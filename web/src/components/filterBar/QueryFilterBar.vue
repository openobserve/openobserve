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
import type { ChipInputActivation } from "@/lib/forms/ChipInput/OChipInput.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OFilterToken from "@/lib/core/Badge/OFilterToken.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { FilterTokenPart } from "@/lib/core/Badge/OFilterToken.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  countConditions,
  findNode,
  findParent,
  type FilterGroup,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import FilterBarNodes from "./FilterBarNodes.vue";
import FilterBarRows from "./FilterBarRows.vue";
import { dialectConfig, FILTER_PROFILES, type FilterEditorConfig } from "./filterProfiles";
import { operatorName, useFilterBarEditor } from "./useFilterBarEditor";
import { containsNode, useFilterBarFolds } from "./useFilterBarFolds";
import { useFilterBarHistory } from "./useFilterBarHistory";
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
  searchFunctions: false,
  openOnType: false,
  profile: undefined,
  layout: undefined,
  loadValues: undefined,
  extraValueSuggestions: undefined,
  extraSuggestions: undefined,
  issues: undefined,
  valueHint: undefined,
  valueLabel: undefined,
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
    : dialectConfig(props.dialect, props.freeText, props.allowCustomFields, props.searchFunctions);
  return props.layout ? { ...base, layout: props.layout } : base;
});
const vertical = computed(() => config.value.layout === "vertical");
const dialect = computed(() => config.value.dialect);

const folds = useFilterBarFolds(toRef(props, "modelValue"));
const foldedIds = folds.folded;

function commitTree(next: FilterGroup) {
  const field = document.activeElement?.closest(`[data-test="${props.dataTest}-field"]`);
  folds.markOwn(next);
  emit("update:modelValue", next);
  // A change can remove the part the keyboard was on; focus then stays in the bar instead of falling to the page.
  if (field)
    nextTick(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) focus();
    });
}

const editor = useFilterBarEditor({
  tree: toRef(props, "modelValue"),
  fields: toRef(props, "fields"),
  config,
  loadValues: toRef(props, "loadValues"),
  extraValues: toRef(props, "extraValueSuggestions"),
  valueLabel: toRef(props, "valueLabel"),
  extraSuggestions: toRef(props, "extraSuggestions"),
  selectExtra: (key, event) => emit("extra-select", key, event),
  t,
  commit: commitTree,
  submit: () => emit("submit"),
});

const history = useFilterBarHistory(toRef(props, "modelValue"), commitTree);

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
// While the bar has focus the next condition's AND/OR stays in view, so it can be switched before typing.
const engaged = ref(false);
const showPendingConnector = computed(
  () =>
    advanced.value &&
    (open.value || engaged.value) &&
    !editingId.value &&
    targetGroup.value.items.length > 0,
);
const caretGroupId = computed(() => targetGroup.value.id);
const showAddOrGroup = computed(
  () =>
    config.value.connectors === "any-of-groups" &&
    !vertical.value &&
    !props.disabled &&
    hasFilters.value &&
    editor.canGroupIn(null),
);
provide(FILTER_BAR_CHIP_CONTEXT, {
  fieldLabel: (field) => props.fields.find((f) => f.name === field)?.label,
  valueHint: (field, values) => props.valueHint?.(field, values),
  valueLabel: (field, value) => props.valueLabel?.(field, value),
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

// Reopened for the next condition with nothing typed: offering a pick, not holding an edit.
const resting = computed(
  () => step.value === "field" && !text.value && !editingId.value && !draft.value,
);

const multiStep = computed(() => step.value === "value" && editor.multiValue.value);
const highlightedKey = ref<string | null>(null);
const operatorHint = computed(() => {
  if (step.value !== "operator" || !highlightedKey.value) return null;
  const key = config.value.operatorHints?.[highlightedKey.value as FilterOperatorId];
  return key ? t(key) : null;
});
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

function activate() {
  if (props.disabled) return;
  focus();
  onActivate("pointer");
}

// A half-built chip or a caret inside a group would point at nodes the restored filter may not hold.
function restore(step: () => boolean): boolean {
  if (props.disabled) return false;
  editor.reset();
  openGroupId.value = null;
  caretBeforeId.value = null;
  return step();
}

const undo = () => restore(history.undo);
const redo = () => restore(history.redo);

function clear(): boolean {
  if (props.disabled || !props.modelValue.items.length) return false;
  clearAll();
  return true;
}

// The chip or AND/OR the keyboard was on may be gone from the restored filter, so focus falls back to the caret.
function onHistory(action: "undo" | "redo" | "clear") {
  ({ undo, redo, clear })[action]();
  nextTick(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) focus();
  });
}

