<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <OCollapsible
    :model-value="isExpanded"
    @update:model-value="handleToggle"
    class="field-expansion-item rounded-default w-full overflow-hidden"
    trigger-class="px-0! py-0!"
  >
    <template #trigger>
      <OFieldRow
        :data-test="`log-search-expand-${field.name}-field-btn`"
        :highlight="isFieldSelected"
      >
        <span class="mr-1 flex w-[0.55rem] shrink-0 items-center justify-center">
          <OIcon
            class="text-text-muted inline-flex w-4 shrink-0 items-center justify-center"
            :name="isExpanded ? 'expand-more' : 'chevron-right'"
            size="sm"
          />
        </span>
        <OFieldLabel
          :field="field"
          :show-type-icon="false"
          :data-test="`logs-field-list-item-${field.name}`"
        />

        <OButton
          :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
          v-if="showQuickMode"
          variant="ghost-neutral"
          class="mr-1 gap-0!"
          :title="
            field.isInterestingField
              ? 'Remove from interesting fields'
              : 'Add to interesting fields'
          "
          size="icon"
          @click.stop="$emit('toggle-interesting', field, field.isInterestingField)"
        >
          <OIcon :name="field.isInterestingField ? 'info-filled' : 'info-outline'" size="sm" />
        </OButton>

        <template #actions>
          <OButton
            v-if="field.isSchemaField && showFilterIcon"
            :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
            variant="ghost-neutral"
            size="icon"
            @click.stop="$emit('add-to-filter', `${field.name}=''`)"
          >
            <OIcon name="add" size="sm" />
          </OButton>
          <OButton
            :data-test="`log-search-index-list-add-${field.name}-field-btn`"
            v-if="showVisibilityToggle && !isFieldSelected"
            variant="ghost-neutral"
            size="icon"
            class="gap-0!"
            @click.stop="$emit('toggle-field', field)"
          >
            <OIcon name="visibility" size="sm" />
          </OButton>
          <OButton
            :data-test="`log-search-index-list-remove-${field.name}-field-btn`"
            v-if="showVisibilityToggle && isFieldSelected"
            variant="ghost-neutral"
            class="gap-0!"
            size="icon"
            @click.stop="$emit('toggle-field', field)"
          >
            <OIcon name="visibility-off" size="sm" />
          </OButton>
          <OButton
            :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
            v-if="showQuickMode"
            variant="ghost-neutral"
            class="gap-0!"
            :title="
              field.isInterestingField
                ? 'Remove from interesting fields'
                : 'Add to interesting fields'
            "
            size="icon"
            @click.stop="$emit('toggle-interesting', field, field.isInterestingField)"
          >
            <OIcon :name="field.isInterestingField ? 'info-filled' : 'info-outline'" size="sm" />
          </OButton>
        </template>
      </OFieldRow>
    </template>

    <div class="py-0 pr-2 pl-4">
      <slot name="body">
        <FieldValuesPanel
          ref="fieldValuesPanelRef"
          :field-name="field.name"
          :field-values="mappedFieldValues"
          :show-multi-select="effectiveShowMultiSelect"
          :default-values-count="defaultValuesCount"
          :theme="theme"
          :active-include-values="activeIncludeValues"
          :active-exclude-values="activeExcludeValues"
          @add-search-term="(fn: string, v: string, a: string) => emit('add-search-term', fn, v, a)"
          @add-multiple-search-terms="
            (fn: string, vs: string[], a: string) => emit('add-multiple-search-terms', fn, vs, a)
          "
          @remove-field-filter="(fn: string) => emit('remove-field-filter', fn)"
          @load-more-values="(fn: string) => emit('load-more-values', fn)"
          @search-field-values="(fn: string, t: string) => emit('search-field-values', fn, t)"
        />
      </slot>
    </div>
  </OCollapsible>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";

interface Props {
  field: any;
  fieldValues?: {
    isLoading: boolean;
    values: { key: string; count: number }[];
    errMsg?: string;
    hasMore?: boolean;
  };
  selectedFields?: string[];
  selectedStreamsCount?: number;
  showMultiSelect?: boolean;
  theme?: string;
  defaultValuesCount?: number;
  activeIncludeValues?: string[];
  activeExcludeValues?: string[];
  expanded?: boolean;
  showVisibilityToggle?: boolean;
  showFilterIcon?: boolean;
  showQuickMode?: boolean;
  valueMapper?: (values: { key: string; count: number }[]) => {
    key: string;
    count: number;
  }[];
}

const props = withDefaults(defineProps<Props>(), {
  selectedFields: () => [],
  selectedStreamsCount: 1,
  showMultiSelect: true,
  theme: "light",
  defaultValuesCount: 10,
  activeIncludeValues: () => [],
  activeExcludeValues: () => [],
  expanded: false,
  showVisibilityToggle: true,
  showFilterIcon: true,
  showQuickMode: false,
  fieldValues: undefined,
  valueMapper: undefined,
});

const emit = defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
  "add-search-term": [fieldName: string, value: string, action: string];
  "add-multiple-search-terms": [fieldName: string, values: string[], action: string];
  "remove-field-filter": [fieldName: string];
  "search-field-values": [fieldName: string, searchTerm: string];
  "load-more-values": [fieldName: string];
  "before-show": [event: any, field: any];
  "before-hide": [field: any];
}>();

const isExpanded = ref(props.expanded ?? false);
const fieldValuesPanelRef = ref();

watch(
  () => props.expanded,
  (val) => {
    if (val !== undefined) isExpanded.value = val;
  },
);

const isFieldSelected = computed(() => (props.selectedFields ?? []).includes(props.field.name));

const effectiveShowMultiSelect = computed(() => {
  if (props.selectedStreamsCount !== undefined && props.field.streams !== undefined) {
    return props.selectedStreamsCount === props.field.streams.length;
  }
  return props.showMultiSelect;
});

const mappedFieldValues = computed(() => {
  const raw = props.fieldValues ?? {
    isLoading: false,
    values: [],
    hasMore: false,
    errMsg: "",
  };
  if (props.valueMapper && raw.values.length) {
    return { ...raw, values: props.valueMapper(raw.values) };
  }
  return raw;
});

const handleBeforeShow = (event: any) => {
  emit("before-show", event, props.field);
};

const handleBeforeHide = () => {
  fieldValuesPanelRef.value?.reset();
  emit("before-hide", props.field);
};

const handleToggle = (val: boolean) => {
  isExpanded.value = val;
  if (val) handleBeforeShow(null);
  else handleBeforeHide();
};

defineExpose({ reset: () => fieldValuesPanelRef.value?.reset() });
</script>

<style scoped>
/* keep(complex-state): :deep overrides of the child collapsible's trigger button
   and content wrapper; the [data-state] rule targets this component's own item. */
.field-expansion-item :deep(button[data-state]:not([role="checkbox"])) {
  min-height: 1.5rem !important;
}

.field-expansion-item :deep(.o-collapsible-content) {
  width: 100%;
}

.field-expansion-item[data-state="open"] {
  margin-bottom: 0.375rem;
}
</style>
