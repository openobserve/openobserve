<template>
  <div class="jd-scrim" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="jd" @click.stop data-test="eval-job-detail">
      <header class="jd__header">
        <span class="jd__title">
          <OIcon name="play-arrow" size="sm" />
          <span class="jd__title-text">{{ row.name }}</span>
          <span class="jd__title-version">v{{ row.version }}</span>
        </span>
        <span class="jd__status-pill" :class="`jd__status-pill--${row.status}`">
          {{ statusLabel }}
        </span>
        <div class="jd__header-spacer" />
        <button
          type="button"
          class="jd__close"
          :aria-label="t('onlineEvals.job.detail.close')"
          data-test="eval-job-detail-close-btn"
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

      <div class="jd__body">
        <!-- Description -->
        <section v-if="row.description" class="jd-section">
          <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.descriptionSection") }}</h4>
          <p class="jd-section__text">{{ row.description }}</p>
        </section>

        <!-- Target -->
        <section class="jd-section">
          <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.targetSection") }}</h4>
          <dl class="jd-kv">
            <dt>{{ t("onlineEvals.job.detail.streamLabel") }}</dt>
            <dd class="jd-mono">{{ row.stream }}</dd>

            <dt>{{ t("onlineEvals.job.detail.streamTypeLabel") }}</dt>
            <dd class="jd-mono">{{ streamType }}</dd>

            <dt>{{ t("onlineEvals.job.detail.filterLabel") }}</dt>
            <dd>
              <pre
                v-if="filterClauses.length > 0"
                class="jd-filter"
                data-test="eval-job-detail-filter"
              ><div
                  v-for="(clause, idx) in filterClauses"
                  :key="idx"
                  class="jd-filter__row"
                  :style="{ paddingLeft: `${clause.depth * 16}px` }"
                ><span class="jd-filter__kw">{{ clause.keyword }}</span><span class="jd-filter__col">{{ clause.column }}</span><span class="jd-filter__op">{{ clause.operator }}</span><span
                    class="jd-filter__val"
                    :class="{ 'jd-filter__val--str': clause.valueIsString }"
                  >{{ clause.valueText }}</span></div></pre>
              <span v-else class="jd-muted">{{ t("onlineEvals.job.detail.filterEmpty") }}</span>
            </dd>
          </dl>
        </section>

        <!-- Scorers -->
        <section class="jd-section">
          <h4 class="jd-section__title">
            {{ t("onlineEvals.job.detail.scorersSection") }}
            <span class="jd-section__chip">{{ resolvedScorers.length }}</span>
          </h4>
          <div v-if="resolvedScorers.length === 0" class="jd-empty">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.job.detail.scorersEmpty") }}</span>
          </div>
          <ul v-else class="jd-scorers">
            <li
              v-for="item in resolvedScorers"
              :key="item.id"
              class="jd-scorers__card"
              data-test="eval-job-detail-scorer-item"
            >
              <div class="jd-scorers__main">
                <div class="jd-scorers__row">
                  <span class="jd-mono jd-scorers__name">{{ item.name }}</span>
                  <span
                    v-if="item.scorerTypeLabel"
                    class="jd-scorers__type"
                    :class="`jd-scorers__type--${item.scorerType}`"
                  >
                    {{ item.scorerTypeLabel }}
                  </span>
                  <span class="jd-scorers__version">v{{ item.version }}</span>
                </div>
                <div v-if="item.scoreConfigName" class="jd-scorers__produces">
                  {{ t("onlineEvals.job.detail.producesPrefix") }}
                  <span class="jd-mono jd-scorers__produces-name">{{ item.scoreConfigName }}</span>
                </div>
              </div>
              <OIcon name="chevron-right" size="sm" class="jd-scorers__chevron" />
            </li>
          </ul>
        </section>

        <!-- Input mapping -->
        <section v-if="hasInputMapping" class="jd-section">
          <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.inputMappingSection") }}</h4>
          <div
            v-for="(mapping, scorerKey) in inputMapping"
            :key="scorerKey"
            class="jd-mapping"
          >
            <div class="jd-mapping__header">
              <OIcon name="grading" size="xs" />
              <span class="jd-mono">{{ scorerNameFor(scorerKey) }}</span>
            </div>
            <dl class="jd-kv jd-kv--tight">
              <template v-for="(value, variable) in mapping" :key="variable">
                <dt class="jd-mono">{{ wrapVariable(variable) }}</dt>
                <dd class="jd-mono">{{ value }}</dd>
              </template>
            </dl>
          </div>
        </section>

        <!-- Sampling -->
        <section class="jd-section">
          <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.samplingSection") }}</h4>
          <dl class="jd-kv">
            <dt>{{ t("onlineEvals.job.detail.samplingModeLabel") }}</dt>
            <dd>{{ samplingModeLabel }}</dd>

            <dt v-if="samplingValue != null">{{ t("onlineEvals.job.detail.samplingValueLabel") }}</dt>
            <dd v-if="samplingValue != null" class="jd-mono">{{ samplingValue }}</dd>
          </dl>
        </section>

        <!-- Metadata -->
        <section class="jd-section">
          <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.metadataSection") }}</h4>
          <dl class="jd-kv">
            <dt>{{ t("onlineEvals.job.detail.versionLabel") }}</dt>
            <dd class="jd-mono">v{{ row.version }}</dd>
            <dt v-if="pipelineId">{{ t("onlineEvals.job.detail.pipelineLabel") }}</dt>
            <dd v-if="pipelineId" class="jd-mono">{{ pipelineId }}</dd>
            <dt v-if="createdAt">{{ t("onlineEvals.job.detail.createdLabel") }}</dt>
            <dd v-if="createdAt" class="jd-mono">{{ formatTimestamp(createdAt) }}</dd>
            <dt v-if="updatedAt">{{ t("onlineEvals.job.detail.updatedLabel") }}</dt>
            <dd v-if="updatedAt" class="jd-mono">{{ formatTimestamp(updatedAt) }}</dd>
          </dl>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type {
  EvalJob,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { normalizeJobFilterCondition } from "../utils/jobFilter";

const props = defineProps<{
  row: EvalJob;
  scorers: Scorer[];
  scoreConfigs: ScoreConfig[];
}>();

defineEmits<{
  (e: "close"): void;
}>();

const { t } = useI18n();

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const streamType = computed<string>(
  () => valueOf<string>(props.row, "streamType", "stream_type") ?? "traces",
);

/** Normalized V2 filter group — unwraps the backend's `{ version, conditions }`
 * envelope and the `{ type: "all" }` empty marker, then runs through the same
 * normalizer JobFormPage uses on edit. Yields an empty group when no filter. */
const normalizedFilter = computed(() => {
  const raw = valueOf<any>(props.row, "filterCondition", "filter_condition");
  return normalizeJobFilterCondition(raw);
});

const filterCondition = computed(() => normalizedFilter.value);

interface FilterClause {
  /** "if" on the first clause, "AND" / "OR" on subsequent rows. */
  keyword: "if" | "AND" | "OR";
  column: string;
  operator: string;
  /** Pre-formatted value (already quoted / wrapped where needed). */
  valueText: string;
  /** Whether the value is a quoted string (for color). */
  valueIsString: boolean;
  /** Indent level for visual nesting. */
  depth: number;
}

const filterClauses = computed<FilterClause[]>(() => {
  const cond = filterCondition.value;
  if (!cond) return [];
  const out = flattenFilter(cond, 0);
  if (out.length === 0) return [];
  // First clause uses "if" instead of the group's logical operator.
  out[0].keyword = "if";
  return out;
});

function flattenFilter(node: any, depth: number): FilterClause[] {
  if (!node || typeof node !== "object") return [];

  if (node.filterType === "condition") {
    const formatted = formatConditionParts(node);
    if (!formatted) return [];
    // Default keyword; the parent group overrides it for non-first siblings.
    return [{ ...formatted, keyword: "AND" as const, depth }];
  }

  if (node.filterType === "group" && Array.isArray(node.conditions)) {
    const op: "AND" | "OR" = node.logicalOperator === "OR" ? "OR" : "AND";
    const out: FilterClause[] = [];
    for (let i = 0; i < node.conditions.length; i += 1) {
      const child = flattenFilter(node.conditions[i], depth + (out.length > 0 ? 1 : 0));
      if (child.length === 0) continue;
      // Mark the first clause of this child group with the parent's joiner
      // (skip for the very first clause overall — the outer computed turns
      // that into "if").
      if (out.length > 0 && child.length > 0) {
        child[0].keyword = op;
      }
      out.push(...child);
    }
    return out;
  }

  return [];
}

function formatConditionParts(
  node: any,
): Pick<FilterClause, "column" | "operator" | "valueText" | "valueIsString"> | null {
  const column = String(node.column ?? "").trim();
  const operator = String(node.operator ?? "=").trim();
  if (!column) return null;

  const valuesList: string[] = Array.isArray(node.values) ? node.values.filter(Boolean) : [];
  const rawValue = node.value;
  const opUpper = operator.toUpperCase();

  if (opUpper === "IN" || opUpper === "NOT IN") {
    const items = valuesList.length > 0 ? valuesList : rawValue ? [String(rawValue)] : [];
    if (items.length === 0) {
      return { column, operator, valueText: "(…)", valueIsString: false };
    }
    return {
      column,
      operator,
      valueText: `(${items.map(formatValue).join(", ")})`,
      valueIsString: false,
    };
  }

  if (rawValue == null || rawValue === "") {
    return { column, operator, valueText: `""`, valueIsString: true };
  }
  const valueText = formatValue(String(rawValue));
  return {
    column,
    operator,
    valueText,
    valueIsString: !/^-?\d+(\.\d+)?$/.test(String(rawValue)),
  };
}

function formatValue(v: string): string {
  // Numeric values stay bare; everything else gets double-quoted.
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

const statusLabel = computed(() => {
  return t(`onlineEvals.jobStatus.${props.row.status}`, props.row.status);
});

const samplingMode = computed(
  () => valueOf<string>(props.row, "samplingMode", "sampling_mode") ?? "all",
);

const samplingValue = computed(
  () => valueOf<any>(props.row, "samplingValue", "sampling_value"),
);

const samplingModeLabel = computed(() => {
  if (samplingMode.value === "rate") return t("onlineEvals.job.detail.samplingRate");
  if (samplingMode.value === "count") return t("onlineEvals.job.detail.samplingCount");
  return t("onlineEvals.job.detail.samplingAll");
});

interface ResolvedScorer {
  id: string;
  name: string;
  version: number;
  scoreConfigName: string;
  scorerType: "llm_judge" | "remote" | "unknown";
  scorerTypeLabel: string;
}

const resolvedScorers = computed<ResolvedScorer[]>(() => {
  if (!Array.isArray(props.row.scorers)) return [];
  return props.row.scorers.map((ref): ResolvedScorer => {
    const refId = typeof ref === "string" ? ref : ref?.id ?? "";
    const refVersion = typeof ref === "object" ? ref?.version ?? null : null;
    const found = props.scorers.find((s) => entityId(s) === refId);
    if (!found) {
      return {
        id: refId,
        name: refId || t("onlineEvals.job.detail.scorerUnknown"),
        version: refVersion ?? 0,
        scoreConfigName: "",
        scorerType: "unknown",
        scorerTypeLabel: "",
      };
    }
    const cfgId = valueOf<string>(
      found,
      "producesScoreConfigId",
      "produces_score_config_id",
    );
    const cfg = cfgId
      ? props.scoreConfigs.find((c) => entityId(c) === cfgId)
      : null;
    const rawType =
      valueOf<string>(found, "scorerType", "scorer_type") ?? "llm_judge";
    const scorerType: ResolvedScorer["scorerType"] =
      rawType === "remote" ? "remote" : "llm_judge";
    return {
      id: found.id,
      name: found.name,
      version: refVersion ?? found.version,
      scoreConfigName: cfg?.name ?? "",
      scorerType,
      scorerTypeLabel:
        scorerType === "remote"
          ? t("onlineEvals.job.detail.scorerTypeRemote")
          : t("onlineEvals.job.detail.scorerTypeLlmJudge"),
    };
  });
});

const inputMapping = computed<Record<string, Record<string, string>>>(
  () =>
    (valueOf<Record<string, Record<string, string>>>(
      props.row,
      "inputMapping",
      "input_mapping",
    ) ?? {}),
);

const hasInputMapping = computed(() => Object.keys(inputMapping.value).length > 0);

function scorerNameFor(refId: string): string {
  const found = props.scorers.find((s) => entityId(s) === refId);
  return found?.name ?? refId;
}

// Wrap a variable in `{{ name }}` for display. The string concatenation
// has to live here in the script — Vue's template lexer doesn't honour
// string-literal boundaries when scanning for interpolation delimiters.
const OPEN_BRACES = String.fromCharCode(123, 123);
const CLOSE_BRACES = String.fromCharCode(125, 125);
function wrapVariable(name: string | number | symbol): string {
  return `${OPEN_BRACES} ${String(name)} ${CLOSE_BRACES}`;
}

const pipelineId = computed<string>(
  () => valueOf<string>(props.row, "pipelineId", "pipeline_id") ?? "",
);

const createdAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "createdAt", "created_at");
  return typeof v === "number" ? v : null;
});

const updatedAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "updatedAt", "updated_at");
  return typeof v === "number" ? v : null;
});

function formatTimestamp(microsOrMs: number): string {
  const ms = microsOrMs > 1e14 ? Math.round(microsOrMs / 1000) : microsOrMs;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(microsOrMs);
  }
}
</script>

<style lang="scss" scoped>
.jd-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 1010;
  display: flex;
  justify-content: flex-end;
  animation: jd-fade 0.18s ease-out;
}

@keyframes jd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

.jd {
  width: 600px;
  max-width: 92vw;
  height: 100%;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-dialog-header-border, var(--o2-border));
  display: flex;
  flex-direction: column;
  animation: jd-slide 0.22s ease-out;
}

@keyframes jd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.jd__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.jd__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-primary, currentColor);
}

.jd__title-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jd__title-version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.jd__status-pill {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: 999px;
  font: 600 11px var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  text-transform: capitalize;
}

.jd__status-pill--active {
  background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 14%, transparent);
  color: var(--o2-status-success-text, #2e7d32);
}

.jd__status-pill--paused {
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: #b45309;
}

.jd__status-pill--degraded {
  background: color-mix(in srgb, var(--o2-status-error-text, #c62828) 14%, transparent);
  color: var(--o2-status-error-text, #c62828);
}

.jd__status-pill--archived {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.7;
}

.jd__header-spacer { flex: 1; }

.jd__close {
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

.jd__body {
  flex: 1;
  overflow: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  background: var(--color-card-bg);
}

.jd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.jd-section__title {
  margin: 0;
  font: 600 13px/1.5 var(--o2-font);
  color: var(--color-text-primary, currentColor);
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.jd-section__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 3px;
  font: 600 10px var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-section__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
}

.jd-kv {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 6px 14px;
  margin: 0;
}

.jd-kv--tight {
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  margin-top: 6px;
}

.jd-kv dt {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
  word-break: break-word;
}

.jd-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.jd-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
}

.jd-empty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-code {
  margin: 0;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}

.jd-filter {
  margin: 0;
  padding: 12px 14px;
  background: color-mix(in srgb, #6b76e3 6%, var(--color-card-bg));
  border: 1px solid color-mix(in srgb, #6b76e3 22%, transparent);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.85;
  color: var(--color-text-primary, currentColor);
  max-height: 240px;
  overflow: auto;
  white-space: pre;
}

.jd-filter__row {
  display: block;
  white-space: pre;
}

.jd-filter__kw {
  display: inline-block;
  width: 38px;
  margin-right: 8px;
  color: #7c3aed;
  font-weight: 700;
}

.jd-filter__col {
  color: #1d4ed8;
  margin-right: 6px;
}

.jd-filter__op {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-right: 6px;
}

.jd-filter__val {
  color: var(--color-text-primary, currentColor);
}

.jd-filter__val--str {
  color: #b25400;
}

.jd-scorers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.jd-scorers__card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--color-card-bg);
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 6px;
  transition: border-color 0.15s, background 0.15s;
}

.jd-scorers__card:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
}

.jd-scorers__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.jd-scorers__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.jd-scorers__name {
  font-weight: 700;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
}

.jd-scorers__type {
  display: inline-flex;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 10px/1.5 var(--o2-font);
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.jd-scorers__type--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.jd-scorers__version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.jd-scorers__produces {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__produces-name {
  color: var(--color-text-primary, currentColor);
  font-weight: 600;
}

.jd-scorers__chevron {
  flex-shrink: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.5;
}

.jd-scorers__card:hover .jd-scorers__chevron {
  color: var(--color-primary-600, #3F7994);
  opacity: 1;
}

.jd-mapping {
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
  border-radius: 5px;
  margin-bottom: 6px;
}

.jd-mapping__header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}
</style>
