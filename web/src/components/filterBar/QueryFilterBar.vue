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

<script setup lang="ts">
import { computed, nextTick, ref, toRef } from "vue";
import OChipInput from "@/lib/forms/ChipInput/OChipInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  countConditions,
  emptyFilterGroup,
  needsAdvancedMode,
  OPERATORS,
  toggleConnector,
  type FilterGroup,
} from "@/utils/query/filterBar";
import FilterBarNodes from "./FilterBarNodes.vue";
import { useFilterBarEditor, type FilterBarMode } from "./useFilterBarEditor";
import type {
  QueryFilterBarEmits,
  QueryFilterBarExpose,
  QueryFilterBarProps,
} from "./QueryFilterBar.types";

const props = withDefaults(defineProps<QueryFilterBarProps>(), {
  dialect: "sql",
  mode: "basic",
  showModeToggle: true,
  freeText: false,
  allowCustomFields: false,
  loadValues: undefined,
  fieldsLoading: false,
  placeholder: undefined,
  disabled: false,
  size: "md",
  dataTest: "query-filter-bar",
});
const emit = defineEmits<QueryFilterBarEmits>();

const { t } = useI18nTyped();
const inputRef = ref<InstanceType<typeof OChipInput> | null>(null);

const editor = useFilterBarEditor({
  tree: toRef(props, "modelValue"),
  fields: toRef(props, "fields"),
  dialect: toRef(props, "dialect"),
  mode: toRef(props, "mode"),
  freeText: toRef(props, "freeText"),
  allowCustomFields: toRef(props, "allowCustomFields"),
  loadValues: toRef(props, "loadValues"),
  t,
  commit: (next: FilterGroup) => emit("update:modelValue", next),
  submit: () => emit("submit"),
});

const {
  text,
  open,
  step,
  draft,
  editingId,
  pendingConnector,
  openGroupId,
  armedId,
  advanced,
  suggestions,
  autoHighlight,
  header,
  valuesLoading,
  targetGroup,
} = editor;

const editIndex = computed(() =>
  editingId.value ? props.modelValue.items.findIndex((item) => item.id === editingId.value) : -1,
);
const itemsBefore = computed(() =>
  editIndex.value >= 0 ? props.modelValue.items.slice(0, editIndex.value) : props.modelValue.items,
);
const itemsAfter = computed(() =>
  editIndex.value >= 0 ? props.modelValue.items.slice(editIndex.value + 1) : [],
);

const hasFilters = computed(() => countConditions(props.modelValue) > 0);
const basicBlocked = computed(() => needsAdvancedMode(props.modelValue));
const showPendingConnector = computed(
  () => advanced.value && open.value && !editingId.value && targetGroup.value.items.length > 0,
);
const editedConnector = computed(() =>
  advanced.value && editIndex.value > 0 ? props.modelValue.items[editIndex.value].connector : null,
);

const placeholderText = computed(() => {
  if (draft.value || props.modelValue.items.length) return undefined;
  return props.placeholder ?? t("filterBar.placeholder");
});

const emptyText = computed(() => {
  if (step.value === "field") {
    return props.fieldsLoading ? t("filterBar.loadingFields") : t("filterBar.noFields");
  }
  if (step.value === "value") return valuesLoading.value ? undefined : t("filterBar.noValues");
  return t("filterBar.noOperators");
});

const hint = computed(() => {
  if (step.value === "value" && editor.multiValue.value) return t("filterBar.hintMultiValue");
  if (step.value !== "field") return t("filterBar.hintBack");
  return advanced.value ? t("filterBar.hintAdvanced") : t("filterBar.hintBasic");
});

function focus() {
  inputRef.value?.focus();
}

defineExpose<QueryFilterBarExpose>({ focus });

function onFocus() {
  open.value = true;
  emit("focus");
}

function onBlur() {
  open.value = false;
  armedId.value = null;
  // A half-built chip would otherwise linger looking applied, and an edited chip would stay hidden.
  editor.onEscape();
}

async function onEdit(id: string) {
  editor.editCondition(id);
  await nextTick();
  focus();
}

function onRemove(id: string) {
  editor.removeCondition(id);
  focus();
}

function onToggleConnector(id: string) {
  emit("update:modelValue", toggleConnector(props.modelValue, id));
}

