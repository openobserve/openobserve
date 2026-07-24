<template>
  <ODrawer
    bleed
    :open="open"
    side="right"
    :width="70"
    :title="row?.name"
    :title-data-test="'scorer-detail-name-badge'"
    :sub-title="t('onlineEvals.scorer.detail.eyebrow')"
    data-test="scorer-detail"
    @update:open="handleOpenChange"
  >
    <!-- Body: the KPI strip + tab bar stay pinned; only the tab content scrolls. -->
    <div class="flex h-full min-h-0 flex-col">
      <!-- ── Global window control ── -->
      <!-- A single date picker drives the WHOLE detail view — the KPI strip
           and the Runs table share this one window. Placed above the cards
           (right-aligned) so it reads as a page-level control, not a per-tab
           filter. Refresh re-queries everything. -->
      <div class="flex items-center justify-end gap-2 px-5 pt-3">
        <DateTimePickerDashboard
          ref="dateTimePickerRef"
          v-model="selectedDate"
          :auto-apply-dashboard="true"
          class="flex-none"
          data-test="scorer-detail-runs-window"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isLoadingRuns"
          :title="t('onlineEvals.scorer.detail.refresh')"
          data-test="scorer-detail-runs-refresh"
          @click="refreshRuns"
        />
      </div>

      <!-- ── KPI strip ── -->
      <!-- KPI strip — identical card layout + text styles to the LLM
           Sessions detail page (SessionDetails.vue) so the AI module stays
           consistent. Pinned band (shrink-0) with a bottom divider; the cards
           below carry their own chrome via Tailwind. -->
      <section
        class="border-b-dialog-header-border grid shrink-0 grid-cols-4 gap-2.5 border-b px-5 py-4"
      >
        <!-- While the KPI query is in flight, show skeleton tiles in place of
             the cards (matches the LLM Insights dashboard pattern). -->
        <KpiCardsSkeleton v-if="isLoadingKpis" :count="4" />
        <div
          v-for="card in kpiCards"
          v-else
          :key="card.label"
          class="rounded-default bg-surface-base border-border-default flex flex-col gap-1 border px-3.5 pt-2.5 pb-2.5 transition-shadow duration-200 hover:shadow-md"
        >
          <div class="kpi-label text-2xs text-text-secondary mb-1 leading-normal font-semibold">
            {{ card.label }}
          </div>
          <div class="flex items-baseline gap-0.75">
            <span class="text-text-secondary text-2xl leading-none font-bold">
              {{ card.value }}
            </span>
            <span v-if="card.unit" class="text-compact text-text-secondary font-semibold">
              {{ card.unit }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── Tab strip ── -->
      <OTabs
        :model-value="activeTab"
        bordered
        class="shrink-0 px-5"
        data-test="scorer-detail-tabs"
        @update:model-value="activeTab = $event as TabId"
      >
        <!-- Slot mode (no `label` prop) so each tab can carry a count badge
             alongside its label. -->
        <OTab
          v-for="tab in tabs"
          :key="tab.id"
          :name="tab.id"
          :data-test="`scorer-detail-tab-${tab.id}`"
        >
          <span>{{ tab.label }}</span>
          <OTag
            v-if="tab.count != null"
            type="countChip"
            :value="activeTab === tab.id ? 'primary' : 'neutral'"
            >{{ tab.count }}</OTag
          >
        </OTab>
      </OTabs>

      <!-- ── Body ── -->
      <div
        class="flex min-h-0 flex-1 flex-col gap-4.5 overflow-auto pt-4.5"
        :class="{ 'pb-4.5': activeTab !== 'runs' }"
      >
        <!-- Runs filter row — agent filter, right-aligned. The date picker +
             refresh live in the global toolbar above the cards, so they're not
             duplicated here. Rendered once with v-show (not v-if) so it never
             remounts on tab switch. -->
        <div v-show="runsEnabled" class="flex flex-wrap items-center justify-end gap-2 px-5">
          <div class="w-56 shrink-0">
            <OSelect
              v-model="agentKey"
              :options="agentOptions"
              labelKey="label"
              valueKey="value"
              class="rounded-default w-full"
              data-test="scorer-detail-runs-agent-filter"
            />
          </div>
        </div>

        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <!-- No section heading here: the "Configuration" tab label already
               names this block, so an in-panel "Configuration" title (and its
               separator) would just duplicate it. -->
          <section class="flex flex-col gap-2 px-5">
            <dl class="sd-kv">
              <dt>{{ t("onlineEvals.scorer.detail.scorerTypeLabel") }}</dt>
              <dd class="flex flex-wrap items-center gap-1.5">
                <OTag type="scorerType" :value="scorerType" />
                <OTag type="fieldTag" value="soft">v{{ row.version }}</OTag>
              </dd>

              <template v-if="scorerType === 'llm_judge'">
                <dt>{{ t("onlineEvals.scorer.detail.providerLabel") }}</dt>
                <dd>
                  <span v-if="provider">{{ provider.name }}</span>
                  <span v-else class="text-text-secondary italic">{{
                    t("onlineEvals.scorer.detail.providerUnknown")
                  }}</span>
                </dd>

                <template v-if="judgeModel">
                  <dt>{{ t("onlineEvals.scorer.detail.modelLabel") }}</dt>
                  <dd>{{ judgeModel }}</dd>
                </template>
              </template>

              <template v-if="scorerType === 'remote' && remoteEndpoint">
                <dt>{{ t("onlineEvals.scorer.detail.endpointLabel") }}</dt>
                <dd>{{ remoteEndpoint }}</dd>
              </template>
            </dl>
          </section>

          <section class="flex flex-col gap-2 px-5">
            <h4
              class="text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scorer.detail.producesSection") }}
            </h4>
            <div
              v-if="producesConfig"
              class="sd-produces text-text-heading"
              data-test="scorer-detail-produces"
            >
              <OIcon name="rule" size="xs" />
              <span class="sd-produces__name">{{ producesConfig.name }}</span>
              <span class="sd-produces__version text-text-secondary"
                >v{{ producesConfig.version }}</span
              >
              <span class="sd-produces__sep text-text-secondary">·</span>
              <span class="sd-produces__type text-text-secondary">{{
                dataTypeOf(producesConfig)
              }}</span>
            </div>
            <OEmptyState
              v-else
              size="inline"
              :title="t('onlineEvals.scorer.detail.producesEmpty')"
              data-test="scorer-detail-produces-empty"
            />
          </section>

          <section v-if="row.template" class="flex flex-col gap-2 px-5">
            <h4
              class="text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{
                scorerType === "llm_judge"
                  ? t("onlineEvals.scorer.detail.promptSection")
                  : t("onlineEvals.scorer.detail.requestTemplateSection")
              }}
              <OTag v-if="variables.length" type="fieldTag" value="soft">
                {{ variables.length }}
                {{ t("onlineEvals.scorer.detail.variablesSuffix") }}
              </OTag>
            </h4>
            <pre class="sd-code text-text-heading" data-test="scorer-detail-template">{{
              row.template
            }}</pre>
          </section>

          <section v-if="outputSchemaPretty" class="flex flex-col gap-2 px-5">
            <h4
              class="text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scorer.detail.outputSchemaSection") }}
            </h4>
            <pre class="sd-code sd-code--mono text-text-heading">{{ outputSchemaPretty }}</pre>
          </section>

          <section class="flex flex-col gap-2 px-5">
            <h4
              class="text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scorer.detail.metadataSection") }}
            </h4>
            <dl class="sd-kv">
              <dt v-if="createdAt">
                {{ t("onlineEvals.scorer.detail.createdLabel") }}
              </dt>
              <dd v-if="createdAt">
                {{ formatTimestamp(createdAt) }}
              </dd>
              <dt v-if="updatedAt">
                {{ t("onlineEvals.scorer.detail.updatedLabel") }}
              </dt>
              <dd v-if="updatedAt">
                {{ formatTimestamp(updatedAt) }}
              </dd>
            </dl>
          </section>
        </template>

        <!-- Versions -->
        <template v-else-if="activeTab === 'versions'">
          <div class="sd__tab-pad">
            <p class="sd__tab-intro">
              {{ t("onlineEvals.scorer.detail.versionsIntro") }}
            </p>
            <ul class="sd-versions">
              <li class="sd-versions__item sd-versions__item--active">
                <div class="sd-versions__head">
                  <span class="sd-versions__label text-text-heading">v{{ row.version }}</span>
                  <OTag type="activeVersionFlag" value="active" />
                </div>
                <div v-if="updatedAt" class="sd-versions__meta text-text-secondary">
                  {{ t("onlineEvals.scorer.detail.lastUpdated") }}
                  <span>{{ formatTimestamp(updatedAt) }}</span>
                </div>
              </li>
            </ul>
          </div>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <OTable
            data-test="scorer-detail-runs-table"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="scorer-runs"
            :data="runs"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :empty-message="t('onlineEvals.scorer.detail.runs.empty')"
            :footer-title="t('onlineEvals.scorer.detail.tabs.runs')"
            show-index
            width="100%"
            class="w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="text-text-secondary">{{ relativeTime(row.timestampMs) }}</span>
            </template>
            <template #cell-jobId="{ row }">
              <span>{{ jobNameFor(row.jobId) }}</span>
            </template>
            <template #cell-targetSpanId="{ row }">
              <span v-if="row.targetSpanId" class="block truncate" :title="row.targetSpanId">{{
                row.targetSpanId
              }}</span>
              <span v-else class="text-text-secondary">—</span>
            </template>
            <template #cell-targetTraceId="{ row }">
              <span v-if="row.targetTraceId" class="block truncate" :title="row.targetTraceId">{{
                row.targetTraceId
              }}</span>
              <span v-else class="text-text-secondary">—</span>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span>{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span>{{ row.latencyMs != null ? formatLatency(row.latencyMs) : "—" }}</span>
            </template>
            <template #cell-status="{ row }">
              <OTag type="evalRunStatus" :value="row.status" />
            </template>
          </OTable>
        </template>

        <!-- Used by -->
        <template v-else-if="activeTab === 'usedBy'">
          <div class="sd__tab-pad">
            <p class="sd__tab-intro">
              {{ t("onlineEvals.scorer.detail.usedByIntro") }}
            </p>
            <OEmptyState
              v-if="usedByJobs.length === 0"
              size="inline"
              :title="t('onlineEvals.scorer.detail.usedByEmpty')"
              data-test="scorer-detail-used-by-empty"
            />
            <ul v-else class="sd-used-list">
              <li v-for="job in usedByJobs" :key="job.id">
                <OButton
                  variant="ghost"
                  class="sd-used-list__item"
                  :data-test="`scorer-detail-used-by-item-${job.name}`"
                  @click="emit('view-job', job)"
                >
                  <OIcon name="play-arrow" size="xs" />
                  <span>{{ job.name }}</span>
                  <span class="sd-used-list__meta text-text-secondary">{{ job.status }}</span>
                  <OIcon
                    name="chevron-right"
                    size="xs"
                    class="sd-used-list__chevron text-text-secondary"
                  />
                </OButton>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import KpiCardsSkeleton from "./KpiCardsSkeleton.vue";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import type { EvalJob, Provider, Scorer, ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import { useScorerRuns, type RunRow, type ScorerRunsWindow } from "../composables/useScorerRuns";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  ALL_AGENTS_VALUE,
  agentFilterKey,
  agentFilterLabel,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";

const props = defineProps<{
  row: Scorer;
  providers: Provider[];
  scoreConfigs: ScoreConfig[];
  jobs: EvalJob[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-job", row: EvalJob): void;
}>();

const { t } = useI18n();
const store = useStore();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "default");

type TabId = "configuration" | "versions" | "runs" | "usedBy";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const scorerType = computed<"llm_judge" | "remote">(() => {
  const raw = valueOf<string>(props.row, "scorerType", "scorer_type") ?? "llm_judge";
  return raw === "remote" ? "remote" : "llm_judge";
});

const params = computed<Record<string, any>>(() => props.row.params ?? {});

const provider = computed<Provider | null>(() => {
  const providerId = params.value.provider_id ?? params.value.providerId;
  if (!providerId) return null;
  return props.providers.find((p) => p.id === providerId) ?? null;
});

const judgeModel = computed<string>(() => params.value.model ?? params.value.judge_model ?? "");

const remoteEndpoint = computed<string>(() => params.value.endpoint ?? params.value.url ?? "");

const producesId = computed(
  () => valueOf<string>(props.row, "producesScoreConfigId", "produces_score_config_id") ?? null,
);

const producesConfig = computed<ScoreConfig | null>(() => {
  if (!producesId.value) return null;
  return props.scoreConfigs.find((c) => entityId(c) === producesId.value) ?? null;
});

// Drawer open state — starts open (the parent mounts this only when a scorer is
// selected). Any dismiss path (× button, Escape, overlay click) flows through
// ODrawer's update:open(false) → we forward `close` to the parent, which
// unmounts us.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("close");
}

const variables = computed<string[]>(() => props.row.variables ?? []);

const outputSchemaPretty = computed<string>(() => {
  const schema = valueOf<any>(props.row, "outputSchema", "output_schema");
  if (!schema) return "";
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return "";
  }
});

