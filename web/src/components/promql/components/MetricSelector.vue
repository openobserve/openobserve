<template>
  <div class="metric-selector">
    <div style="display: flex; flex-direction: row" class="tw:pl-3">
      <div class="layout-name">{{ t("panel.metric") }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container">
        <OSelect
          v-model="selectedMetric"
          :options="metrics"
          label="Metric Name"
          class="showLabelOnTop metric-select"
          @update:model-value="onMetricSelect"
          clearable
          data-test="metric-selector"
        >
          <template #empty>
            {{ loading ? "Loading metrics..." : "No metrics found" }}
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

const onMetricSelect = (value: string | null) => {
  selectedMetric.value = value || "";
  emit("update:metric", selectedMetric.value);
};
</script>

<style scoped lang="scss">
.metric-selector {
  margin-bottom: 8px;
}

.layout-name {
  font-size: 14px;
  white-space: nowrap;
  min-width: 130px;
  display: flex;
  align-items: center;
}

.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}

.axis-container {
  margin: 5px;
  flex: 1;
}

.metric-select {
  min-width: 300px;
  max-width: 500px;
}
</style>
