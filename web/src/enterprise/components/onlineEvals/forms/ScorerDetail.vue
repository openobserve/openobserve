<template>
  <div class="sd-scrim" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="sd" @click.stop data-test="scorer-detail">
      <!-- ── Header ── -->
      <header class="sd__header">
        <div class="sd__header-text">
          <span class="sd__eyebrow">{{ t("onlineEvals.scorer.detail.eyebrow") }}</span>
          <div class="sd__title-row">
            <span class="sd__title">{{ row.name }}</span>
            <span class="sd__type-pill" :class="`sd__type-pill--${scorerType}`">
              {{ scorerTypeLabel }}
            </span>
            <span class="sd__title-version">v{{ row.version }}</span>
          </div>
          <div v-if="row.description" class="sd__produces-line">
            <template v-if="producesConfig">
              <span class="sd__produces-prefix">{{ t("onlineEvals.scorer.detail.producesShort") }}</span>
              <span class="sd-mono sd__produces-name">{{ producesConfig.name }}</span>
              <span class="sd__sep">·</span>
            </template>
            <span class="sd__produces-desc">{{ row.description }}</span>
          </div>
          <div v-else-if="producesConfig" class="sd__produces-line">
            <span class="sd__produces-prefix">{{ t("onlineEvals.scorer.detail.producesShort") }}</span>
            <span class="sd-mono sd__produces-name">{{ producesConfig.name }}</span>
          </div>
        </div>
        <button
          type="button"
          class="sd__close"
          :aria-label="t('onlineEvals.scorer.detail.close')"
          data-test="scorer-detail-close-btn"
          @click="$emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <!-- ── KPI strip ── -->
      <section class="sd__kpis">
        <article class="sd-kpi">
          <span class="sd-kpi__title">{{ t("onlineEvals.scorer.detail.kpis.totalRuns") }}</span>
          <span class="sd-kpi__value">{{ formatCount(kpis.totalRuns) }}</span>
          <span class="sd-kpi__sub">{{ t("onlineEvals.scorer.detail.kpis.totalRunsSub") }}</span>
        </article>
        <article class="sd-kpi" :class="successRateTone">
          <span class="sd-kpi__title">{{ t("onlineEvals.scorer.detail.kpis.successRate") }}</span>
          <span class="sd-kpi__value">{{ formatPercent(kpis.successRate) }}</span>
          <span class="sd-kpi__sub">{{ t("onlineEvals.scorer.detail.kpis.successRateSub") }}</span>
        </article>
        <article class="sd-kpi">
          <span class="sd-kpi__title">{{ t("onlineEvals.scorer.detail.kpis.avgLatency") }}</span>
          <span class="sd-kpi__value">{{ formatLatency(kpis.avgLatencyMs) }}</span>
          <span class="sd-kpi__sub">{{ t("onlineEvals.scorer.detail.kpis.avgLatencySub") }}</span>
        </article>
        <article class="sd-kpi">
          <span class="sd-kpi__title">{{ t("onlineEvals.scorer.detail.kpis.usedBy") }}</span>
          <span class="sd-kpi__value">{{ usedByJobs.length }}</span>
          <span class="sd-kpi__sub">
            {{ usedByJobs.length === 1
              ? t("onlineEvals.scorer.detail.kpis.usedBySubSingular")
              : t("onlineEvals.scorer.detail.kpis.usedBySubPlural") }}
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
          <span v-if="tab.count != null" class="sd__tab-count">{{ tab.count }}</span>
        </button>
      </nav>

      <!-- ── Body ── -->
      <div class="sd__body">
        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <section class="sd-section">
            <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.configurationSection") }}</h4>
            <dl class="sd-kv">
              <dt>{{ t("onlineEvals.scorer.detail.scorerTypeLabel") }}</dt>
              <dd>
                <span class="sd-type-chip" :class="`sd-type-chip--${scorerType}`">{{ scorerTypeLabel }}</span>
              </dd>

              <template v-if="scorerType === 'llm_judge'">
                <dt>{{ t("onlineEvals.scorer.detail.providerLabel") }}</dt>
                <dd>
                  <span v-if="provider" class="sd-mono">{{ provider.name }}</span>
                  <span v-else class="sd-muted">{{ t("onlineEvals.scorer.detail.providerUnknown") }}</span>
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
            <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.producesSection") }}</h4>
            <div v-if="producesConfig" class="sd-produces" data-test="scorer-detail-produces">
              <OIcon name="rule" size="xs" />
              <span class="sd-mono sd-produces__name">{{ producesConfig.name }}</span>
              <span class="sd-produces__version">v{{ producesConfig.version }}</span>
              <span class="sd-produces__sep">·</span>
              <span class="sd-produces__type">{{ dataTypeOf(producesConfig) }}</span>
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
                {{ variables.length }} {{ t("onlineEvals.scorer.detail.variablesSuffix") }}
              </span>
            </h4>
            <pre class="sd-code" data-test="scorer-detail-template">{{ row.template }}</pre>
          </section>

          <section v-if="outputSchemaPretty" class="sd-section">
            <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.outputSchemaSection") }}</h4>
            <pre class="sd-code sd-code--mono">{{ outputSchemaPretty }}</pre>
          </section>

          <section class="sd-section">
            <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.metadataSection") }}</h4>
            <dl class="sd-kv">
              <dt v-if="createdAt">{{ t("onlineEvals.scorer.detail.createdLabel") }}</dt>
              <dd v-if="createdAt" class="sd-mono">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt">{{ t("onlineEvals.scorer.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt" class="sd-mono">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- Versions -->
        <template v-else-if="activeTab === 'versions'">
          <p class="sd__tab-intro">{{ t("onlineEvals.scorer.detail.versionsIntro") }}</p>
          <ul class="sd-versions">
            <li class="sd-versions__item sd-versions__item--active">
              <div class="sd-versions__head">
                <span class="sd-mono sd-versions__label">v{{ row.version }}</span>
                <span class="sd-versions__chip">{{ t("onlineEvals.scorer.detail.activeVersionChip") }}</span>
              </div>
              <div v-if="updatedAt" class="sd-versions__meta">
                {{ t("onlineEvals.scorer.detail.lastUpdated") }}
                <span class="sd-mono">{{ formatTimestamp(updatedAt) }}</span>
              </div>
            </li>
          </ul>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <div class="sd__runs-toolbar">
            <OSelect
              v-model="runsWindowKey"
              :options="runsWindowOptions"
              size="md"
              class="sd__runs-window-select"
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
            <span class="sd__runs-meta">
              {{ t("onlineEvals.scorer.detail.runs.showingPrefix") }}
              <strong>{{ runs.length }}</strong>
              {{ t("onlineEvals.scorer.detail.runs.showingOf") }}
              <strong>{{ formatCount(kpis.totalRuns) }}</strong>
              {{ t("onlineEvals.scorer.detail.runs.showingSuffix") }}
            </span>
          </div>

          <div v-if="runs.length === 0 && !isLoadingRuns" class="sd-empty">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scorer.detail.runs.empty") }}</span>
          </div>

          <ul v-else class="sd-runs">
            <li
              v-for="run in runs"
              :key="run.id"
              class="sd-run-row"
              :class="`sd-run-row--${run.status}`"
              data-test="scorer-detail-run-row"
            >
              <div class="sd-run-row__time">{{ relativeTime(run.timestampMs) }}</div>
              <div class="sd-run-row__job">
                <span class="sd-mono">{{ jobNameFor(run.jobId) }}</span>
              </div>
              <div class="sd-run-row__target">
                <div v-if="run.targetSpanId" class="sd-run-row__target-line">
                  <span class="sd-run-row__label">{{ t("onlineEvals.scorer.detail.runs.spanLabel") }}</span>
                  <span class="sd-mono">{{ shortId(run.targetSpanId) }}</span>
                </div>
                <div v-if="run.targetTraceId" class="sd-run-row__target-line">
                  <span class="sd-run-row__label">{{ t("onlineEvals.scorer.detail.runs.traceLabel") }}</span>
                  <span class="sd-mono">{{ shortId(run.targetTraceId) }}</span>
                </div>
              </div>
              <div class="sd-run-row__score sd-mono">{{ run.scoreDisplay }}</div>
              <div class="sd-run-row__latency sd-mono">
                {{ run.latencyMs != null ? formatLatency(run.latencyMs) : "—" }}
              </div>
              <div class="sd-run-row__status">
                <span class="sd-run-row__dot" :class="`sd-run-row__dot--${run.status}`" />
                {{ run.status }}
              </div>
            </li>
          </ul>
        </template>

        <!-- Used by -->
        <template v-else-if="activeTab === 'usedBy'">
          <p class="sd__tab-intro">{{ t("onlineEvals.scorer.detail.usedByIntro") }}</p>
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
                <OIcon name="chevron-right" size="xs" class="sd-used-list__chevron" />
              </OButton>
            </li>
          </ul>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type {
  EvalJob,
  Provider,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import { useScorerRuns, type ScorerRunsWindow } from "../composables/useScorerRuns";

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
    valueOf<string>(props.row, "producesScoreConfigId", "produces_score_config_id") ??
    null,
);

