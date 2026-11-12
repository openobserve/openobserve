<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- Alert names are not unique, so a rule already installed for the stream is skipped, not duplicated. -->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="t('aiAlertPack.title')"
    :sub-title="t('aiAlertPack.subtitle')"
    :primary-button-label="
      toInstall.length
        ? t('aiAlertPack.install', { n: toInstall.length }, toInstall.length)
        : t('aiAlertPack.allInstalled')
    "
    :primary-button-disabled="!stream || loading || toInstall.length === 0"
    :primary-button-loading="installing"
    primary-button-data-test="ai-alert-pack-install"
    :secondary-button-label="t('common.cancel')"
    data-test="ai-alert-pack-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="install"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <OSelect
          v-model="stream"
          :options="streamOptions"
          :label="t('aiAlertPack.stream')"
          :loading="loading"
          data-test="ai-alert-pack-stream"
        />
        <OSelect
          v-model="destination"
          :options="destinationOptions"
          :label="t('aiAlertPack.destination')"
          :placeholder="t('aiAlertPack.noDestination')"
          :loading="loading"
          clearable
          data-test="ai-alert-pack-destination"
        />
      </div>
      <span
        v-if="!loading && !streams.length"
        class="text-compact text-text-secondary"
        data-test="ai-alert-pack-no-trace-stream"
      >
        {{ t("aiAlertPack.noTraceStream") }}
      </span>

      <section v-for="group in groups" :key="group.kind" class="flex flex-col gap-1">
        <span class="text-compact text-text-heading font-medium">{{ group.label }}</span>
        <div
          v-for="rule in group.rules"
          :key="rule.id"
          class="border-border-default flex items-center gap-3 border-b py-1.5 last:border-b-0"
          :data-test="`ai-alert-pack-rule-${rule.id}`"
        >
          <span class="text-compact text-text-body w-48 shrink-0">{{ t(rule.titleKey) }}</span>
          <span class="text-2xs text-text-secondary min-w-0 flex-1">{{ t(rule.whenKey) }}</span>
          <OBadge
            v-if="isInstalled(rule)"
            variant="primary-soft"
            size="sm"
            data-test="ai-alert-pack-rule-installed"
          >
            {{ t("aiAlertPack.installed") }}
          </OBadge>
          <OBadge
            v-else
            :variant="readiness(rule) === 'ready' ? 'success-soft' : 'default-soft'"
            size="sm"
          >
            {{
              readiness(rule) === "ready" ? t("aiAlertPack.runsNow") : t(ruleWaitsKey(rule, stream))
            }}
          </OBadge>
        </div>
      </section>

      <span v-if="stream" class="text-2xs text-text-secondary" data-test="ai-alert-pack-summary">
        {{
          toInstall.length
            ? t(
                "aiAlertPack.summary",
                {
                  n: toInstall.length,
                  folder: AI_PACK_FOLDER,
                  waiting: AI_AGENTS_PACK.length - ready.length,
                },
                toInstall.length,
              )
            : t("aiAlertPack.nothingToAdd", {
                waiting: AI_AGENTS_PACK.length - ready.length,
              })
        }}
        <template v-if="toInstall.length && skipped">
          {{ t("aiAlertPack.skipped", { n: skipped }, skipped) }}
        </template>
      </span>
    </div>
  </ODialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import useStreams from "@/composables/useStreams";
import destinationService from "@/services/alert_destination";
import { errorMessage } from "@/services/alert_calibration";
import alertsService from "@/services/alerts";
import { createFolderByType, getFoldersListByType } from "@/utils/commons";
import {
  AI_AGENTS_PACK,
  AI_PACK_FOLDER,
  aiPackAlertPayload,
  packAlertName,
  ruleReadiness,
  ruleWaitsKey,
  streamKey,
  type AiPackRule,
} from "@/utils/alerts/aiAgentsPack";

const props = defineProps<{ open: boolean; defaultStream?: string }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "installed", count: number): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { getStreams } = useStreams(t);

const loading = ref(false);
const installing = ref(false);
const streams = ref<string[]>([]);
const destinations = ref<string[]>([]);
// `_`-prefixed streams included: the evaluator's rules read `_llm_scores` and `_evaluator`.
const existingStreams = ref<Set<string>>(new Set());
const stream = ref("");
const destination = ref<string | null>(null);

const streamOptions = computed(() => streams.value.map((s) => ({ value: s, label: raw(s) })));
const destinationOptions = computed(() =>
  destinations.value.map((d) => ({ value: d, label: raw(d) })),
);
const readiness = (rule: AiPackRule) => ruleReadiness(rule, stream.value, existingStreams.value);
const ready = computed(() => AI_AGENTS_PACK.filter((r) => readiness(r) === "ready"));

// Exact because a rule's alert is named for the stream it was installed for (packAlertName).
const installedAlerts = ref<Set<string>>(new Set());
const alertKey = (streamName: string, name: string) => `${streamName}/${name}`;
function isInstalled(rule: AiPackRule): boolean {
  if (!rule.spec || !stream.value) return false;
  const spec = rule.spec(stream.value);
  return installedAlerts.value.has(alertKey(spec.streamName, packAlertName(spec, stream.value)));
}
const toInstall = computed(() => ready.value.filter((r) => !isInstalled(r)));
const skipped = computed(() => ready.value.length - toInstall.value.length);

