<template>
  <div
    data-test="promql-query-builder"
    class="tw:px-2.5 tw:max-w-350 tw:mx-auto tw:h-[calc(100vh-50px)] tw:overflow-auto"
  >
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
        <div class="tw:flex tw:flex-col tw:gap-5">
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
            <pre class="tw:m-0 tw:p-3 tw:font-mono tw:text-sm tw:leading-relaxed tw:whitespace-pre-wrap tw:wrap-break-word tw:text-[#1976d2] tw:font-medium">{{ generatedQuery || "No query built yet" }}</pre>
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
            <pre class="tw:m-0 tw:p-3 tw:font-mono tw:text-sm tw:leading-relaxed tw:whitespace-pre-wrap tw:wrap-break-word tw:text-[#424242] tw:max-h-100 tw:overflow-y-auto">{{ queryResult }}</pre>
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

