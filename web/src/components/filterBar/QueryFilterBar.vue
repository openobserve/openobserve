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
import { computed, nextTick, provide, ref, toRef, watch, type ComponentPublicInstance } from "vue";
import OChipInput from "@/lib/forms/ChipInput/OChipInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OFilterToken from "@/lib/core/Badge/OFilterToken.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { FilterTokenPart } from "@/lib/core/Badge/OFilterToken.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { countConditions, findNode, findParent, type FilterGroup } from "@/utils/query/filterBar";
import FilterBarNodes from "./FilterBarNodes.vue";
import FilterBarRows from "./FilterBarRows.vue";
import { dialectConfig, FILTER_PROFILES, type FilterEditorConfig } from "./filterProfiles";
import { operatorName, useFilterBarEditor } from "./useFilterBarEditor";
import { containsNode, useFilterBarFolds } from "./useFilterBarFolds";
import {
  FILTER_BAR_CHIP_CONTEXT,
  type QueryFilterBarEmits,
  type QueryFilterBarExpose,
  type QueryFilterBarProps,
} from "./QueryFilterBar.types";

const props = withDefaults(defineProps<QueryFilterBarProps>(), {
  dialect: "sql",
  freeText: false,
  allowCustomFields: false,
  profile: undefined,
  layout: undefined,
  loadValues: undefined,
  extraValueSuggestions: undefined,
  issues: undefined,
  valueHint: undefined,
  fieldsLoading: false,
  placeholder: undefined,
  disabled: false,
  size: "md",
  appearance: "field",
  maxRows: undefined,
  dataTest: "query-filter-bar",
});
const emit = defineEmits<QueryFilterBarEmits>();

const { t } = useI18nTyped();
const inputRef = ref<InstanceType<typeof OChipInput> | null>(null);
const draftRef = ref<ComponentPublicInstance | null>(null);
const editAnchor = ref<HTMLElement | null>(null);
const rowsRef = ref<HTMLElement | null>(null);

const config = computed<FilterEditorConfig>(() => {
  const base = props.profile
    ? FILTER_PROFILES[props.profile]
    : dialectConfig(props.dialect, props.freeText, props.allowCustomFields);
  return props.layout ? { ...base, layout: props.layout } : base;
});
const vertical = computed(() => config.value.layout === "vertical");
const dialect = computed(() => config.value.dialect);

const folds = useFilterBarFolds(toRef(props, "modelValue"));
const foldedIds = folds.folded;

function commitTree(next: FilterGroup) {
  folds.markOwn(next);
  emit("update:modelValue", next);
}

const editor = useFilterBarEditor({
  tree: toRef(props, "modelValue"),
  fields: toRef(props, "fields"),
  config,
  loadValues: toRef(props, "loadValues"),
  extraValues: toRef(props, "extraValueSuggestions"),
  t,
  commit: commitTree,
  submit: () => emit("submit"),
});

const {
  text,
  open,
  step,
  draft,
  editingId,
  editPart,
  openGroupId,
  caretBeforeId,
  caretIndex,
  armedId,
  advanced,
  suggestions,
  autoHighlight,
  searchPlaceholder,
  valuesLoading,
  targetGroup,
  nextConnector,
  atConditionLimit,
  valuesAtLimit,
  fieldEmptyText,
} = editor;

