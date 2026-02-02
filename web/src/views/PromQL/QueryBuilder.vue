<template>
  <div class="promql-query-builder tw:px-[0.625rem]">
    <q-card>
      <q-card-section>
        <div class="text-h5 q-mb-md">PromQL Query Builder</div>
        <div class="text-subtitle2 text-grey-7">
          Build and test PromQL queries visually
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <!-- Query Builder Section -->
        <div class="query-builder-container">
          <!-- Metric Selector -->
          <MetricSelector
            v-model:metric="visualQuery.metric"
            :datasource="datasourceOptions"
          />

          <!-- Label Filters -->
          <LabelFilterEditor
            v-model:labels="visualQuery.labels"
            :metric="visualQuery.metric"
          />

          <!-- Operations List -->
          <OperationsList
            v-model:operations="visualQuery.operations"
          />
        </div>
      </q-card-section>

      <q-separator />

      <!-- Generated Query Display -->
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">Generated PromQL Query:</div>
        <q-card flat bordered class="bg-grey-1">
          <q-card-section>
            <pre class="query-output">{{ generatedQuery || "No query built yet" }}</pre>
          </q-card-section>
        </q-card>

        <div class="q-mt-md row q-gutter-sm">
          <q-btn
            color="primary"
            label="Copy Query"
            icon="content_copy"
            @click="copyQuery"
            :disable="!generatedQuery"
          />
          <q-btn
            color="secondary"
            label="Clear All"
            icon="clear"
            @click="clearQuery"
          />
          <q-btn
            color="positive"
            label="Test Query"
            icon="play_arrow"
            @click="testQuery"
            :disable="!generatedQuery"
          />
        </div>
      </q-card-section>

      <!-- Query Result Preview -->
      <q-card-section v-if="queryResult">
        <div class="text-subtitle1 q-mb-sm">Query Result Preview:</div>
        <q-card flat bordered class="bg-grey-1">
          <q-card-section>
            <pre class="result-output">{{ queryResult }}</pre>
          </q-card-section>
        </q-card>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuasar } from "quasar";
import { PromVisualQuery } from "@/components/promql/types";
import { promQueryModeller } from "@/components/promql/operations/queryModeller";
import MetricSelector from "@/components/promql/components/MetricSelector.vue";
import LabelFilterEditor from "@/components/promql/components/LabelFilterEditor.vue";
import OperationsList from "@/components/promql/components/OperationsList.vue";

const $q = useQuasar();

// State
const visualQuery = ref<PromVisualQuery>({
  metric: "",
  labels: [],
  operations: [],
});

const queryResult = ref<string | null>(null);
const showDocumentation = ref(true);

// Datasource options (you can connect this to actual datasource later)
const datasourceOptions = ref({
  type: "prometheus",
  url: "",
});

// Computed
const generatedQuery = computed(() => {
  if (!visualQuery.value.metric && visualQuery.value.labels.length === 0) {
    return "";
  }
  return promQueryModeller.renderQuery(visualQuery.value);
});

// Methods
const copyQuery = () => {
  if (generatedQuery.value) {
    navigator.clipboard.writeText(generatedQuery.value);
    $q.notify({
      type: "positive",
      message: "Query copied to clipboard!",
      position: "top",
    });
  }
};

const clearQuery = () => {
  visualQuery.value = {
    metric: "",
    labels: [],
    operations: [],
  };
  queryResult.value = null;
  $q.notify({
    type: "info",
    message: "Query cleared",
    position: "top",
  });
};

const testQuery = () => {
  // TODO: Implement actual query execution
  $q.notify({
    type: "info",
    message: "Query testing will be implemented soon",
    position: "top",
  });

  // Mock result for now
  queryResult.value = JSON.stringify(
    {
      status: "success",
      message: "Query execution will be implemented in the next phase",
    },
    null,
    2
  );
};
</script>

<style scoped lang="scss">
.promql-query-builder {
  max-width: 1400px;
  margin: 0 auto;
  height: calc(100vh - 50px);
  overflow: auto;
}

.query-builder-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.query-output,
.result-output {
  margin: 0;
  padding: 12px;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.query-output {
  color: #1976d2;
  font-weight: 500;
}

.result-output {
  color: #424242;
  max-height: 400px;
  overflow-y: auto;
}
</style>
