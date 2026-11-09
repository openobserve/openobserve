<!-- Copyright 2026 OpenObserve Inc. SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";

import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped } from "@/types/i18n";

import ocsfPacks, { type OcsfPack } from "@/services/ocsfPacks";
import analytics from "@/services/product_analytics";
import { useSecuritySources } from "@/composables/security/useSecuritySources";
import { realtimePipelinesFor, useOcsfAttach } from "@/composables/security/useOcsfAttach";
import {
  findOurNode,
  preAttachChecks,
  type AttachConfig,
  type Pipeline,
  type PreAttachBlock,
  type SecuritySetting,
} from "@/utils/security/ocsfPipeline";
import type { StreamWithSecurity } from "@/utils/security/sourceSelection";

// Columns the packs guarantee; used by the user-defined-schema pre-attach check.
const GUARANTEED_COLUMNS = [
  "class_uid",
  "class_name",
  "category_uid",
  "category_name",
  "activity_id",
  "activity_name",
  "type_uid",
  "severity_id",
  "severity",
  "status_id",
  "o2_ocsf_pack",
];

interface SourceRow {
  name: string;
  state: "mapped" | "included" | "notMapped";
  label: string;
  sourceType: string;
  included: boolean;
  setting: SecuritySetting | null;
  pack: OcsfPack | null;
  streamSettings: StreamWithSecurity["settings"] | undefined;
  // Non-null when the pipeline carries our node but no setting records it: detach can still remove it.
  detachSetting: SecuritySetting | null;
}

const { t } = useI18nTyped();
const store = useStore();
const secSources = useSecuritySources();
const attachFlow = useOcsfAttach();

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
// Only admins can write stream settings, so only they migrate local include/exclude choices.
const canWrite = computed(() =>
  ["admin", "root"].includes(
    String(store.state.userInfo?.role ?? store.state.currentuser?.role ?? "").toLowerCase(),
  ),
);
// Falls back to the backend default (3) only until zoConfig.ingest_flatten_level is loaded.
const attachConfig = computed<AttachConfig>(() => ({
  globalFlattenLevel: Number(store.state.zoConfig?.ingest_flatten_level ?? 3),
  guaranteedColumns: GUARANTEED_COLUMNS,
}));

const packs = ref<OcsfPack[]>([]);
const entityPack = computed(() => packs.value.find((p) => p.kind === "entity") ?? null);
const allPipelines = ref<Pipeline[]>([]);
const pipelinesLoaded = ref(false);
const actionNotice = ref<SecurityNotice | null>(null);
const blockNotices = ref<SecurityNotice[]>([]);

/** The full pack for the stream's classified type, falling back to the generic entity pack. */
function offeredPack(sourceType: string): OcsfPack | null {
  return (
    packs.value.find((p) => p.kind === "full" && p.source_type === sourceType) ?? entityPack.value
  );
}

function realtimePipelineFor(stream: string): Pipeline | null {
  return realtimePipelinesFor(allPipelines.value, stream)[0] ?? null;
}

/** A pseudo-setting so detach can remove an unrecorded OCSF node. */
function orphanDetachSetting(
  stream: string,
  sourceType: string,
  included: boolean,
): SecuritySetting | null {
  // Never read a stale pipeline list: an old org's pipeline_id would drive a wrong-org Detach.
  if (!pipelinesLoaded.value) return null;
  const pipeline = realtimePipelineFor(stream);
  const node = pipeline ? findOurNode(pipeline) : null;
  const tag = (node?.meta as { o2_ocsf_pack?: string })?.o2_ocsf_pack;
  if (!pipeline || !tag) return null;
  const [packId, version] = tag.split("@");
  return {
    source_type: sourceType,
    pack_id: packId ?? "",
    pack_version: Number(version ?? 0),
    attached_at: 0,
    pipeline_id: pipeline.pipeline_id ?? "",
    pipeline_created: false,
    included,
  };
}

const suggestionByName = computed(
  () => new Map(secSources.suggestions.value.map((e) => [e.name, e.verdict])),
);

const rows = computed<SourceRow[]>(() => {
  const streams = secSources.streams.value as StreamWithSecurity[];
  const included = new Set(secSources.sourceNames.value);
  return streams
    .filter((s) => !s.name.startsWith("_"))
    .map((s) => {
      const setting = s.settings?.security ?? null;
      const sourceType = setting?.source_type || "";
      if (setting?.pack_id) {
        return {
          name: s.name,
          state: "mapped" as const,
          label: t("siem.sources.stateMapped", {
            pack: `${setting.pack_id}@${setting.pack_version}`,
          }),
          sourceType,
          included: setting.included !== false,
          setting,
          pack: offeredPack(sourceType),
          streamSettings: s.settings,
          detachSetting: setting,
        };
      }
      const isIncluded = setting?.included === true || included.has(s.name);
      const suggestion = suggestionByName.value.get(s.name);
      const label = isIncluded
        ? t("siem.sources.stateIncluded")
        : suggestion
          ? t("siem.sources.stateSuggested", { label: suggestion.label })
          : t("siem.sources.stateNotMapped");
      return {
        name: s.name,
        state: isIncluded ? ("included" as const) : ("notMapped" as const),
        label,
        sourceType,
        included: isIncluded,
        setting,
        pack: offeredPack(sourceType),
        streamSettings: s.settings,
        detachSetting: orphanDetachSetting(s.name, sourceType, isIncluded),
      };
    });
});