const producesConfig = computed<ScoreConfig | null>(() => {
  if (!producesId.value) return null;
  return (
    props.scoreConfigs.find((c) => entityId(c) === producesId.value) ?? null
  );
});

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

// — Tabs —
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
    count: kpis.value.totalRuns,
  },
  {
    id: "usedBy" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.usedBy"),
    count: usedByJobs.value.length,
  },
]);

// — Runs window —
type WindowKey = "last1h" | "last24h" | "last7d" | "last30d";
const WINDOW_MS: Record<WindowKey, number> = {
  last1h: 60 * 60 * 1000,
  last24h: 24 * 60 * 60 * 1000,
  last7d: 7 * 24 * 60 * 60 * 1000,
  last30d: 30 * 24 * 60 * 60 * 1000,
};
const runsWindowKey = ref<WindowKey>("last24h");
const runsWindowOptions = computed(() => [
  { value: "last1h", label: t("onlineEvals.scorer.detail.runs.windowLast1h") },
  { value: "last24h", label: t("onlineEvals.scorer.detail.runs.windowLast24h") },
  { value: "last7d", label: t("onlineEvals.scorer.detail.runs.windowLast7d") },
  { value: "last30d", label: t("onlineEvals.scorer.detail.runs.windowLast30d") },
]);

