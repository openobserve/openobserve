<!-- Copyright 2026 OpenObserve Inc. SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { useSecuritySources } from "@/composables/security/useSecuritySources";
import { loadSecurityAccess, useSecurityAccess } from "@/composables/security/useSecurityAccess";
import {
  attachErrorOf,
  type AttachPlan,
  type DetachResult,
  type PackRef,
  type PreAttachBlock,
  type SourceNoticeCode,
  type SourceRow,
} from "@/services/securitySources";
import {
  attachPackMutation,
  attachPlanMutation,
  detachPackMutation,
} from "@/services/securitySources.queries";
import { ocsfClass } from "@/utils/security/ocsf";
import { formatTimestamp } from "@/utils/date";

interface Row {
  name: string;
  state: SourceRow["state"];
  label: I18nText;
  sourceTypeLabel: I18nText;
  sourceType: string;
  /** Who made the last change and what it was, from the server's record. */
  lastChange: I18nText | null;
  included: boolean;
  pack: PackRef | null;
  /** Set when there is a pack to remove: the recorded one, or an unrecorded node on the pipeline. */
  detachPack: PackRef | null;
}

const { t } = useI18nTyped();
const store = useStore();
const secSources = useSecuritySources();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
// Attaching writes a function and pipeline (authoring); including is triage; detaching or excluding weakens coverage (admin).
const { canTriage, canAuthor, canAdmin } = useSecurityAccess();
const attachMutation = useMutation(computed(() => attachPackMutation(orgId.value)));
const detachMutation = useMutation(computed(() => detachPackMutation(orgId.value)));
const planMutation = useMutation(computed(() => attachPlanMutation(orgId.value)));
const busy = computed(() => attachMutation.isPending.value || detachMutation.isPending.value);
const globalFlattenLevel = computed(() => Number(store.state.zoConfig?.ingest_flatten_level ?? 3));

const actionNotice = ref<SecurityNotice | null>(null);
const errorNotice = ref<SecurityNotice | null>(null);
const blockNotices = ref<SecurityNotice[]>([]);

const minute = (us: number) => formatTimestamp(us, "YYYY-MM-DD HH:mm");

function lastChangeText(row: SourceRow): I18nText | null {
  const change = row.last_change;
  if (!change) return null;
  return t("siem.sources.lastChange", {
    user: raw(change.by),
    time: minute(change.at),
    summary: raw(change.summary),
  });
}

function excludedText(row: SourceRow) {
  if (!row.updated_by) return t("siem.sources.stateExcluded");
  return t("siem.sources.excludedBy", { user: raw(row.updated_by), time: minute(row.updated_at) });
}

function stateText(row: SourceRow): I18nText {
  if (row.state === "mapped") {
    return t("siem.sources.stateMapped", {
      pack: `${row.setting?.pack_id ?? ""}@${row.setting?.pack_version ?? 0}`,
    });
  }
  if (row.state === "excluded") return excludedText(row);
  if (row.state === "included") return t("siem.sources.stateIncluded");
  if (row.suggested && row.verdict) {
    return t("siem.sources.stateSuggested", { label: raw(row.verdict.label) });
  }
  return t("siem.sources.stateNotMapped");
}

const rows = computed<Row[]>(() =>
  secSources.rows.value.map((row) => ({
    name: row.name,
    state: row.state,
    label: stateText(row),
    sourceTypeLabel: row.verdict
      ? t("siem.sources.sourceTypeConfidence", {
          label: raw(row.verdict.label),
          n: Math.round(row.verdict.confidence * 100),
        })
      : row.source_type
        ? raw(row.source_type)
        : t("siem.sources.notClassified"),
    sourceType: row.source_type,
    lastChange: lastChangeText(row),
    included: row.reason !== null,
    pack: row.offered_pack,
    detachPack: row.detach_pack,
  })),
);

