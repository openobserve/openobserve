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

        <div v-else class="plan-container">
          <!-- Show metrics summary if analyze was run -->
          <div v-if="showAnalyzeResults && analyzeMetrics" class="metrics-summary q-mb-md">
            <q-card flat bordered>
              <q-card-section>
                <div class="text-subtitle1 q-mb-sm">{{ t("search.executionMetrics") }}</div>
                <div class="metrics-grid">
                  <div
                    v-for="metric in analyzeMetrics"
                    :key="metric.label"
                    class="metric-item"
                  >
                    <div class="metric-label">{{ metric.label }}</div>
                    <div class="metric-value">{{ metric.value }}</div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>

          <!-- Query plan display -->
          <q-card flat bordered class="plan-card">
            <q-card-section class="q-pa-none">
              <pre class="plan-text">{{ formattedPlan }}</pre>
            </q-card-section>
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
import searchService from "@/services/search";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { generateTraceContext } from "@/utils/zincutils";

export default defineComponent({
  name: "QueryPlanDialog",
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
    const rawPlan = ref("");
    const isAnalyzing = ref(false);
    const showAnalyzeResults = ref(false);
    const analyzeMetrics = ref<Array<{ label: string; value: string }>>([]);

    const showDialog = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    const formattedPlan = computed(() => {
      if (!rawPlan.value) return "";
      return formatQueryPlan(rawPlan.value);
    });

    const formatQueryPlan = (plan: string): string => {
      // DataFusion plans already contain \n characters
      // We'll enhance the formatting by:
      // 1. Preserving existing indentation
      // 2. Adding extra spacing between major plan sections
      // 3. Highlighting key operators

      let formatted = plan;

      // Add extra line breaks before major plan sections
      const majorSections = [
        "logical_plan",
        "physical_plan",
        "Physical Plan",
        "Logical Plan",
      ];

      majorSections.forEach((section) => {
        formatted = formatted.replace(
          new RegExp(`(${section})`, "gi"),
          `\n$1`
        );
      });

      // Add spacing around operators (lines that start with indent + uppercase)
      formatted = formatted
        .split("\n")
        .map((line) => {
          // Check if line contains a major operator
          if (
            /^\s*(TableScan|Filter|Projection|Aggregate|Sort|Limit|Join|Union|SubqueryAlias|EmptyRelation|CrossJoin|Repartition)/i.test(
              line
            )
          ) {
            return line;
          }
          return line;
        })
        .join("\n");

      return formatted;
    };

    const extractAnalyzeMetrics = (plan: string) => {
      const metrics: Array<{ label: string; value: string }> = [];

      // Extract common metrics from EXPLAIN ANALYZE output
      // Look for patterns like "rows=123", "time=456ms", "memory=789KB"

      const rowsMatch = plan.match(/output_rows=(\d+)/);
      if (rowsMatch) {
        metrics.push({ label: "Output Rows", value: rowsMatch[1] });
      }

      const timeMatch = plan.match(/elapsed_compute=(\d+(?:\.\d+)?[a-z]+)/i);
      if (timeMatch) {
        metrics.push({ label: "Elapsed Time", value: timeMatch[1] });
      }

      const memoryMatch = plan.match(/memory=(\d+(?:\.\d+)?[A-Z]+)/i);
      if (memoryMatch) {
        metrics.push({ label: "Memory Used", value: memoryMatch[1] });
      }

      // Extract metrics from plan lines
      const lines = plan.split("\n");
      lines.forEach((line) => {
        // Look for metrics in format: key=value
        const metricsRegex = /(\w+)=(\d+(?:\.\d+)?(?:[a-z]+)?)/gi;
        let match;
        while ((match = metricsRegex.exec(line)) !== null) {
          const [, key, value] = match;
          if (
            key.toLowerCase().includes("time") ||
            key.toLowerCase().includes("rows") ||
            key.toLowerCase().includes("memory")
          ) {
            metrics.push({
              label: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
              value,
            });
          }
        }
      });

      return metrics;
    };

    const fetchExplainPlan = async () => {
      loading.value = true;
      error.value = "";
      rawPlan.value = "";
      showAnalyzeResults.value = false;
      analyzeMetrics.value = [];

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

        const traceparent = generateTraceContext()?.traceparent;
        const response = await searchService.search(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: explainQueryPayload,
            page_type: "logs",
            traceparent,
          },
          "ui"
        );

        // The plan is typically returned as a string in the response
        if (response.data) {
          // Check if there's a plan field directly in the response
          if (response.data.plan) {
            rawPlan.value = response.data.plan;
          } else if (response.data.hits && response.data.hits.length > 0) {
            // Sometimes the plan is in the first hit
            const firstHit = response.data.hits[0];
            const planText = firstHit.plan ||
                            firstHit._source?.plan ||
                            firstHit.query_plan ||
                            JSON.stringify(firstHit, null, 2);
            rawPlan.value = planText;
          } else {
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

        const traceparent = generateTraceContext()?.traceparent;
        const response = await searchService.search(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: analyzeQueryPayload,
            page_type: "logs",
            traceparent,
          },
          "ui"
        );

        // The plan is typically returned as a string in the response
        if (response.data) {
          let planText = "";
          if (response.data.plan) {
            planText = response.data.plan;
          } else if (response.data.hits && response.data.hits.length > 0) {
            const firstHit = response.data.hits[0];
            planText = firstHit.plan ||
                      firstHit._source?.plan ||
                      firstHit.query_plan ||
                      JSON.stringify(firstHit, null, 2);
          }

          if (planText) {
            rawPlan.value = planText;
            showAnalyzeResults.value = true;
            analyzeMetrics.value = extractAnalyzeMetrics(planText);
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
      formattedPlan,
      isAnalyzing,
      showAnalyzeResults,
      analyzeMetrics,
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

  .metrics-summary {
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }

    .metric-item {
      padding: 8px;
      border-radius: 4px;
      background-color: rgba(var(--q-primary-rgb), 0.05);

      .metric-label {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 4px;
      }

      .metric-value {
        font-size: 18px;
        font-weight: 600;
        color: var(--q-primary);
      }
    }
  }

  .plan-card {
    flex: 1;
    overflow: hidden;

    .q-card-section {
      max-height: 500px;
      overflow-y: auto;
    }
  }

  .plan-text {
    font-family: "Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro",
      monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0;
    padding: 16px;
    background-color: rgba(0, 0, 0, 0.02);
    border-radius: 4px;
  }

  .error-container {
    padding: 16px;
  }
}

// Dark theme support
.body--dark {
  .query-plan-dialog {
    .plan-text {
      background-color: rgba(255, 255, 255, 0.05);
    }

    .metric-item {
      background-color: rgba(var(--q-primary-rgb), 0.15);

      .metric-label {
        color: rgba(255, 255, 255, 0.7);
      }
    }
  }
}
</style>