const dateWindow = computed<ScorerRunsWindow>(() => {
  const nowMs = Date.now();
  const windowMs = WINDOW_MS[runsWindowKey.value];
  return {
    startUs: (nowMs - windowMs) * 1000,
    endUs: nowMs * 1000,
  };
});

const runsEnabled = computed(() => activeTab.value === "runs");
const scorerIdRef = computed(() => entityId(props.row));

const { kpis, runs, isLoadingRuns, refresh: refreshRunsData } = useScorerRuns(
  scorerIdRef,
  dateWindow,
  runsEnabled,
);

async function refreshRuns() {
  await refreshRunsData();
}

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

function shortId(id: string): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
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
.sd-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 1010;
  display: flex;
  justify-content: flex-end;
  animation: sd-fade 0.18s ease-out;
}

@keyframes sd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

.sd {
  width: 1100px;
  max-width: 96vw;
  height: 100%;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-dialog-header-border, var(--o2-border));
  display: flex;
  flex-direction: column;
  animation: sd-slide 0.22s ease-out;
}

@keyframes sd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

/* — Header — */
.sd__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.sd__header-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sd__eyebrow {
  font: 700 10px/1.4 var(--o2-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sd__title {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.005em;
  color: var(--color-text-primary, currentColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sd__title-version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.sd__type-pill {
  display: inline-flex;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.sd__type-pill--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.sd__produces-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  flex-wrap: wrap;
}

.sd__produces-prefix { color: var(--color-text-secondary, var(--o2-text-secondary)); }
.sd__produces-name { color: var(--color-text-primary, currentColor); font-weight: 600; }
.sd__produces-desc { color: var(--color-text-secondary, var(--o2-text-secondary)); }
.sd__sep { opacity: 0.5; }

.sd__close {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

/* — KPI strip — */
.sd__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 20px;
  background: color-mix(in srgb, var(--color-text-secondary) 4%, var(--color-card-bg));
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  flex-shrink: 0;
}

.sd-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--color-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
}

.sd-kpi--good { background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 4%, var(--color-card-bg)); }
.sd-kpi--warn { background: color-mix(in srgb, #f59e0b 5%, var(--color-card-bg)); }
.sd-kpi--bad  { background: color-mix(in srgb, var(--o2-status-error-text, #c62828) 4%, var(--color-card-bg)); }

.sd-kpi__title {
  font: 700 10px/1.4 var(--o2-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-kpi__value {
  font: 700 22px/1.1 var(--o2-font);
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary, currentColor);
}

.sd-kpi--good .sd-kpi__value { color: var(--o2-status-success-text, #2e7d32); }
.sd-kpi--warn .sd-kpi__value { color: #b45309; }
.sd-kpi--bad  .sd-kpi__value { color: var(--o2-status-error-text, #c62828); }

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

.sd__tab:hover { color: var(--color-text-primary, currentColor); }

.sd__tab--active {
  color: var(--color-primary-600, #3F7994);
  border-bottom-color: var(--color-primary-600, #3F7994);
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
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 18%, transparent);
  color: var(--color-primary-600, #3F7994);
}

/* — Body — */
.sd__body {
  flex: 1;
  overflow: auto;
  padding: 18px 20px;
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
}

.sd-section__title {
  margin: 0;
  font: 600 13px/1.5 var(--o2-font);
  color: var(--color-text-primary, currentColor);
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
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
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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

.sd-produces {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary-600, #3F7994) 30%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-primary, currentColor);
}

.sd-produces__name { font-weight: 700; }

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
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
}

.sd-code--mono { white-space: pre; }

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
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 6px;
}

.sd-versions__item--active {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--color-card-bg));
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
  background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 14%, transparent);
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
  gap: 8px;
}

.sd__runs-window-select {
  width: 180px;
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

.sd-runs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  border-radius: 6px;
  overflow: hidden;
}

.sd-run-row {
  display: grid;
  grid-template-columns: 70px 1fr 1.6fr 60px 70px 90px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  font-size: 12px;
  border-top: 1px solid color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
}

.sd-run-row:first-child { border-top: 0; }

.sd-run-row__time {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.sd-run-row__job span {
  color: var(--color-text-primary, currentColor);
  font-weight: 600;
}

.sd-run-row__target {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sd-run-row__target-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 11px;
}

.sd-run-row__label {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-run-row__score,
.sd-run-row__latency {
  text-align: right;
}

.sd-run-row__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-run-row__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-run-row__dot--success { background: var(--o2-status-success-text, #2e7d32); }
.sd-run-row__dot--error,
.sd-run-row__dot--timeout { background: var(--o2-status-error-text, #c62828); }
.sd-run-row__dot--skipped { background: color-mix(in srgb, var(--color-text-secondary) 60%, transparent); }

.sd-run-row--success .sd-run-row__status { color: var(--o2-status-success-text, #2e7d32); }
.sd-run-row--error  .sd-run-row__status,
.sd-run-row--timeout .sd-run-row__status { color: var(--o2-status-error-text, #c62828); }

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
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent) !important;
  border: 1px solid transparent !important;
  border-radius: 5px !important;
  transition: border-color 0.15s, background 0.15s;
}

.sd-used-list__item:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent) !important;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, transparent) !important;
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
  color: var(--color-primary-600, #3F7994);
  opacity: 1;
}
</style>
