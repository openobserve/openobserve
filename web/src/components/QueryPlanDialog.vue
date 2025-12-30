<!-- Copyright 2023 OpenObserve Inc.

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
  <q-dialog v-model="showDialog" @hide="onClose" maximized>
    <q-card class="query-plan-dialog full-height">
      <q-card-section class="row items-center q-pb-sm q-pt-sm">
        <div class="text-h6">{{ t("search.queryPlan") }}</div>
        <q-space />
        <q-btn icon="close" flat round dense @click="onClose">
          <q-tooltip>Close (ESC)</q-tooltip>
        </q-btn>
      </q-card-section>

      <q-separator />

      <q-card-section class="query-plan-content full-height q-pa-none">
        <q-splitter
          v-model="splitterPosition"
          class="full-height"
        >
          <!-- Left Pane: SQL Query -->
          <template #before>
            <div class="sql-query-pane full-height">
              <div
                class="pane-header q-pa-sm tw:px-[1rem] row items-center"
                :class="store.state.theme === 'dark' ? 'pane-header-dark' : 'pane-header-light'"
              >
                <q-icon name="code" size="20px" class="q-mr-sm" />
                <div class="text-subtitle1 text-weight-medium">SQL Query</div>
              </div>
              <q-separator />
              <div
                class="sql-query-content q-pa-md"
                :class="store.state.theme === 'dark' ? 'sql-query-content-dark' : 'sql-query-content-light'"
              >
                <div class="sql-query-wrapper">
                  <pre class="sql-query-text">{{ sqlQuery }}</pre>
                </div>
              </div>
            </div>
          </template>

          <!-- Right Pane: Explain/Analyze Results -->
          <template #after>
            <div class="explain-results-pane full-height">
              <div
                class="pane-header q-pa-sm tw:px-[1rem]  row items-center"
                :class="store.state.theme === 'dark' ? 'pane-header-dark' : 'pane-header-light'"
              >
                <div class="text-subtitle1 text-weight-medium">
                  {{ showAnalyzeResults ? t("search.analyzeResults") : t("search.explainResults") }}
                </div>
                <q-space />
                <q-btn
                  v-if="!isAnalyzing && !showAnalyzeResults"
                  color="primary"
                  :label="t('search.analyze')"
                  no-caps
                  size="sm"
                  @click="runAnalyze"
                  :loading="loading"
                >
                  <q-tooltip>{{ t("search.analyzeTooltip") }}</q-tooltip>
                </q-btn>
              </div>
              <q-separator />

              <div v-if="loading" class="flex flex-center q-pa-xl full-height">
                <div class="text-center">
                  <q-spinner-dots color="primary" size="50px" />
                  <div class="q-mt-md">
                    {{ isAnalyzing ? t("search.runningAnalyze") : t("search.loadingPlan") }}
                  </div>
                </div>
              </div>

              <div v-else-if="error" class="q-pa-md">
                <q-banner class="bg-negative text-white">
                  <template v-slot:avatar>
                    <q-icon name="error" />
                  </template>
                  {{ error }}
                </q-banner>
              </div>

              <!-- EXPLAIN ANALYZE view -->
              <div v-else-if="showAnalyzeResults" class="plan-container q-pa-md">
                <!-- Metrics Summary Card -->
                <MetricsSummaryCard
                  v-if="summaryMetrics"
                  :metrics="summaryMetrics"
                  class="q-mb-md"
                />

                <!-- Execution Plan Tree -->
                <q-card flat bordered class="plan-card">
                  <q-card-section class="q-pa-none">
                    <div class="plan-scroll-area">
                      <QueryPlanTree
                        v-if="planTree"
                        :tree="planTree"
                        :is-analyze="true"
                      />
                      <div v-else class="q-pa-md text-grey-6">
                        {{ t("search.noAnalyzePlanFound") }}
                      </div>
                    </div>
                  </q-card-section>
                </q-card>
              </div>

              <!-- EXPLAIN view (tabs for logical/physical) -->
              <div v-else class="plan-container q-pa-md">
                <q-card flat bordered class="plan-card">
                  <q-tabs
                    v-model="activeTab"
                    dense
                    class="text-grey"
                    active-color="primary"
                    indicator-color="primary"
                    align="left"
                    no-caps
                  >
                    <q-tab name="logical" :label="t('search.logicalPlan')" />
                    <q-tab name="physical" :label="t('search.physicalPlan')" />
                  </q-tabs>

                  <q-separator />

                  <q-tab-panels v-model="activeTab" animated>
                    <q-tab-panel name="logical" class="q-pa-none">
                      <div class="plan-scroll-area">
                        <QueryPlanTree
                          v-if="logicalPlanTree"
                          :tree="logicalPlanTree"
                          :is-analyze="false"
                        />
                        <div v-else class="q-pa-md text-grey-6">
                          {{ t("search.noLogicalPlan") }}
                        </div>
                      </div>
                    </q-tab-panel>

                    <q-tab-panel name="physical" class="q-pa-none">
                      <div class="plan-scroll-area">
                        <QueryPlanTree
                          v-if="physicalPlanTree"
                          :tree="physicalPlanTree"
                          :is-analyze="false"
                        />
                        <div v-else class="q-pa-md text-grey-6">
                          {{ t("search.noPhysicalPlan") }}
                        </div>
                      </div>
                    </q-tab-panel>
                  </q-tab-panels>
                </q-card>
              </div>
            </div>
          </template>
        </q-splitter>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
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

