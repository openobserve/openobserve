<template>
  <div data-test="promql-labelfilter-editor">
    <div class="flex flex-row ps-2">
      <div
        data-test="promql-labelfilter-editor-label"
        class="flex min-w-24 items-center whitespace-nowrap"
      >
        <span
          class="rounded-default bg-badge-orange-ol-text me-1.5 h-2 w-2 shrink-0"
          aria-hidden="true"
        ></span>
        {{ t("panel.labelFilters") }}
      </div>
      <span class="ms-0.5 me-0.5 flex items-center">:</span>
      <div class="scroll m-0.5 flex min-h-8 flex-wrap items-center gap-2">
        <template v-for="section in sections" :key="section.group">
          <span
            v-if="section.group > 0"
            class="text-3xs text-text-secondary shrink-0 tracking-wide uppercase select-none"
            :data-test="`promql-labelfilter-group-join-${section.group}`"
            >{{
              section.position > 0
                ? t("metrics.labelGroups.or")
                : section.hasBase
                  ? t("metrics.labelGroups.andAnyOf")
                  : t("metrics.labelGroups.anyOf")
            }}</span
          >
          <div
            :class="
              section.group > 0
                ? 'border-border-default rounded-default flex flex-wrap items-center gap-2 border border-dashed p-0.5'
                : 'contents'
            "
            :data-test="section.group > 0 ? `promql-labelfilter-group-${section.group}` : undefined"
          >
            <OButton
              v-if="section.group > 0"
              variant="ghost"
              size="chip-12"
              :active="section.negate"
              :aria-pressed="section.negate"
              :data-test="`promql-labelfilter-group-not-${section.group}`"
              @click="toggleNegate(section.group)"
            >
              {{ t("metrics.labelGroups.not") }}
              <OTooltip :content="t('metrics.labelGroups.notTooltip')" side="top" />
            </OButton>
            <div
              v-for="{ label, index } in section.items"
              :key="index"
              data-test="promql-labelfilter-item"
              class="flex items-center"
            >
              <OButtonGroup
                class="axis-field border-border-default border-s-badge-orange-ol-border bg-surface-panel overflow-hidden border border-s-2 [&>*:not(:first-child)]:!border-s"
                radius="sm"
                :divided="true"
              >
                <ODropdown>
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="chip-12"
                      class="!ps-1 !pe-1"
                      :data-test="`promql-label-filter-${index}`"
                    >
                      <span class="leading-normal font-normal whitespace-nowrap">
                        <template v-if="!label.label">
                          <span class="text-text-secondary">{{ computedLabel(label) }}</span>
                        </template>
                        <template v-else>
                          <span class="text-promql-label">{{ label.label }}</span>
                          <template v-if="label.value">
                            <span class="text-text-secondary px-1">{{ label.op }}</span>
                            <span
                              :class="
                                /^-?[\d.]+$/.test(String(label.value).trim())
                                  ? 'text-promql-number'
                                  : 'text-promql-string'
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
                      <OSelect
                        v-model="label.label"
                        :options="labelOptionsFor(section.group)"
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

                      <OSelect
                        v-model="label.op"
                        :options="operatorOptions"
                        :label="t('metrics.labelFilterEditor.operator')"
                        class="label-filter-operator-select showLabelOnTop mb-1.5"
                        data-test="promql-operator-select"
                      />

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
                  :aria-label="t('common.remove')"
                  variant="ghost"
                  size="icon-chip"
                  class="!w-4"
                  @click="removeLabel(index)"
                  :data-test="`promql-label-filter-remove-${index}`"
                >
                  <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
                </OButton>
              </OButtonGroup>
            </div>
            <OButton
              v-if="section.group > 0"
              variant="ghost"
              size="icon-chip"
              :aria-label="t('metrics.labelGroups.addToGroup')"
              :data-test="`promql-labelfilter-group-add-${section.group}`"
              @click="addLabel(section.group)"
            >
              <OIcon name="add" size="sm" />
              <OTooltip :content="t('metrics.labelGroups.addToGroup')" side="top" />
            </OButton>
            <OButton
              v-else
              variant="outline"
              size="icon-chip"
              @click="addLabel(0)"
              data-test="promql-add-label-filter"
            >
              <OIcon name="add" size="sm" />
              <OTooltip :content="t('metrics.labelFilterEditor.addLabelFilter')" side="top" />
            </OButton>
          </div>
        </template>

        <OButton
          v-if="props.labels.length"
          variant="ghost"
          size="xs"
          data-test="promql-add-label-group"
          @click="addGroup"
        >
          {{ t("metrics.labelGroups.addGroup") }}
          <OTooltip :content="t('metrics.labelGroups.addGroupTooltip')" side="top" />
        </OButton>
      </div>
    </div>
    <div
      v-if="tooMany"
      class="text-status-error-text ps-2 text-xs"
      role="alert"
      data-test="promql-labelfilter-too-many-branches"
    >
      {{
        t("metrics.labelGroups.tooManyBranches", {
          count: tooMany,
          max: MAX_FILTER_BRANCHES,
        })
      }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { PromqlLabelMatcher } from "@/components/promql/types";
import {
  compileLabelFilters,
  filterGroupsOf,
  MAX_FILTER_BRANCHES,
} from "@/components/promql/labelBoolean";
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

const { t } = useI18nTyped();

// Get fetchPromQLLabels from composable
const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { fetchPromQLLabels, fetchPromQLLabelValues } = useDashboardPanelData(
  dashboardPanelDataPageKey,
  t,
);

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

// Labels already picked in the same group are hidden; another group may reuse them.
const labelOptionsFor = (group: number) => {
  const selectedLabels: string[] = props.labels
    .filter((l) => (l.group ?? 0) === group)
    .map((l) => l.label);
  return availableLabels.value.filter((label) => !selectedLabels.includes(label));
};

const compiled = computed(() => compileLabelFilters(props.labels));

/** The branch count of an add or NOT toggle that was refused for passing the cap; 0 once an edit lands. */
const refusedCount = ref(0);
const tooMany = computed(() =>
  compiled.value.ok ? refusedCount.value : compiled.value.branchCount,
);

/** Emits `labels` unless they would expand past the cap, which leaves the query unrenderable. */
const emitWithinCap = (labels: PromqlLabelMatcher[]) => {
  const next = compileLabelFilters(labels);
  if (!next.ok) {
    refusedCount.value = next.branchCount;
    return;
  }
  refusedCount.value = 0;
  emit("update:labels", labels);
};

const sections = computed(() => {
  const items = props.labels.map((label, index) => ({ label, index }));
  const base = items.filter(({ label }) => (label.group ?? 0) <= 0);
  const groups = filterGroupsOf(props.labels).map(({ group, negate }, position) => ({
    group,
    negate,
    position,
    hasBase: base.length > 0,
    items: items.filter(({ label }) => label.group === group),
  }));
  return [{ group: 0, negate: false, position: 0, hasBase: false, items: base }, ...groups];
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

// Watch the metric, and only the metric. The label list is read from the
// stream SCHEMA, which has no time dimension, so the panel's selected range
// cannot change the answer — watching it bought a request per range change and
// nothing else. The range mattered when labels were derived from the series in
// that window; see tmp/code.md D11 for what changed and what it costs.
watch(
  () => props.metric,
  async () => {
    if (props.metric) {
      await fetchPromQLLabels(props.metric);
    }
    // When metric is cleared, the computed properties will handle empty state
    // No need to mutate props.dashboardData
  },
  { immediate: true },
);

// Values are fetched for the labels a user has actually chosen, one at a time.
// They used to arrive with the label NAMES, derived from every series of the
// metric; asking for all of them up front costs a distinct-value aggregation
// per label, for labels most queries never filter on.
watch(
  () => props.labels.map((label) => label.label).join(","),
  () => {
    // Read into a local: the narrowing from the guard does not survive into the
    // callback, where TypeScript has to assume the prop may have changed.
    const metric = props.metric;
    if (!metric) return;
    props.labels
      .map((label) => label.label)
      .filter(Boolean)
      .forEach((label) => void fetchPromQLLabelValues(metric, label));
  },
  { immediate: true },
);

const emptyMatcher = (group: number): PromqlLabelMatcher => {
  const matcher: PromqlLabelMatcher = { label: raw(""), op: "=", value: "" };
  if (group > 0) matcher.group = group;
  if (group > 0 && props.labels.some((l) => l.group === group && l.negate)) matcher.negate = true;
  return matcher;
};

const addLabel = (group = 0) => {
  emitWithinCap([...props.labels, emptyMatcher(group)]);
};

const addGroup = () => {
  const next = Math.max(0, ...props.labels.map((l) => l.group ?? 0)) + 1;
  emitWithinCap([...props.labels, emptyMatcher(next)]);
};

const toggleNegate = (group: number) => {
  const negate = !props.labels.some((l) => l.group === group && l.negate);
  emitWithinCap(
    props.labels.map((l) => {
      if (l.group !== group) return l;
      const next = { ...l };
      if (negate) next.negate = true;
      else delete next.negate;
      return next;
    }),
  );
};

const removeLabel = (index: number) => {
  const newLabels = props.labels.filter((_, idx) => idx !== index);
  refusedCount.value = 0;
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
      label: raw(value),
      value: value,
      isVariable: false,
    });
  });

  return options;
};
</script>
