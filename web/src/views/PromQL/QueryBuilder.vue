<template>
  <div class="promql-query-builder tw:px-[0.625rem]">
    <OCard>
      <OCardSection role="header">
        <div class="tw:text-2xl tw:font-semibold">PromQL Query Builder</div>
        <div class="tw:text-sm tw:font-medium tw:text-gray-400">
          Build and test PromQL queries visually
        </div>
      </OCardSection>

      <OSeparator />

      <OCardSection role="body">
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
      </OCardSection>

      <OSeparator />

      <!-- Generated Query Display -->
      <OCardSection>
        <div class="tw:text-base tw:font-medium tw:mb-2">Generated PromQL Query:</div>
        <OCard class="tw:bg-surface-panel">
          <OCardSection>
            <pre class="query-output">{{ generatedQuery || "No query built yet" }}</pre>
          </OCardSection>
        </OCard>

        <div class="tw:mt-3 tw:flex tw:gap-2">
          <OButton
            variant="primary"
            size="sm-action"
            @click="copyQuery"
            :disabled="!generatedQuery"
          >
            <OIcon name="content-copy" size="xs" class="tw:mr-1" />
            Copy Query
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            @click="clearQuery"
          >
            <OIcon name="close" size="xs" class="tw:mr-1" />
            Clear All
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            @click="testQuery"
            :disabled="!generatedQuery"
          >
            <OIcon name="play-arrow" size="xs" class="tw:mr-1" />
            Test Query
          </OButton>
        </div>
      </OCardSection>

      <!-- Query Result Preview -->
      <OCardSection v-if="queryResult">
        <div class="tw:text-base tw:font-medium tw:mb-2">Query Result Preview:</div>
        <OCard class="tw:bg-surface-panel">
          <OCardSection>
            <pre class="result-output">{{ queryResult }}</pre>
          </OCardSection>
        </OCard>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PromVisualQuery } from "@/components/promql/types";
import { promQueryModeller } from "@/components/promql/operations/queryModeller";
import MetricSelector from "@/components/promql/components/MetricSelector.vue";
import LabelFilterEditor from "@/components/promql/components/LabelFilterEditor.vue";
import OperationsList from "@/components/promql/components/OperationsList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";


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
    copyToClipboard(generatedQuery.value, {
      successMessage: "Query copied to clipboard!",
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
  toast({
    variant: "info",
    message: "Query cleared",  });
};

const testQuery = () => {
  // TODO: Implement actual query execution
  toast({
    variant: "info",
    message: "Query testing will be implemented soon",  });

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