const usedByJobs = computed<EvalJob[]>(() => {
  const myId = entityId(props.row);
  return props.jobs.filter((job) => {
    if (!Array.isArray(job.scorers)) return false;
    return job.scorers.some((ref) => {
      if (typeof ref === "string") return ref === myId;
      return ref?.id === myId;
    });
  });
});

const createdAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "createdAt", "created_at");
  return typeof v === "number" ? v : null;
});

const updatedAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "updatedAt", "updated_at");
  return typeof v === "number" ? v : null;
});

// — Tabs — no badge counts on Runs (the KPI strip already shows totalRuns).
const tabs = computed(() => [
  {
    id: "configuration" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.configuration"),
    count: null as number | null,
  },
  {
    id: "versions" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.versions"),
    count: 1,
  },
  {
    id: "runs" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.runs"),
    count: null as number | null,
  },
  {
    id: "usedBy" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.usedBy"),
    count: usedByJobs.value.length,
  },
]);

// — Runs window — backed by DateTimePickerDashboard.
const dateTimePickerRef = ref<{
  getConsumableDateTime: () => { startTime: number; endTime: number };
} | null>(null);
const selectedDate = ref<any>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "24h",
});

const dateWindow = ref<ScorerRunsWindow>({
  startUs: (Date.now() - 24 * 60 * 60 * 1000) * 1000,
  endUs: Date.now() * 1000,
});
const agents = ref<AgentFilterSelection[]>([]);
const agentKey = ref(ALL_AGENTS_VALUE);