const hasFilters = computed(() => countConditions(props.modelValue) > 0);
const newDraft = computed(() => (editingId.value ? null : draft.value));
const showPendingConnector = computed(
  () => advanced.value && open.value && !editingId.value && targetGroup.value.items.length > 0,
);
const caretGroupId = computed(() => targetGroup.value.id);
provide(FILTER_BAR_CHIP_CONTEXT, {
  fieldLabel: (field) => props.fields.find((f) => f.name === field)?.label,
  valueHint: (field, values) => props.valueHint?.(field, values),
  issueMessage: (nodeId) => props.issues?.find((issue) => issue.nodeId === nodeId)?.message,
  operatorName: (id) => operatorName(id, dialect.value, t, config.value.operatorNames),
});
const invalidIds = computed(
  () => new Set((props.issues ?? []).map((issue) => issue.nodeId).filter(Boolean) as string[]),
);
// A folded group opens once the caret, an edit or a newly found problem lands inside it.
watch([caretGroupId, editingId, armedId], (ids) => ids.forEach((id) => folds.reveal(id)));
watch(invalidIds, (next, previous) =>
  next.forEach((id) => {
    if (!previous?.has(id)) folds.reveal(id);
  }),
);
const limitReason = computed<I18nText | undefined>(() =>
  atConditionLimit.value
    ? t(
        "filterBar.limits.conditions",
        { count: config.value.limits.maxConditions ?? 0 },
        config.value.limits.maxConditions ?? 0,
      )
    : undefined,
);
const showEmptyRow = computed(
  () =>
    vertical.value &&
    config.value.startWithEmptyRow &&
    !props.modelValue.items.length &&
    !newDraft.value,
);
// A vertical caret gets its own line where it stands; resting at the end of an idle filter it sits beside the add buttons.
const caretLine = computed(
  () =>
    vertical.value &&
    (open.value ||
      Boolean(newDraft.value) ||
      Boolean(openGroupId.value) ||
      Boolean(caretBeforeId.value) ||
      showEmptyRow.value),
);
const nodesCaretIndex = computed(() =>
  vertical.value && !caretLine.value ? null : caretIndex.value,
);
// Only the caret at the very end fills its line; between chips it would push the rest away.
const caretAtEnd = computed(() => !openGroupId.value && !caretBeforeId.value);
// At the front of a non-empty group the typed connector joins the new node to the one after it.
const connectorAfterDraft = computed(() => caretIndex.value === 0);

// The picker opens under the part being changed, or under the half-built chip.
const anchor = computed<HTMLElement | null>(() => {
  if (editingId.value) return editAnchor.value;
  return (draftRef.value?.$el as HTMLElement | undefined) ?? null;
});

const placeholderText = computed(() => {
  if (newDraft.value || props.modelValue.items.length || showEmptyRow.value) return undefined;
  return props.placeholder ?? t("filterBar.placeholder");
});

const emptyText = computed(() => {
  if (step.value === "field") {
    if (fieldEmptyText.value) return fieldEmptyText.value;
    return props.fieldsLoading ? t("filterBar.loadingFields") : t("filterBar.noFields");
  }
  if (step.value === "value") return valuesLoading.value ? undefined : t("filterBar.noValues");
  return t("filterBar.noOperators");
});

const multiStep = computed(() => step.value === "value" && editor.multiValue.value);
const selectedCount = computed(() => draft.value?.values.length ?? 0);

// The picker's search box goes away with the edit; a keyboard user lands back on the part they changed.
watch(editingId, async (id) => {
  if (id) return;
  const part = editAnchor.value;
  editAnchor.value = null;
  await nextTick();
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  if (part?.isConnected) part.focus();
  else focus();
});

function focus() {
  inputRef.value?.focus();
}

defineExpose<QueryFilterBarExpose>({ focus });

function onActivate() {
  if (props.disabled) return;
  if (editingId.value) editor.reset();
  armedId.value = null;
  open.value = true;
  emit("focus");
}

/** Shuts the list and drops a half-built chip, leaving the caret where it is. */
function dismiss() {
  open.value = false;
  armedId.value = null;
  // A half-built chip would otherwise linger looking applied.
  editor.onEscape();
}

