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
    :title="t('search.queryPlan')"
    @update:open="(v) => !v && onClose()"
  >
    <div class="h-full overflow-hidden p-0">
      <OSplitter
        v-model="splitterPosition"
        :horizontal="false"
        separator-class="relative before:content-[''] before:absolute before:left-1/2 before:inset-y-0 before:w-px before:bg-card-glass-border before:-translate-x-1/2 before:transition-[background-color,width] before:duration-200 hover:before:bg-accent hover:before:w-0.5"
        class="h-full"
      >
        <!-- Left Pane: SQL Query -->
        <template #before>
          <section class="bg-surface-base flex h-full flex-col overflow-hidden">
            <header
              class="bg-card-glass-bg border-card-glass-border flex h-11 shrink-0 items-center gap-2 border-b border-solid px-4"
            >
              <div class="flex items-center gap-2">
                <OIcon name="code" size="sm" class="text-text-secondary" />
                <h3
                  class="text-text-heading m-0 text-(length:--text-sm) font-(--font-semibold) tracking-[0.01em]"
                >
                  {{ t("search.sqlQuery") }}
                </h3>
              </div>
            </header>
            <div class="flex-1 overflow-y-auto p-4">
              <pre
                class="sql-query-text text-compact bg-code-bg border-card-glass-border rounded-default text-text-code m-0 box-border min-h-full border border-solid px-4 py-3.5 [font-family:var(--font-mono)] leading-[1.6] wrap-break-word whitespace-pre-wrap"
              ><code class="[font-family:inherit] text-inherit bg-transparent p-0">{{ sqlQuery }}</code></pre>
            </div>
          </section>
        </template>

        <!-- Right Pane: Explain/Analyze Results -->
        <template #after>
          <section class="bg-surface-base flex h-full flex-col overflow-hidden">
            <header
              class="bg-card-glass-bg border-card-glass-border flex h-11 shrink-0 items-center gap-2 border-b border-solid px-4"
            >
              <h3
                class="text-text-heading m-0 text-(length:--text-sm) font-(--font-semibold) tracking-[0.01em]"
              >
                {{ showAnalyzeResults ? t("search.analyzeResults") : t("search.explainResults") }}
              </h3>
              <div class="flex-1" />
              <OButton
                v-if="!isAnalyzing && !showAnalyzeResults"
                variant="primary"
                size="sm"
                :loading="loading"
                @click="runAnalyze"
              >
                {{ t("search.analyze") }}
                <OTooltip :content="t('search.analyzeTooltip')" />
              </OButton>
            </header>

            <div v-if="loading" class="flex flex-1 items-center justify-center p-6">
              <div class="text-center">
                <OSpinner variant="dots" size="lg" />
                <div class="text-text-secondary mt-3 text-(length:--text-sm)">
                  {{ isAnalyzing ? t("search.runningAnalyze") : t("search.loadingPlan") }}
                </div>
              </div>
            </div>

            <div v-else-if="error" class="p-4">
              <OBanner variant="error" icon="error" :content="error" />
            </div>

            <!-- EXPLAIN ANALYZE view -->
            <div
              v-else-if="showAnalyzeResults"
              class="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
            >
              <MetricsSummaryCard v-if="summaryMetrics" :metrics="summaryMetrics" class="mb-3" />

              <div
                class="plan-surface bg-card-glass-bg border-card-glass-border rounded-default flex flex-1 flex-col overflow-hidden border border-solid"
              >
                <div
                  class="border-card-glass-border bg-surface-base border-b border-solid px-4 py-2.5"
                >
                  <span
                    class="text-text-label text-(length:--text-xs) font-(--font-semibold) tracking-[0.06em] uppercase"
                    >{{ t("search.executionPlan") }}</span
                  >
                </div>
                <div class="flex-1 overflow-y-auto px-4 py-3">
                  <QueryPlanTree v-if="planTree" :tree="planTree" :is-analyze="true" />
                  <div v-else class="text-text-muted px-4 py-6 text-center text-(length:--text-sm)">
                    {{ t("search.noAnalyzePlanFound") }}
                  </div>
                </div>
              </div>
            </div>

            <!-- EXPLAIN view (tabs for logical/physical) -->
            <div v-else class="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div
                class="plan-surface bg-card-glass-bg border-card-glass-border rounded-default flex flex-1 flex-col overflow-hidden border border-solid"
              >
                <div class="border-card-glass-border border-b border-solid px-2">
                  <OTabs v-model="activeTab" dense align="left">
                    <OTab name="logical" :label="t('search.logicalPlan')" />
                    <OTab name="physical" :label="t('search.physicalPlan')" />
                  </OTabs>
                </div>

                <OTabPanels v-model="activeTab" animated>
                  <OTabPanel name="logical">
                    <div class="flex-1 overflow-y-auto px-4 py-3">
                      <QueryPlanTree
                        v-if="logicalPlanTree"
                        :tree="logicalPlanTree"
                        :is-analyze="false"
                      />
                      <div
                        v-else
                        class="text-text-muted px-4 py-6 text-center text-(length:--text-sm)"
                      >
                        {{ t("search.noLogicalPlan") }}
                      </div>
                    </div>
                  </OTabPanel>

                  <OTabPanel name="physical">
                    <div class="flex-1 overflow-y-auto px-4 py-3">
                      <QueryPlanTree
                        v-if="physicalPlanTree"
                        :tree="physicalPlanTree"
                        :is-analyze="false"
                      />
                      <div
                        v-else
                        class="text-text-muted px-4 py-6 text-center text-(length:--text-sm)"
                      >
                        {{ t("search.noPhysicalPlan") }}
                      </div>
                    </div>
                  </OTabPanel>
                </OTabPanels>
              </div>
            </div>
          </section>
        </template>
      </OSplitter>
    </div>
  </ODialog>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import streamingSearch from "@/services/streaming_search";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { generateTraceContext } from "@/utils/zincutils";
