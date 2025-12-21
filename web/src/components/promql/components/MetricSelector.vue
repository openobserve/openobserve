<template>
  <div class="metric-selector">
    <div class="text-subtitle2 q-mb-sm">
      <q-icon name="analytics" class="q-mr-xs" />
      Select Metric
    </div>
    <q-select
      v-model="selectedMetric"
      :options="filteredMetrics"
      use-input
      input-debounce="300"
      label="Metric Name"
      borderless
      dense
      stack-label
      hide-bottom-space
      class="showLabelOnTop"
      @filter="filterMetrics"
      @update:model-value="onMetricSelect"
      clearable
      :loading="loading"
      data-test="metric-selector"
    >
      <template v-slot:no-option>
        <q-item>
          <q-item-section class="text-grey">
            {{ loading ? "Loading metrics..." : "No metrics found" }}
          </q-item-section>
        </q-item>
      </template>

      <template v-slot:prepend>
        <q-icon name="search" />
      </template>

      <template v-slot:hint>
        Type to search for metrics or select from the list
      </template>
    </q-select>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useStore } from "vuex";
import streamService from "@/services/stream";

const props = defineProps<{
  metric: string;
  datasource?: any;
}>();

const emit = defineEmits<{
  "update:metric": [value: string];
}>();

const store = useStore();
const selectedMetric = ref<string>(props.metric);
const metrics = ref<string[]>([]);
const filteredMetrics = ref<string[]>([]);
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
      filteredMetrics.value = [...metrics.value];
    }
  } catch (error) {
    console.error("Error loading metrics:", error);
    metrics.value = [];
    filteredMetrics.value = [];
  } finally {
    loading.value = false;
  }
};

const filterMetrics = async (val: string, update: any) => {
  if (val === "") {
    update(() => {
      filteredMetrics.value = metrics.value;
    });
  } else {
    // Use API search for better performance
    loading.value = true;
    try {
      const response = await streamService.nameList(
        store.state.selectedOrganization.identifier,
        "metrics",
        false,
        -1,
        -1,
        val, // Use search keyword
        "",
        false
      );

      update(() => {
        if (response.data && response.data.list) {
          filteredMetrics.value = response.data.list.map((stream: any) => stream.name);
        } else {
          filteredMetrics.value = [];
        }
      });
    } catch (error) {
      console.error("Error filtering metrics:", error);
      update(() => {
        filteredMetrics.value = [];
      });
    } finally {
      loading.value = false;
    }
  }
};

const onMetricSelect = (value: string | null) => {
  selectedMetric.value = value || "";
  emit("update:metric", selectedMetric.value);
};
</script>

<style scoped lang="scss">
.metric-selector {
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}
</style>