function onTogglePending() {
  editor.setPendingConnector(pendingConnector.value === "AND" ? "OR" : "AND");
  focus();
}

function clearAll() {
  editor.reset();
  openGroupId.value = null;
  emit("update:modelValue", emptyFilterGroup());
  focus();
}

function onModeChange(value: unknown) {
  if (value !== "basic" && value !== "advanced") return;
  if (value === "basic") openGroupId.value = null;
  emit("update:mode", value as FilterBarMode);
}
</script>

<template>
  <OChipInput
    ref="inputRef"
    :model-value="text"
    :open="open"
    :suggestions="suggestions"
    :header="header"
    :empty-text="emptyText"
    :loading="step === 'value' ? valuesLoading : step === 'field' && fieldsLoading"
    :auto-highlight="autoHighlight"
    :placeholder="placeholderText"
    :aria-label="t('filterBar.ariaLabel')"
    :disabled="disabled"
    :input-grow="editIndex < 0"
    :size="size"
    :data-test="dataTest"
    @update:model-value="editor.onTextChange"
    @select="editor.select"
    @enter="editor.onEnter"
    @separator="editor.onSeparator"
    @backspace-empty="editor.onBackspace"
    @escape="editor.onEscape"
    @close="open = false"
    @focus="onFocus"
    @blur="onBlur"
  >
    <FilterBarNodes
      :items="itemsBefore"
      :advanced="advanced"
      :editing-id="editingId"
      :armed-id="armedId"
      :open-group-id="openGroupId"
      :data-test="dataTest"
      @edit="onEdit"
      @remove="onRemove"
      @toggle-connector="onToggleConnector"
    />
    <OTag
      v-if="editedConnector"
      size="sm"
      variant="default-outline"
      :label="raw(editedConnector)"
    />
    <OTag
      v-if="showPendingConnector"
      clickable
      size="sm"
      variant="default-outline"
      :label="raw(pendingConnector)"
      :aria-label="t('filterBar.toggleConnector')"
      :data-test="`${dataTest}-pending-connector`"
      @mousedown.prevent
      @click.stop="onTogglePending"
    />
    <template v-if="draft">
      <OTag
        v-if="draft.field"
        size="sm"
        variant="primary-outline"
        :label="raw(draft.field)"
        :data-test="`${dataTest}-draft-field`"
      />
      <OTag
        v-if="draft.operator"
        size="sm"
        variant="primary-outline"
        :label="raw(OPERATORS[draft.operator].symbol)"
        :data-test="`${dataTest}-draft-operator`"
      />
      <OTag
        v-for="value in draft.values"
        :key="value"
        size="sm"
        variant="primary-soft"
        :label="raw(value)"
      />
    </template>
    <template #after>
      <FilterBarNodes
        :items="itemsAfter"
        :advanced="advanced"
        :offset="editIndex + 1"
        :armed-id="armedId"
        :open-group-id="openGroupId"
        :data-test="dataTest"
        @edit="onEdit"
        @remove="onRemove"
        @toggle-connector="onToggleConnector"
      />
    </template>
    <template #trailing>
      <OButton
        v-if="hasFilters"
        variant="ghost"
        size="icon-xs-sq"
        icon-left="close"
        :aria-label="t('filterBar.clearAll')"
        :data-test="`${dataTest}-clear`"
        @mousedown.prevent
        @click.stop="clearAll"
      />
      <OToggleGroup
        v-if="showModeToggle && dialect === 'sql'"
        type="single"
        :model-value="mode"
        :data-test="`${dataTest}-mode`"
        @update:model-value="onModeChange"
      >
        <OToggleGroupItem
          value="basic"
          size="xs"
          :disabled="basicBlocked && mode === 'advanced'"
          :tooltip="basicBlocked ? t('filterBar.basicBlocked') : t('filterBar.basicTooltip')"
          :data-test="`${dataTest}-mode-basic`"
          >{{ t("filterBar.basic") }}</OToggleGroupItem
        >
        <OToggleGroupItem
          value="advanced"
          size="xs"
          :tooltip="t('filterBar.advancedTooltip')"
          :data-test="`${dataTest}-mode-advanced`"
          >{{ t("filterBar.advanced") }}</OToggleGroupItem
        >
      </OToggleGroup>
    </template>
    <template #footer>{{ hint }}</template>
  </OChipInput>
</template>
