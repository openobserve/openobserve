<template>
  <ODrawer
    :open="open"
    side="right"
    :width="70"
    :title="t('onlineEvals.scorer.detail.eyebrow')"
    data-test="scorer-detail"
    @update:open="handleOpenChange"
  >
    <!-- Header: module label as the title + the scorer name as a blue chip,
         mirroring the Alert History drawer. -->
    <template #header-left>
      <span
        v-if="row.name"
        :class="[
          'tw:font-semibold tw:text-[18px] tw:px-2 tw:py-1 tw:rounded-md tw:ml-2 tw:min-w-0 tw:truncate',
          store.state.theme === 'dark'
            ? 'tw:text-blue-400 tw:bg-blue-900/50'
            : 'tw:text-blue-600 tw:bg-blue-50',
        ]"
        data-test="scorer-detail-name-badge"
      >
        {{ row.name }}
        <OTooltip v-if="row.name" :content="row.name" />
      </span>
    </template>

    <!-- Body: the KPI strip + tab bar stay pinned; only the tab content scrolls. -->
    <div class="sd__body-inner">
      <!-- ── KPI strip ── -->
      <section class="sd__kpis">
        <article class="sd-kpi">
          <span class="sd-kpi__title">{{
            t("onlineEvals.scorer.detail.kpis.totalRuns")
          }}</span>
          <span class="sd-kpi__value">{{ formatCount(kpis.totalRuns) }}</span>
          <span class="sd-kpi__sub">{{
            t("onlineEvals.scorer.detail.kpis.totalRunsSub")
          }}</span>
        </article>
        <article class="sd-kpi" :class="successRateTone">
          <span class="sd-kpi__title">{{
            t("onlineEvals.scorer.detail.kpis.successRate")
          }}</span>
          <span class="sd-kpi__value">{{
            formatPercent(kpis.successRate)
          }}</span>
          <span class="sd-kpi__sub">{{
            t("onlineEvals.scorer.detail.kpis.successRateSub")
          }}</span>
        </article>
        <article class="sd-kpi">
          <span class="sd-kpi__title">{{
            t("onlineEvals.scorer.detail.kpis.avgLatency")
          }}</span>
          <span class="sd-kpi__value">{{
            formatLatency(kpis.avgLatencyMs)
          }}</span>
          <span class="sd-kpi__sub">{{
            t("onlineEvals.scorer.detail.kpis.avgLatencySub")
          }}</span>
        </article>
        <article class="sd-kpi">
          <span class="sd-kpi__title">{{
            t("onlineEvals.scorer.detail.kpis.usedBy")
          }}</span>
          <span class="sd-kpi__value">{{ usedByJobs.length }}</span>
          <span class="sd-kpi__sub">
            {{
              usedByJobs.length === 1
                ? t("onlineEvals.scorer.detail.kpis.usedBySubSingular")
                : t("onlineEvals.scorer.detail.kpis.usedBySubPlural")
            }}
          </span>
        </article>
      </section>

      <!-- ── Tab strip ── -->
      <nav class="sd__tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="sd__tab"
          :class="{ 'sd__tab--active': activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :data-test="`scorer-detail-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.count != null" class="sd__tab-count">{{
            tab.count
          }}</span>
        </button>
      </nav>

      <!-- ── Body ── -->
      <div class="sd__body">
        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <section class="sd-section">
            <h4 class="sd-section__title">
              {{ t("onlineEvals.scorer.detail.configurationSection") }}
            </h4>
            <dl class="sd-kv">
              <dt>{{ t("onlineEvals.scorer.detail.scorerTypeLabel") }}</dt>
              <dd>
                <span
                  class="sd-type-chip"
                  :class="`sd-type-chip--${scorerType}`"
                  >{{ scorerTypeLabel }}</span
                >
                <span class="sd-version-chip">v{{ row.version }}</span>
              </dd>

              <template v-if="scorerType === 'llm_judge'">
                <dt>{{ t("onlineEvals.scorer.detail.providerLabel") }}</dt>
                <dd>
                  <span v-if="provider" class="sd-mono">{{
                    provider.name
                  }}</span>
                  <span v-else class="sd-muted">{{
                    t("onlineEvals.scorer.detail.providerUnknown")
                  }}</span>
                </dd>

                <template v-if="judgeModel">
                  <dt>{{ t("onlineEvals.scorer.detail.modelLabel") }}</dt>
                  <dd class="sd-mono">{{ judgeModel }}</dd>
                </template>
              </template>

              <template v-if="scorerType === 'remote' && remoteEndpoint">
                <dt>{{ t("onlineEvals.scorer.detail.endpointLabel") }}</dt>
                <dd class="sd-mono">{{ remoteEndpoint }}</dd>
              </template>
            </dl>
          </section>

          <section class="sd-section">
            <h4 class="sd-section__title">
              {{ t("onlineEvals.scorer.detail.producesSection") }}
            </h4>
            <div
              v-if="producesConfig"
              class="sd-produces"
              data-test="scorer-detail-produces"
            >
              <OIcon name="rule" size="xs" />
              <span class="sd-mono sd-produces__name">{{
                producesConfig.name
              }}</span>
              <span class="sd-produces__version"
                >v{{ producesConfig.version }}</span
              >
              <span class="sd-produces__sep">·</span>
              <span class="sd-produces__type">{{
                dataTypeOf(producesConfig)
              }}</span>
            </div>
            <div v-else class="sd-empty">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.scorer.detail.producesEmpty") }}</span>
            </div>
          </section>

          <section v-if="row.template" class="sd-section">
            <h4 class="sd-section__title">
              {{
                scorerType === "llm_judge"
                  ? t("onlineEvals.scorer.detail.promptSection")
                  : t("onlineEvals.scorer.detail.requestTemplateSection")
              }}
              <span v-if="variables.length" class="sd-section__chip">
                {{ variables.length }}
                {{ t("onlineEvals.scorer.detail.variablesSuffix") }}
              </span>
            </h4>
            <pre class="sd-code" data-test="scorer-detail-template">{{
              row.template
            }}</pre>
          </section>

          <section v-if="outputSchemaPretty" class="sd-section">
            <h4 class="sd-section__title">
              {{ t("onlineEvals.scorer.detail.outputSchemaSection") }}
            </h4>
            <pre class="sd-code sd-code--mono">{{ outputSchemaPretty }}</pre>
          </section>

          <section class="sd-section">
            <h4 class="sd-section__title">
              {{ t("onlineEvals.scorer.detail.metadataSection") }}
            </h4>
            <dl class="sd-kv">
              <dt v-if="createdAt">
                {{ t("onlineEvals.scorer.detail.createdLabel") }}
              </dt>
              <dd v-if="createdAt" class="sd-mono">
                {{ formatTimestamp(createdAt) }}
              </dd>
              <dt v-if="updatedAt">
                {{ t("onlineEvals.scorer.detail.updatedLabel") }}
              </dt>
              <dd v-if="updatedAt" class="sd-mono">
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
                  <span class="sd-mono sd-versions__label"
                    >v{{ row.version }}</span
                  >
                  <span class="sd-versions__chip">{{
                    t("onlineEvals.scorer.detail.activeVersionChip")
                  }}</span>
                </div>
                <div v-if="updatedAt" class="sd-versions__meta">
                  {{ t("onlineEvals.scorer.detail.lastUpdated") }}
                  <span class="sd-mono">{{ formatTimestamp(updatedAt) }}</span>
                </div>
              </li>
            </ul>
          </div>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <div class="sd__runs-toolbar">
            <div class="tw:w-[14rem] tw:flex-shrink-0">
              <OSelect
                v-model="agentKey"
                :options="agentOptions"
                labelKey="label"
                valueKey="value"
                class="tw:w-full tw:rounded"
                data-test="scorer-detail-runs-agent-filter"
              />
            </div>
            <DateTimePickerDashboard
              ref="dateTimePickerRef"
              v-model="selectedDate"
              :auto-apply-dashboard="true"
              class="sd__date-picker"
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
            :page-size-options="[20, 50, 100, 200]"
            width="100%"
            class="tw:w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="sd-mono sd-muted-text">{{
                relativeTime(row.timestampMs)
              }}</span>
            </template>
            <template #cell-jobId="{ row }">
              <span class="sd-mono">{{ jobNameFor(row.jobId) }}</span>
            </template>
            <template #cell-target="{ row }">
              <div class="sd-target-cell">
                <div v-if="row.targetSpanId" class="sd-target-cell__line">
                  <span class="sd-target-cell__label">{{
                    t("onlineEvals.scorer.detail.runs.spanLabel")
                  }}</span>
                  <span
                    class="sd-mono sd-target-cell__id"
                    :title="row.targetSpanId"
                    >{{ row.targetSpanId }}</span
                  >
                </div>
                <div v-if="row.targetTraceId" class="sd-target-cell__line">
                  <span class="sd-target-cell__label">{{
                    t("onlineEvals.scorer.detail.runs.traceLabel")
                  }}</span>
                  <span
                    class="sd-mono sd-target-cell__id"
                    :title="row.targetTraceId"
                    >{{ row.targetTraceId }}</span
                  >
                </div>
              </div>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span class="sd-mono">{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span class="sd-mono">{{
                row.latencyMs != null ? formatLatency(row.latencyMs) : "—"
              }}</span>
            </template>
            <template #cell-status="{ row }">
              <span
                class="sd-status-cell"
                :class="`sd-status-cell--${row.status}`"
              >
                <span class="sd-status-cell__dot" />
                {{ row.status }}
              </span>
            </template>
          </OTable>
        </template>

        <!-- Used by -->
        <template v-else-if="activeTab === 'usedBy'">
          <div class="sd__tab-pad">
            <p class="sd__tab-intro">
              {{ t("onlineEvals.scorer.detail.usedByIntro") }}
            </p>
            <div v-if="usedByJobs.length === 0" class="sd-empty">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.scorer.detail.usedByEmpty") }}</span>
            </div>
            <ul v-else class="sd-used-list">
              <li v-for="job in usedByJobs" :key="job.id">
                <OButton
                  variant="ghost"
                  class="sd-used-list__item"
                  :data-test="`scorer-detail-used-by-item-${job.name}`"
                  @click="emit('view-job', job)"
                >
                  <OIcon name="play-arrow" size="xs" />
                  <span class="sd-mono">{{ job.name }}</span>
                  <span class="sd-used-list__meta">{{ job.status }}</span>
                  <OIcon
                    name="chevron-right"
                    size="xs"
                    class="sd-used-list__chevron"
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
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import type {
  EvalJob,
  Provider,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import {
  useScorerRuns,
  type ScorerRunsWindow,
} from "../composables/useScorerRuns";
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
const orgId = computed(
  () => store.state.selectedOrganization?.identifier ?? "default",
);

type TabId = "configuration" | "versions" | "runs" | "usedBy";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(
  row: any,
  camel: string,
  snake: string,
): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const scorerType = computed<"llm_judge" | "remote">(() => {
  const raw =
    valueOf<string>(props.row, "scorerType", "scorer_type") ?? "llm_judge";
  return raw === "remote" ? "remote" : "llm_judge";
});

const scorerTypeLabel = computed(() =>
  scorerType.value === "remote"
    ? t("onlineEvals.scorer.detail.typeRemote")
    : t("onlineEvals.scorer.detail.typeLlmJudge"),
);

const params = computed<Record<string, any>>(() => props.row.params ?? {});

const provider = computed<Provider | null>(() => {
  const providerId = params.value.provider_id ?? params.value.providerId;
  if (!providerId) return null;
  return props.providers.find((p) => p.id === providerId) ?? null;
});

const judgeModel = computed<string>(
  () => params.value.model ?? params.value.judge_model ?? "",
);

const remoteEndpoint = computed<string>(
  () => params.value.endpoint ?? params.value.url ?? "",
);

const producesId = computed(
  () =>
    valueOf<string>(
      props.row,
      "producesScoreConfigId",
      "produces_score_config_id",
    ) ?? null,
);

const producesConfig = computed<ScoreConfig | null>(() => {
  if (!producesId.value) return null;
  return (
    props.scoreConfigs.find((c) => entityId(c) === producesId.value) ?? null
  );
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
  return (
    agents.value.find((agent) => agentFilterKey(agent) === agentKey.value) ??
    null
  );
});

async function loadAgents() {
  const { startUs, endUs } = dateWindow.value;
  try {
    const response = await genAiAgentMappingService.listAgents(
      orgId.value,
      startUs,
      endUs,
    );
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
  if (
    dt &&
    typeof dt.startTime === "number" &&
    typeof dt.endTime === "number"
  ) {
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
// `_evaluator.attributes_scorer_id` stores the per-version row `id`, not
// `entity_id`. Using entityId here returns 0 runs even when runs exist.
const scorerIdRef = computed(() => String(props.row.id));

const {
  kpis,
  runs,
  isLoadingRuns,
  refresh: refreshRunsData,
} = useScorerRuns(scorerIdRef, dateWindow, runsEnabled, selectedAgent);

async function refreshRuns() {
  syncDateWindow();
  await refreshRunsData();
}

// — OTable column definitions —
const runColumns = computed(() => [
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
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "target",
    header: t("onlineEvals.scorer.detail.runs.col.target"),
    sortable: false,
    size: 360,
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
    meta: { align: "right" },
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

// — KPI tone —
const successRateTone = computed(() => {
  const r = kpis.value.successRate;
  if (r == null) return "";
  if (r >= 95) return "sd-kpi--good";
  if (r >= 80) return "sd-kpi--warn";
  return "sd-kpi--bad";
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

function formatPercent(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
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
// Drawer body wrapper: fills ODrawer's scrollable body and lays the KPI strip
// and tab bar as fixed (shrink-0) rows, with the tab content scrolling on its
// own below them — preserves the previous fixed-header / scrolling-content feel
// that the hand-rolled panel had.
.sd__body-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* — KPI strip — */
.sd__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 20px;
  background: color-mix(
    in srgb,
    var(--color-text-secondary) 4%,
    var(--color-card-bg)
  );
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  flex-shrink: 0;
}

.sd-kpi {
  // Tile styling mirrors the stream-schema stat tiles (rounded-lg + p-3 +
  // shadow-sm + border). No icon — the scorer KPIs read fine label-only.
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--color-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 8px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.sd-kpi--good {
  background: color-mix(
    in srgb,
    var(--o2-status-success-text, #2e7d32) 4%,
    var(--color-card-bg)
  );
}
.sd-kpi--warn {
  background: color-mix(in srgb, #f59e0b 5%, var(--color-card-bg));
}
.sd-kpi--bad {
  background: color-mix(
    in srgb,
    var(--o2-status-error-text, #c62828) 4%,
    var(--color-card-bg)
  );
}

.sd-kpi__title {
  font: 700 12px/1.4 var(--o2-font);
  letter-spacing: 0.01em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-kpi__value {
  font: 700 22px/1.1 var(--o2-font);
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary, currentColor);
}

.sd-kpi--good .sd-kpi__value {
  color: var(--o2-status-success-text, #2e7d32);
}
.sd-kpi--warn .sd-kpi__value {
  color: #b45309;
}
.sd-kpi--bad .sd-kpi__value {
  color: var(--o2-status-error-text, #c62828);
}

.sd-kpi__sub {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Tab strip — */
.sd__tabs {
  display: flex;
  gap: 18px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.sd__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font: 600 13px var(--o2-font);
  margin-bottom: -1px;
}

.sd__tab:hover {
  color: var(--color-text-primary, currentColor);
}

.sd__tab--active {
  color: var(--color-primary-600, #3f7994);
  border-bottom-color: var(--color-primary-600, #3f7994);
}

.sd__tab-count {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  min-width: 18px;
  height: 16px;
  border-radius: 999px;
  font: 600 10px/1 var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  justify-content: center;
}

.sd__tab--active .sd__tab-count {
  background: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 18%,
    transparent
  );
  color: var(--color-primary-600, #3f7994);
}

/* — Body — */
.sd__body {
  flex: 1;
  overflow: auto;
  // Horizontal padding lives on the children (sections + toolbar) instead of
  // the body, so the Runs table — a bare child of the body — sits full-bleed
  // with edge-to-edge column headers. No bottom padding: the table reaches the
  // bottom edge with no dead space under its pagination bar.
  padding: 18px 0 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  background: var(--color-card-bg);
}

.sd__tab-intro {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Sections (Configuration tab) — */
.sd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  // Re-apply the inset the body no longer provides (config sections stay
  // aligned with the page content).
  padding-left: 20px;
  padding-right: 20px;
}

// Versions / Used By tab content sits directly in the body (not in a
// .sd-section), so it needs the same horizontal inset the body no longer
// carries. The Runs tab keeps its full-bleed table and is not wrapped here.
.sd__tab-pad {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-left: 20px;
  padding-right: 20px;
}

.sd-section__title {
  margin: 0;
  font: 600 13px/1.5 var(--o2-font);
  color: var(--color-text-primary, currentColor);
  padding-bottom: 6px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sd-section__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 3px;
  font: 600 10px var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 14px;
  margin: 0;
}

.sd-kv dt {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
}

.sd-mono {
  font-variant-numeric: tabular-nums;
}

.sd-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
}

.sd-type-chip {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.sd-type-chip--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.sd-version-chip {
  display: inline-flex;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-produces {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 8%,
    transparent
  );
  border: 1px solid
    color-mix(in srgb, var(--color-primary-600, #3f7994) 30%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-primary, currentColor);
}

.sd-produces__name {
  font-weight: 700;
}

.sd-produces__version,
.sd-produces__sep,
.sd-produces__type {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 11px;
}

.sd-empty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-code {
  margin: 0;
  padding: 12px;
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
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
  gap: 8px;
}

.sd-versions__item {
  padding: 12px 14px;
  background: var(--color-card-bg);
  border: 1px solid
    color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 6px;
}

.sd-versions__item--active {
  border-color: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 30%,
    transparent
  );
  background: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 5%,
    var(--color-card-bg)
  );
}

.sd-versions__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sd-versions__label {
  font-weight: 700;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
}

.sd-versions__chip {
  display: inline-flex;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 10px var(--o2-font);
  background: color-mix(
    in srgb,
    var(--o2-status-success-text, #2e7d32) 14%,
    transparent
  );
  color: var(--o2-status-success-text, #2e7d32);
}

.sd-versions__meta {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Runs tab — */
.sd__runs-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  // Re-apply the body's former inset so the toolbar controls stay aligned.
  padding-left: 20px;
  padding-right: 20px;
}

.sd__date-picker {
  flex: 0 0 auto;
}

.sd__runs-meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd__runs-meta strong {
  color: var(--color-text-primary, currentColor);
  font-variant-numeric: tabular-nums;
}

.sd-muted-text {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-target-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sd-target-cell__line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  min-width: 0;
}

.sd-target-cell__label {
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-target-cell__id {
  font-size: 11.5px;
  color: var(--color-text-primary, currentColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sd-status-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-status-cell__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-status-cell--success {
  color: var(--o2-status-success-text, #2e7d32);
}
.sd-status-cell--success .sd-status-cell__dot {
  background: var(--o2-status-success-text, #2e7d32);
}

.sd-status-cell--error,
.sd-status-cell--timeout {
  color: var(--o2-status-error-text, #c62828);
}
.sd-status-cell--error .sd-status-cell__dot,
.sd-status-cell--timeout .sd-status-cell__dot {
  background: var(--o2-status-error-text, #c62828);
}

.sd-status-cell--skipped .sd-status-cell__dot {
  background: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
}

/* — Used by tab — */
.sd-used-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sd-used-list__item {
  width: 100%;
  background: color-mix(
    in srgb,
    var(--color-text-secondary) 5%,
    transparent
  ) !important;
  border: 1px solid transparent !important;
  border-radius: 5px !important;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.sd-used-list__item:hover {
  border-color: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 35%,
    transparent
  ) !important;
  background: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 5%,
    transparent
  ) !important;
}

.sd-used-list__item:deep(button) {
  height: auto !important;
  padding: 8px 10px !important;
  gap: 8px;
  font-size: 12px;
  justify-content: flex-start;
  text-align: left;
}

.sd-used-list__meta {
  margin-left: auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-used-list__chevron {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.5;
}

.sd-used-list__item:hover .sd-used-list__chevron {
  color: var(--color-primary-600, #3f7994);
  opacity: 1;
}
</style>
