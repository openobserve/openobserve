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
        <OToggleGroupItem value="text" size="sm" data-test="query-plan-mode-text">{{
          t("search.queryProfile.modeText")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="analyze" size="sm" data-test="query-plan-mode-analyze">
          {{ t("search.queryProfile.modeAnalyze") }}
          <span v-if="analyzeBusy" class="ms-1.5 inline-flex items-center gap-1">
            <OSpinner size="xs" />
            <span
              class="text-2xs font-mono tabular-nums"
              data-test="query-plan-mode-analyze-elapsed"
              >{{ elapsedLabel }}</span
            >
          </span>
          <span
            v-else-if="analyzeState === 'done' || analyzeState === 'failed'"
            role="img"
            class="ms-1.5 inline-block size-1.5 rounded-full"
            :class="analyzeState === 'done' ? 'bg-status-positive' : 'bg-status-negative'"
            :aria-label="
              analyzeState === 'done'
                ? t('search.queryProfile.analyzeSucceeded')
                : t('search.queryProfile.analyzeFailedShort')
            "
            :data-test="`query-plan-mode-analyze-${analyzeState}`"
          />
        </OToggleGroupItem>
      </OToggleGroup>
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
          v-if="mode === 'analyze'"
          class="flex h-full min-h-0 flex-col"
          data-test="query-plan-analyze"
        >
          <template v-if="hasResults && (analyzeState === 'done' || analyzeState === 'rerunning')">
            <AnalyzeResultBar
              :ran-at="lastRun?.ranAt ?? ''"
              :took="lastRun ? formatTime(lastRun.tookMs) : null"
              :nodes="resultNodes"
              :busy="analyzeBusy"
              @rerun="runAnalyze"
            />
            <div class="relative min-h-0 flex-1">
              <div
                class="h-full"
                :class="analyzeBusy ? 'pointer-events-none opacity-35 saturate-50' : ''"
                :inert="analyzeBusy"
                data-test="query-plan-analyze-results"
              >
                <QueryProfileView v-if="resultModel" :model="resultModel" :stream="streamResult" />
                <div
                  v-else
                  class="flex h-full flex-col gap-3 overflow-y-auto p-4"
                  data-test="query-plan-analyze-fallback"
                >
                  <MetricsSummaryCard v-if="summaryMetrics" :metrics="summaryMetrics" />
                  <div
                    class="bg-card-glass-bg border-card-glass-border rounded-default flex flex-1 flex-col overflow-hidden border border-solid"
                  >
                    <div
                      class="border-card-glass-border bg-surface-base border-b border-solid px-4 py-2.5"
                    >
                      <span class="text-text-label text-xs font-semibold">{{
                        t("search.executionPlan")
                      }}</span>
                    </div>
                    <div class="flex-1 overflow-y-auto px-4 py-3">
                      <QueryPlanTree v-if="analyzeTree" :tree="analyzeTree" :is-analyze="true" />
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="analyzeBusy"
                class="absolute inset-0 z-30 flex items-center justify-center overflow-auto p-6"
              >
                <AnalyzeRunningCard
                  :elapsed="elapsedLabel"
                  rerun
                  :reference="lastRun ? formatTime(lastRun.tookMs) : null"
                  @cancel="cancelAnalyze"
                />
              </div>
            </div>
          </template>
          <div
            v-else
            class="bg-surface-panel flex h-full items-center justify-center overflow-auto p-6 max-md:p-4"
          >
            <AnalyzeRunningCard
              v-if="analyzeBusy"
              :elapsed="elapsedLabel"
              :rerun="false"
              :reference="lastSearchTook"
              @cancel="cancelAnalyze"
            />
            <AnalyzeStartCard
              v-else
              :facts="analyzeFacts"
              :notice="analyzeNotice"
              :retry="analyzeState === 'failed'"
              @run="runAnalyze"
            />
          </div>
        </div>

        <div
          v-else-if="planLoading"
          class="flex h-full flex-col items-center justify-center gap-3 p-6"
          data-test="query-plan-loading"
        >
          <OSpinner variant="dots" size="lg" />
          <div class="text-text-secondary text-sm">{{ t("search.loadingPlan") }}</div>
        </div>

        <div v-else-if="mode === 'plan' && planError" class="p-4" data-test="query-plan-error">
          <OBanner variant="error" icon="error" :content="raw(planError)" />
        </div>

        <QueryPlanView
          v-else-if="mode === 'plan' && planModel"
          :model="planModel"
          @analyze="mode = 'analyze'"
        />

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
          {{ t("search.noPhysicalPlan") }}
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import streamingSearch from "@/services/streaming_search";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { generateTraceContext } from "@/utils/zincutils";
import {
  calculateSummaryMetrics,
  findRemoteExecNode,
  formatTime,
  parseQueryPlanTree,
  type OperatorNode,
  type SummaryMetrics,
} from "@/utils/queryPlanParser";
import {
  buildProfileModel,
  clusterNodes,
  extractProfile,
  formatElapsed,
  parseSearchStream,
  physicalPlanToProfile,
  summarizePlan,
  type PlanHit,
  type QueryProfile,
  type SearchStreamResult,
} from "@/utils/queryProfile";
import AnalyzeResultBar from "@/components/query-plan/AnalyzeResultBar.vue";
import AnalyzeRunningCard from "@/components/query-plan/AnalyzeRunningCard.vue";
import AnalyzeStartCard from "@/components/query-plan/AnalyzeStartCard.vue";
import MetricsSummaryCard from "@/components/query-plan/MetricsSummaryCard.vue";
import QueryPlanText from "@/components/query-plan/QueryPlanText.vue";
import QueryPlanTree from "@/components/query-plan/QueryPlanTree.vue";
import QueryPlanView from "@/components/query-plan/QueryPlanView.vue";
import QueryProfileView from "@/components/query-plan/QueryProfileView.vue";
import type { AnalyzeFact, AnalyzeNotice } from "@/components/query-plan/profileStyles";
import { timeRangeLabel } from "@/components/query-plan/profileText";

type PlanMode = "plan" | "text" | "analyze";

type AnalyzeState = "idle" | "running" | "cancelled" | "failed" | "done" | "rerunning";

interface DialogSearchObj {
  data?: {
    query?: string;
    stream?: { selectedStream?: string[] };
    datetime?: Parameters<typeof timeRangeLabel>[1];
    queryResults?: { took?: number };
  };
}

const MODES: PlanMode[] = ["plan", "text", "analyze"];
const TICK_MS = 1000;

defineOptions({ name: "QueryPlanDialog" });

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    searchObj: DialogSearchObj;
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
const analyzeState = ref<AnalyzeState>("idle");
const analyzeError = ref("");
const stoppedAfterMs = ref(0);
const runStartedAt = ref(0);
const now = ref(0);
const lastRun = ref<{ ranAt: string; tookMs: number } | null>(null);
const streamResult = ref<SearchStreamResult | null>(null);
const profile = ref<QueryProfile | null>(null);
const analyzePlan = ref("");
const analyzeTree = ref<OperatorNode | null>(null);
// a reopened dialog must ignore responses from requests sent before it was reset
let requestEpoch = 0;
// bumped on cancel and reset so a response that lands afterwards is dropped
let analyzeEpoch = 0;
let analyzeTraceId = "";
let analyzeAbort: AbortController | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

const showDialog = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const sqlQuery = computed(() => props.searchObj?.data?.query || "");
const sqlOneLine = computed(() => raw(sqlQuery.value.replace(/\s+/g, " ").trim()));
const planProfile = computed(() =>
  physicalPlan.value ? physicalPlanToProfile(physicalPlan.value) : null,
);
const planModel = computed(() =>
  planProfile.value ? buildProfileModel(planProfile.value, [], { planOnly: true }) : null,
);
// a join reads streams the logs page did not select, so prefer the ones the plan scans
const planStreams = computed(() => (planModel.value ? summarizePlan(planModel.value).streams : []));
const hasResults = computed(() => !!profile.value || !!analyzePlan.value);
const analyzeBusy = computed(
  () => analyzeState.value === "running" || analyzeState.value === "rerunning",
);
const elapsedLabel = computed(() => formatElapsed(now.value - runStartedAt.value));

const summaryMetrics = computed<SummaryMetrics | null>(() =>
  analyzePlan.value ? calculateSummaryMetrics(analyzePlan.value) : null,
);

const resultModel = computed(() =>
  profile.value ? buildProfileModel(profile.value, streamResult.value?.hits ?? []) : null,
);
const resultNodes = computed(() =>
  resultModel.value ? clusterNodes(resultModel.value).length : 0,
);

const analyzeText = computed<string | null>(() => {
  if (!streamResult.value || !hasResults.value) return null;
  return [...streamResult.value.hits]
    .sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))
    .map((h) => (h.plan ?? "").replace(/\s+$/, ""))
    .filter((plan) => plan.trim())
    .join("\n");
});