import {
  parseQueryPlanTree,
  calculateSummaryMetrics,
  findRemoteExecNode,
  type OperatorNode,
  type SummaryMetrics,
} from "@/utils/queryPlanParser";
import MetricsSummaryCard from "@/components/query-plan/MetricsSummaryCard.vue";
import QueryPlanTree from "@/components/query-plan/QueryPlanTree.vue";
import { searchState } from "@/composables/useLogs/searchState";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

export default defineComponent({
  name: "QueryPlanDialog",
  components: {
    OSplitter,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    MetricsSummaryCard,
    QueryPlanTree,
    OButton,
    ODialog,
    OSpinner,
    OIcon,
    OTooltip,
    OBanner,
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    searchObj: {
      type: Object,
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const { getSearchQueryPayload } = useSearchStream();

    const loading = ref(false);
    const error = ref("");
    const logicalPlan = ref("");
    const physicalPlan = ref("");
    const analyzePlan = ref("");
    const analyzePlanTreeOverride = ref<OperatorNode | null>(null); // For hierarchical phase nesting
    const activeTab = ref("logical");
    const isAnalyzing = ref(false);
    const showAnalyzeResults = ref(false);
    const splitterPosition = ref(50);

    let { searchObj } = searchState();

    const showDialog = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    const sqlQuery = computed(() => {
      return props.searchObj?.data?.query || "";
    });

    // Parse plans into tree structures
    const logicalPlanTree = computed<OperatorNode | null>(() => {
      if (!logicalPlan.value) return null;
      return parseQueryPlanTree(logicalPlan.value);
    });

    const physicalPlanTree = computed<OperatorNode | null>(() => {
      if (!physicalPlan.value) return null;
      return parseQueryPlanTree(physicalPlan.value);
    });

    const planTree = computed<OperatorNode | null>(() => {
      // Use override tree if available (for hierarchical phase nesting)
      if (analyzePlanTreeOverride.value) {
        return analyzePlanTreeOverride.value;
      }
      // Otherwise parse from text
      if (!analyzePlan.value) return null;
      return parseQueryPlanTree(analyzePlan.value);
    });

    // Calculate summary metrics for EXPLAIN ANALYZE
    const summaryMetrics = computed<SummaryMetrics | null>(() => {
      if (!analyzePlan.value) return null;
      return calculateSummaryMetrics(analyzePlan.value);
    });

    const parsePlans = (responseData: any, isAnalyze: boolean = false) => {
      // EXPLAIN returns: { hits: [{ plan_type: "logical_plan", plan: "..." }, { plan_type: "physical_plan", plan: "..." }] }
      // EXPLAIN ANALYZE returns: { hits: [{ phase: 0, plan: "..." }, { phase: 1, plan: "..." }] }

      logicalPlan.value = "";
      physicalPlan.value = "";
      analyzePlan.value = "";
      analyzePlanTreeOverride.value = null;

      if (!responseData || !responseData.hits) {
        return;
      }

      if (isAnalyze) {
        // For EXPLAIN ANALYZE: phase is numeric
        // Phase 0: RemoteExec (coordinator)
        // Phase 1+: Actual execution plans from workers
        // We need to nest Phase 1+ plans as children of Phase 0 RemoteExec

        // Separate phases
        const phase0Hits = responseData.hits.filter((hit: any) => hit.phase === 0);
        const phase1Hits = responseData.hits.filter((hit: any) => hit.phase === 1);

        if (phase0Hits.length > 0 && phase1Hits.length > 0) {
          // Parse phase 0
          const phase0Plan = phase0Hits
            .map((hit: any) => hit.plan || "")
            .filter((plan: string) => plan.trim() !== "")
            .join("\n");

          // Parse Phase 0 into tree
          const phase0Tree = parseQueryPlanTree(phase0Plan);

          // Find RemoteExec or RemoteScanExec in phase 0
          const remoteExec = findRemoteExecNode(phase0Tree);

          if (remoteExec) {
            // Parse each Phase 1 hit separately (one per partition)
            // Each partition may have its own execution tree
            const phase1Children: OperatorNode[] = [];

            for (const hit of phase1Hits) {
              const plan = hit.plan || "";
              if (plan.trim()) {
                const partitionTree = parseQueryPlanTree(plan);
                // Add all top-level operators from this partition as children
                if (partitionTree.children.length > 0) {
                  phase1Children.push(...partitionTree.children);
                }
              }
            }

            // Attach all Phase 1 children to RemoteScanExec
            if (phase1Children.length > 0) {
              remoteExec.children = phase1Children;
            }
          }

          // Store the merged hierarchy
          // Set both the text (for metrics calculation) and the tree (for display)
          analyzePlan.value = phase0Plan.trim();
          analyzePlanTreeOverride.value = phase0Tree;
        } else {
          // Fallback: combine all phases if structure is unexpected
          const allPlans = responseData.hits
            .sort((a: any, b: any) => (a.phase || 0) - (b.phase || 0))
            .map((hit: any) => hit.plan || "")
            .filter((plan: string) => plan.trim() !== "")
            .join("\n\n");

          if (allPlans) {
            analyzePlan.value = allPlans.trim();
            analyzePlanTreeOverride.value = null; // Use default parsing
          }
        }
      } else {
        // For EXPLAIN: plan_type is string
        responseData.hits.forEach((hit: any) => {
          const planType = hit.plan_type || hit._source?.plan_type;
          const planContent = hit.plan || hit._source?.plan || "";

          if (planType === "logical_plan") {
            logicalPlan.value = planContent.trim();
          } else if (planType === "physical_plan") {
            physicalPlan.value = planContent.trim();
          }
        });

        // Fallback: if no plan_type, try to parse from combined text
        if (!logicalPlan.value && !physicalPlan.value && responseData.hits.length > 0) {
          const combined = responseData.hits
            .map((h: any) => h.plan || JSON.stringify(h))
            .join("\n");

          // Try to split by plan_type markers
          const logicalMatch = combined.match(/logical_plan[:\s]+(.+?)(?=physical_plan|$)/is);
          const physicalMatch = combined.match(/physical_plan[:\s]+(.+?)$/is);

          if (logicalMatch) {
            logicalPlan.value = logicalMatch[1].trim();
          }
          if (physicalMatch) {
            physicalPlan.value = physicalMatch[1].trim();
          }
        }
      }
    };

    const parseSSEResponse = (sseText: string): any => {
      // Parse Server-Sent Events format response
      // Format: event: <event_type>\ndata: <json>\n\n
      try {
        const lines = sseText.split("\n");
        let currentEvent = "";
        let result: any = null;

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.substring(6).trim();
          } else if (trimmed.startsWith("data:")) {
            const dataContent = trimmed.substring(5).trim();

            // Skip progress events and done marker
            if (dataContent === "[[DONE]]" || currentEvent === "progress") {
              continue;
            }

            try {
              const parsed = JSON.parse(dataContent);
              // Look for actual search results with hits
              if (parsed && (parsed.hits !== undefined || parsed.total !== undefined)) {
                result = parsed;
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
        }

        return result;
      } catch (err) {
        console.error("Error parsing SSE response:", err);
        return null;
      }
    };

    const fetchExplainPlan = async () => {
      loading.value = true;
      error.value = "";
      logicalPlan.value = "";
      physicalPlan.value = "";
      analyzePlan.value = "";
      showAnalyzeResults.value = false;

      try {
        // Build the complete query using getSearchQueryPayload()
        // This method doesn't mutate searchObj, so no need to save/restore state
        const queryReq = getSearchQueryPayload();

        if (!queryReq || !queryReq.query || !queryReq.query.sql) {
          error.value = t("search.errorFetchingPlan");
          loading.value = false;
          return;
        }

        // Wrap the SQL with EXPLAIN
        const explainSQL = `EXPLAIN ${queryReq.query.sql}`;
        const explainQueryPayload = {
          ...queryReq,
          query: {
            ...queryReq.query,
            sql: explainSQL,
          },
        };

        const { traceId } = generateTraceContext();
        const response = await streamingSearch.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: explainQueryPayload,
          page_type: searchObj.data.stream.streamType || "logs",
          search_type: "ui",
          traceId,
        });

        // Parse SSE response - streaming API returns Server-Sent Events format
        const parsedData = parseSSEResponse(response.data);

        // Parse the response to extract logical and physical plans
        if (parsedData) {
          parsePlans(parsedData, false);

          // Check if we got at least one plan
          if (!logicalPlan.value && !physicalPlan.value) {
            error.value = t("search.noPlanFound");
          }
        } else {
          error.value = t("search.noPlanFound");
        }
      } catch (err: any) {
        console.error("Error fetching explain plan:", err);
        error.value = err.response?.data?.message || err.message || t("search.errorFetchingPlan");
      } finally {
        loading.value = false;
      }
    };

    const runAnalyze = async () => {
      loading.value = true;
      error.value = "";
      isAnalyzing.value = true;

      try {
        // Build the complete query using getSearchQueryPayload()
        // This method doesn't mutate searchObj, so no need to save/restore state
        const queryReq = getSearchQueryPayload();

        if (!queryReq || !queryReq.query || !queryReq.query.sql) {
          error.value = t("search.errorRunningAnalyze");
          loading.value = false;
          isAnalyzing.value = false;
          return;
        }

        // Wrap the SQL with EXPLAIN ANALYZE
        const analyzeSQL = `EXPLAIN ANALYZE ${queryReq.query.sql}`;
        const analyzeQueryPayload = {
          ...queryReq,
          query: {
            ...queryReq.query,
            sql: analyzeSQL,
          },
        };

        const { traceId } = generateTraceContext();
        const response = await streamingSearch.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: analyzeQueryPayload,
          page_type: searchObj.data.stream.streamType || "logs",
          search_type: "ui",
          traceId,
        });

        // Parse SSE response - streaming API returns Server-Sent Events format
        const parsedData = parseSSEResponse(response.data);

        // Parse the response to extract execution plan with metrics
        if (parsedData) {
          parsePlans(parsedData, true);

          // Check if we got the analyze plan
          if (analyzePlan.value) {
            showAnalyzeResults.value = true;
          } else {
            error.value = t("search.noAnalyzePlanFound");
          }
        } else {
          error.value = t("search.noAnalyzePlanFound");
        }
      } catch (err: any) {
        console.error("Error running analyze:", err);
        error.value = err.response?.data?.message || err.message || t("search.errorRunningAnalyze");
      } finally {
        loading.value = false;
        isAnalyzing.value = false;
      }
    };

    const onClose = () => {
      emit("update:modelValue", false);
    };

    // ESC key handler
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showDialog.value) {
        onClose();
      }
    };

    watch(
      () => props.modelValue,
      (newVal) => {
        if (newVal && props.searchObj) {
          fetchExplainPlan();
          // Reset to logical tab when opening
          activeTab.value = "logical";
        }
      },
    );

    // Reset activeTab when switching between EXPLAIN and ANALYZE
    watch(
      () => showAnalyzeResults.value,
      (isAnalyze) => {
        if (!isAnalyze) {
          // Switching back to EXPLAIN - reset to logical tab
          activeTab.value = "logical";
        }
      },
    );

    // Add ESC key listener when dialog opens
    watch(
      () => showDialog.value,
      (isOpen) => {
        if (isOpen) {
          document.addEventListener("keydown", handleEscKey);
        } else {
          document.removeEventListener("keydown", handleEscKey);
        }
      },
    );

    return {
      t,
      showDialog,
      loading,
      error,
      sqlQuery,
      splitterPosition,
      logicalPlanTree,
      physicalPlanTree,
      planTree,
      summaryMetrics,
      activeTab,
      isAnalyzing,
      showAnalyzeResults,
      runAnalyze,
      onClose,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override): stretch OTabPanels/OTabPanel library-internal DOM to fill the plan surface height */
.plan-surface :deep(.o-tab-panels) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.plan-surface :deep(.o-tab-panel) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
