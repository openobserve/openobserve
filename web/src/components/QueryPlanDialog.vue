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
  <q-dialog v-model="showDialog" @hide="onClose">
    <q-card class="query-plan-dialog" style="width: 900px; max-width: 90vw; max-height: 85vh">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ t("search.queryPlan") }}</div>
        <q-space />
        <q-btn
          v-if="!isAnalyzing && !showAnalyzeResults"
          icon="analytics"
          color="primary"
          :label="t('search.analyze')"
          flat
          no-caps
          class="q-mr-sm"
          @click="runAnalyze"
          :loading="loading"
        >
          <q-tooltip>{{ t("search.analyzeTooltip") }}</q-tooltip>
        </q-btn>
        <q-btn icon="close" flat round dense @click="onClose" />
      </q-card-section>

      <q-card-section class="q-pt-sm query-plan-content">
        <div v-if="loading" class="flex flex-center q-pa-xl">
          <q-spinner-dots color="primary" size="50px" />
          <div class="q-ml-md">
            {{ isAnalyzing ? t("search.runningAnalyze") : t("search.loadingPlan") }}
          </div>
        </div>

        <div v-else-if="error" class="error-container">
          <q-banner class="bg-negative text-white">
            <template v-slot:avatar>
              <q-icon name="error" />
            </template>
            {{ error }}
          </q-banner>
        </div>

        <!-- EXPLAIN ANALYZE view (no tabs, just metrics + tree) -->
        <div v-else-if="showAnalyzeResults" class="plan-container">
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
        <div v-else class="plan-container">
          <q-card flat bordered class="plan-card">
            <q-tabs
              v-model="activeTab"
              dense
              class="text-grey"
              active-color="primary"
              indicator-color="primary"
              align="left"
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
  type OperatorNode,
  type SummaryMetrics,
} from "@/utils/queryPlanParser";
import MetricsSummaryCard from "@/components/query-plan/MetricsSummaryCard.vue";
import QueryPlanTree from "@/components/query-plan/QueryPlanTree.vue";

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
    const activeTab = ref("logical");
    const isAnalyzing = ref(false);
    const showAnalyzeResults = ref(false);

    const showDialog = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
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

      if (!responseData || !responseData.hits) {
        return;
      }

      if (isAnalyze) {
        // For EXPLAIN ANALYZE: phase is numeric, combine all phases into single plan
        const allPlans = responseData.hits
          .sort((a: any, b: any) => (a.phase || 0) - (b.phase || 0))
          .map((hit: any) => hit.plan || "")
          .filter((plan: string) => plan.trim() !== "")
          .join("\n\n");

        if (allPlans) {
          analyzePlan.value = allPlans.trim();
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
        // Build the complete query using buildSearch()
        const queryReq = buildSearch();

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
          page_type: "logs",
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
        // Build the complete query using buildSearch()
        const queryReq = buildSearch();

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

    watch(
      () => props.modelValue,
      (newVal) => {
        if (newVal && props.searchObj) {
          fetchExplainPlan();
        }
      }
    );

    return {
      t,
      store,
      showDialog,
      loading,
      error,
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
    max-height: calc(85vh - 120px);
    overflow-y: auto;
  }

  .plan-container {
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
    max-height: 500px;
    overflow-y: auto;
  }

  .error-container {
    padding: 16px;
  }
}
</style>