const lastSearchTook = computed(() => {
  const took = Number(props.searchObj?.data?.queryResults?.took);
  return took > 0 ? formatTime(took) : null;
});

const analyzeFacts = computed<AnalyzeFact[]>(() => {
  const data = props.searchObj?.data;
  const streams = planStreams.value.length
    ? planStreams.value
    : (data?.stream?.selectedStream ?? []);
  const count = Math.max(1, streams.length);
  const facts: AnalyzeFact[] = [
    {
      key: "stream",
      label: t("search.queryProfile.streamTile", { count }, count),
      value: streams.join(", ") || "—",
    },
  ];
  const range = timeRangeLabel(t, data?.datetime ?? null);
  if (range) facts.push({ key: "range", label: t("search.queryProfile.timeRange"), value: range });
  if (lastSearchTook.value) {
    facts.push({
      key: "took",
      label: t("search.queryProfile.lastSearchTook"),
      value: lastSearchTook.value,
      sub: t("search.queryProfile.fromCurrentResults"),
    });
  }
  facts.push({
    key: "nodes",
    label: t("search.queryProfile.runsOn"),
    value: t("search.queryProfile.allNodes"),
    sub: t("search.queryProfile.queriersAndIngesters"),
  });
  return facts;
});

const analyzeNotice = computed<AnalyzeNotice | null>(() => {
  const elapsed = formatElapsed(stoppedAfterMs.value);
  if (analyzeState.value === "cancelled") {
    const text =
      stoppedAfterMs.value >= TICK_MS
        ? t("search.queryProfile.cancelledAfter", { elapsed })
        : t("search.queryProfile.cancelledNow");
    return { variant: "info", text };
  }
  if (analyzeState.value !== "failed") return null;
  const message = analyzeError.value.replace(/[.\s]+$/, "");
  return {
    variant: "error",
    text: stoppedAfterMs.value
      ? t("search.queryProfile.failedAfter", { elapsed, message })
      : t("search.queryProfile.failedNow", { message }),
  };
});