const columns = computed<OTableColumnDef<Row>[]>(() => [
  { id: "name", header: t("siem.sources.colStream"), accessorKey: "name", meta: { isName: true } },
  {
    id: "sourceType",
    header: t("siem.sources.colSourceType"),
    accessorKey: "sourceTypeLabel",
    size: 220,
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

function noticeText(code: SourceNoticeCode, stream: string): I18nText {
  if (code === "pack_removed_outside") return t("siem.sources.noticePackRemoved", { stream });
  if (code === "pipeline_not_writing_back") return t("siem.sources.noticeNotWriting", { stream });
  if (code === "pipeline_disabled") return t("siem.sources.noticeDisabled", { stream });
  return t("siem.sources.noticeNoRecord", { stream });
}

const notices = computed<SecurityNotice[]>(() => [
  ...(errorNotice.value ? [errorNotice.value] : []),
  ...(actionNotice.value ? [actionNotice.value] : []),
  ...blockNotices.value,
  ...secSources.notices.value.map((n) => ({
    key: `${n.code}-${n.stream}`,
    tone: "warning" as const,
    text: noticeText(n.code, n.stream),
  })),
]);

function blockText(block: PreAttachBlock, stream: string): I18nText {
  if (block.code === "stream_not_written") {
    return t("siem.sources.blockStreamNotWritten", {
      stream,
      streams: (block.streams ?? []).join(", "),
    });
  }
  if (block.code === "flatten_level_mismatch")
    return t("siem.sources.blockFlattenLevel", { stream });
  if (block.code === "global_flatten_level") {
    return t("siem.sources.blockGlobalFlatten", { stream, level: globalFlattenLevel.value });
  }
  if (block.code === "schema_missing_columns") {
    return t("siem.sources.blockSchemaMissing", {
      stream,
      columns: (block.columns ?? []).join(", "),
    });
  }
  return t("siem.sources.blockPipelineDisabled", { stream });
}

function clearNotices() {
  actionNotice.value = null;
  errorNotice.value = null;
  blockNotices.value = [];
}

/** Shows a refused action: the pre-attach blocks one by one, else the server's message. */
function showRefusal(err: unknown, stream: string, fallback: I18nText) {
  const refusal = attachErrorOf(err);
  if (refusal?.blocks?.length) {
    blockNotices.value = refusal.blocks.map((b) => ({
      key: `block-${stream}-${b.code}`,
      tone: "warning",
      text: blockText(b, stream),
    }));
    return;
  }
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  errorNotice.value = {
    key: "action-error",
    tone: "error",
    text: raw(refusal?.message ?? message) || fallback,
  };
}

async function reload() {
  if (!orgId.value) return;
  // Stale warnings must not survive a reload or an org switch.
  blockNotices.value = [];
  await secSources.load(orgId.value);
  // Awaits the cached access answer, which a first load can reach before the reactive flag has it.
  await secSources.migrateIncludes((await loadSecurityAccess(orgId.value)).triage);
}

/** The stream whose attach plan is shown; nothing is written until it is confirmed. */
const previewStream = ref("");
const plan = ref<AttachPlan | null>(null);
const previewOpen = computed(() => !!previewStream.value);

function closePreview() {
  previewStream.value = "";
  plan.value = null;
}

async function onAttach(row: Row) {
  if (!row.pack || !canAuthor.value) return;
  clearNotices();
  previewStream.value = row.name;
  plan.value = null;
  try {
    const res = await planMutation.mutateAsync(row.name);
    if (previewStream.value === row.name) plan.value = res.plan;
  } catch (err) {
    closePreview();
    showRefusal(err, row.name, t("siem.sources.actionFailed"));
  }
}

async function confirmAttach() {
  const stream = previewStream.value;
  const planned = plan.value;
  if (!stream || !planned || !canAuthor.value) return;
  try {
    // The previewed pack is pinned, so what runs is exactly what was shown.
    const res = await attachMutation.mutateAsync({
      stream,
      packId: planned.pack_id,
      packVersion: planned.pack_version,
    });
    analytics.track("security_source_pack_attached", {
      source_type: res.setting.source_type,
      // The server reads a setting's pack kind the same way when the pack itself is gone.
      kind: res.setting.pack_id === "entity" ? "entity" : "full",
      pipeline_created: res.pipeline_created,
    });
    closePreview();
    actionNotice.value = {
      key: "attached",
      tone: "info",
      text: t("siem.sources.attached", { pack: `${planned.pack_id}@${planned.pack_version}` }),
    };
  } catch (err) {
    closePreview();
    showRefusal(err, stream, t("siem.sources.actionFailed"));
  }
}

const classText = (uid: number) => {
  const name = ocsfClass(uid)?.name ?? (uid === 0 ? "Base Event" : "");
  return name ? `${name} (${uid})` : String(uid);
};

const planRows = computed<{ key: string; label: I18nText; value: I18nText }[]>(() => {
  const p = plan.value;
  if (!p) return [];
  const pipeline =
    p.pipeline_action === "create"
      ? t("siem.sources.previewPipelineCreate", {
          name: p.pipeline_name,
          stream: previewStream.value,
        })
      : p.pipeline_action === "already_present"
        ? t("siem.sources.previewPipelineAlready", { name: p.pipeline_name || p.pipeline_id })
        : t("siem.sources.previewPipelineExtend", {
            name: p.pipeline_name || p.pipeline_id,
            feeds: p.feeds.join(", ") || "—",
          });
  return [
    {
      key: "pack",
      label: t("siem.sources.previewPack"),
      value: raw(`${p.pack_label} (${p.pack_id}@${p.pack_version})`),
    },
    {
      key: "classes",
      label: t("siem.sources.previewClasses"),
      value: raw(p.ocsf_classes.map(classText).join(", ")),
    },
    {
      key: "function",
      label: t("siem.sources.previewFunction"),
      value:
        p.function_action === "reuse"
          ? t("siem.sources.previewFunctionReuse", { name: p.function_name })
          : t("siem.sources.previewFunctionCreate", { name: p.function_name }),
    },
    { key: "pipeline", label: t("siem.sources.previewPipeline"), value: pipeline },
  ];
});

function detachedText(res: DetachResult | undefined): I18nText {
  const skipped = res?.skipped;
  if (!skipped) return t("siem.sources.detached");
  return t("siem.sources.detachedSkipped", {
    id: skipped.pipeline_id,
    reason: t(`siem.sources.skipReason.${skipped.reason}`),
  });
}

async function onDetach(row: Row) {
  if (!row.detachPack || !canAdmin.value) return;
  clearNotices();
  try {
    const res = await detachMutation.mutateAsync(row.name);
    analytics.track("security_source_pack_detached", {
      source_type: row.sourceType,
      pipeline_skipped: !!res?.skipped,
    });
    actionNotice.value = {
      key: "detached",
      tone: res?.skipped ? "warning" : "info",
      text: detachedText(res),
    };
  } catch (err) {
    showRefusal(err, row.name, t("siem.sources.actionFailed"));
  }
}

/** Include/exclude is the org-wide stream setting; a refused save shows in the notices. */
async function setIncluded(row: Row, included: boolean) {
  if (!(included ? canTriage.value : canAdmin.value)) return;
  clearNotices();
  try {
    await (included ? secSources.include(row.name) : secSources.exclude(row.name));
  } catch (err) {
    showRefusal(err, row.name, t("siem.sources.actionFailed"));
    return;
  }
  analytics.track("security_source_inclusion_changed", { included, view: "sources" });
}

watch(orgId, (id) => {
  if (id) void reload();
});

onMounted(reload);
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
        <span class="inline-flex items-center" :data-test="`security-sources-state-${row.name}`">
          <OTag v-if="row.state === 'mapped'" variant="teal-soft" shape="rounded" size="xs">{{
            row.label
          }}</OTag>
          <OTag
            v-else-if="row.state === 'included'"
            variant="blue-soft"
            shape="rounded"
            size="xs"
            >{{ row.label }}</OTag
          >
          <OTag
            v-else-if="row.state === 'excluded'"
            variant="warning-soft"
            shape="rounded"
            size="xs"
            >{{ row.label }}</OTag
          >
          <span v-else class="text-text-secondary">{{ row.label }}</span>
          <OTooltip v-if="row.lastChange" :content="row.lastChange" />
        </span>
      </template>
      <template #cell-actions="{ row }">
        <div v-if="canTriage || canAuthor || canAdmin" class="flex items-center justify-end gap-2">
          <OButton
            v-if="row.detachPack && canAdmin"
            size="sm"
            variant="outline"
            :loading="busy"
            data-test="security-sources-detach"
            @click="onDetach(row)"
          >
            {{ t("siem.sources.detach") }}
          </OButton>
          <OButton
            v-else-if="!row.detachPack && row.pack && canAuthor"
            size="sm"
            variant="primary"
            :loading="busy"
            data-test="security-sources-attach"
            @click="onAttach(row)"
          >
            {{ t("siem.sources.attach") }}
          </OButton>
          <OButton
            v-if="!row.included && canTriage"
            size="sm"
            variant="ghost"
            data-test="security-sources-include"
            @click="setIncluded(row, true)"
          >
            {{ t("siem.sources.include") }}
          </OButton>
          <OButton
            v-else-if="row.included && row.state !== 'mapped' && canAdmin"
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

    <ODialog
      :open="previewOpen"
      size="md"
      :title="
        t('siem.sources.previewTitle', {
          pack: plan ? `${plan.pack_id}@${plan.pack_version}` : '…',
          stream: previewStream,
        })
      "
      :sub-title="t('siem.sources.previewSubtitle')"
      :primary-button-label="t('siem.sources.confirmAttach')"
      :secondary-button-label="t('siem.sources.cancel')"
      :primary-button-disabled="!plan || !canAuthor"
      :primary-button-loading="attachMutation.isPending.value"
      primary-button-data-test="security-sources-attach-confirm"
      data-test="security-sources-attach-preview"
      @update:open="(v: boolean) => !v && closePreview()"
      @click:secondary="closePreview"
      @click:primary="confirmAttach"
    >
      <OBanner v-if="!plan" variant="info" icon="hourglass-empty" dense>
        {{ t("siem.sources.previewLoading") }}
      </OBanner>
      <dl v-else class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <template v-for="r in planRows" :key="r.key">
          <dt class="text-text-secondary">{{ r.label }}</dt>
          <dd class="text-text-heading break-words" :data-test="`security-sources-plan-${r.key}`">
            {{ r.value }}
          </dd>
        </template>
      </dl>
    </ODialog>
  </OPageLayout>
</template>
