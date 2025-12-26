<template>
  <div class="label-filter-editor tw:py-[0.25rem]">
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
                    :options="filteredLabelOptions"
                    label="Label"
                    dense
                    borderless
                    stack-label
                    hide-bottom-space
                    class="label-filter-label-select showLabelOnTop tw:normal-case! q-mb-sm"
                    input-class="tw:normal-case!"
                    use-input
                    fill-input
                    hide-selected
                    input-debounce="300"
                    :loading="loadingLabels"
                    clearable
                    @filter="(val, update) => filterLabels(val, update, index)"
                    data-test="promql-label-select"
                  >
                    <template v-slot:no-option>
                      <q-item>
                        <q-item-section class="text-grey">
                          {{
                            loadingLabels
                              ? "Loading labels..."
                              : "No labels found"
                          }}
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
                    class="label-filter-operator-select showLabelOnTop q-mb-sm"
                    input-class="tw:normal-case!"
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
                    class="label-filter-value-select showLabelOnTop"
                    input-class="tw:normal-case!"
                    use-input
                    fill-input
                    hide-selected
                    input-debounce="300"
                    emit-value
                    map-options
                    option-value="value"
                    option-label="label"
                    @filter="
                      (val, update) =>
                        filterLabelValues(val, update, label.label)
                    "
                    :disable="!label.label"
                    clearable
                    data-test="promql-value-select"
                  >
                    <template v-slot:no-option>
                      <q-item>
                        <q-item-section class="text-grey">
                          {{
                            !label.label
                              ? "Select a label first"
                              : "No values found"
                          }}
                        </q-item-section>
                      </q-item>
                    </template>
                    <template v-slot:option="scope">
                      <q-item v-bind="scope.itemProps">
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label
                            v-if="scope.opt.isVariable"
                            caption
                            class="text-grey-7"
                          >
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
import { ref, watch, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { QueryBuilderLabelFilter } from "@/components/promql/types";
import useDashboardPanelData from "@/composables/useDashboardPanel";

const props = defineProps<{
  labels: QueryBuilderLabelFilter[];
  metric?: string;
  dashboardData?: any; // Dashboard data containing variables
  dashboardPanelData?: any;
}>();

const emit = defineEmits<{
  "update:labels": [value: QueryBuilderLabelFilter[]];
}>();

const { t } = useI18n();

// Get fetchPromQLLabels from composable
const dashboardPanelDataPageKey = inject(
  "dashboardPanelDataPageKey",
  "dashboard",
);
const { fetchPromQLLabels } = useDashboardPanelData(dashboardPanelDataPageKey);

const availableLabels = computed(
  () => props.dashboardPanelData?.meta?.promql?.availableLabels || [],
);

const labelValuesMap = computed(
  () => props.dashboardPanelData?.meta?.promql?.labelValuesMap || new Map(),
);
const loadingLabels = computed(
  () => props.dashboardPanelData?.meta?.promql?.loadingLabels || false,
);

const operatorOptions = ["=", "!=", "=~", "!~"];

const availableLabelOptions = ref([]);
const filteredLabelOptions = ref([...availableLabelOptions.value]);


const filterLabelOptions = () => {
  const selectedLabels = props.labels.map((l) => l.label);
  availableLabelOptions.value = availableLabels.value.filter(
    (label) => !selectedLabels.includes(label),
  );
};

const computedLabel = (label: QueryBuilderLabelFilter): string => {
  if (!label.label) {
    return "Select label";
  }
  if (!label.value) {
    return label.label;
  }
  return `${label.label} ${label.op} ${label.value}`;
};

watch(
  () => props.labels,
  async () => {
    filterLabelOptions();
  },
  {
    deep: true,
    immediate: true,
  },
);

// Watch for metric changes to fetch available labels
watch(
  () => props.metric,
  async (newMetric) => {
    if (newMetric) {
      await fetchPromQLLabels(newMetric);
      filterLabelOptions();
    }
    // When metric is cleared, the computed properties will handle empty state
    // No need to mutate props.dashboardData
  },
  { immediate: true },
);

const addLabel = () => {
  const newLabels: QueryBuilderLabelFilter[] = [
    ...props.labels,
    {
      label: "",
      op: "=",
      value: "",
    },
  ];
  emit("update:labels", newLabels);
};

const removeLabel = (index: number) => {
  const newLabels = props.labels.filter((_, idx) => idx !== index);
  emit("update:labels", newLabels);
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

// Filter labels with autocomplete
const filterLabels = (val: string, update: any, currentIndex: number) => {
  update(() => {
    const options = availableLabelOptions.value;
    if (val === "") {
      filteredLabelOptions.value = options;
    } else {
      const needle = val.toLowerCase();
      filteredLabelOptions.value = options.filter((v) =>
        v.toLowerCase().includes(needle),
      );
    }
  });
};

// Filter label values with autocomplete
const filterLabelValues = (val: string, update: any, labelKey: string) => {
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
      opt.label.toLowerCase().includes(needle),
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
