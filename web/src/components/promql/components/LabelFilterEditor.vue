<template>
  <div class="label-filter-editor tw-py-[0.25rem]">
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">{{ t("panel.labelFilters") }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container scroll row">
        <!-- Label Filter Items -->
        <div
          v-for="(label, index) in props.labels"
          :key="index"
          class="label-filter-item"
        >
          <q-btn-group>
            <q-btn
              square
              icon-right="arrow_drop_down"
              no-caps
              dense
              :no-wrap="true"
              color="primary"
              size="sm"
              :label="computedLabel(label)"
              class="q-pl-sm"
              :data-test="`promql-label-filter-${index}`"
            >
              <q-menu class="q-pa-md">
                <div style="width: 350px">
                  <!-- Label Selection -->
                  <q-select
                    v-model="label.label"
                    :options="availableLabels"
                    label="Label"
                    dense
                    borderless
                    stack-label
                    hide-bottom-space
                    class="showLabelOnTop q-mb-sm"
                    use-input
                    fill-input
                    hide-selected
                    input-debounce="0"
                    :loading="loadingLabels"
                    clearable
                    data-test="promql-label-select"
                  >
                    <template v-slot:no-option>
                      <q-item>
                        <q-item-section class="text-grey">
                          {{ loadingLabels ? 'Loading labels...' : 'No labels found' }}
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>

                  <!-- Operator Selection -->
                  <q-select
                    v-model="label.op"
                    :options="operatorOptions"
                    label="Operator"
                    dense
                    borderless
                    stack-label
                    hide-bottom-space
                    class="showLabelOnTop q-mb-sm"
                    data-test="promql-operator-select"
                  />

                  <!-- Value Selection -->
                  <q-select
                    v-model="label.value"
                    :options="getLabelValueOptions(label.label)"
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
                    emit-value
                    map-options
                    option-value="value"
                    option-label="label"
                    @filter="(val, update) => filterLabelValues(val, update, label.label)"
                    :disable="!label.label"
                    clearable
                    data-test="promql-value-select"
                  >
                    <template v-slot:no-option>
                      <q-item>
                        <q-item-section class="text-grey">
                          {{ !label.label ? 'Select a label first' : 'No values found' }}
                        </q-item-section>
                      </q-item>
                    </template>
                    <template v-slot:option="scope">
                      <q-item v-bind="scope.itemProps">
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label v-if="scope.opt.isVariable" caption class="text-grey-7">
                            Variable
                          </q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                    <template v-slot:hint>
                      {{ getOperatorHint(label.op) }}
                    </template>
                  </q-select>
                </div>
              </q-menu>
            </q-btn>
            <q-btn
              size="xs"
              dense
              @click="removeLabel(index)"
              icon="close"
              :data-test="`promql-label-filter-remove-${index}`"
            />
          </q-btn-group>
        </div>

        <!-- Add Button -->
        <q-btn
          flat
          dense
          icon="add"
          size="sm"
          color="primary"
          @click="addLabel"
          class="add-filter-btn"
          data-test="promql-add-label-filter"
        >
          <q-tooltip>Add label filter</q-tooltip>
        </q-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { QueryBuilderLabelFilter } from "@/components/promql/types";
import metricsService from "@/services/metrics";

const props = defineProps<{
  labels: QueryBuilderLabelFilter[];
  metric?: string;
  dashboardData?: any; // Dashboard data containing variables
}>();

const emit = defineEmits<{
  "update:labels": [value: QueryBuilderLabelFilter[]];
}>();

const { t } = useI18n();
const store = useStore();
const availableLabels = ref<string[]>([]);
const labelValuesMap = ref<Map<string, string[]>>(new Map()); // Maps label key to its values
const loadingLabels = ref(false);

const operatorOptions = ["=", "!=", "=~", "!~"];

const computedLabel = (label: QueryBuilderLabelFilter): string => {
  if (!label.label) {
    return "Select label";
  }
  if (!label.value) {
    return label.label;
  }
  return `${label.label} ${label.op} ${label.value}`;
};

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

const addLabel = () => {
  props.labels.push({
    label: "",
    op: "=",
    value: "",
  });
};

const removeLabel = (index: number) => {
  props.labels.splice(index, 1);
};

// Get label value options including variables
const getLabelValueOptions = (labelKey: string) => {
  if (!labelKey) return [];

  const options: any[] = [];

  // Add dashboard variables at the top
  // Note: dashboardData is already currentDashboardData.data from AddPanel.vue
  if (props.dashboardData?.variables?.list) {
    const variables = props.dashboardData.variables.list;
    variables.forEach((variable: any) => {
      options.push({
        label: `$${variable.name}`,
        value: `$${variable.name}`,
        isVariable: true,
      });
    });
  }

  // Add actual label values
  const actualValues = labelValuesMap.value.get(labelKey) || [];
  actualValues.forEach((value: string) => {
    options.push({
      label: value,
      value: value,
      isVariable: false,
    });
  });

  return options;
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

  const allOptions = getLabelValueOptions(labelKey);

  update(() => {
    if (val === "") {
      return allOptions;
    }
    // Filter options based on input
    const needle = val.toLowerCase();
    return allOptions.filter((opt: any) =>
      opt.label.toLowerCase().includes(needle)
    );
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
.layout-name {
  font-size: 14px;
  white-space: nowrap;
  min-width: 86px;
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
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.label-filter-item {
  display: flex;
  align-items: center;
}

.add-filter-btn {
  margin-left: 4px;
}

.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;
}
</style>