export default defineComponent({
  name: "QueryPlanDialog",
  components: {
    MetricsSummaryCard,
    QueryPlanTree,
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
    const $q = useQuasar();
    const { buildSearch } = useSearchStream();

    const loading = ref(false);
    const error = ref("");
    const logicalPlan = ref("");
    const physicalPlan = ref("");
    const analyzePlan = ref("");
    const analyzePlanTreeOverride = ref<OperatorNode | null>(null); // For hierarchical phase nesting
    const activeTab = ref("logical");
    const isAnalyzing = ref(false);
    const showAnalyzeResults = ref(false);
    const splitterPosition = ref(50); // Split at 50%

    let { searchObj } = searchState();

    const showDialog = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    // Get SQL query from searchObj
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
          const combined = responseData.hits.map((h: any) => h.plan || JSON.stringify(h)).join("\n");

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
        const lines = sseText.split('\n');
        let currentEvent = '';
        let result: any = null;

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.substring(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const dataContent = trimmed.substring(5).trim();

            // Skip progress events and done marker
            if (dataContent === '[[DONE]]' || currentEvent === 'progress') {
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
        // Save the current histogram state before calling buildSearch()
        // This is necessary because buildSearch() modifies the global searchObj.data.histogram
        // when histogram is turned off, which would clear the title on the logs page
        const savedHistogram = searchObj.meta.showHistogram === false
          ? JSON.parse(JSON.stringify(searchObj.data.histogram))
          : null;

        // Build the complete query using buildSearch()
        const queryReq = buildSearch();

        // Restore the histogram state after buildSearch() only if histogram is still off
        // This prevents QueryPlanDialog from clearing the histogram title on the logs page
        if (savedHistogram !== null && searchObj.meta.showHistogram === false) {
          searchObj.data.histogram = savedHistogram;
        }

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
        // Save the current histogram state before calling buildSearch()
        // This is necessary because buildSearch() modifies the global searchObj.data.histogram
        // when histogram is turned off, which would clear the title on the logs page
        const savedHistogram = searchObj.meta.showHistogram === false
          ? JSON.parse(JSON.stringify(searchObj.data.histogram))
          : null;

        // Build the complete query using buildSearch()
        const queryReq = buildSearch();

        // Restore the histogram state after buildSearch() only if histogram is still off
        // This prevents QueryPlanDialog from clearing the histogram title on the logs page
        if (savedHistogram !== null && searchObj.meta.showHistogram === false) {
          searchObj.data.histogram = savedHistogram;
        }

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
          page_type: "logs",
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
      }
    );

    // Reset activeTab when switching between EXPLAIN and ANALYZE
    watch(
      () => showAnalyzeResults.value,
      (isAnalyze) => {
        if (!isAnalyze) {
          // Switching back to EXPLAIN - reset to logical tab
          activeTab.value = "logical";
        }
      }
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
      }
    );

    return {
      t,
      store,
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

<style lang="scss" scoped>
.query-plan-dialog {
  display: flex;
  flex-direction: column;

  .query-plan-content {
    flex: 1;
    overflow: hidden;

    .sql-query-pane,
    .explain-results-pane {
      display: flex;
      flex-direction: column;
      overflow: hidden;

      .pane-header {
        flex-shrink: 0;
      }

      .pane-header-light {
        background-color: #f5f5f5;
      }

      .pane-header-dark {
        background-color: #181a1b;
      }

      .sql-query-content {
        flex: 1;
        overflow-y: auto;

        .sql-query-wrapper {
          border-radius: 4px;
          padding: 12px;
          min-height: 100%;
        }

        .sql-query-text {
          font-family: monospace;
          font-size: 12px;
          line-height: 1.6;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }
      }

      .sql-query-content-light {
        background-color: #f8f9fa;
        color: #1d1d1d;

        .sql-query-wrapper {
          background-color: #ffffff;
          border: 1px solid #e0e0e0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
      }

      .sql-query-content-dark {
        background-color: #121212;
        color: #e0e0e0;

        .sql-query-wrapper {
          background-color: #1e1e1e;
          border: 1px solid #3d3d3d;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
      }
    }

    .explain-results-pane {
      .plan-container {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      .plan-card {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;

        .q-tabs {
          flex-shrink: 0;
        }

        .q-tab-panels {
          flex: 1;
          overflow: hidden;
        }
      }

      .plan-scroll-area {
        max-height: calc(100vh - 250px);
        overflow-y: auto;
      }
    }
  }
}

// Verbose output styling
.verbose-output-container {
  display: flex;
  flex-direction: column;
}

.verbose-output {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  border-radius: 4px;

  // Light mode
  background-color: #f5f5f5;
  color: #1d1d1d;
  border: 1px solid #e0e0e0;
}

// Dark mode for verbose output
body.body--dark {
  .verbose-output {
    background-color: #1e1e1e;
    color: #e0e0e0;
    border-color: #3d3d3d;
  }
}
</style>
