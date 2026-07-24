<template>
  <div data-test="promql-labelfilter-editor">
    <div class="flex flex-row pl-2">
      <div
        data-test="promql-labelfilter-editor-label"
        class="flex min-w-24 items-center whitespace-nowrap"
      >
        <span
          class="rounded-default bg-badge-orange-ol-text mr-1.5 h-2 w-2 shrink-0"
          aria-hidden="true"
        ></span>
        {{ t("panel.labelFilters") }}
      </div>
      <span class="mr-0.5 ml-0.5 flex items-center">:</span>
      <div class="scroll m-0.5 flex flex-wrap items-center gap-2 min-h-8">
        <!-- Label Filter Items -->
        <div
          v-for="(label, index) in props.labels"
          :key="index"
          data-test="promql-labelfilter-item"
          class="flex items-center"
        >
          <OButtonGroup
            class="axis-field border-border-default border-s-badge-orange-ol-border bg-surface-panel overflow-hidden border border-s-2"
            radius="sm"
            :divided="false"
          >
            <ODropdown>
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="chip-12"
                  class="!ps-1 !pe-0"
                  :data-test="`promql-label-filter-${index}`"
                >
                  <span class="font-normal leading-normal whitespace-nowrap">
                    <template v-if="!label.label">
                      <span class="text-text-secondary">{{ computedLabel(label) }}</span>
                    </template>
                    <template v-else>
                      <span class="text-text-body">{{ label.label }}</span>
                      <template v-if="label.value">
                        <span class="text-text-secondary px-1">{{ label.op }}</span>
                        <span
                          :class="
                            /^-?[\d.]+$/.test(String(label.value).trim())
                              ? 'text-badge-success-ol-text'
                              : 'text-badge-error-ol-text'
                          "
                          >{{ label.value }}</span
                        >
                      </template>
                    </template>
                  </span>
                  <template #icon-right><OIcon name="arrow-drop-down" size="sm" /></template>
                </OButton>
              </template>
              <div class="p-3" :data-test="`promql-label-filter-${index}-menu`">
                <div class="w-86 [&_.o-input-label]:text-xs [&_.o-input-label]:font-normal">
                  <!-- Label Selection -->
                  <OSelect
                    v-model="label.label"
                    :options="availableLabelOptions"
                    :label="t('metrics.labelFilterEditor.label')"
                    class="label-filter-label-select showLabelOnTop mb-1.5 normal-case!"
                    searchable
                    clearable
                    data-test="promql-label-select"
                  >
                    <template #empty>
                      <span class="text-text-secondary px-3 py-2">{{
                        loadingLabels
                          ? t("metrics.labelFilterEditor.loadingLabels")
                          : t("metrics.labelFilterEditor.noLabelsFound")
                      }}</span>
                    </template>
                  </OSelect>

                  <!-- Operator Selection -->
                  <OSelect
                    v-model="label.op"
                    :options="operatorOptions"
                    :label="t('metrics.labelFilterEditor.operator')"
                    class="label-filter-operator-select showLabelOnTop mb-1.5"
                    data-test="promql-operator-select"
                  />

                  <!-- Value Selection -->
                  <OSelect
                    v-model="label.value"
                    :options="getLabelValueOptions(label.label)"
                    :label="t('metrics.labelFilterEditor.value')"
                    class="label-filter-value-select showLabelOnTop"
                    :value-key="'value'"
                    :label-key="'label'"
                    :disabled="!label.label"
                    searchable
                    clearable
                    data-test="promql-value-select"
                  >
                    <template #empty>
                      <span class="text-text-secondary px-3 py-2">{{
                        !label.label
                          ? t("metrics.labelFilterEditor.selectLabelFirst")
                          : t("metrics.labelFilterEditor.noValuesFound")
                      }}</span>
                    </template>
                  </OSelect>
                </div>
              </div>
            </ODropdown>
            <OButton
              variant="ghost"
              size="icon-chip"
              class="-ms-1 !w-4"
              @click="removeLabel(index)"
              :data-test="`promql-label-filter-remove-${index}`"
            >
              <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
            </OButton>
          </OButtonGroup>
        </div>

        <!-- Add Button -->
        <OButton
          variant="outline"
          size="icon-chip"
          @click="addLabel"
          data-test="promql-add-label-filter"
        >
          <OIcon name="add" size="sm" />
          <OTooltip :content="t('metrics.labelFilterEditor.addLabelFilter')" side="top" />
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
import { PromqlLabelMatcher } from "@/components/promql/types";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

const props = defineProps<{
  labels: PromqlLabelMatcher[];
  metric?: string;
  dashboardData?: any; // Dashboard data containing variables
  dashboardPanelData?: any;
}>();

const emit = defineEmits<{
  "update:labels": [value: PromqlLabelMatcher[]];
}>();

const { t } = useI18n();

// Get fetchPromQLLabels from composable
const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { fetchPromQLLabels } = useDashboardPanelData(dashboardPanelDataPageKey);

const availableLabels = computed<string[]>(
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
  return availableLabels.value.filter((label) => !selectedLabels.includes(label));
});

const computedLabel = (label: PromqlLabelMatcher): string => {
  if (!label.label) {
    return t("metrics.labelFilterEditor.selectLabel");
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
  const newLabels: PromqlLabelMatcher[] = [
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
      return t("metrics.labelFilterEditor.exactMatch");
    case "!=":
      return t("metrics.labelFilterEditor.notEqualTo");
    case "=~":
      return t("metrics.labelFilterEditor.regexPattern");
    case "!~":
      return t("metrics.labelFilterEditor.regexNotMatching");
    default:
      return "";
  }
};
</script>
