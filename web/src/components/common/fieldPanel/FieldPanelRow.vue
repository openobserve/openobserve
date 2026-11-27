<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OFieldRow
    :highlight="highlight && !grouped"
    :class="{ 'bg-accent/10!': grouped }"
    :data-test="expandable ? rowTestIds.expand : undefined"
  >
    <!-- The first icon of a row carries its own inset, so it is pulled back to start on the panel edge. -->
    <span
      v-if="drag"
      :class="[
        'text-field-list-drag-icon -ms-2 inline-flex w-4 shrink-0 items-center justify-center',
        dragEnabled ? 'cursor-grab' : 'cursor-not-allowed opacity-40',
      ]"
      data-test="o-field-list-drag-indicator"
      @mousedown="armDrag?.()"
      @click.stop
    >
      <OTooltip v-if="dragEnabled" :content="t('panel.dragToAxis')" />
      <OIcon name="drag-indicator" size="sm" />
    </span>
    <span class="flex w-3.5 shrink-0 items-center justify-center" :class="drag ? '' : '-ms-2'">
      <OIcon
        v-if="expandable"
        :name="expanded ? 'expand-more' : 'chevron-right'"
        size="sm"
        class="text-field-list-expand-icon inline-flex w-4 shrink-0 items-center justify-center"
        :data-test="`field-panel-row-chevron-${field.name}`"
      />
    </span>
    <OFieldLabel :field="field" show-type-icon :data-test="rowTestIds.label" />
    <template v-if="hasActions" #actions>
      <OButton
        v-if="showAddFilter"
        :aria-label="t('common.addFilter')"
        variant="ghost-primary"
        size="icon"
        :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
        @click.stop="emit('add-filter', `${field.name}=''`)"
      >
        <OIcon name="add" size="sm" />
        <OTooltip :content="t('common.addFilter')" />
      </OButton>
      <OButton
        v-if="showToggleColumn"
        :aria-label="columnLabel"
        :data-test="`log-search-index-list-${isColumn ? 'remove' : 'add'}-${field.name}-field-btn`"
        variant="ghost-primary"
        size="icon"
        class="gap-0!"
        @click.stop="emit('toggle-column', field)"
      >
        <OIcon :name="isColumn ? 'visibility-off' : 'visibility'" size="sm" />
        <OTooltip :content="columnLabel" />
      </OButton>
      <OButton
        v-if="showLockedColumn"
        :aria-label="field.columnLockedReason"
        :data-test="`log-search-index-list-locked-${field.name}-field-btn`"
        variant="ghost-primary"
        size="icon"
        class="gap-0!"
        disabled
        focusable-unavailable
      >
        <OIcon name="visibility" size="sm" />
        <OTooltip :content="field.columnLockedReason" />
        <template #unavailable-reason>{{ field.columnLockedReason }}</template>
      </OButton>
      <OButton
        v-if="groupBy"
        :aria-label="t('search.groupByThisField')"
        variant="ghost-primary"
        size="icon"
        class="gap-0!"
        :data-test="`log-search-index-list-group-by-${field.name}-field-btn`"
        @click.stop="emit('group-by', field.name)"
      >
        <OIcon name="group-work" size="sm" />
        <OTooltip :content="t('search.groupByThisField')" />
      </OButton>
      <template v-for="(chip, index) in chips" :key="chip.target">
        <span
          v-if="index > 0"
          class="bg-field-list-actions-border h-4 w-px shrink-0"
          aria-hidden="true"
        />
        <OButton
          variant="ghost-primary"
          size="chip"
          class="px-1! text-xs! font-bold"
          :disabled="chip.disabled"
          focusable-unavailable
          :data-test="chip.testId"
          @click.stop="emit('chip', field, chip.target)"
        >
          {{ chip.label }}
          <OTooltip v-if="chipTip(chip)" :content="chipTip(chip)" side="top" align="end" />
          <template v-if="chip.disabled && chip.reason" #unavailable-reason>{{
            chip.reason
          }}</template>
        </OButton>
      </template>
    </template>
    <template v-if="showInteresting" #trailing>
      <span class="contents">
        <OButton
          :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
          variant="ghost-neutral"
          size="icon"
          class="gap-0!"
          :aria-label="interestingLabel"
          @click.stop="emit('toggle-interesting', field)"
        >
          <OIcon :name="field.isInterestingField ? 'info-filled' : 'info-outline'" size="sm" />
          <OTooltip :content="interestingLabel" />
        </OButton>
      </span>
    </template>
  </OFieldRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";
