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
import { computed, ref, toRef, watch, type ComponentPublicInstance } from "vue";
import OChipInput from "@/lib/forms/ChipInput/OChipInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OFilterToken from "@/lib/core/Badge/OFilterToken.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { FilterTokenPart } from "@/lib/core/Badge/OFilterToken.types";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  countConditions,
  emptyFilterGroup,
  toggleConnector,
  type FilterGroup,
} from "@/utils/query/filterBar";
import FilterBarNodes from "./FilterBarNodes.vue";
import { operatorChipLabel, useFilterBarEditor } from "./useFilterBarEditor";
import type {
  QueryFilterBarEmits,
  QueryFilterBarExpose,
  QueryFilterBarProps,
} from "./QueryFilterBar.types";

const props = withDefaults(defineProps<QueryFilterBarProps>(), {
  dialect: "sql",
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
const draftRef = ref<ComponentPublicInstance | null>(null);
const editAnchor = ref<HTMLElement | null>(null);

const editor = useFilterBarEditor({
  tree: toRef(props, "modelValue"),
  fields: toRef(props, "fields"),
  dialect: toRef(props, "dialect"),
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
  editPart,
  pendingConnector,
  openGroupId,
  armedId,
  advanced,
  suggestions,
  autoHighlight,
  searchPlaceholder,
  valuesLoading,
  targetGroup,
} = editor;

const hasFilters = computed(() => countConditions(props.modelValue) > 0);
const newDraft = computed(() => (editingId.value ? null : draft.value));
const showPendingConnector = computed(
  () => advanced.value && open.value && !editingId.value && targetGroup.value.items.length > 0,
);

// The picker opens under the part being changed, or under the half-built chip at the end of the bar.
const anchor = computed<HTMLElement | null>(() => {
  if (editingId.value) return editAnchor.value;
  return (draftRef.value?.$el as HTMLElement | undefined) ?? null;
});

const placeholderText = computed(() => {
  if (newDraft.value || props.modelValue.items.length) return undefined;
  return props.placeholder ?? t("filterBar.placeholder");
});

const emptyText = computed(() => {
  if (step.value === "field") {
    return props.fieldsLoading ? t("filterBar.loadingFields") : t("filterBar.noFields");
  }
  if (step.value === "value") return valuesLoading.value ? undefined : t("filterBar.noValues");
  return t("filterBar.noOperators");
});

const multiStep = computed(() => step.value === "value" && editor.multiValue.value);
const selectedCount = computed(() => draft.value?.values.length ?? 0);

const hint = computed(() => {
  if (step.value !== "field") return t("filterBar.hintBack");
  return advanced.value ? t("filterBar.hintAdvanced") : t("filterBar.hintBasic");
});

watch(editingId, (id) => {
  if (!id) editAnchor.value = null;
});

function focus() {
  inputRef.value?.focus();
}

defineExpose<QueryFilterBarExpose>({ focus });

function onActivate(typed: string) {
  if (props.disabled) return;
  if (editingId.value) editor.reset();
  armedId.value = null;
  open.value = true;
  emit("focus");
  if (typed) editor.onTextChange(typed);
}

function close() {
  open.value = false;
  armedId.value = null;
  // A half-built chip would otherwise linger looking applied.
  editor.onEscape();
}

function onEdit(id: string, part: FilterTokenPart, element: HTMLElement) {
  if (props.disabled) return;
  editAnchor.value = element;
  editor.editCondition(id, part);
  emit("focus");
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
}

function clearAll() {
  editor.reset();
  openGroupId.value = null;
  emit("update:modelValue", emptyFilterGroup());
  focus();
}

const draftOperator = computed(() => {
  const op = newDraft.value?.operator;
  return op ? operatorChipLabel(op, t) : undefined;
});
</script>

<template>
  <OChipInput
    ref="inputRef"
    :model-value="text"
    :open="open"
    :suggestions="suggestions"
    :search-placeholder="searchPlaceholder"
    :anchor="anchor"
    :empty-text="emptyText"
    :loading="step === 'value' ? valuesLoading : step === 'field' && fieldsLoading"
    :auto-highlight="autoHighlight"
    :multiple="multiStep"
    :placeholder="placeholderText"
    :aria-label="t('filterBar.ariaLabel')"
    :disabled="disabled"
    :size="size"
    :data-test="dataTest"
    @update:model-value="editor.onTextChange"
    @select="editor.select"
    @enter="editor.onEnter"
    @separator="editor.onSeparator"
    @backspace-empty="editor.onBackspace"
    @escape="close"
    @close="close"
    @activate="onActivate"
  >
    <FilterBarNodes
      :items="modelValue.items"
      :connectors="advanced"
      :editing-id="editingId"
      :edit-part="editPart"
      :armed-id="armedId"
      :open-group-id="openGroupId"
      :data-test="dataTest"
      @edit="onEdit"
      @remove="onRemove"
      @toggle-connector="onToggleConnector"
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
    <OFilterToken
      v-if="newDraft?.field"
      ref="draftRef"
      :field="raw(newDraft.field)"
      :operator="draftOperator"
      :value="newDraft.values.length ? raw(newDraft.values.join(', ')) : undefined"
      :active-part="step"
      :editable="false"
      :data-test="`${dataTest}-draft`"
    />
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
    </template>
    <template #footer>
      <div v-if="multiStep" class="flex items-center gap-2">
        <span class="min-w-0 flex-1" :data-test="`${dataTest}-selected-count`">{{
          t("filterBar.selectedCount", { count: selectedCount }, selectedCount)
        }}</span>
        <OButton
          variant="primary"
          size="xs"
          :disabled="!selectedCount"
          :data-test="`${dataTest}-apply`"
          @mousedown.prevent
          @click="editor.applyValues"
          >{{ t("common.apply") }}</OButton
        >
      </div>
      <template v-else>{{ hint }}</template>
    </template>
  </OChipInput>
</template>
