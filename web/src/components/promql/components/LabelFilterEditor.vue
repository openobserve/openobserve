<template>
  <div class="label-filter-editor">
    <div class="text-subtitle2 q-mb-sm">
      <q-icon name="label" class="q-mr-xs" />
      Label Filters
      <q-btn
        flat
        dense
        round
        icon="add"
        size="sm"
        color="primary"
        @click="addLabel"
        class="q-ml-sm"
      >
        <q-tooltip>Add label filter</q-tooltip>
      </q-btn>
    </div>

    <div v-if="localLabels.length === 0" class="text-grey-7 q-pa-md text-center">
      No label filters added yet. Click + to add a filter.
    </div>

    <div v-else class="labels-list">
      <q-card
        v-for="(label, index) in localLabels"
        :key="label.label"
        flat
        bordered
        class="label-item q-mb-sm"
      >
        <q-card-section class="row items-center q-pa-sm">
          <!-- Label Name -->
          <div class="col-3">
            <q-select
              v-model="label.label"
              :options="availableLabels"
              label="Label"
              dense
              borderless
              stack-label
              hide-bottom-space
              class="showLabelOnTop"
              use-input
              fill-input
              hide-selected
              input-debounce="0"
              @update:model-value="onLabelChange"
              :loading="loadingLabels"
              clearable
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    {{ loadingLabels ? 'Loading labels...' : 'No labels found' }}
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <!-- Operator -->
          <div class="col-2 q-px-sm">
            <q-select
              v-model="label.op"
              :options="operators"
              label="Operator"
              dense
              borderless
              stack-label
              hide-bottom-space
              class="showLabelOnTop"
              @update:model-value="onLabelChange"
            />
          </div>

          <!-- Value -->
          <div class="col-6">
            <q-select
              v-model="label.value"
              :options="labelValuesMap.get(label.label) || []"
              label="Value"
              dense
              borderless
              stack-label
              hide-bottom-space
              class="showLabelOnTop"
              use-input
              fill-input
              hide-selected
              input-debounce="0"
              @filter="(val, update) => filterLabelValues(val, update, label.label)"
              @update:model-value="onLabelChange"
              :disable="!label.label"
              clearable
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    {{ !label.label ? 'Select a label first' : 'No values found' }}
                  </q-item-section>
                </q-item>
              </template>
              <template v-slot:hint>
                {{ getOperatorHint(label.op) }}
              </template>
            </q-select>
          </div>

          <!-- Remove Button -->
          <div class="col-1 text-right">
            <q-btn
              flat
              dense
              round
              icon="delete"
              color="negative"
              size="sm"
              @click="removeLabel(index)"
            >
              <q-tooltip>Remove filter</q-tooltip>
            </q-btn>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { QueryBuilderLabelFilter } from "@/components/promql/types";
import metricsService from "@/services/metrics";

const props = defineProps<{
  labels: QueryBuilderLabelFilter[];
  metric?: string;
}>();

const emit = defineEmits<{
  "update:labels": [value: QueryBuilderLabelFilter[]];
}>();

const store = useStore();
const localLabels = ref<QueryBuilderLabelFilter[]>([...props.labels]);
const availableLabels = ref<string[]>([]);
const labelValuesMap = ref<Map<string, string[]>>(new Map()); // Maps label key to its values
const loadingLabels = ref(false);

const operators = [
  { label: "= (equals)", value: "=" },
  { label: "!= (not equals)", value: "!=" },
  { label: "=~ (regex match)", value: "=~" },
  { label: "!~ (regex not match)", value: "!~" },
];

// Watch for metric changes to fetch available labels
watch(
  () => props.metric,
  async (newMetric) => {
    if (newMetric) {
      await fetchAvailableLabels(newMetric);
    } else {
      availableLabels.value = [];
      labelValuesMap.value.clear();
    }
  },
  { immediate: true }
);

// Watch for prop changes
watch(
  () => props.labels,
  (newLabels) => {
    localLabels.value = [...newLabels];
  }
);

// Watch for changes in labels to clear value when label key changes
watch(
  () => localLabels.value,
  (newLabels, oldLabels) => {
    if (oldLabels) {
      newLabels.forEach((newLabel, index) => {
        const oldLabel = oldLabels[index];
        // If label key changed, clear the value since label changed
        if (oldLabel && newLabel.label !== oldLabel.label) {
          newLabel.value = "";
        }
      });
    }
  },
  { deep: true }
);

// Fetch available labels and their values for the selected metric
const fetchAvailableLabels = async (metric: string) => {
  if (!metric) return;

  loadingLabels.value = true;
  try {
    const endTime = Math.floor(Date.now() * 1000); // microseconds
    const startTime = endTime - (24 * 60 * 60 * 1000000); // 24 hours ago in microseconds

    const response = await metricsService.get_promql_series({
      org_identifier: store.state.selectedOrganization.identifier,
      labels: `{__name__="${metric}"}`,
      start_time: startTime,
      end_time: endTime,
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      // Extract all unique label keys and their values from the series
      const labelSet = new Set<string>();
      const valuesMap = new Map<string, Set<string>>();

      response.data.data.forEach((series: any) => {
        Object.keys(series).forEach((key) => {
          if (key !== "__name__") {
            labelSet.add(key);

            // Collect all values for this label key
            if (!valuesMap.has(key)) {
              valuesMap.set(key, new Set<string>());
            }
            valuesMap.get(key)!.add(series[key]);
          }
        });
      });

      availableLabels.value = Array.from(labelSet).sort();

      // Convert Sets to sorted arrays and store in the map
      const newLabelValuesMap = new Map<string, string[]>();
      valuesMap.forEach((valueSet, labelKey) => {
        newLabelValuesMap.set(labelKey, Array.from(valueSet).sort());
      });
      labelValuesMap.value = newLabelValuesMap;
    } else {
      availableLabels.value = [];
      labelValuesMap.value = new Map();
    }
  } catch (error) {
    console.error("Error fetching labels:", error);
    availableLabels.value = [];
    labelValuesMap.value = new Map();
  } finally {
    loadingLabels.value = false;
  }
};

const addLabel = () => {
  localLabels.value.push({
    label: "",
    op: "=",
    value: "",
  });
  onLabelChange();
};

const removeLabel = (index: number) => {
  localLabels.value.splice(index, 1);
  onLabelChange();
};

const onLabelChange = () => {
  emit("update:labels", localLabels.value);
};

// Filter label values with autocomplete
const filterLabelValues = (
  val: string,
  update: any,
  labelKey: string
) => {
  if (!labelKey) {
    update(() => {});
    return;
  }

  const allValues = labelValuesMap.value.get(labelKey) || [];

  update(() => {
    if (val === "") {
      return allValues;
    }
    // Filter values based on input
    const needle = val.toLowerCase();
    return allValues.filter((v) => v.toLowerCase().includes(needle));
  });
};

const getOperatorHint = (op: string): string => {
  switch (op) {
    case "=":
      return "Exact match";
    case "!=":
      return "Not equal to";
    case "=~":
      return "Regex pattern (e.g., prod.*)";
    case "!~":
      return "Regex not matching (e.g., test.*)";
    default:
      return "";
  }
};
</script>

<style scoped lang="scss">
.label-filter-editor {
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}

.labels-list {
  max-height: 400px;
  overflow-y: auto;
}

.label-item {
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
}
</style>