const columns = computed<OTableColumnDef<SourceRow>[]>(() => [
  { id: "name", header: t("siem.sources.colStream"), accessorKey: "name", meta: { isName: true } },
  {
    id: "sourceType",
    header: t("siem.sources.colSourceType"),
    accessorKey: "sourceType",
    size: 180,
  },
  { id: "mapping", header: t("siem.sources.colMapping"), accessorKey: "label", size: 200 },
  {
    id: "actions",
    header: t("siem.sources.colActions"),
    accessorKey: "name",
    size: 280,
    meta: { align: "right" },
  },
]);

function consistencyText(state: string, stream: string): string | null {
  if (state === "pack_removed_outside") return t("siem.sources.noticePackRemoved", { stream });
  if (state === "pipeline_not_writing_back") return t("siem.sources.noticeNotWriting", { stream });
  if (state === "pipeline_disabled") return t("siem.sources.noticeDisabled", { stream });
  return null;
}

// Consistency states computed from the one listPipelines call, with no per-stream GET.
const consistencyNotices = computed<SecurityNotice[]>(() => {
  if (!pipelinesLoaded.value) return [];
  const out: SecurityNotice[] = [];
  for (const row of rows.value) {
    if (row.state === "mapped" && row.setting) {
      const pipeline =
        allPipelines.value.find((p) => (p.pipeline_id ?? "") === row.setting!.pipeline_id) ?? null;
      const text = consistencyText(attachFlow.consistency(row.setting, pipeline), row.name);
      if (text) out.push({ key: `cons-${row.name}`, tone: "warning", text });
    }
  }
  // A realtime pipeline carrying our node on a stream with no recorded pack.
  const mapped = new Set(rows.value.filter((r) => r.state === "mapped").map((r) => r.name));
  for (const p of allPipelines.value) {
    const stream = p.source?.stream_name;
    if (typeof stream !== "string" || mapped.has(stream)) continue;
    if (attachFlow.consistency(null, p) === "attached_without_record") {
      out.push({
        key: `rec-${stream}`,
        tone: "warning",
        text: t("siem.sources.noticeNoRecord", { stream }),
      });
    }
  }
  return out;
});

const notices = computed<SecurityNotice[]>(() => {
  const out: SecurityNotice[] = [];
  const err = attachFlow.error.value;
  if (err) {
    const text = "raw" in err ? raw(err.raw) : t(err.key, err.params ?? {});
    out.push({ key: "attach-error", tone: "error", text });
  }
  if (actionNotice.value) out.push(actionNotice.value);
  return [...out, ...blockNotices.value, ...consistencyNotices.value];
});

async function loadPipelines() {
  const org = orgId.value;
  pipelinesLoaded.value = false;
  try {
    const res = await ocsfPacks.listPipelines(org);
    // Drop a late response from a previous org so its pipelines never drive another org's rows.
    if (org !== orgId.value) return;
    allPipelines.value = (res.data?.list ?? res.data ?? []) as Pipeline[];
    pipelinesLoaded.value = true;
  } catch {
    if (org === orgId.value) allPipelines.value = [];
  }
}

async function reload() {
  if (!orgId.value) return;
  // Stale pre-attach warnings must not survive a reload or an org switch.
  blockNotices.value = [];
  await Promise.all([secSources.load(orgId.value, { fetchSchema: false }), loadPipelines()]);
  await secSources.migrateIncludes(canWrite.value);
}

async function loadPacks() {
  try {
    const res = await ocsfPacks.listPacks(orgId.value);
    packs.value = res.packs ?? [];
  } catch {
    packs.value = [];
  }
}

function blockText(block: PreAttachBlock, stream: string): string {
  if (block.code === "stream_not_written") {
    return t("siem.sources.blockStreamNotWritten", {
      stream,
      streams: (block.streams ?? []).join(", "),
    });
  }
  if (block.code === "flatten_level_mismatch") {
    return t("siem.sources.blockFlattenLevel", { stream });
  }
  if (block.code === "global_flatten_level") {
    return t("siem.sources.blockGlobalFlatten", {
      stream,
      level: attachConfig.value.globalFlattenLevel,
    });
  }
  if (block.code === "schema_missing_columns") {
    return t("siem.sources.blockSchemaMissing", {
      stream,
      columns: (block.columns ?? []).join(", "),
    });
  }
  return t("siem.sources.blockPipelineDisabled", { stream });
}

