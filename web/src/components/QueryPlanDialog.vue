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

<template>
  <ODialog
    v-model:open="showDialog"
    data-test="query-plan-dialog"
    size="full"
    :title="t('search.queryProfile.dialogTitle')"
  >
    <template #header-left>
      <OButton
        variant="outline"
        size="sm"
        class="min-w-0 flex-1"
        :icon-right="sqlExpanded ? 'expand-less' : 'expand-more'"
        :aria-expanded="sqlExpanded"
        data-test="query-plan-sql-toggle"
        @click="sqlExpanded = !sqlExpanded"
      >
        <OTruncatedText :tooltip="false" class="flex-1 text-start font-mono text-xs">{{
          sqlOneLine
        }}</OTruncatedText>
      </OButton>
    </template>
    <template #header-right>
      <OToggleGroup
        type="single"
        mobile-dropdown
        :model-value="mode"
        :aria-label="t('search.queryProfile.modeLabel')"
        data-test="query-plan-mode"
        @update:model-value="onMode"
      >
        <OToggleGroupItem value="plan" size="sm" data-test="query-plan-mode-plan">{{
          t("search.queryProfile.modePlan")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="analyze" size="sm" data-test="query-plan-mode-analyze">{{
          t("search.queryProfile.modeAnalyze")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="text" size="sm" data-test="query-plan-mode-text">{{
          t("search.queryProfile.modeText")
        }}</OToggleGroupItem>
      </OToggleGroup>
      <OButton
        :variant="hasAnalyze ? 'outline' : 'primary'"
        size="sm"
        :icon-left="hasAnalyze ? 'refresh' : 'play-arrow'"
        :loading="profileLoading"
        data-test="query-plan-run-btn"
        @click="runAnalyze"
      >
        {{ hasAnalyze ? t("search.queryProfile.rerun") : t("search.queryProfile.runAnalyze") }}
        <OTooltip :content="t('search.queryProfile.runAnalyzeTooltip')" />
      </OButton>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <div
        v-if="sqlExpanded"
        class="border-border-default bg-surface-base max-h-[30vh] shrink-0 overflow-auto border-b px-4 py-3"
        data-test="query-plan-sql-full"
      >
        <pre
          class="bg-code-bg text-text-code rounded-default text-compact m-0 px-3 py-2 font-mono leading-normal wrap-break-word whitespace-pre-wrap"
          >{{ sqlQuery }}</pre>
      </div>

      <div class="min-h-0 flex-1">
        <div
          v-if="loadingText"
          class="flex h-full flex-col items-center justify-center gap-3 p-6"
          data-test="query-plan-loading"
        >
          <OSpinner variant="dots" size="lg" />
          <div class="text-text-secondary text-sm">{{ loadingText }}</div>
        </div>

        <div v-else-if="errorText" class="p-4" data-test="query-plan-error">
          <OBanner variant="error" icon="error" :content="raw(errorText)" />
        </div>

        <QueryPlanView
          v-else-if="mode === 'plan' && planProfile"
          :profile="planProfile"
          :running="profileLoading"
          @run="runAnalyze"
        />

        <QueryProfileView
          v-else-if="mode === 'analyze' && profile"
          :profile="profile"
          :stream="streamResult"
        />

        <div
          v-else-if="mode === 'analyze' && analyzePlan"
          class="flex h-full flex-col gap-3 overflow-y-auto p-4"
          data-test="query-plan-analyze-fallback"
        >
          <MetricsSummaryCard v-if="summaryMetrics" :metrics="summaryMetrics" />
          <div
            class="bg-card-glass-bg border-card-glass-border rounded-default flex flex-1 flex-col overflow-hidden border border-solid"
          >
            <div class="border-card-glass-border bg-surface-base border-b border-solid px-4 py-2.5">
              <span class="text-text-label text-xs font-semibold">{{
                t("search.executionPlan")
              }}</span>
            </div>
            <div class="flex-1 overflow-y-auto px-4 py-3">
              <QueryPlanTree v-if="analyzeTree" :tree="analyzeTree" :is-analyze="true" />
            </div>
          </div>
        </div>

        <QueryPlanText
          v-else-if="mode === 'text'"
          :physical-plan="physicalPlan"
          :logical-plan="logicalPlan"
          :analyze-plan="analyzeText"
        />

        <div
          v-else
          class="text-text-secondary px-4 py-6 text-center text-sm"
          data-test="query-plan-empty"
        >
          {{ mode === "plan" ? t("search.noPhysicalPlan") : t("search.noAnalyzePlanFound") }}
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import streamingSearch from "@/services/streaming_search";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { generateTraceContext } from "@/utils/zincutils";
import {
  calculateSummaryMetrics,
  findRemoteExecNode,
  parseQueryPlanTree,
  type OperatorNode,
  type SummaryMetrics,
} from "@/utils/queryPlanParser";
import {
  extractProfile,
  parseSearchStream,
  physicalPlanToProfile,
  type PlanHit,
  type QueryProfile,
  type SearchStreamResult,
} from "@/utils/queryProfile";
import MetricsSummaryCard from "@/components/query-plan/MetricsSummaryCard.vue";
import QueryPlanText from "@/components/query-plan/QueryPlanText.vue";
import QueryPlanTree from "@/components/query-plan/QueryPlanTree.vue";
import QueryPlanView from "@/components/query-plan/QueryPlanView.vue";
import QueryProfileView from "@/components/query-plan/QueryProfileView.vue";

type PlanMode = "plan" | "analyze" | "text";

const MODES: PlanMode[] = ["plan", "analyze", "text"];

defineOptions({ name: "QueryPlanDialog" });

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    searchObj: { data?: { query?: string } };
  }>(),
  { modelValue: false },
);

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t } = useI18nTyped();
const store = useStore();
const { getSearchQueryPayload } = useSearchStream(t);
const { searchObj: logsState } = searchState();

const mode = ref<PlanMode>("plan");
const sqlExpanded = ref(false);
const planLoading = ref(false);
const planError = ref("");
const logicalPlan = ref("");
const physicalPlan = ref("");
const profileLoading = ref(false);
const profileError = ref("");
const streamResult = ref<SearchStreamResult | null>(null);
const profile = ref<QueryProfile | null>(null);
const analyzePlan = ref("");
const analyzeTree = ref<OperatorNode | null>(null);
// a reopened dialog must ignore responses from requests sent before it was reset
let requestEpoch = 0;

const showDialog = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const sqlQuery = computed(() => props.searchObj?.data?.query || "");
const sqlOneLine = computed(() => raw(sqlQuery.value.replace(/\s+/g, " ").trim()));
const planProfile = computed(() =>
  physicalPlan.value ? physicalPlanToProfile(physicalPlan.value) : null,
);
const hasAnalyze = computed(() => !!profile.value || !!analyzePlan.value);

const summaryMetrics = computed<SummaryMetrics | null>(() =>
  analyzePlan.value ? calculateSummaryMetrics(analyzePlan.value) : null,
);

const analyzeText = computed<string | null>(() => {
  if (!streamResult.value) return null;
  return [...streamResult.value.hits]
    .sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))
    .map((h) => (h.plan ?? "").replace(/\s+$/, ""))
    .filter((plan) => plan.trim())
    .join("\n");
});

