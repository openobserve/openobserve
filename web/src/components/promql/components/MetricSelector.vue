<template>
  <div class="metric-selector">
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">{{ t("panel.metric") }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container">
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
          class="showLabelOnTop metric-select"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import streamService from "@/services/stream";

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