function explainPayload(prefix: string) {
  const queryReq = getSearchQueryPayload();
  if (!queryReq?.query?.sql) return null;
  return { ...queryReq, query: { ...queryReq.query, sql: `${prefix} ${queryReq.query.sql}` } };
}

async function search(
  query: Record<string, unknown>,
  traceId: string,
  signal?: AbortSignal,
): Promise<SearchStreamResult | null> {
  const response = await streamingSearch.search({
    org_identifier: store.state.selectedOrganization.identifier,
    query,
    page_type: logsState.data.stream.streamType || "logs",
    search_type: "ui",
    traceId,
    signal,
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

function clearResults() {
  streamResult.value = null;
  profile.value = null;
  analyzePlan.value = "";
  analyzeTree.value = null;
  lastRun.value = null;
}

function startTicker() {
  stopTicker();
  runStartedAt.value = Date.now();
  now.value = runStartedAt.value;
  ticker = setInterval(() => (now.value = Date.now()), TICK_MS);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  now.value = Date.now();
}

function clockTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

async function fetchExplainPlan() {
  const epoch = ++requestEpoch;
  planLoading.value = true;
  planError.value = "";
  logicalPlan.value = "";
  physicalPlan.value = "";
  try {
    const payload = explainPayload("EXPLAIN");
    const parsed = payload ? await search(payload, generateTraceContext().traceId) : null;
    if (epoch !== requestEpoch) return;
    if (!payload) planError.value = t("search.errorFetchingPlan");
    else if (parsed?.error) planError.value = parsed.error;
    else if (parsed) parseExplainHits(parsed.hits);
    if (payload && !planError.value && !logicalPlan.value && !physicalPlan.value) {
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

function failAnalyze(message: string) {
  stopTicker();
  const elapsedMs = analyzeBusy.value ? now.value - runStartedAt.value : 0;
  // under a second "Failed after 0:00" reads as if nothing ran
  stoppedAfterMs.value = elapsedMs >= TICK_MS ? elapsedMs : 0;
  clearResults();
  analyzeError.value = message;
  analyzeState.value = "failed";
}

function finishAnalyze(parsed: SearchStreamResult | null) {
  if (parsed?.error !== undefined) {
    failAnalyze(parsed.error || t("search.errorRunningAnalyze"));
    return;
  }
  stopTicker();
  const elapsedMs = now.value - runStartedAt.value;
  if (parsed) {
    parseAnalyzeHits(parsed.hits);
    streamResult.value = parsed;
    profile.value = extractProfile(parsed.hits);
  }
  if (!parsed || !hasResults.value) {
    failAnalyze(t("search.noAnalyzePlanFound"));
    return;
  }
  const tookMs = parsed.took_detail?.total || parsed.took || elapsedMs;
  lastRun.value = { ranAt: clockTime(new Date()), tookMs };
  analyzeState.value = "done";
}

async function runAnalyze() {
  if (analyzeBusy.value) return;
  const payload = explainPayload("EXPLAIN ANALYZE");
  if (!payload) {
    failAnalyze(t("search.errorRunningAnalyze"));
    return;
  }
  const epoch = ++analyzeEpoch;
  analyzeTraceId = generateTraceContext().traceId;
  analyzeAbort = new AbortController();
  analyzeError.value = "";
  analyzeState.value = hasResults.value ? "rerunning" : "running";
  startTicker();
  try {
    const parsed = await search(payload, analyzeTraceId, analyzeAbort.signal);
    if (epoch === analyzeEpoch) finishAnalyze(parsed);
  } catch (err: unknown) {
    if (epoch !== analyzeEpoch) return;
    console.error("Error running analyze:", err);
    failAnalyze(errorMessage(err, t("search.errorRunningAnalyze")));
  }
}

function stopServerQuery() {
  analyzeEpoch++;
  stopTicker();
  // closing the request stops the query even when the cancel below races its registration
  analyzeAbort?.abort();
  analyzeAbort = null;
  const traceId = analyzeTraceId;
  analyzeTraceId = "";
  if (!traceId) return;
  Promise.resolve()
    .then(() =>
      streamingSearch.cancelStream({
        org_identifier: store.state.selectedOrganization.identifier,
        traceId,
      }),
    )
    .catch((err: unknown) => console.error("Error cancelling analyze:", err));
}

function cancelAnalyze() {
  if (!analyzeBusy.value) return;
  const afterMs = Date.now() - runStartedAt.value;
  const rerun = analyzeState.value === "rerunning";
  stopServerQuery();
  if (rerun) {
    analyzeState.value = "done";
    toast({
      variant: "info",
      message:
        afterMs >= TICK_MS
          ? t("search.queryProfile.rerunCancelled", { elapsed: formatElapsed(afterMs) })
          : t("search.queryProfile.rerunCancelledNow"),
    });
    return;
  }
  stoppedAfterMs.value = afterMs;
  analyzeState.value = "cancelled";
}

function resetAnalyze() {
  if (analyzeBusy.value) stopServerQuery();
  analyzeEpoch++;
  stopTicker();
  analyzeState.value = "idle";
  analyzeError.value = "";
  stoppedAfterMs.value = 0;
  clearResults();
}

function onMode(value: unknown) {
  if (MODES.includes(value as PlanMode)) mode.value = value as PlanMode;
}

watch(
  () => props.modelValue,
  (open) => {
    resetAnalyze();
    if (!open || !props.searchObj) return;
    mode.value = "plan";
    sqlExpanded.value = false;
    fetchExplainPlan();
  },
);

onBeforeUnmount(resetAnalyze);
</script>
