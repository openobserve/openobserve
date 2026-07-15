<template>
  <div
    data-test="promql-query-builder"
    class="h-[calc(100vh-50px)] flex flex-col overflow-hidden"
  >
    <AppPageHeader
      title="PromQL Query Builder"
      subtitle="Build and test PromQL queries visually"
      icon="query-stats"
      class="shrink-0 px-4 border-b border-border-default"
    />
    <div class="flex-1 overflow-auto px-2.5">
      <div class="max-w-350 mx-auto py-2.5">
    <OCard>
      <OCardSection role="body">
        <!-- Query Builder Section -->
        <div class="flex flex-col gap-5">
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
        <div class="text-base font-medium mb-2">Generated PromQL Query:</div>
        <OCard class="bg-surface-panel">
          <OCardSection>
            <pre class="m-0 p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap wrap-break-word text-[#1976d2] font-medium">{{ generatedQuery || "No query built yet" }}</pre>
          </OCardSection>
        </OCard>

        <div class="mt-3 flex gap-2">
          <OButton
            variant="primary"
            size="sm-action"
            @click="copyQuery"
            :disabled="!generatedQuery"
          >
            <OIcon name="content-copy" size="xs" class="mr-1" />
            Copy Query
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            @click="clearQuery"
          >
            <OIcon name="close" size="xs" class="mr-1" />
            Clear All
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            @click="testQuery"
            :disabled="!generatedQuery"
          >
            <OIcon name="play-arrow" size="xs" class="mr-1" />
            Test Query
          </OButton>
        </div>
      </OCardSection>

      <!-- Query Result Preview -->
      <OCardSection v-if="queryResult">
        <div class="text-base font-medium mb-2">Query Result Preview:</div>
        <OCard class="bg-surface-panel">
          <OCardSection>
            <pre class="m-0 p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap wrap-break-word text-[#424242] max-h-100 overflow-y-auto">{{ queryResult }}</pre>
          </OCardSection>
        </OCard>
      </OCardSection>
    </OCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { PromqlBuilderQuery } from "@/components/promql/types";
import { promqlRenderer } from "@/components/promql/operations/queryModeller";
import MetricSelector from "@/components/promql/components/MetricSelector.vue";
import LabelFilterEditor from "@/components/promql/components/LabelFilterEditor.vue";
import OperationsList from "@/components/promql/components/OperationsList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";


// State
const visualQuery = ref<PromqlBuilderQuery>({
  metric: "",
  labels: [],
  operations: [],
});

const queryResult = ref<string | null>(null);

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
  return promqlRenderer.renderQuery(visualQuery.value);
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