// Every pack alert is named ai_*; one listing covers every stream and folder.
async function loadInstalled(): Promise<Set<string>> {
  const res: any = await alertsService.listByFolderId(
    1,
    1000,
    "name",
    false,
    "",
    org(),
    undefined,
    "ai_",
  );
  return new Set(
    (res?.data?.list ?? []).map((a: { stream_name: string; name: string }) =>
      alertKey(a.stream_name, a.name),
    ),
  );
}
const groups = computed(() => [
  {
    kind: "rule",
    label: t("aiAlertPack.reliabilityRules"),
    rules: AI_AGENTS_PACK.filter((r) => r.kind === "rule"),
  },
  {
    kind: "template",
    label: t("aiAlertPack.templates"),
    rules: AI_AGENTS_PACK.filter((r) => r.kind === "template"),
  },
]);

const org = () => store.state.selectedOrganization?.identifier ?? "";

type StreamItem = { name: string; settings?: { is_llm_stream?: boolean } };
const streamList = (res: unknown): StreamItem[] =>
  res && typeof res === "object" && "list" in res && Array.isArray(res.list) ? res.list : [];

async function load() {
  loading.value = true;
  try {
    const [traceStreams, logStreams, dest, installed] = await Promise.all([
      getStreams("traces", false, false),
      getStreams("logs", false, false).catch(() => ({ list: [] })),
      destinationService
        .list({
          org_identifier: org(),
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          module: "alert",
        })
        .catch(() => ({ data: [] })),
      // Unknown on a failed listing: nothing is marked, as before.
      loadInstalled().catch(() => new Set<string>()),
    ]);
    installedAlerts.value = installed;
    const traceList = streamList(traceStreams);
    const logList = streamList(logStreams);
    streams.value = traceList
      .filter((s) => s?.settings?.is_llm_stream !== false && !s.name.startsWith("_"))
      .map((s) => s.name);
    existingStreams.value = new Set([
      ...traceList.map((s) => streamKey("traces", s.name)),
      ...logList.map((s) => streamKey("logs", s.name)),
    ]);
    destinations.value = (Array.isArray((dest as any)?.data) ? (dest as any).data : [])
      .map((d: { name?: string }) => d?.name)
      .filter((n: unknown): n is string => typeof n === "string" && n !== "");
    stream.value = streams.value.includes(props.defaultStream ?? "")
      ? (props.defaultStream as string)
      : (streams.value[0] ?? "");
    destination.value = destinations.value[0] ?? null;
  } finally {
    loading.value = false;
  }
}

async function packFolderId(): Promise<string> {
  const folders: Array<{ folderId: string; name: string }> =
    (await getFoldersListByType(store, "alerts")) ?? [];
  const found = folders.find((f) => f.name === AI_PACK_FOLDER);
  if (found) return found.folderId;
  const created: any = await createFolderByType(
    store,
    { name: AI_PACK_FOLDER, description: t("aiAlertPack.folderDescription") },
    "alerts",
  );
  return created?.data?.folderId ?? "default";
}

async function install() {
  if (!stream.value) return;
  installing.value = true;
  let installed = 0;
  const failed: string[] = [];
  try {
    const folderId = await packFolderId();
    for (const rule of toInstall.value) {
      const spec = rule.spec!(stream.value);
      const payload = aiPackAlertPayload(rule.id, spec, {
        stream: stream.value,
        folderId,
        destination: destination.value ?? "",
        owner: store.state.userInfo?.email ?? "",
        timezone: store.state.timezone || "UTC",
      });
      try {
        await alertsService.create_by_alert_id(org(), payload, folderId);
        installed++;
        // Mark it now, so a retry after a partial install skips it.
        installedAlerts.value = new Set(installedAlerts.value).add(
          alertKey(spec.streamName, packAlertName(spec, stream.value)),
        );
      } catch (e) {
        // Name the server's reason (e.g. "Stream _evaluator not found").
        const reason = errorMessage(e);
        failed.push(reason ? `${t(rule.titleKey)} (${reason})` : t(rule.titleKey));
      }
    }
  } catch (e) {
    // The folder could not be found or created: nothing below it ran. Keep the dialog open.
    console.error("AI alert pack install error:", e);
    toast({
      variant: "error",
      message: t("aiAlertPack.installFailed", { reason: errorMessage(e) || String(e) }),
    });
    return;
  } finally {
    installing.value = false;
  }
  toast({
    variant: failed.length ? "warning" : "success",
    message: failed.length
      ? t("aiAlertPack.installedSome", { n: installed, failed: failed.join(", ") }, installed)
      : t("aiAlertPack.installedAll", { n: installed, folder: AI_PACK_FOLDER }, installed),
  });
  if (installed) emit("installed", installed);
  if (!failed.length) emit("update:open", false);
}

watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);
</script>
