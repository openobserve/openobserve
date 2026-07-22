<template>
  <div data-test="promql-metric-selector" class="mb-2">
    <div class="pl-3 flex flex-row">
      <div
        data-test="promql-metric-selector-label"
        class="text-sm whitespace-nowrap flex items-center min-w-32.5"
      >{{ t("panel.metric") }}</div>
      <span class="flex items-center ml-0.5 mr-0.5">:</span>
      <div class="m-1.25 flex-1">
        <OSelect
          v-model="selectedMetric"
          :options="metrics"
          :label="t('metrics.metricSelector.metricName')"
          class="showLabelOnTop min-w-75 max-w-125"
          @update:model-value="onMetricSelect"
          clearable
          data-test="metric-selector"
        >
          <template #empty>
            {{ loading ? t('metrics.metricSelector.loadingMetrics') : t('metrics.metricSelector.noMetricsFound') }}
          </template>
        </OSelect>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import streamService from "@/services/stream";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";

const props = defineProps<{
  metric: string;
  datasource?: any;
}>();

const emit = defineEmits<{
  "update:metric": [value: string];
}>();

const { t } = useI18n();
const store = useStore();
const selectedMetric = ref<string>(props.metric);
const metrics = ref<string[]>([]);
const loading = ref(false);

onMounted(async () => {
  await loadMetrics();
});

const loadMetrics = async () => {
  loading.value = true;
  try {
    // Load metrics streams from the streams API
    const response = await streamService.nameList(
      store.state.selectedOrganization.identifier,
      "metrics", // type parameter for metrics
      false, // schema
      -1, // offset
      -1, // limit (get all)
      "", // keyword
      "", // sort
      false // asc
    );

    if (response.data && response.data.list) {
      metrics.value = response.data.list.map((stream: any) => stream.name);
    }
  } catch (error) {
    console.error("Error loading metrics:", error);
    metrics.value = [];
  } finally {
    loading.value = false;
  }
};

const onMetricSelect = (value: SelectModelValue) => {
  // Single-select of metric names: value is a string or null/empty at runtime.
  selectedMetric.value = typeof value === "string" ? value : "";
  emit("update:metric", selectedMetric.value);
};
</script>