async function onAttach(row: SourceRow) {
  if (!row.pack) return;
  actionNotice.value = null;
  blockNotices.value = [];
  // Pre-attach checks run first, so a blocked stream is never recorded as mapped.
  const blocks = preAttachChecks(
    { name: row.name, settings: row.streamSettings ?? undefined },
    pipelinesLoaded.value ? realtimePipelineFor(row.name) : null,
    attachConfig.value,
  );
  if (blocks.length) {
    blockNotices.value = blocks.map((b) => ({
      key: `block-${row.name}-${b.code}`,
      tone: "warning",
      text: blockText(b, row.name),
    }));
    return;
  }
  const res = await attachFlow.attach(orgId.value, row.name, row.pack, true, attachConfig.value);
  if (res) {
    actionNotice.value = {
      key: "attached",
      tone: "info",
      text: t("siem.sources.attached", { pack: `${row.pack.id}@${row.pack.version}` }),
    };
  }
  await reload();
}

async function onDetach(row: SourceRow) {
  if (!row.detachSetting) return;
  actionNotice.value = null;
  blockNotices.value = [];
  // Only persist a cleared setting when the stream already had one; an undecided orphan stays undecided.
  const res = await attachFlow.detach(
    orgId.value,
    row.name,
    row.detachSetting,
    row.setting != null,
  );
  if (res?.pipeline_skipped) {
    actionNotice.value = {
      key: "detached",
      tone: "warning",
      text: t("siem.sources.detachedPipelineSkipped"),
    };
  } else if (res !== null) {
    actionNotice.value = { key: "detached", tone: "info", text: t("siem.sources.detached") };
  }
  await reload();
}

/** Include/exclude is stored in the setting when the stream has one, else in the local fallback. */
async function setIncluded(row: SourceRow, included: boolean) {
  blockNotices.value = [];
  if (row.setting) {
    // Routed through run() so a 403 surfaces in the notices and the row only reloads on success.
    const setting = { ...row.setting, included };
    const res = await attachFlow.run(() => ocsfPacks.saveSetting(orgId.value, row.name, setting));
    if (res !== null) {
      analytics.track("security_source_inclusion_changed", { included, view: "sources" });
      await reload();
    }
    return;
  }
  if (included) secSources.include(row.name);
  else secSources.exclude(row.name);
  analytics.track("security_source_inclusion_changed", { included, view: "sources" });
}

watch(orgId, async (id) => {
  if (!id) return;
  await loadPacks();
  await reload();
});

onMounted(async () => {
  await loadPacks();
  await reload();
});
</script>

<template>
  <OPageLayout
    :title="t('siem.sources.title')"
    :subtitle="t('siem.sources.subtitle')"
    icon="cloud-upload"
    data-test="security-sources"
  >
    <SecurityNotices :notices="notices" data-test="security-sources-notices" />
    <OTable
      :data="rows"
      :columns="columns"
      row-key="name"
      :loading="secSources.loading.value && !rows.length"
      pagination="client"
      :show-global-filter="true"
      class="min-h-0 flex-1"
      data-test="security-sources-table"
    >
      <template #cell-mapping="{ row }">
        <OTag v-if="row.state === 'mapped'" variant="teal-soft" shape="rounded" size="xs">{{
          row.label
        }}</OTag>
        <OTag v-else-if="row.state === 'included'" variant="blue-soft" shape="rounded" size="xs">{{
          row.label
        }}</OTag>
        <span v-else class="text-text-secondary">{{ row.label }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-2">
          <OButton
            v-if="row.detachSetting"
            size="sm"
            variant="outline"
            :loading="attachFlow.busy.value"
            data-test="security-sources-detach"
            @click="onDetach(row)"
          >
            {{ t("siem.sources.detach") }}
          </OButton>
          <OButton
            v-else-if="row.pack"
            size="sm"
            variant="primary"
            :loading="attachFlow.busy.value"
            data-test="security-sources-attach"
            @click="onAttach(row)"
          >
            {{ t("siem.sources.attach") }}
          </OButton>
          <OButton
            v-if="!row.included"
            size="sm"
            variant="ghost"
            data-test="security-sources-include"
            @click="setIncluded(row, true)"
          >
            {{ t("siem.sources.include") }}
          </OButton>
          <OButton
            v-else-if="row.state !== 'mapped'"
            size="sm"
            variant="ghost"
            data-test="security-sources-exclude"
            @click="setIncluded(row, false)"
          >
            {{ t("siem.sources.exclude") }}
          </OButton>
        </div>
      </template>
      <template #cell-name="{ row }">
        <span class="text-text-heading truncate font-medium">{{ raw(row.name) }}</span>
      </template>
      <template #empty>
        <OEmptyState
          size="inline"
          icon="cloud-upload"
          :title="t('siem.sources.title')"
          :description="t('siem.sources.empty')"
        />
      </template>
    </OTable>
  </OPageLayout>
</template>