import type { ChipSpec, FieldAction, PanelField } from "./fieldPanel.types";

// Pages whose e2e suites address rows by the logs ids; any other page's rows are scoped by its prefix.
const LOGS_ROW_ID_PAGES = new Set([
  "logs-page",
  "traces-page",
  "scheduled-pipeline",
  "security-events",
]);

const props = withDefaults(
  defineProps<{
    field: PanelField;
    actions: FieldAction[];
    timestampColumn: string;
    expandable?: boolean;
    expanded?: boolean;
    drag?: boolean;
    dragEnabled?: boolean;
    armDrag?: () => void;
    highlight?: boolean;
    isColumn?: boolean;
    chips?: ChipSpec[];
    testIdPrefix?: string;
    filterBlocked?: boolean;
    groupBy?: boolean;
    grouped?: boolean;
  }>(),
  {
    expandable: false,
    expanded: false,
    drag: false,
    dragEnabled: false,
    armDrag: undefined,
    highlight: false,
    isColumn: false,
    chips: () => [],
    testIdPrefix: "logs-page",
    filterBlocked: false,
    groupBy: false,
    grouped: false,
  },
);

const emit = defineEmits<{
  "add-filter": [expression: string];
  "toggle-column": [field: PanelField];
  "toggle-interesting": [field: PanelField];
  chip: [field: PanelField, target: string];
  "group-by": [name: string];
}>();

const { t } = useI18nTyped();

// The visualize editor stays mounted behind logs, so a page sharing the DOM with logs needs ids of its own.
const rowTestIds = computed(() => {
  const name = props.field.name;
  if (LOGS_ROW_ID_PAGES.has(props.testIdPrefix)) {
    return { label: `logs-field-list-item-${name}`, expand: `log-search-expand-${name}-field-btn` };
  }
  return {
    label: `${props.testIdPrefix}-field-list-item-${name}`,
    expand: `${props.testIdPrefix}-expand-${name}-field-btn`,
  };
});

const isTimestamp = computed(() => props.field.name === props.timestampColumn);

// The timestamp column is always in the table and never a filter or interesting candidate.
const showAddFilter = computed(
  () =>
    props.actions.includes("add-filter") &&
    !props.filterBlocked &&
    props.field.isSchemaField &&
    !isTimestamp.value,
);

const showToggleColumn = computed(
  () => props.actions.includes("toggle-column") && !isTimestamp.value && !props.field.columnLocked,
);

const showLockedColumn = computed(
  () =>
    props.actions.includes("toggle-column") &&
    !!props.field.columnLocked &&
    !!props.field.columnLockedReason,
);

const showInteresting = computed(
  () => props.actions.includes("interesting") && props.field.isSchemaField && !isTimestamp.value,
);

const columnLabel = computed(() =>
  props.isColumn ? t("common.removeFieldFromTable") : t("common.addFieldToTable"),
);

const interestingLabel = computed(() =>
  props.field.isInterestingField
    ? t("logStream.removeFromInterestingFields")
    : t("logStream.addToInterestingFields"),
);

const chipTip = (chip: ChipSpec) => (chip.disabled ? (chip.reason ?? chip.tooltip) : chip.tooltip);

const hasActions = computed(
  () =>
    showAddFilter.value ||
    showToggleColumn.value ||
    showLockedColumn.value ||
    props.groupBy ||
    props.chips.length > 0,
);
</script>
