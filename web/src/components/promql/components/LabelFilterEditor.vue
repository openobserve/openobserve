<template>
  <div class="label-filter-editor">
    <div style="display: flex; flex-direction: row" class="tw:pl-2">
      <div class="layout-name">{{ t("panel.labelFilters") }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container scroll tw:flex">
        <!-- Label Filter Items -->
        <div
          v-for="(label, index) in props.labels"
          :key="index"
          class="label-filter-item"
        >
          <OButtonGroup class="axis-field" radius="sm">
            <ODropdown>
              <template #trigger>
                <OButton
                  variant="primary"
                  size="chip"
                  class="tw:!text-[12px]"
                  :data-test="`promql-label-filter-${index}`"
                >
                  {{ computedLabel(label) }}
                  <template #icon-right><OIcon name="arrow-drop-down" size="sm" /></template>
                </OButton>
              </template>
              <div
                class="label-filter-editor-dropdown tw:p-4"
                :data-test="`promql-label-filter-${index}-menu`"
              >
                <div style="width: 350px">
                  <!-- Label Selection -->
                  <OSelect
                    v-model="label.label"
                    :options="availableLabelOptions"
                    label="Label"
                    class="label-filter-label-select showLabelOnTop tw:normal-case! tw:mb-2"
                    searchable
                    clearable
                    data-test="promql-label-select"
                  >
                    <template #empty>
                      <span class="tw:text-text-secondary tw:px-3 tw:py-2">{{
                        loadingLabels
                          ? "Loading labels..."
                          : "No labels found"
                      }}</span>
                    </template>
                  </OSelect>

                  <!-- Operator Selection -->
                  <OSelect
                    v-model="label.op"
                    :options="operatorOptions"
                    label="Operator"
                    class="label-filter-operator-select showLabelOnTop tw:mb-2"
                    data-test="promql-operator-select"
                  />

                  <!-- Value Selection -->
                  <OSelect
                    v-model="label.value"
                    :options="getLabelValueOptions(label.label)"
                    label="Value"
                    class="label-filter-value-select showLabelOnTop"
                    :value-key="'value'"
                    :label-key="'label'"
                    :disabled="!label.label"
                    searchable
                    clearable
                    data-test="promql-value-select"
                  >
                    <template #empty>
                      <span class="tw:text-text-secondary tw:px-3 tw:py-2">{{
                        !label.label
                          ? 'Select a label first'
                          : 'No values found'
                      }}</span>
                    </template>
                  </OSelect>
                </div>
              </div>
            </ODropdown>
            <OButton
              variant="outline"
              size="icon-chip"
              @click="removeLabel(index)"
              :data-test="`promql-label-filter-remove-${index}`"
              icon-left="close"
            >
            </OButton>
          </OButtonGroup>
        </div>

        <!-- Add Button -->
        <OButton
          variant="ghost-primary"
          size="sm"
          @click="addLabel"
          data-test="promql-add-label-filter"
        >
          <OIcon name="add" size="sm" />
          <OTooltip content="Add label filter" side="top" />
        </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, watch } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { useI18n } from "vue-i18n";
import { QueryBuilderLabelFilter } from "@/components/promql/types";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

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

// Computed: available labels minus ones already selected in other rows
const availableLabelOptions = computed(() => {
  const selectedLabels = props.labels.map((l) => l.label);
  return availableLabels.value.filter(
    (label) => !selectedLabels.includes(label),
  );
});

const computedLabel = (label: QueryBuilderLabelFilter): string => {
  if (!label.label) {
    return "Select label";
  }
  if (!label.value) {
    return label.label;
  }
  return `${label.label} ${label.op} ${label.value}`;
};

// Watch for metric OR selected time range changes to (re)fetch available labels.
watch(
  () => [
    props.metric,
    props.dashboardPanelData?.meta?.dateTime?.start_time,
    props.dashboardPanelData?.meta?.dateTime?.end_time,
  ],
  async () => {
    if (props.metric) {
      await fetchPromQLLabels(props.metric);
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
  margin: 2px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.label-filter-item {
  display: flex;
  align-items: center;
}

.label-filter-editor-dropdown {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;
}
</style>