const loadingText = computed<I18nText | null>(() => {
  if (mode.value === "analyze")
    return profileLoading.value ? t("search.queryProfile.runningAnalyze") : null;
  return planLoading.value ? t("search.loadingPlan") : null;
});

const errorText = computed(() => {
  if (mode.value === "analyze") return profileError.value;
  return mode.value === "plan" ? planError.value : "";
});

function explainPayload(prefix: string) {
  const queryReq = getSearchQueryPayload();
  if (!queryReq?.query?.sql) return null;
  return { ...queryReq, query: { ...queryReq.query, sql: `${prefix} ${queryReq.query.sql}` } };
}

async function search(query: Record<string, unknown>): Promise<SearchStreamResult | null> {
  const { traceId } = generateTraceContext();
  const response = await streamingSearch.search({
    org_identifier: store.state.selectedOrganization.identifier,
    query,
    page_type: logsState.data.stream.streamType || "logs",
    search_type: "ui",
    traceId,
  });
  return parseSearchStream(response.data);
}

function errorMessage(err: unknown, fallback: I18nText): string {
  const e = err as { message?: string; response?: { data?: { message?: string } } } | null;
  return e?.response?.data?.message || e?.message || fallback;
}

function parseExplainHits(hits: PlanHit[]) {
  for (const hit of hits) {
    const source = hit._source as PlanHit | undefined;
    const planType = hit.plan_type ?? source?.plan_type;
    const plan = String(hit.plan ?? source?.plan ?? "").trim();
    if (planType === "logical_plan") logicalPlan.value = plan;
    else if (planType === "physical_plan") physicalPlan.value = plan;
  }
}

