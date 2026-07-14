<template>
  <ODrawer
    :open="open"
    side="right"
    :width="70"
    :title="row?.name"
    :title-data-test="'eval-job-detail-name-badge'"
    :sub-title="t('onlineEvals.job.detail.eyebrow')"
    data-test="eval-job-detail"
    @update:open="handleOpenChange"
  >

    <!-- Body: the KPI strip + tab bar stay pinned; only the tab content scrolls. -->
    <div class="flex flex-col h-full min-h-0">
      <!-- ── Global window control ── -->
      <!-- A single date picker drives the WHOLE detail view — the KPI strip
           and both the Runs and Failures tables share this one window. Placed
           above the cards (right-aligned) so it reads as a page-level control,
           not a per-tab filter. Refresh re-queries everything. -->
      <div
        class="flex items-center justify-end gap-[0.5rem] px-5 pt-3"
      >
        <DateTimePickerDashboard
          ref="dateTimePickerRef"
          v-model="selectedDate"
          :auto-apply-dashboard="true"
          class="flex-none"
          data-test="eval-job-detail-window"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isLoadingKpis || isLoadingRuns"
          :title="t('onlineEvals.job.detail.refresh')"
          data-test="eval-job-detail-refresh"
          @click="refreshAll"
        />
      </div>

      <!-- ── KPI strip ── -->
      <!-- KPI strip — identical card layout + text styles to the LLM
           Sessions detail page (SessionDetails.vue) so the AI module stays
           consistent. Pinned band (shrink-0) with a bottom divider; the cards
           below carry their own chrome via Tailwind. -->
      <section
        class="flex-shrink-0 grid grid-cols-4 gap-[0.625rem] px-5 py-4 border-b border-b-[var(--color-dialog-header-border,var(--o2-border))]"
      >
        <!-- While the KPI query is in flight, show skeleton tiles in place of
             the cards (matches the LLM Insights dashboard pattern). -->
        <KpiCardsSkeleton v-if="isLoadingKpis" :count="4" />
        <div
          v-for="card in kpiCards"
          v-else
          :key="card.label"
          class="rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-[var(--color-surface-base)] border border-[var(--color-border-default)] transition-shadow duration-200 hover:shadow-[0_0.0625rem_0.375rem_rgba(0,0,0,0.08)]"
        >
          <div
            class="kpi-label text-[0.7rem] leading-normal font-semibold mb-[0.25rem] text-[var(--color-text-secondary)]"
          >
            {{ card.label }}
          </div>
          <div class="flex items-baseline gap-[0.2rem]">
            <span
              class="text-[1.4rem] font-bold leading-none text-[var(--color-grey-600)]"
            >
              {{ card.value }}
            </span>
            <span
              v-if="card.unit"
              class="text-[0.8rem] font-semibold text-[var(--color-text-secondary)]"
            >
              {{ card.unit }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── Tab strip ── -->
      <OTabs
        :model-value="activeTab"
        bordered
        class="flex-shrink-0 px-5"
        data-test="eval-job-detail-tabs"
        @update:model-value="activeTab = $event as TabId"
      >
        <OTab
          v-for="tab in tabs"
          :key="tab.id"
          :name="tab.id"
          :label="tab.label"
          :data-test="`eval-job-detail-tab-${tab.id}`"
        />
      </OTabs>

      <!-- ── Body ── -->
      <!-- Horizontal padding lives on the children (sections + toolbar), not
           the body, so the Runs/Failures table sits full-bleed with
           edge-to-edge column headers. Bottom padding is opt-in for the
           Configuration (form) tab; the table tabs stay flush to the bottom. -->
      <div
        class="flex-1 overflow-auto flex flex-col gap-[1.125rem] min-h-0 pt-[1.125rem]"
        :class="{ 'pb-[1.125rem]': activeTab === 'configuration' }"
      >
        <!-- Shared Runs/Failures filter row — agent filter (both tabs),
             right-aligned. The date picker + refresh live in the global
             toolbar above the cards, so they're not duplicated here. Rendered
             once with v-show (not v-if) so it never remounts on tab switch. -->
        <div
          v-show="tableEnabled"
          class="flex items-center justify-end gap-2 flex-wrap px-5"
        >
          <div class="w-[14rem] flex-shrink-0">
            <OSelect
              v-model="agentKey"
              :options="agentOptions"
              labelKey="label"
              valueKey="value"
              class="w-full rounded"
              data-test="eval-job-detail-runs-agent-filter"
            />
          </div>
        </div>

        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <!-- Target -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-[0.375rem] inline-flex items-center gap-[0.375rem] text-[0.8125rem] font-semibold leading-[1.5] text-[var(--color-text-primary)] border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.targetSection") }}
            </h4>
            <dl class="jd-kv">
              <dt>{{ t("onlineEvals.job.detail.streamLabel") }}</dt>
              <dd>{{ row.stream }}</dd>

              <dt>{{ t("onlineEvals.job.detail.streamTypeLabel") }}</dt>
              <dd>{{ streamType }}</dd>
            </dl>

            <!-- Filter rendered as a code block with a header bar + copy action,
                 matching the Alert History condition view. -->
            <div class="jd-codeblock" data-test="eval-job-detail-filter">
              <div class="jd-codeblock__header">
                <span class="jd-codeblock__label">{{
                  t("onlineEvals.job.detail.filterLabel")
                }}</span>
                <OButton
                  v-if="filterText"
                  variant="ghost-muted"
                  size="icon-xs-sq"
                  data-test="eval-job-detail-filter-copy-btn"
                  @click="
                    copyToClipboard(filterText, {
                      successMessage: t('common.copySuccess'),
                    })
                  "
                >
                  <OIcon name="content-copy" size="sm" />
                  <OTooltip :content="t('common.copy')" />
                </OButton>
              </div>
              <pre class="jd-codeblock__content">{{
                filterText || t("onlineEvals.job.detail.filterEmpty")
              }}</pre>
            </div>
          </section>

          <!-- Scorers -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-[0.375rem] inline-flex items-center gap-[0.375rem] text-[0.8125rem] font-semibold leading-[1.5] text-[var(--color-text-primary)] border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.scorersSection") }}
              <OTag type="fieldTag" value="soft">{{ resolvedScorers.length }}</OTag>
            </h4>
            <OEmptyState
              v-if="resolvedScorers.length === 0"
              size="inline"
              :title="t('onlineEvals.job.detail.scorersEmpty')"
              data-test="eval-job-detail-scorers-empty"
            />
            <ul v-else class="jd-scorers">
              <li v-for="item in resolvedScorers" :key="item.id">
                <button
                  type="button"
                  class="jd-scorers__card"
                  :data-test="`eval-job-detail-scorer-item-${item.name}`"
                  :disabled="!findScorerById(item.id)"
                  @click="onScorerClick(item.id)"
                >
                  <span
                    class="jd-scorers__icon"
                    :class="`jd-scorers__icon--${item.scorerType}`"
                  >
                    <OIcon
                      :name="
                        item.scorerType === 'remote' ? 'cloud' : 'smart-toy'
                      "
                      size="sm"
                    />
                  </span>
                  <div class="jd-scorers__main">
                    <div class="jd-scorers__row">
                      <span class="jd-scorers__name">{{
                        item.name
                      }}</span>
                      <OTag
                        v-if="item.scorerTypeLabel"
                        type="scorerType"
                        :value="item.scorerType"
                      />
                      <span class="jd-scorers__version"
                        >v{{ item.version }}</span
                      >
                    </div>
                    <div
                      v-if="item.scoreConfigName"
                      class="jd-scorers__produces"
                    >
                      <OIcon
                        name="rule"
                        size="xs"
                        class="jd-scorers__produces-icon"
                      />
                      <span class="jd-scorers__produces-prefix">
                        {{ t("onlineEvals.job.detail.producesPrefix") }}
                      </span>
                      <span class="jd-scorers__produces-name">{{
                        item.scoreConfigName
                      }}</span>
                      <template v-if="item.scoreConfigDataType">
                        <span class="jd-scorers__sep">·</span>
                        <span class="jd-scorers__produces-type">
                          {{ item.scoreConfigDataType }}
                        </span>
                      </template>
                      <template v-if="item.scoreConfigRangeText">
                        <span class="jd-scorers__sep">·</span>
                        <span class="jd-scorers__produces-range">
                          {{ item.scoreConfigRangeText }}
                        </span>
                      </template>
                    </div>
                  </div>
                  <span
                    class="jd-scorers__cta text-[0.6875rem] font-semibold"
                  >
                    <span class="jd-scorers__cta-label">
                      {{ t("onlineEvals.job.detail.viewScorerHint") }}
                    </span>
                    <OIcon
                      name="chevron-right"
                      size="sm"
                      class="jd-scorers__chevron"
                    />
                  </span>
                </button>
              </li>
            </ul>
          </section>

          <!-- Sampling -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-[0.375rem] inline-flex items-center gap-[0.375rem] text-[0.8125rem] font-semibold leading-[1.5] text-[var(--color-text-primary)] border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.samplingSection") }}
            </h4>
            <dl class="jd-kv">
              <dt>{{ t("onlineEvals.job.detail.samplingModeLabel") }}</dt>
              <dd>{{ samplingModeLabel }}</dd>

              <dt v-if="samplingValue != null">
                {{ t("onlineEvals.job.detail.samplingValueLabel") }}
              </dt>
              <dd v-if="samplingValue != null">
                {{ samplingValue }}
              </dd>
            </dl>
          </section>

          <!-- Metadata -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-[0.375rem] inline-flex items-center gap-[0.375rem] text-[0.8125rem] font-semibold leading-[1.5] text-[var(--color-text-primary)] border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.metadataSection") }}
            </h4>
            <dl class="jd-kv">
              <dt>{{ t("onlineEvals.job.detail.versionLabel") }}</dt>
              <dd>v{{ row.version }}</dd>
              <dt v-if="pipelineId">
                {{ t("onlineEvals.job.detail.pipelineLabel") }}
              </dt>
              <dd v-if="pipelineId">{{ pipelineId }}</dd>
              <dt v-if="createdAt">
                {{ t("onlineEvals.job.detail.createdLabel") }}
              </dt>
              <dd v-if="createdAt">
                {{ formatTimestamp(createdAt) }}
              </dd>
              <dt v-if="updatedAt">
                {{ t("onlineEvals.job.detail.updatedLabel") }}
              </dt>
              <dd v-if="updatedAt">
                {{ formatTimestamp(updatedAt) }}
              </dd>
            </dl>
          </section>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <OTable
            data-test="eval-job-detail-runs-table"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="eval-job-runs"
            :data="runs"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :empty-message="t('onlineEvals.job.detail.runs.empty')"
            :footer-title="t('onlineEvals.job.detail.tabs.runs')"
            show-index
            width="100%"
            class="w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="text-[var(--color-text-secondary)]">{{
                relativeTime(row.timestampMs)
              }}</span>
            </template>
            <template #cell-scorerId="{ row }">
              <span>{{ scorerNameFor(row.scorerId) }}</span>
            </template>
            <template #cell-targetSpanId="{ row }">
              <span
                v-if="row.targetSpanId"
                class="block truncate"
                :title="row.targetSpanId"
                >{{ row.targetSpanId }}</span
              >
              <span v-else class="text-[var(--color-text-secondary)]">—</span>
            </template>
            <template #cell-targetTraceId="{ row }">
              <span
                v-if="row.targetTraceId"
                class="block truncate"
                :title="row.targetTraceId"
                >{{ row.targetTraceId }}</span
              >
              <span v-else class="text-[var(--color-text-secondary)]">—</span>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span>{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span>{{
                row.latencyMs != null ? formatLatency(row.latencyMs) : "—"
              }}</span>
            </template>
            <template #cell-status="{ row }">
              <OTag type="evalRunStatus" :value="row.status" />
            </template>
          </OTable>
        </template>

        <!-- Failures -->
        <template v-else-if="activeTab === 'failures'">
          <!-- Single failures table — filterable by agent. -->
          <OTable
            data-test="eval-job-detail-failures-table"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="eval-job-failures"
            :data="failures"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :empty-message="t('onlineEvals.job.detail.failures.recentEmpty')"
            :footer-title="t('onlineEvals.job.detail.tabs.failures')"
            show-index
            width="100%"
            class="w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="text-[var(--color-text-secondary)]">{{
                relativeTime(row.timestampMs)
              }}</span>
            </template>
            <template #cell-scorerId="{ row }">
              <span>{{ scorerNameFor(row.scorerId) }}</span>
            </template>
            <template #cell-targetSpanId="{ row }">
              <span
                v-if="row.targetSpanId"
                class="block truncate"
                :title="row.targetSpanId"
                >{{ row.targetSpanId }}</span
              >
              <span v-else class="text-[var(--color-text-secondary)]">—</span>
            </template>
            <template #cell-targetTraceId="{ row }">
              <span
                v-if="row.targetTraceId"
                class="block truncate"
                :title="row.targetTraceId"
                >{{ row.targetTraceId }}</span
              >
              <span v-else class="text-[var(--color-text-secondary)]">—</span>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span>{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span>{{
                row.latencyMs != null ? formatLatency(row.latencyMs) : "—"
              }}</span>
            </template>
            <template #cell-status="{ row }">
              <OTag type="evalRunStatus" :value="row.status" />
            </template>
          </OTable>
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import KpiCardsSkeleton from "./KpiCardsSkeleton.vue";
import { copyToClipboard } from "@/utils/clipboard";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import type {
  EvalJob,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { normalizeJobFilterCondition } from "../utils/jobFilter";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import {
  useEvalJobRuns,
  type JobRunsWindow,
} from "../composables/useEvalJobRuns";
import {
  ALL_AGENTS_VALUE,
  agentFilterKey,
  agentFilterLabel,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";

const props = defineProps<{
  row: EvalJob;
  scorers: Scorer[];
  scoreConfigs: ScoreConfig[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-scorer", row: Scorer): void;
}>();

// Drawer open state — starts open (the parent mounts this only when a job is
// selected). Any dismiss path (× button, Escape, overlay click) flows through
// ODrawer's update:open(false) → we forward `close` to the parent, which
// unmounts us.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("close");
}

const { t } = useI18n();
const store = useStore();
const orgId = computed(
  () => store.state.selectedOrganization?.identifier ?? "default",
);

type TabId = "configuration" | "runs" | "failures";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(
  row: any,
  camel: string,
  snake: string,
): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const streamType = computed<string>(
  () => valueOf<string>(props.row, "streamType", "stream_type") ?? "traces",
);

const normalizedFilter = computed(() => {
  const raw = valueOf<any>(props.row, "filterCondition", "filter_condition");
  return normalizeJobFilterCondition(raw);
});

const filterCondition = computed(() => normalizedFilter.value);

// Render the filter with the SAME formatter the alert UI uses, so a job's
// filter reads identically to an alert condition: a single inline expression
// with lowercase operators and nested groups in parentheses (no custom
// per-level layout). The job's `filter_condition` is the same V2 group
// structure alerts use, so it feeds straight into `buildConditionsString`.
const filterText = computed<string>(() => {
  const cond = filterCondition.value;
  if (!cond) return "";
  const body = buildConditionsString(cond, {
    sqlMode: false,
    addWherePrefix: false,
    formatValues: false,
  });
  return body ? `if ${body}` : "";
});

const statusLabel = computed(() =>
  t(`onlineEvals.jobStatus.${props.row.status}`, props.row.status),
);

const samplingMode = computed(
  () => valueOf<string>(props.row, "samplingMode", "sampling_mode") ?? "all",
);

const samplingValue = computed(() =>
  valueOf<any>(props.row, "samplingValue", "sampling_value"),
);

const samplingModeLabel = computed(() => {
  if (samplingMode.value === "rate")
    return t("onlineEvals.job.detail.samplingRate");
  if (samplingMode.value === "count")
    return t("onlineEvals.job.detail.samplingCount");
  return t("onlineEvals.job.detail.samplingAll");
});

interface ResolvedScorer {
  id: string;
  name: string;
  version: number;
  scoreConfigName: string;
  scoreConfigDataType: string;
  scoreConfigRangeText: string;
  scorerType: "llm_judge" | "remote" | "unknown";
  scorerTypeLabel: string;
}

function describeScoreConfig(cfg: ScoreConfig | null): {
  dataType: string;
  rangeText: string;
} {
  if (!cfg) return { dataType: "", rangeText: "" };
  const dataType = String(valueOf<string>(cfg, "dataType", "data_type") ?? "");
  if (dataType === "numeric") {
    const range: any = valueOf<any>(cfg, "numericRange", "numeric_range") ?? {};
    if (range && range.min != null && range.max != null) {
      return { dataType, rangeText: `${range.min}–${range.max}` };
    }
    return { dataType, rangeText: "" };
  }
  if (dataType === "categorical") {
    const cats: string[] = Array.isArray((cfg as any).categories)
      ? (cfg as any).categories
      : [];
    const text =
      cats.length > 0
        ? cats.length <= 3
          ? cats.join(" · ")
          : `${cats.slice(0, 3).join(" · ")} +${cats.length - 3}`
        : "";
    return { dataType, rangeText: text };
  }
  if (dataType === "boolean") {
    return { dataType, rangeText: "true / false" };
  }
  return { dataType, rangeText: "" };
}

const resolvedScorers = computed<ResolvedScorer[]>(() => {
  if (!Array.isArray(props.row.scorers)) return [];
  return props.row.scorers.map((ref): ResolvedScorer => {
    const refId = typeof ref === "string" ? ref : (ref?.id ?? "");
    const refVersion = typeof ref === "object" ? (ref?.version ?? null) : null;
    const found = props.scorers.find((s) => entityId(s) === refId);
    if (!found) {
      return {
        id: refId,
        name: refId || t("onlineEvals.job.detail.scorerUnknown"),
        version: refVersion ?? 0,
        scoreConfigName: "",
        scoreConfigDataType: "",
        scoreConfigRangeText: "",
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
      ? (props.scoreConfigs.find((c) => entityId(c) === cfgId) ?? null)
      : null;
    const cfgMeta = describeScoreConfig(cfg);
    const rawType =
      valueOf<string>(found, "scorerType", "scorer_type") ?? "llm_judge";
    const scorerType: ResolvedScorer["scorerType"] =
      rawType === "remote" ? "remote" : "llm_judge";
    return {
      // Use the resolved scorer's stable entity_id so downstream lookups
      // (findScorerById, onScorerClick) consistently match against
      // `entityId(s)`. Using the raw `found.id` here breaks when entity_id
      // differs from id (the common case for versioned rows).
      id: entityId(found),
      name: found.name,
      version: refVersion ?? found.version,
      scoreConfigName: cfg?.name ?? "",
      scoreConfigDataType: cfgMeta.dataType,
      scoreConfigRangeText: cfgMeta.rangeText,
      scorerType,
      scorerTypeLabel:
        scorerType === "remote"
          ? t("onlineEvals.job.detail.scorerTypeRemote")
          : t("onlineEvals.job.detail.scorerTypeLlmJudge"),
    };
  });
});

// `_evaluator.attributes_scorer_id` stores the scorer's stable `entity_id`
// (the cross-version identifier), NOT the per-version row `id`. Match on
// `entityId(s)` so the lookup resolves to the scorer name — matching `s.id`
// fails whenever entity_id differs from id (the common versioned case), which
// left the Runs table showing the raw id instead of the scorer name.
function scorerNameFor(refId: string): string {
  if (!refId) return t("onlineEvals.job.detail.runs.scorerUnknown");
  const found = props.scorers.find((s) => entityId(s) === refId);
  return found?.name ?? refId;
}

// Config-tab scorer cards key off `resolvedScorers[].id`, which is the scorer's
// stable `entity_id` (see resolvedScorers). Match on `entityId(s)` here too —
// matching the per-version row `id` instead leaves the card disabled whenever
// entity_id differs from id (the common case for versioned scorers).
function findScorerById(refId: string): Scorer | null {
  return props.scorers.find((s) => entityId(s) === refId) ?? null;
}

function onScorerClick(refId: string) {
  const scorer = findScorerById(refId);
  if (scorer) emit("view-scorer", scorer);
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

// — Tabs — no badge counts on Runs / Failures (the KPI strip already shows
// these numbers at the top of every tab in eval job list).
const tabs = computed(() => [
  {
    id: "configuration" as TabId,
    label: t("onlineEvals.job.detail.tabs.configuration"),
  },
  { id: "runs" as TabId, label: t("onlineEvals.job.detail.tabs.runs") },
  { id: "failures" as TabId, label: t("onlineEvals.job.detail.tabs.failures") },
]);

// — Runs / Failures window — backed by DateTimePickerDashboard.
const dateTimePickerRef = ref<{
  getConsumableDateTime: () => { startTime: number; endTime: number };
} | null>(null);
const selectedDate = ref<any>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "24h",
});

const dateWindow = ref<JobRunsWindow>({
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

// The DateTimePicker emits `update:modelValue` on apply; sync the resolved
// window on every change so the queries refire.
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

const tableEnabled = computed(
  () => activeTab.value === "runs" || activeTab.value === "failures",
);
const jobIdRef = computed(() => String(props.row.id ?? ""));

const {
  kpis,
  runs,
  failures,
  isLoadingKpis,
  isLoading: isLoadingRuns,
  refresh: refreshRunsData,
} = useEvalJobRuns(jobIdRef, dateWindow, tableEnabled, selectedAgent);

// Global refresh — re-syncs the shared window then re-queries everything
// (KPI strip + Runs + Failures), since one picker drives the whole view.
async function refreshAll() {
  syncDateWindow();
  await refreshRunsData();
}

// — KPI strip cards —
// value/unit split mirrors the SessionDetails KPI cards (big value + small
// trailing unit) so the AI module's detail pages read identically.
const kpiCards = computed<{ label: string; value: string; unit: string }[]>(
  () => {
    const k = kpis.value;
    return [
      {
        label: t("onlineEvals.job.detail.kpis.totalRuns"),
        value: formatCount(k.totalRuns),
        unit: "",
      },
      {
        label: t("onlineEvals.job.detail.kpis.successRate"),
        value: k.successRate == null ? "—" : k.successRate.toFixed(1),
        unit: k.successRate == null ? "" : "%",
      },
      {
        label: t("onlineEvals.job.detail.kpis.avgLatency"),
        ...splitLatency(k.avgLatencyMs),
      },
      {
        label: t("onlineEvals.job.detail.kpis.scorers"),
        value: String(resolvedScorers.value.length),
        unit: "",
      },
    ];
  },
);

// — OTable column definitions —
const runColumns = computed(() => [
  {
    id: "timestampMs",
    header: t("onlineEvals.job.detail.runs.col.time"),
    accessorKey: "timestampMs",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "scorerId",
    header: t("onlineEvals.job.detail.runs.col.scorer"),
    accessorKey: "scorerId",
    sortable: true,
    // Numeric size + `flex`: this column fills the leftover width AND stays
    // resizable. `size: "auto"` is not a valid size — it broke column-width
    // computation (header/body misalignment) and the resize grips.
    size: 220,
    meta: { align: "left", flex: true },
  },
  {
    id: "targetSpanId",
    header: t("onlineEvals.job.detail.runs.col.spanId"),
    accessorKey: "targetSpanId",
    sortable: true,
    size: 190,
    meta: { align: "left" },
  },
  {
    id: "targetTraceId",
    header: t("onlineEvals.job.detail.runs.col.traceId"),
    accessorKey: "targetTraceId",
    sortable: true,
    size: 230,
    meta: { align: "left" },
  },
  {
    id: "scoreDisplay",
    header: t("onlineEvals.job.detail.runs.col.score"),
    accessorKey: "scoreDisplay",
    sortable: false,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "latencyMs",
    header: t("onlineEvals.job.detail.runs.col.latency"),
    accessorKey: "latencyMs",
    sortable: true,
    size: 110,
    // Left-aligned to match the rest of the columns. A sortable header can't
    // right-align (its flex-1 sort wrapper overrides justify-end), so a
    // right-aligned cell would never line up under the header label.
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("onlineEvals.job.detail.runs.col.status"),
    accessorKey: "status",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
]);


// — Helpers —
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

<style lang="scss">
// Page layout, spacing, colors, and text styling are Tailwind utilities in the
// template (matching SessionDetails.vue). Only cohesive blocks that rely on
// descendant/element selectors or hover state remain here. Font-family is never
// set per component — it inherits the global --font-sans.

/* — Key/value description lists — */
.jd-kv {
  display: grid;
  grid-template-columns: 8.125rem 1fr;
  gap: 0.375rem 0.875rem;
  margin: 0;
}

// Field labels follow the alert form convention (AddAlert.vue's
// `.alert-v3-inline-label`): 12px / 600, in the muted-secondary color so the
// label reads as a strong caption while the value below stays primary.
.jd-kv dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-kv dd {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-primary, currentColor);
  word-break: break-word;
}

// Filter code block — mirrors the Alert History condition view (rounded,
// bordered, neutral surface + header bar) so condition rendering is consistent
// across drawers.
.jd-codeblock {
  border: 0.0625rem solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 0.5rem;
  overflow: hidden;
  background: color-mix(
    in srgb,
    var(--color-text-secondary) 4%,
    var(--color-card-bg)
  );
}

.jd-codeblock__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0.625rem;
  border-bottom: 0.0625rem solid var(--color-dialog-header-border, var(--o2-border));
  background: color-mix(
    in srgb,
    var(--color-text-secondary) 6%,
    var(--color-card-bg)
  );
}

.jd-codeblock__label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-codeblock__content {
  margin: 0;
  padding: 0.625rem 0.875rem;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--color-text-primary, currentColor);
  white-space: pre-wrap;
  overflow-x: auto;
  // Hard cap the filter condition height; longer conditions scroll.
  max-height: 12.5rem;
  overflow-y: auto;
}

.jd-scorers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  // Show ~3 scorer cards (~65px each + 10px gap); the rest scroll. The small
  // extra lets the 4th card peek as a scroll affordance. padding-right keeps
  // the scrollbar off the card edges.
  max-height: 25rem;
  overflow-y: auto;
  padding-right: 0.25rem;
  padding-top:0.625rem
}

.jd-scorers__card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  background: var(--color-card-bg);
  border: 0.0625rem solid
    color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 0.5rem;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s,
    transform 0.15s;
}

.jd-scorers__card:hover:not(:disabled) {
  border-color: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 45%,
    transparent
  );
  background: color-mix(
    in srgb,
    var(--color-primary-600, #3f7994) 4%,
    var(--color-card-bg)
  );
  box-shadow: 0 0.0625rem 0.1875rem
    color-mix(in srgb, var(--color-primary-600, #3f7994) 12%, transparent);
  transform: translateY(-0.0625rem);
}

.jd-scorers__card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.jd-scorers__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.125rem;
  height: 2.125rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.jd-scorers__icon--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.jd-scorers__icon--unknown {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3125rem;
}

.jd-scorers__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.jd-scorers__name {
  font-weight: 700;
  font-size: 0.875rem;
  color: var(--color-text-primary, currentColor);
}

.jd-scorers__type {
  display: inline-flex;
  padding: 0.0625rem 0.4375rem;
  border-radius: 0.1875rem;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.jd-scorers__type--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.jd-scorers__version {
  font-size: 0.6875rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__produces {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  flex-wrap: wrap;
}

.jd-scorers__produces-icon {
  flex-shrink: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.7;
}

.jd-scorers__produces-prefix {
  font-weight: 500;
}

.jd-scorers__produces-name {
  color: var(--color-text-primary, currentColor);
  font-weight: 700;
}

.jd-scorers__produces-type,
.jd-scorers__produces-range {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__sep {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.5;
}

.jd-scorers__cta {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__cta-label {
  opacity: 0;
  transition: opacity 0.15s;
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__cta {
  color: var(--color-primary-600, #3f7994);
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__cta-label {
  opacity: 1;
}

.jd-scorers__chevron {
  flex-shrink: 0;
  opacity: 0.5;
  transition:
    opacity 0.15s,
    transform 0.15s;
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__chevron {
  opacity: 1;
  transform: translateX(0.125rem);
}

/* — Runs / Failures status cell — */
.jd-status-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-status-cell__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-status-cell--success {
  color: var(--color-status-success-text);
}
.jd-status-cell--success .jd-status-cell__dot {
  background: var(--color-status-success-text);
}

.jd-status-cell--error,
.jd-status-cell--timeout {
  color: var(--color-status-error-text);
}
.jd-status-cell--error .jd-status-cell__dot,
.jd-status-cell--timeout .jd-status-cell__dot {
  background: var(--color-status-error-text);
}

.jd-status-cell--skipped .jd-status-cell__dot {
  background: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
}
</style>