defineExpose<QueryFilterBarExpose>({ focus, activate, undo, redo, clear });

function onActivate(how: ChipInputActivation) {
  if (props.disabled) return;
  if (editingId.value) editor.reset();
  armedId.value = null;
  open.value = !props.openOnType || how !== "pointer";
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
  engaged.value = false;
  dismiss();
  editor.leaveGroups();
}

function onEdit(id: string, part: FilterTokenPart, element: HTMLElement) {
  if (props.disabled) return;
  editAnchor.value = element;
  editor.editCondition(id, part);
  emit("focus");
}

// Removed from the keyboard, a chip leaves the caret where it stood, so the next condition can go there.
function onRemove(id: string) {
  const fromKeys = activeIn("[data-filter-chip]", "filterChip") === id;
  const parent = findParent(props.modelValue, id);
  const after = parent?.items[parent.items.findIndex((item) => item.id === id) + 1]?.id ?? null;
  editor.removeCondition(id);
  if (fromKeys && parent) placeCaret(parent.id, after);
  focus();
}

// The id that the focused element's closest `selector` holds in data attribute `key`.
function activeIn(selector: string, key: string): string | undefined {
  return (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(selector)?.dataset[
    key
  ];
}

function placeCaret(groupId: string, beforeId: string | null) {
  editor.moveCaretTo(groupId === props.modelValue.id ? null : groupId, beforeId);
}

// The arrow keys walk the filter as a text cursor walks text: every part, AND/OR and button, and every gap between them.
function walkStops(lines: Element): HTMLElement[] {
  const atCaret = (gap: HTMLElement) =>
    gap.dataset.gapGroup === caretGroupId.value &&
    (gap.dataset.gapBefore || null) === (caretBeforeId.value ?? null);
  return Array.from(lines.querySelectorAll<HTMLElement>("[data-walk], [data-gap], input")).filter(
    (stop) => {
      if (stop.dataset.gap !== undefined) return !atCaret(stop);
      // A control shown only on hover or focus is skipped while hidden.
      return typeof stop.checkVisibility === "function" ? stop.checkVisibility() : true;
    },
  );
}

// A gap takes the caret; any other stop takes focus itself.
function land(stop: HTMLElement | null) {
  if (stop && stop.dataset.gap === undefined) {
    if (stop.tagName === "INPUT") focus();
    else stop.focus();
    return;
  }
  placeCaret(stop?.dataset.gapGroup ?? props.modelValue.id, stop?.dataset.gapBefore || null);
  nextTick(focus);
}

function onWalk(move: -1 | 1 | "home" | "end", from: HTMLElement) {
  const lines = from.closest("[data-o-chip-lines]");
  if (!lines) return;
  if (move === "end") return land(null);
  const stops = walkStops(lines);
  if (move === "home") return land(stops[0] ?? null);
  const target = stops[stops.indexOf(from) + move];
  if (target) land(target);
}

// Typing on a chip's part carries on in the gap right after that chip, as typing after a word does.
function onTypeAt(from: HTMLElement, key: string) {
  const lines = from.closest("[data-o-chip-lines]");
  if (!lines) return;
  const stops = walkStops(lines);
  const gap = stops
    .slice(stops.indexOf(from) + 1)
    .find((stop) => stop.dataset.gap !== undefined || stop.tagName === "INPUT");
  land(gap ?? null);
  nextTick(() => {
    focus();
    const caret = lines.querySelector<HTMLInputElement>("input");
    if (!caret) return;
    caret.value += key;
    caret.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

// Groups stand after the base list whatever the caret was doing.
function onAddOrGroup() {
  editor.moveCaretTo(null);
  onAddGroup(props.modelValue.id);
}

// Ungrouped from the keyboard, the caret takes the place the opening bracket had.
function onUngroup(id: string) {
  const group = findNode(props.modelValue, id);
  const parent = findParent(props.modelValue, id);
  const fromKeys = activeIn("[data-filter-group]", "filterGroup") === id;
  editor.ungroup(id);
  if (!fromKeys || group?.kind !== "group" || !parent) return;
  placeCaret(parent.id, group.items[0]?.id ?? null);
  nextTick(focus);
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
  // Matched by attribute value, not a selector, so a saved group id holding a quote cannot break the lookup.
  nextTick(() =>
    Array.from(rowsRef.value?.querySelectorAll<HTMLElement>("[data-fold-toggle]") ?? [])
      .find((toggle) => toggle.dataset.foldToggle === id)
      ?.focus(),
  );
}

function clearAll() {
  editor.reset();
  editor.moveCaretTo(null);
  commitTree({ ...props.modelValue, items: [] });
  focus();
}

// A vertical caret holds a line of its own, so Escape gives that line back instead of leaving it empty.
function onEscape() {
  // Escape out of a chip part's list returns to that part, after the field has put focus on its caret.
  const part = editingId.value ? editAnchor.value : null;
  if (vertical.value) close();
  else dismiss();
  if (part) nextTick(() => part.isConnected && part.focus());
}

// The parts a chip being edited has, offered as tabs at the top of its list.
const editParts = computed<FilterTokenPart[]>(() => {
  const node = editingId.value ? findNode(props.modelValue, editingId.value) : undefined;
  if (node?.kind !== "condition" || node.operator === "match_all") return [];
  const parts: FilterTokenPart[] = ["field", "operator"];
  if (editor.arityOf(node.operator) !== "none") parts.push("value");
  return parts;
});

function switchPart(part: FilterTokenPart) {
  const id = editingId.value;
  const chip = editAnchor.value?.closest<HTMLElement>("[data-filter-chip]");
  const element = chip?.querySelector<HTMLElement>(`[data-part="${part}"]`);
  if (!id || !element || part === editPart.value) return;
  onEdit(id, part, element);
}

function onPartTab(stepBy: -1 | 1) {
  const parts = editParts.value;
  const at = parts.indexOf(editPart.value ?? "value");
  switchPart(parts[(at + stepBy + parts.length) % parts.length]);
}

const partLabel = (part: FilterTokenPart) =>
  part === "field"
    ? t(dialect.value === "promql" ? "filterBar.editPart.label" : "filterBar.editPart.field")
    : t(`filterBar.editPart.${part}`);

function onCaretMove(stepBy: -1 | 1) {
  if (editor.moveCaret(stepBy)) armedId.value = null;
}

// The keyboard stays on the AND/OR it grouped from, which keeps its node inside the new group.
function onGroupAround(id: string) {
  const fromKeys = (document.activeElement as HTMLElement | null)?.dataset.join === id;
  editor.groupAround(id);
  if (!fromKeys) return;
  nextTick(() => {
    const join = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-test="${props.dataTest}-field"] [data-join]`),
    ).find((element) => element.dataset.join === id);
    if (join) join.focus();
    else focus();
  });
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

// A search function picked from the list waits for its field with the operator (and maybe value) set.
const draftField = computed(() => {
  if (newDraft.value?.field) return raw(newDraft.value.field);
  return newDraft.value?.operator === "match_all"
    ? t("filterBar.textField")
    : t("filterBar.chooseField");
});

// Like a finished free-text chip, a match_all draft names no operator.
const draftOperator = computed(() => {
  const op = newDraft.value?.operator;
  if (!op || op === "match_all") return undefined;
  return operatorName(op, dialect.value, t, config.value.operatorNames);
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
    :resting="resting"
    :placeholder="placeholderText"
    :aria-label="t('filterBar.ariaLabel')"
    :disabled="disabled"
    :size="size"
    :appearance="appearance"
    :max-rows="maxRows"
    :walk-chips="!vertical"
    :tab-switch="editParts.length > 1"
    :data-test="dataTest"
    @update:model-value="editor.onTextChange"
    @select="editor.select"
    @enter="editor.onEnter"
    @apply="editor.commitPending"
    @separator="editor.onSeparator"
    @backspace-empty="editor.onBackspace"
    @delete-empty="editor.onDelete"
    @caret-move="onCaretMove"
    @press="onPress"
    @escape="onEscape"
    @dismiss="dismiss"
    @close="close"
    @leave="close"
    @activate="onActivate"
    @highlight="highlightedKey = $event"
    @history="onHistory"
    @tab="onPartTab"
    @walk="onWalk"
    @type-at="onTypeAt"
    @engage="engaged = true"
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
                  tabindex="-1"
                  data-walk
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
                  v-if="newDraft?.field || newDraft?.operator"
                  ref="draftRef"
                  :field="draftField"
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
        :can-group-around="editor.canGroupAround"
        :data-test="dataTest"
        @edit="onEdit"
        @remove="onRemove"
        @toggle-connector="editor.toggleConnector"
        @toggle-negate="editor.toggleNegate"
        @ungroup="onUngroup"
        @group-around="onGroupAround"
        @add-condition="onAddCondition"
      >
        <template #caret>
          <span v-if="showPendingConnector && !connectorAfterDraft" class="inline-flex">
            <OTag
              clickable
              size="xs"
              shape="rounded"
              variant="default-soft"
              :label="raw(nextConnector)"
              :aria-label="t('filterBar.pendingConnectorHint')"
              :data-test="`${dataTest}-pending-connector`"
              tabindex="-1"
              data-walk
              @mousedown.prevent
              @click.stop="editor.togglePendingConnector"
            />
            <OTooltip :content="t('filterBar.pendingConnectorHint')" />
          </span>
          <OFilterToken
            v-if="newDraft?.field || newDraft?.operator"
            ref="draftRef"
            :field="draftField"
            :operator="draftOperator"
            :value="newDraft.values.length ? raw(newDraft.values.join(', ')) : undefined"
            :active-part="step"
            :editable="false"
            :data-test="`${dataTest}-draft`"
          />
          <component :is="caret" :grow="caretAtEnd" :shrink="!caretAtEnd" />
          <span v-if="showPendingConnector && connectorAfterDraft" class="inline-flex">
            <OTag
              clickable
              size="xs"
              shape="rounded"
              variant="default-soft"
              :label="raw(nextConnector)"
              :aria-label="t('filterBar.pendingConnectorHint')"
              :data-test="`${dataTest}-pending-connector`"
              tabindex="-1"
              data-walk
              @mousedown.prevent
              @click.stop="editor.togglePendingConnector"
            />
            <OTooltip :content="t('filterBar.pendingConnectorHint')" />
          </span>
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
        <component :is="caret" v-if="!caretLine" shrink />
      </div>
    </template>
    <template #trailing>
      <span v-if="showAddOrGroup" class="inline-flex">
        <OButton
          variant="ghost"
          size="xs"
          :data-test="`${dataTest}-add-group`"
          @mousedown.prevent
          @click.stop="onAddOrGroup"
          >{{ t("metrics.labelGroups.addGroup") }}</OButton
        >
        <OTooltip :content="t('metrics.labelGroups.addGroupTooltip')" />
      </span>
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
    <template v-if="editParts.length > 1" #header>
      <div class="border-select-content-border border-b px-1.5 py-1">
        <OToggleGroup
          :model-value="editPart ?? 'value'"
          type="single"
          :data-test="`${dataTest}-edit-parts`"
          @update:model-value="(part) => part && switchPart(part as FilterTokenPart)"
        >
          <OToggleGroupItem
            v-for="part in editParts"
            :key="part"
            :value="part"
            size="xs"
            :data-test="`${dataTest}-edit-part-${part}`"
            @mousedown.prevent
          >
            {{ partLabel(part) }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
    </template>
    <template v-if="multiStep || operatorHint" #footer>
      <div v-if="!multiStep" :data-test="`${dataTest}-operator-hint`">{{ operatorHint }}</div>
      <div v-else class="flex items-center gap-2">
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