// Phase 1+ plans are nested under the phase-0 remote scan so the old analyze tree reads top-down.
function parseAnalyzeHits(hits: PlanHit[]) {
  const planOf = (h: PlanHit) => String(h.plan ?? "");
  const phase0 = hits.filter((h) => h.phase === 0);
  const phase1 = hits.filter((h) => h.phase === 1);
  analyzeTree.value = null;
  if (!phase0.length || !phase1.length) {
    analyzePlan.value = [...hits]
      .sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))
      .map(planOf)
      .filter((p) => p.trim())
      .join("\n\n")
      .trim();
    analyzeTree.value = analyzePlan.value ? parseQueryPlanTree(analyzePlan.value) : null;
    return;
  }
  const phase0Plan = phase0
    .map(planOf)
    .filter((p) => p.trim())
    .join("\n");
  const tree = parseQueryPlanTree(phase0Plan);
  const remote = findRemoteExecNode(tree);
  const children = phase1.flatMap((h) =>
    planOf(h).trim() ? parseQueryPlanTree(planOf(h)).children : [],
  );
  if (remote && children.length) remote.children = children;
  analyzePlan.value = phase0Plan.trim();
  analyzeTree.value = tree;
}

function resetAnalyze() {
  profileError.value = "";
  streamResult.value = null;
  profile.value = null;
  analyzePlan.value = "";
  analyzeTree.value = null;
}

async function fetchExplainPlan() {
  const epoch = ++requestEpoch;
  planLoading.value = true;
  planError.value = "";
  logicalPlan.value = "";
  physicalPlan.value = "";
  try {
    const payload = explainPayload("EXPLAIN");
    const parsed = payload ? await search(payload) : null;
    if (epoch !== requestEpoch) return;
    if (!payload) planError.value = t("search.errorFetchingPlan");
    else if (parsed) parseExplainHits(parsed.hits);
    if (payload && !logicalPlan.value && !physicalPlan.value) {
      planError.value = t("search.noPlanFound");
    }
  } catch (err: unknown) {
    if (epoch !== requestEpoch) return;
    console.error("Error fetching explain plan:", err);
    planError.value = errorMessage(err, t("search.errorFetchingPlan"));
  } finally {
    if (epoch === requestEpoch) planLoading.value = false;
  }
}

async function runAnalyze() {
  if (profileLoading.value) return;
  const epoch = requestEpoch;
  mode.value = "analyze";
  profileLoading.value = true;
  profileError.value = "";
  try {
    const payload = explainPayload("EXPLAIN ANALYZE");
    const parsed = payload ? await search(payload) : null;
    if (epoch !== requestEpoch) return;
    resetAnalyze();
    if (!payload) {
      profileError.value = t("search.errorRunningAnalyze");
      return;
    }
    if (parsed) {
      parseAnalyzeHits(parsed.hits);
      streamResult.value = parsed;
      profile.value = extractProfile(parsed.hits);
    }
    if (!profile.value && !analyzePlan.value) profileError.value = t("search.noAnalyzePlanFound");
  } catch (err: unknown) {
    if (epoch !== requestEpoch) return;
    console.error("Error running analyze:", err);
    resetAnalyze();
    profileError.value = errorMessage(err, t("search.errorRunningAnalyze"));
  } finally {
    if (epoch === requestEpoch) profileLoading.value = false;
  }
}

function onMode(value: unknown) {
  if (!MODES.includes(value as PlanMode)) return;
  mode.value = value as PlanMode;
  if (mode.value === "analyze" && !hasAnalyze.value && !profileLoading.value) runAnalyze();
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.searchObj) return;
    mode.value = "plan";
    sqlExpanded.value = false;
    profileLoading.value = false;
    resetAnalyze();
    fetchExplainPlan();
  },
);
</script>