const agentOptions = computed(() => [
  { label: "All Agents", value: ALL_AGENTS_VALUE },
  ...agents.value.map((agent) => ({
    label: agentFilterLabel(agent),
    value: agentFilterKey(agent),
  })),
]);

const selectedAgent = computed<AgentFilterSelection | null>(() => {
  if (agentKey.value === ALL_AGENTS_VALUE) return null;
  return agents.value.find((agent) => agentFilterKey(agent) === agentKey.value) ?? null;
});

async function loadAgents() {
  const { startUs, endUs } = dateWindow.value;
  try {
    const response = await genAiAgentMappingService.listAgents(orgId.value, startUs, endUs);
    agents.value = response.agents;
    if (
      agentKey.value !== ALL_AGENTS_VALUE &&
      !agents.value.some((agent) => agentFilterKey(agent) === agentKey.value)
    ) {
      agentKey.value = ALL_AGENTS_VALUE;
    }
  } catch (err) {
    console.warn("Failed to load GenAI agents", err);
    agents.value = [];
    agentKey.value = ALL_AGENTS_VALUE;
  }
}

function syncDateWindow() {
  const picker = dateTimePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  if (dt && typeof dt.startTime === "number" && typeof dt.endTime === "number") {
    dateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

watch(selectedDate, () => syncDateWindow(), { deep: true });
watch(
  dateWindow,
  () => {
    void loadAgents();
  },
  { immediate: true },
);
watch(orgId, () => {
  agentKey.value = ALL_AGENTS_VALUE;
  void loadAgents();
});

const runsEnabled = computed(() => activeTab.value === "runs");
// `_evaluator.attributes_scorer_id` stores the scorer's stable `entity_id`
// (the cross-version identifier), NOT the per-version row `id`. Filtering by
// `id` returns 0 runs even when runs exist; key off `entityId` so the KPIs and
// Runs table actually match the evaluator records.
const scorerIdRef = computed(() => entityId(props.row));

const {
  kpis,
  runs,
  isLoadingKpis,
  isLoadingRuns,
  refresh: refreshRunsData,
} = useScorerRuns(scorerIdRef, dateWindow, runsEnabled, selectedAgent);

async function refreshRuns() {
  syncDateWindow();
  await refreshRunsData();
}

// — OTable column definitions —
const runColumns = computed<OTableColumnDef<RunRow>[]>(() => [
  {
    id: "timestampMs",
    header: t("onlineEvals.scorer.detail.runs.col.time"),
    accessorKey: "timestampMs",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "jobId",
    header: t("onlineEvals.scorer.detail.runs.col.job"),
    accessorKey: "jobId",
    sortable: true,
    // Numeric size + `flex`: fills the leftover width AND stays resizable.
    // `size: "auto"` broke column-width computation and the resize grips.
    size: 220,
    meta: { align: "left", flex: true },
  },
  {
    id: "targetSpanId",
    header: t("onlineEvals.scorer.detail.runs.col.spanId"),
    accessorKey: "targetSpanId",
    sortable: true,
    size: 190,
    meta: { align: "left" },
  },
  {
    id: "targetTraceId",
    header: t("onlineEvals.scorer.detail.runs.col.traceId"),
    accessorKey: "targetTraceId",
    sortable: true,
    size: 230,
    meta: { align: "left" },
  },
  {
    id: "scoreDisplay",
    header: t("onlineEvals.scorer.detail.runs.col.score"),
    accessorKey: "scoreDisplay",
    sortable: false,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "latencyMs",
    header: t("onlineEvals.scorer.detail.runs.col.latency"),
    accessorKey: "latencyMs",
    sortable: true,
    size: 110,
    // Left-aligned to match the rest of the columns (a sortable header can't
    // right-align, so a right-aligned cell never lines up under the label).
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("onlineEvals.scorer.detail.runs.col.status"),
    accessorKey: "status",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
]);

// — KPI strip cards —
// value/unit split mirrors the SessionDetails KPI cards (big value + small
// trailing unit) so the AI module's detail pages read identically.
const kpiCards = computed<{ label: string; value: string; unit: string }[]>(() => {
  const k = kpis.value;
  return [
    {
      label: t("onlineEvals.scorer.detail.kpis.totalRuns"),
      value: formatCount(k.totalRuns),
      unit: "",
    },
    {
      label: t("onlineEvals.scorer.detail.kpis.successRate"),
      value: k.successRate == null ? "—" : k.successRate.toFixed(1),
      unit: k.successRate == null ? "" : "%",
    },
    {
      label: t("onlineEvals.scorer.detail.kpis.avgLatency"),
      ...splitLatency(k.avgLatencyMs),
    },
    {
      label: t("onlineEvals.scorer.detail.kpis.usedBy"),
      value: String(usedByJobs.value.length),
      unit: "",
    },
  ];
});

// — Helpers —
function jobNameFor(jobId: string): string {
  if (!jobId) return t("onlineEvals.scorer.detail.runs.jobUnknown");
  const job = props.jobs.find((j) => String(j.id) === jobId);
  return job?.name ?? jobId;
}

function formatTimestamp(microsOrMs: number): string {
  const ms = microsOrMs > 1e14 ? Math.round(microsOrMs / 1000) : microsOrMs;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(microsOrMs);
  }
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Split latency into a bare value + trailing unit so the KPI card can render
 * the unit in the smaller, secondary type (matches SessionDetails). */
function splitLatency(ms: number | null): { value: string; unit: string } {
  if (ms == null) return { value: "—", unit: "" };
  if (ms >= 1000) return { value: (ms / 1000).toFixed(1), unit: "s" };
  return { value: String(Math.round(ms)), unit: "ms" };
}

function relativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  if (diff < 0 || !Number.isFinite(diff)) return "—";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
</script>

<style lang="scss" scoped>
/* keep(complex-state): The <dl>/<dt>/<dd> element-selector grid, the used-by list's hover/:deep(button)
   overrides, and the status-cell dot variants — descendant and pseudo-class
   selectors with no element of their own to carry a utility. */
// Page layout, spacing, colors, and text styling are Tailwind utilities in the
// template (matching SessionDetails.vue). Only cohesive blocks that rely on
// descendant/element selectors or hover state remain here. Font-family is never
// set per component — it inherits the global --font-sans.

.sd__tab-intro {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-text-secondary, var(--color-text-secondary));
}

// Versions / Used By tab content sits directly in the body (not in a
// .sd-section), so it needs its own horizontal inset. The Runs tab keeps its
// full-bleed table and is not wrapped here.
.sd__tab-pad {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  padding-left: 1.25rem;
  padding-right: 1.25rem;
}

.sd-kv {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 0.375rem 0.875rem;
  margin: 0;
}

.sd-kv dt {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary, var(--color-text-secondary));
}

.sd-kv dd {
  margin: 0;
  font-size: var(--text-compact);
  color: var(--color-text-heading, currentColor);
}

.sd-produces {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background: color-mix(in srgb, var(--color-primary-600) 8%, transparent);
  border: 0.0625rem solid color-mix(in srgb, var(--color-primary-600) 30%, transparent);
  border-radius: 0.3125rem;
  font-size: var(--text-xs);
}

.sd-produces__name {
  font-weight: 700;
}

.sd-produces__version,
.sd-produces__sep,
.sd-produces__type {
  font-size: var(--text-2xs);
}

.sd-code {
  margin: 0;
  padding: 0.75rem;
  background: color-mix(in srgb, var(--color-text-heading) 5%, transparent);
  border: 0.0625rem solid color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  border-radius: 0.375rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 12.5rem;
  overflow: auto;
}

.sd-code--mono {
  white-space: pre;
}

/* — Versions tab — */
.sd-versions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sd-versions__item {
  padding: 0.75rem 0.875rem;
  background: var(--color-card-bg);
  border: 0.0625rem solid color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 0.375rem;
}

.sd-versions__item--active {
  border-color: color-mix(in srgb, var(--color-primary-600) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary-600) 5%, var(--color-card-bg));
}

.sd-versions__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sd-versions__label {
  font-weight: 700;
  font-size: var(--text-compact);
}

.sd-versions__meta {
  margin-top: 0.375rem;
  font-size: var(--text-2xs);
}

/* — Used by tab — */
.sd-used-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sd-used-list__item {
  width: 100%;
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent) !important;
  border: 0.0625rem solid transparent !important;
  border-radius: 0.3125rem !important;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.sd-used-list__item:hover {
  border-color: color-mix(in srgb, var(--color-primary-600) 35%, transparent) !important;
  background: color-mix(in srgb, var(--color-primary-600) 5%, transparent) !important;
}

.sd-used-list__item:deep(button) {
  height: auto !important;
  padding: 0.5rem 0.625rem !important;
  gap: 0.5rem;
  font-size: var(--text-xs);
  justify-content: flex-start;
  text-align: left;
}

.sd-used-list__meta {
  margin-left: auto;
  font-size: var(--text-3xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sd-used-list__chevron {
  opacity: 0.5;
}

.sd-used-list__item:hover .sd-used-list__chevron {
  color: var(--color-primary-600);
  opacity: 1;
}
</style>