/** The user is done with the bar: empty groups go and the caret returns to the end. */
function close() {
  dismiss();
  editor.leaveGroups();
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

function onAddCondition(groupId: string) {
  if (props.disabled) return;
  folds.reveal(groupId);
  editor.addIn(groupId);
  focus();
  emit("focus");
}

function onAddAfter(id: string) {
  if (props.disabled) return;
  folds.reveal(findParent(props.modelValue, id)?.id);
  editor.addAfter(id);
  focus();
  emit("focus");
}

function onAddGroup(groupId: string) {
  if (props.disabled) return;
  folds.reveal(groupId);
  editor.reset();
  editor.startGroup(groupId === props.modelValue.id ? null : groupId);
  open.value = true;
  focus();
  emit("focus");
}

function onUngroup(id: string) {
  editor.ungroup(id);
}

function onToggleFold(id: string) {
  const folding = !foldedIds.value.has(id);
  const group = findNode(props.modelValue, id);
  const holds = (inner: string | null) =>
    Boolean(inner) && group?.kind === "group" && (inner === id || containsNode(group, inner!));
  if (folding && [caretGroupId.value, editingId.value, armedId.value].some(holds)) close();
  // The toggle is redrawn on the other side of the fold, so keyboard focus moves to its new copy.
  const focused = (document.activeElement as HTMLElement | null)?.closest("[data-fold-toggle]");
  folds.setFolded(id, folding);
  if (!focused) return;
  nextTick(() => rowsRef.value?.querySelector<HTMLElement>(`[data-fold-toggle="${id}"]`)?.focus());
}

function clearAll() {
  editor.reset();
  editor.moveCaretTo(null);
  commitTree({ ...props.modelValue, items: [] });
  focus();
}

function onCaretMove(stepBy: -1 | 1) {
  if (editor.moveCaret(stepBy)) armedId.value = null;
}

// A press between chips puts the caret there: before the first chip whose middle lies after the press.
function onPress(event: PointerEvent) {
  if (vertical.value || editingId.value || draft.value) return;
  const target = event.target as HTMLElement;
  const box = target.closest<HTMLElement>("[data-filter-group]");
  const field = target.closest(`[data-test="${props.dataTest}-field"]`);
  const container = box ?? field?.querySelector("[data-o-chip-lines]");
  const groupId = box?.dataset.filterGroup ?? props.modelValue.id;
  const group =
    groupId === props.modelValue.id ? props.modelValue : findNode(props.modelValue, groupId);
  if (!container || group?.kind !== "group") return;
  let before: string | null = null;
  for (const element of Array.from(
    container.querySelectorAll<HTMLElement>(":scope > [data-filter-index]"),
  )) {
    const rect = element.getBoundingClientRect();
    const later =
      event.clientY < rect.top ||
      (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2);
    if (later) {
      before = group.items[Number(element.dataset.filterIndex)]?.id ?? null;
      break;
    }
  }
  editor.moveCaretTo(groupId, before);
}

const draftOperator = computed(() => {
  const op = newDraft.value?.operator;
  return op ? operatorName(op, dialect.value, t, config.value.operatorNames) : undefined;
});
</script>

<template>
  <OChipInput
    ref="inputRef"
    inline-caret
    :model-value="text"
    :open="open"
    :suggestions="suggestions"
    :search-placeholder="searchPlaceholder"
    :search-in-list="Boolean(editingId)"
    :anchor="anchor"
    :empty-text="emptyText"
    :loading="step === 'value' ? valuesLoading : step === 'field' && fieldsLoading"
    :auto-highlight="autoHighlight"
    :multiple="multiStep"
    :placeholder="placeholderText"
    :aria-label="t('filterBar.ariaLabel')"
    :disabled="disabled"
    :size="size"
    :appearance="appearance"
    :max-rows="maxRows"
    :data-test="dataTest"
    @update:model-value="editor.onTextChange"
    @select="editor.select"
    @enter="editor.onEnter"
    @apply="editor.applyValues"
    @separator="editor.onSeparator"
    @backspace-empty="editor.onBackspace"
    @delete-empty="editor.onDelete"
    @caret-move="onCaretMove"
    @press="onPress"
    @escape="dismiss"
    @dismiss="dismiss"
    @close="close"
    @leave="close"
    @activate="onActivate"
  >
    <template #default="{ caret }">
      <div v-if="vertical" ref="rowsRef" class="flex w-full min-w-min flex-col gap-1.5">
        <FilterBarRows
          :items="modelValue.items"
          :group-id="modelValue.id"
          :connector-mode="config.connectors"
          :dialect="dialect"
          :editing-id="editingId"
          :edit-part="editPart"
          :armed-id="armedId"
          :caret-group-id="caretGroupId"
          :caret-index="nodesCaretIndex"
          :invalid-ids="invalidIds"
          :disabled="disabled"
          :can-group-in="editor.canGroupIn"
          :can-ungroup="editor.canUngroup"
          :limit-reason="limitReason"
          :next-connector="nextConnector"
          :folded-ids="foldedIds"
          :data-test="dataTest"
          @edit="onEdit"
          @remove="onRemove"
          @toggle-connector="editor.toggleConnector"
          @ungroup="onUngroup"
          @add-condition="onAddCondition"
          @add-group="onAddGroup"
          @add-after="onAddAfter"
          @toggle-fold="onToggleFold"
        >
          <template #caret="{ index, groupId }">
            <div class="flex min-w-0 items-start gap-1.5" :data-test="`${dataTest}-draft-row`">
              <div class="flex h-6 w-10 shrink-0 items-center">
                <OTag
                  v-if="showPendingConnector"
                  clickable
                  size="xs"
                  shape="rounded"
                  variant="default-soft"
                  :label="raw(nextConnector)"
                  :aria-label="t('filterBar.toggleConnector')"
                  :data-test="`${dataTest}-pending-connector`"
                  @mousedown.prevent
                  @click.stop="editor.togglePendingConnector"
                />
                <span v-else-if="index > 0" class="text-text-secondary text-xs">{{
                  raw(nextConnector)
                }}</span>
                <span v-else-if="groupId === modelValue.id" class="text-text-secondary text-xs">{{
                  t("filterBar.where")
                }}</span>
              </div>
              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
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
                <OFilterToken
                  v-else-if="showEmptyRow && !open"
                  :field="t('filterBar.chooseField')"
                  :data-test="`${dataTest}-empty-row`"
                  @select="onAddCondition(modelValue.id)"
                />
                <component :is="caret" />
              </div>
            </div>
          </template>
        </FilterBarRows>
      </div>
      <FilterBarNodes
        v-else
        :items="modelValue.items"
        :group-id="modelValue.id"
        :connector-mode="config.connectors"
        :dialect="dialect"
        :editing-id="editingId"
        :edit-part="editPart"
        :armed-id="armedId"
        :caret-group-id="caretGroupId"
        :caret-index="nodesCaretIndex"
        :invalid-ids="invalidIds"
        :disabled="disabled"
        :can-ungroup="editor.canUngroup"
        :data-test="dataTest"
        @edit="onEdit"
        @remove="onRemove"
        @toggle-connector="editor.toggleConnector"
        @ungroup="onUngroup"
      >
        <template #caret>
          <OTag
            v-if="showPendingConnector && !connectorAfterDraft"
            clickable
            size="xs"
            shape="rounded"
            variant="default-soft"
            :label="raw(nextConnector)"
            :aria-label="t('filterBar.toggleConnector')"
            :data-test="`${dataTest}-pending-connector`"
            @mousedown.prevent
            @click.stop="editor.togglePendingConnector"
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
          <component :is="caret" :grow="caretAtEnd" />
          <OTag
            v-if="showPendingConnector && connectorAfterDraft"
            clickable
            size="xs"
            shape="rounded"
            variant="default-soft"
            :label="raw(nextConnector)"
            :aria-label="t('filterBar.toggleConnector')"
            :data-test="`${dataTest}-pending-connector`"
            @mousedown.prevent
            @click.stop="editor.togglePendingConnector"
          />
        </template>
      </FilterBarNodes>
      <div v-if="vertical" class="flex w-full min-w-0 items-center gap-1.5">
        <span class="w-10 shrink-0" aria-hidden="true" />
        <template v-if="!disabled">
          <span class="inline-flex">
            <OButton
              variant="ghost"
              size="xs"
              icon-left="add"
              :disabled="Boolean(limitReason)"
              :data-test="`${dataTest}-add-condition`"
              @mousedown.prevent
              @click.stop="onAddCondition(modelValue.id)"
              >{{ t("filterBar.addCondition") }}</OButton
            >
            <OTooltip v-if="limitReason" :content="limitReason" />
          </span>
          <span v-if="editor.canGroupIn(modelValue.id)" class="inline-flex">
            <OButton
              variant="ghost"
              size="xs"
              icon-left="add"
              :disabled="Boolean(limitReason)"
              :data-test="`${dataTest}-add-group`"
              @mousedown.prevent
              @click.stop="onAddGroup(modelValue.id)"
              >{{ t("filterBar.addGroup") }}</OButton
            >
            <OTooltip v-if="limitReason" :content="limitReason" />
          </span>
        </template>
        <component :is="caret" v-if="!caretLine" />
      </div>
    </template>
    <template #trailing>
      <OButton
        v-if="hasFilters && !disabled"
        variant="ghost"
        size="icon-xs-sq"
        icon-left="close"
        :aria-label="t('filterBar.clearAll')"
        :data-test="`${dataTest}-clear`"
        @mousedown.prevent
        @click.stop="clearAll"
      />
    </template>
    <template v-if="multiStep" #footer>
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1" :data-test="`${dataTest}-selected-count`">{{
          valuesAtLimit
            ? t(
                "filterBar.limits.values",
                { count: config.limits.maxValues ?? 0 },
                config.limits.maxValues ?? 0,
              )
            : t("filterBar.selectedCount", { count: selectedCount }, selectedCount)
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
    </template>
  </OChipInput>
</template>
