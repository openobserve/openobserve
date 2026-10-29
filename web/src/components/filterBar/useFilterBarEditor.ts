// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref, watch, type Ref } from "vue";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { ChipInputSuggestion } from "@/lib/forms/ChipInput/OChipInput.types";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import {
  countConditions,
  findNode,
  findParent,
  groupLevel,
  insertNode,
  makeCondition,
  newFilterId,
  OPERATORS,
  removeNode,
  replaceNode,
  canUngroupNode,
  setGroupConnector,
  ungroupNode,
  type FilterCondition,
  type FilterConnector,
  type FilterDialect,
  type FilterField,
  type FilterFieldType,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import { parseShorthand } from "@/utils/query/filterBarParser";
import { leafConditions } from "./codecs/types";
import { arityFor, type FilterEditorConfig } from "./filterProfiles";

export type FilterBarStep = "field" | "operator" | "value";

/** The operator as dashboards and alerts name it; PromQL keeps its own regex symbols, and a profile may keep its page's own names. */
export const operatorName = (
  id: FilterOperatorId,
  dialect: FilterDialect,
  t: TranslateFn,
  names?: FilterEditorConfig["operatorNames"],
): I18nText => {
  const op = OPERATORS[id];
  const own = names?.[id];
  if (own) return t(own);
  if (op.nameKey) return t(op.nameKey);
  return raw(dialect === "promql" && op.promqlSymbol ? op.promqlSymbol : op.symbol);
};

export interface FilterBarDraft {
  field: string;
  operator: FilterOperatorId | null;
  values: string[];
}

export interface FilterBarEditorOptions {
  tree: Ref<FilterGroup>;
  fields: Ref<FilterField[]>;
  config: Ref<FilterEditorConfig>;
  loadValues: Ref<((field: string, search: string) => Promise<string[]>) | undefined>;
  /** Values offered before the loaded ones for every field, e.g. dashboard `$variables`. */
  extraValues?: Ref<((field: string) => string[]) | undefined>;
  t: TranslateFn;
  commit: (next: FilterGroup) => void;
  submit: () => void;
}

const MAX_ROWS = 100;
const VALUE_DEBOUNCE_MS = 200;
const FREE_TEXT_KEY = "\u0000free-text";
const SHORTHAND_KEY = "\u0000shorthand";
const CUSTOM_KEY = "\u0000custom";
const CUSTOM_FIELD_KEY = "\u0000custom-field";
const GROUP_KEY = "\u0000group";
const PROMQL_LABEL_NAME = /^[A-Za-z_]\w*$/;
// Engine pages take dotted payload paths (a workflow's `meta.severity`), so SQL names allow what the shorthand parser does.
const SQL_FIELD_NAME = /^[A-Za-z_@][\w.@-]*$/;
const EXACT_VALUE_OPERATORS = new Set<FilterOperatorId>(["eq", "neq", "in", "not_in"]);

const TYPE_ICONS: Record<FilterFieldType, IconName> = {
  string: "text-fields",
  number: "tag",
  boolean: "toggle-off",
};

const rankByMatch = (names: string[], needle: string): string[] => {
  if (!needle) return names;
  const lower = needle.toLowerCase();
  const prefix: string[] = [];
  const inner: string[] = [];
  for (const name of names) {
    const index = name.toLowerCase().indexOf(lower);
    if (index === 0) prefix.push(name);
    else if (index > 0) inner.push(name);
  }
  return [...prefix, ...inner];
};

export function useFilterBarEditor(options: FilterBarEditorOptions) {
  const { tree, fields, config, t } = options;
  const dialect = computed<FilterDialect>(() => config.value.dialect);

  const text = ref("");
  const open = ref(false);
  const step = ref<FilterBarStep>("field");
  const draft = ref<FilterBarDraft | null>(null);
  const editingId = ref<string | null>(null);
  // The one part of an existing chip being changed; null while a whole condition is built.
  const editPart = ref<FilterBarStep | null>(null);
  const pendingConnector = ref<FilterConnector>("AND");
  // The caret sits in group `openGroupId` (the root when null), before node `caretBeforeId` (at the end when null).
  const openGroupId = ref<string | null>(null);
  const caretBeforeId = ref<string | null>(null);
  const armedId = ref<string | null>(null);
  const values = ref<string[]>([]);
  const valuesLoading = ref(false);
  // The value of a chip being edited, until the user types over it.
  const editedValue = ref<string | null>(null);

  const valueCache = new Map<string, string[]>();
  let valueTimer: ReturnType<typeof setTimeout> | undefined;
  let valueRequest = 0;

  const advanced = computed(() => config.value.connectors !== "and-only");
  const fieldMap = computed(() => new Map(fields.value.map((field) => [field.name, field])));
  const typeOf = (field: string): FilterFieldType => fieldMap.value.get(field)?.type ?? "string";
  const draftType = computed<FilterFieldType>(() => typeOf(draft.value?.field ?? ""));
  const arityOf = (id: FilterOperatorId) => arityFor(config.value, id);
  const multiValue = computed(() =>
    draft.value?.operator ? arityOf(draft.value.operator) === "many" : false,
  );
  const operatorIdsOf = (field: string): FilterOperatorId[] => {
    const own = fieldMap.value.get(field)?.operators;
    const byType = config.value.operators[typeOf(field)];
    return own ? byType.filter((id) => own.includes(id)) : byType;
  };
  const allows = (field: string, id: FilterOperatorId) => operatorIdsOf(field).includes(id);

  const groupIn = (base: FilterGroup): FilterGroup => {
    const group = openGroupId.value ? findNode(base, openGroupId.value) : undefined;
    return group?.kind === "group" ? group : base;
  };
  const indexIn = (group: FilterGroup): number => {
    const at = caretBeforeId.value
      ? group.items.findIndex((item) => item.id === caretBeforeId.value)
      : -1;
    return at < 0 ? group.items.length : at;
  };

  const targetGroup = computed<FilterGroup>(() => groupIn(tree.value));
  /** Where in the caret's group a new node lands. */
  const caretIndex = computed(() => indexIn(targetGroup.value));

  const maxConditions = computed(() => config.value.limits.maxConditions);
  const maxValues = computed(() => config.value.limits.maxValues);
  /** Adding another condition would pass the profile's limit. */
  const atConditionLimit = computed(
    () => maxConditions.value !== undefined && countConditions(tree.value) >= maxConditions.value,
  );
  const valuesAtLimit = computed(
    () =>
      multiValue.value &&
      maxValues.value !== undefined &&
      (draft.value?.values.length ?? 0) >= maxValues.value,
  );

  /** A new group may open inside `groupId` (the root when null) without passing the depth limit. */
  function canGroupIn(groupId: string | null): boolean {
    const max = config.value.maxDepth;
    if (max === null) return true;
    return groupLevel(tree.value, groupId ?? tree.value.id) < max;
  }

  const usedFields = computed(
    () => new Set(leafConditions(tree.value).map((node: FilterCondition) => node.field)),
  );

  // Per-group connectors: a group's AND/OR is set once its second item exists, and later items follow it.
  const groupConnector = (group: FilterGroup): FilterConnector | null =>
    config.value.connectors === "per-group" && group.items.length > 1
      ? group.items[1].connector
      : null;

  const nextConnector = computed<FilterConnector>(() => {
    if (!advanced.value) return "AND";
    return groupConnector(targetGroup.value) ?? pendingConnector.value;
  });

  function reset() {
    editedValue.value = null;
    text.value = "";
    step.value = "field";
    draft.value = null;
    editingId.value = null;
    editPart.value = null;
    armedId.value = null;
  }

  const editedNode = computed(() => {
    const node = editingId.value ? findNode(tree.value, editingId.value) : undefined;
    return node?.kind === "condition" ? node : undefined;
  });

  const fieldSuggestions = computed<ChipInputSuggestion[]>(() => {
    const needle = text.value.trim();
    const rows: ChipInputSuggestion[] = [];
    if (!editingId.value && atConditionLimit.value) return rows;
    const shorthand = parseShorthand(needle);
    if (shorthand && fieldMap.value.has(shorthand.field)) {
      rows.push({
        key: SHORTHAND_KEY,
        label: raw(
          `${shorthand.field} ${operatorName(shorthand.operator, dialect.value, t, config.value.operatorNames)} ${shorthand.value}`,
        ),
        detail: t("filterBar.addFilter"),
        icon: "filter-list",
      });
    }
    const editedField = editedNode.value?.field;
    const unique = config.value.limits.uniqueFields;
    const names = rankByMatch(
      fields.value
        .map((field) => field.name)
        .filter((name) => !unique || name === editedField || !usedFields.value.has(name)),
      needle,
    ).slice(0, MAX_ROWS);
    for (const name of names) {
      const type = fieldMap.value.get(name)!.type;
      rows.push({
        key: name,
        label: raw(fieldMap.value.get(name)!.label ?? name),
        detail: t(`filterBar.types.${type}`),
        icon: TYPE_ICONS[type],
        selected: editPart.value === "field" && editedNode.value?.field === name,
      });
    }
    if (
      needle &&
      config.value.allowCustomFields &&
      !fieldMap.value.has(needle) &&
      (dialect.value === "promql" ? PROMQL_LABEL_NAME : SQL_FIELD_NAME).test(needle)
    ) {
      rows.push({
        key: CUSTOM_FIELD_KEY,
        label: t(dialect.value === "promql" ? "filterBar.useLabel" : "filterBar.useField", {
          field: needle,
        }),
        icon: "add",
      });
    }
    if (needle && config.value.freeText && dialect.value === "sql" && !shorthand) {
      const row: ChipInputSuggestion = {
        key: FREE_TEXT_KEY,
        label: t("filterBar.searchText", { text: needle }),
        icon: "search",
      };
      if (names.length) rows.push(row);
      else rows.unshift(row);
    }
    if (!needle && !editingId.value && !draft.value && canGroupIn(openGroupId.value)) {
      rows.push({ key: GROUP_KEY, label: t("filterBar.startGroup"), icon: "data-object" });
    }
    return rows;
  });

  const operatorSuggestions = computed<ChipInputSuggestion[]>(() => {
    const needle = text.value.trim().toLowerCase();
    return operatorIdsOf(draft.value?.field ?? "")
      .map((id) => OPERATORS[id])
      .filter((op) => {
        if (!needle) return true;
        const name = operatorName(
          op.id,
          dialect.value,
          t,
          config.value.operatorNames,
        ).toLowerCase();
        return (
          name.startsWith(needle) ||
          op.symbol.toLowerCase().startsWith(needle) ||
          t(op.labelKey).toLowerCase().includes(needle)
        );
      })
      .map((op) => ({
        key: op.id,
        label: operatorName(op.id, dialect.value, t, config.value.operatorNames),
        detail: t(op.labelKey),
        selected: editPart.value === "operator" && editedNode.value?.operator === op.id,
      }));
  });

  const valueSuggestions = computed<ChipInputSuggestion[]>(() => {
    const needle = editedValue.value === null ? text.value.trim() : "";
    const extras = options.extraValues?.value?.(draft.value?.field ?? "") ?? [];
    const fetched = draftType.value === "boolean" ? ["true", "false"] : values.value;
    const loaded = [...extras, ...fetched.filter((value) => !extras.includes(value))];
    const chosen = new Set(draft.value?.values ?? []);
    // A picked value missing from the loaded list stays listed, so it can still be unticked.
    const typedPicks = multiValue.value ? [...chosen].filter((v) => !loaded.includes(v)) : [];
    const pinned = editedValue.value !== null ? [editedValue.value] : typedPicks;
    const source = [...pinned, ...loaded.filter((v) => !pinned.includes(v))];
    const ranked = rankByMatch(source, needle).slice(0, MAX_ROWS);
    const rows: ChipInputSuggestion[] = ranked.map((value) => ({
      key: value,
      label: raw(value === "" ? t("filterBar.emptyValue") : value),
      selected: multiValue.value && chosen.has(value),
    }));
    if (needle && !source.includes(needle)) {
      const row: ChipInputSuggestion = {
        key: CUSTOM_KEY,
        label: t("filterBar.useValue", { value: needle }),
        icon: "add",
      };
      // Typed text is a pattern or bound for other operators, so only exact text matches defer to a known value.
      const exact =
        draftType.value === "string" && EXACT_VALUE_OPERATORS.has(draft.value!.operator!);
      if (valuesAtLimit.value && !chosen.has(needle)) return rows;
      if (exact && rows.length) rows.push(row);
      else rows.unshift(row);
    }
    return rows;
  });

  const suggestions = computed(() => {
    if (step.value === "operator") return operatorSuggestions.value;
    if (step.value === "value") return valueSuggestions.value;
    return fieldSuggestions.value;
  });

  const autoHighlight = computed(() => {
    if (step.value === "field") return text.value.trim() !== "";
    if (step.value === "value" && multiValue.value) {
      return text.value.trim() !== "" || !draft.value?.values.length;
    }
    return true;
  });

  const fieldEmptyText = computed<I18nText | undefined>(() =>
    !editingId.value && atConditionLimit.value
      ? t(
          "filterBar.limits.conditions",
          { count: maxConditions.value ?? 0 },
          maxConditions.value ?? 0,
        )
      : undefined,
  );

  const searchPlaceholder = computed<I18nText>(() => {
    if (step.value === "operator") return t("filterBar.searchOperators");
    if (step.value === "value") {
      return multiValue.value ? t("filterBar.searchValues") : t("filterBar.searchValue");
    }
    return t(dialect.value === "promql" ? "filterBar.searchLabels" : "filterBar.searchFields");
  });

  async function fetchValues(field: string, search: string) {
    const loader = options.loadValues.value;
    if (!loader || draftType.value === "boolean") {
      values.value = [];
      return;
    }
    const cacheKey = `${field}\u0000${search}`;
    const cached = valueCache.get(cacheKey);
    if (cached) {
      values.value = cached;
      return;
    }
    const request = ++valueRequest;
    valuesLoading.value = true;
    try {
      const result = await loader(field, search);
      valueCache.set(cacheKey, result);
      if (request === valueRequest) values.value = result;
    } catch {
      if (request === valueRequest) values.value = [];
    } finally {
      if (request === valueRequest) valuesLoading.value = false;
    }
  }

  // A new loader reads another stream, so values cached from the old one no longer apply.
  watch(options.loadValues, () => valueCache.clear());

  // A typed needle is passed to the loader so high-cardinality fields search server side.
  watch([step, () => draft.value?.field, text], ([currentStep, field, typed]) => {
    if (currentStep !== "value" || !field) return;
    clearTimeout(valueTimer);
    const search = editedValue.value === null ? typed.trim() : "";
    valueTimer = setTimeout(() => fetchValues(field, search), search ? VALUE_DEBOUNCE_MS : 0);
  });

  function startDraft(field: string) {
    values.value = [];
    draft.value = { field, operator: null, values: [] };
    text.value = "";
    step.value = "operator";
  }

  function commitDraft() {
    const current = draft.value;
    if (!current?.operator) return;
    const filled = current.values;
    if (arityOf(current.operator) !== "none" && !filled.length) return;
    let next: FilterGroup;
    if (editingId.value) {
      const previous = findNode(tree.value, editingId.value);
      const edited = { field: current.field, operator: current.operator, values: filled };
      // The saved payload rides along, so the codec merges the edit onto it.
      let merged: FilterCondition | null = null;
      if (previous?.kind === "condition") {
        merged = { ...previous, ...edited };
        // An `IS TRUE` spelling only fits the field and `=` / `!=` it was typed with.
        if (previous.field !== current.field || previous.operator !== current.operator)
          delete merged.isSpelling;
      }
      next = merged
        ? replaceNode(tree.value, editingId.value, merged)
        : replaceNode(tree.value, editingId.value, {
            ...makeCondition(current.field, current.operator, filled),
            id: editingId.value,
          });
    } else {
      next = place(
        tree.value,
        makeCondition(current.field, current.operator, filled, nextConnector.value),
      );
    }
    const wasEditing = Boolean(editingId.value);
    pendingConnector.value = "AND";
    reset();
    options.commit(next);
    open.value = !wasEditing;
  }

  // A new condition keeps the chip's value when it still takes one.
  function changeOperator(id: FilterOperatorId) {
    const kept = draft.value!.values;
    const arity = arityOf(id);
    const values = arity === "none" ? [] : arity === "one" ? kept.slice(0, 1) : kept;
    draft.value = { ...draft.value!, operator: id, values };
    text.value = "";
    if (arity === "none" || values.length) return commitDraft();
    editPart.value = null;
    step.value = "value";
  }

  // A new field keeps the condition and value when the condition still fits its type.
  function changeField(field: string) {
    const current = draft.value!;
    if (current.operator && allows(field, current.operator)) {
      draft.value = { ...current, field };
      return commitDraft();
    }
    editPart.value = null;
    startDraft(field);
  }

  function pickOperator(id: FilterOperatorId) {
    if (!draft.value) return;
    if (editPart.value === "operator") return changeOperator(id);
    draft.value = { ...draft.value, operator: id, values: [] };
    text.value = "";
    if (arityOf(id) === "none") commitDraft();
    else step.value = "value";
  }

  function addValue(value: string) {
    if (!draft.value) return;
    if (!multiValue.value) {
      draft.value = { ...draft.value, values: [value] };
      commitDraft();
      return;
    }
    const chosen = draft.value.values;
    if (!chosen.includes(value) && valuesAtLimit.value) return;
    draft.value = {
      ...draft.value,
      values: chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value],
    };
    text.value = "";
  }

  function addShorthand() {
    const shorthand = parseShorthand(text.value.trim());
    if (!shorthand) return;
    const allowed = allows(shorthand.field, shorthand.operator);
    startDraft(shorthand.field);
    if (!allowed) return;
    draft.value = {
      field: shorthand.field,
      operator: shorthand.operator,
      values: [shorthand.value],
    };
    commitDraft();
  }

  function selectField(key: string) {
    if (key === GROUP_KEY) return startGroup();
    if (key === SHORTHAND_KEY) return addShorthand();
    if (key === FREE_TEXT_KEY) {
      draft.value = { field: "", operator: "match_all", values: [text.value.trim()] };
      return commitDraft();
    }
    const field = key === CUSTOM_FIELD_KEY ? text.value.trim() : key;
    if (editPart.value === "field" && draft.value) return changeField(field);
    startDraft(field);
  }

  function select(key: string) {
    armedId.value = null;
    if (step.value === "field") return selectField(key);
    if (step.value === "operator") return pickOperator(key as FilterOperatorId);
    addValue(key === CUSTOM_KEY ? text.value.trim() : key);
  }

  function onEnter() {
    if (step.value === "value") {
      if (text.value.trim()) return addValue(text.value.trim());
      if (multiValue.value && draft.value?.values.length) return commitDraft();
      return;
    }
    if (step.value === "field" && !text.value.trim() && !draft.value) {
      open.value = false;
      options.submit();
    }
  }

  function applyValues() {
    if (multiValue.value && draft.value?.values.length) commitDraft();
  }

  function onSeparator() {
    if (step.value === "value" && multiValue.value && text.value.trim())
      addValue(text.value.trim());
  }

  /** Puts `node` at the caret; at the front of a group the old first item takes the connector typed for the join. */
  function place(base: FilterGroup, node: FilterNode): FilterGroup {
    const group = groupIn(base);
    const index = indexIn(group);
    const first = group.items[0];
    if (index > 0 || !first) return insertNode(base, node, group.id, index);
    const moved =
      first.connector === node.connector
        ? base
        : replaceNode(base, first.id, { ...first, connector: node.connector });
    return insertNode(moved, { ...node, connector: first.connector }, group.id, 0);
  }

  /** Drops the empty group the caret leaves, and any parent that empties with it, but never `keepId`. */
  function dropAbandoned(base: FilterGroup, fromId: string, keepId: string): FilterGroup {
    let id: string | undefined = fromId;
    let next = base;
    while (id && id !== keepId && id !== next.id) {
      const group = findNode(next, id);
      if (group?.kind !== "group" || group.items.length) break;
      const parent = findParent(next, id);
      if (!parent) break;
      // Only this group goes; removeNode would also prune empty groups the user never touched.
      const items = parent.items.filter((item) => item.id !== id);
      next =
        parent.id === next.id
          ? { ...next, items }
          : replaceNode(next, parent.id, { ...parent, items });
      id = parent.id;
    }
    return next;
  }

  /** Moves the caret to group `groupId` before node `beforeId`; returns the tree without the group it abandoned. */
  function moveTo(base: FilterGroup, groupId: string, beforeId: string | null): FilterGroup {
    const from = openGroupId.value;
    const next = from && from !== groupId ? dropAbandoned(base, from, groupId) : base;
    openGroupId.value = groupId === base.id ? null : groupId;
    caretBeforeId.value = beforeId;
    armedId.value = null;
    pendingConnector.value = "AND";
    // Typed text belongs to where it was typed.
    text.value = "";
    return next;
  }

  function moveCaretTo(groupId: string | null, beforeId: string | null = null) {
    const next = moveTo(tree.value, groupId ?? tree.value.id, beforeId);
    if (next !== tree.value) options.commit(next);
  }

  /** Opens a new group at the caret (or at the end of `parentId`), so the next conditions land in it. */
  function startGroup(parentId?: string | null) {
    const parent = parentId === undefined ? openGroupId.value : parentId;
    if (!canGroupIn(parent) || atConditionLimit.value) return;
    let next = tree.value;
    if ((parent ?? next.id) !== (openGroupId.value ?? next.id)) {
      next = moveTo(next, parent ?? next.id, null);
    }
    const siblings = groupIn(next);
    const group: FilterNode = {
      kind: "group",
      id: newFilterId(),
      connector: advanced.value ? (groupConnector(siblings) ?? pendingConnector.value) : "AND",
      items: [],
    };
    next = place(next, group);
    pendingConnector.value = "AND";
    text.value = "";
    openGroupId.value = group.id;
    caretBeforeId.value = null;
    options.commit(next);
  }

  /** Steps out of the open group to just after it; an empty one is dropped. */
  function closeGroup() {
    const id = openGroupId.value;
    if (!id) return;
    const parent = findParent(tree.value, id);
    if (!parent) return moveCaretTo(null);
    const at = parent.items.findIndex((item) => item.id === id);
    moveCaretTo(parent.id, parent.items[at + 1]?.id ?? null);
  }

  /** Drops every open group that is still empty and puts the caret back at the end of the root. */
  function leaveGroups() {
    moveCaretTo(null);
  }

  /** Starts a new condition at the end of group `groupId` (the root when null). */
  function addIn(groupId: string | null) {
    reset();
    moveCaretTo(groupId && groupId !== tree.value.id ? groupId : null);
    values.value = [];
    open.value = true;
  }

  /** Starts a new condition right after node `id`, in the same group. */
  function addAfter(id: string) {
    const parent = findParent(tree.value, id);
    if (!parent) return;
    reset();
    const at = parent.items.findIndex((item) => item.id === id);
    moveCaretTo(parent.id, parent.items[at + 1]?.id ?? null);
    values.value = [];
    open.value = true;
  }

  /** Steps the caret one place left or right through the tree, entering and leaving groups. */
  function moveCaret(step: -1 | 1): boolean {
    if (draft.value || editingId.value) return false;
    const group = targetGroup.value;
    const index = caretIndex.value;
    const near = group.items[step > 0 ? index : index - 1];
    if (near?.kind === "group") {
      moveCaretTo(near.id, step > 0 ? (near.items[0]?.id ?? null) : null);
      return true;
    }
    if (near) {
      moveCaretTo(group.id, step > 0 ? (group.items[index + 1]?.id ?? null) : near.id);
      return true;
    }
    const parent = openGroupId.value ? findParent(tree.value, group.id) : undefined;
    if (!parent) return false;
    const at = parent.items.findIndex((item) => item.id === group.id);
    // An empty group is dropped on the way out, so the caret lands where it stood.
    const after = parent.items[at + 1]?.id ?? null;
    const before = group.items.length ? group.id : after;
    moveCaretTo(parent.id, step > 0 ? after : before);
    return true;
  }

  function toggleConnector(id: string) {
    const node = findNode(tree.value, id);
    if (!node) return;
    const next: FilterConnector = node.connector === "AND" ? "OR" : "AND";
    if (config.value.connectors === "per-group") {
      const parent = findParent(tree.value, id);
      if (parent) return options.commit(setGroupConnector(tree.value, parent.id, next));
    }
    options.commit(replaceNode(tree.value, id, { ...node, connector: next }));
  }

  function togglePendingConnector() {
    const next: FilterConnector = nextConnector.value === "AND" ? "OR" : "AND";
    if (groupConnector(targetGroup.value)) {
      return options.commit(setGroupConnector(tree.value, targetGroup.value.id, next));
    }
    pendingConnector.value = next;
  }

  // Advanced mode reads `(`, `)`, `and ` and `or ` as tokens the moment they are typed.
  function onTextChange(value: string) {
    text.value = value;
    editedValue.value = null;
    armedId.value = null;
    if (step.value !== "field" || !advanced.value) return;
    const typed = value.trimStart().toLowerCase();
    if (typed === "(" && canGroupIn(openGroupId.value)) {
      text.value = "";
      return startGroup();
    }
    if (typed === ")" && openGroupId.value) {
      text.value = "";
      return closeGroup();
    }
    const connector = /^(and|or)\s$/.exec(typed)?.[1];
    if (connector && targetGroup.value.items.length) {
      text.value = "";
      const chosen = connector.toUpperCase() as FilterConnector;
      if (groupConnector(targetGroup.value) && chosen !== nextConnector.value)
        togglePendingConnector();
      else pendingConnector.value = chosen;
    }
  }

  function backspaceDraft(): boolean {
    if (step.value === "value") {
      if (multiValue.value && draft.value?.values.length) {
        draft.value = { ...draft.value, values: draft.value.values.slice(0, -1) };
      } else {
        draft.value = { ...draft.value!, operator: null, values: [] };
        step.value = "operator";
      }
      return true;
    }
    if (step.value === "operator") {
      const field = draft.value?.field ?? "";
      const wasEditing = editingId.value;
      reset();
      if (!wasEditing) text.value = field;
      return true;
    }
    return false;
  }

  function onBackspace() {
    if (backspaceDraft()) return;
    if (pendingConnector.value === "OR") {
      pendingConnector.value = "AND";
      return;
    }
    const group = targetGroup.value;
    if (openGroupId.value && !group.items.length) return closeGroup();
    const previous = group.items[caretIndex.value - 1];
    if (!previous) return;
    // Like deleting a closing bracket, Backspace after a group steps into it.
    if (previous.kind === "group") return moveCaretTo(previous.id);
    if (armedId.value === previous.id) {
      armedId.value = null;
      options.commit(removeNode(tree.value, previous.id, openGroupId.value));
    } else armedId.value = previous.id;
  }

  function onDelete() {
    if (draft.value) return;
    const group = targetGroup.value;
    const index = caretIndex.value;
    const following = group.items[index];
    if (!following) return;
    if (following.kind === "group")
      return moveCaretTo(following.id, following.items[0]?.id ?? null);
    if (armedId.value === following.id) {
      armedId.value = null;
      caretBeforeId.value = group.items[index + 1]?.id ?? null;
      options.commit(removeNode(tree.value, following.id, openGroupId.value));
    } else armedId.value = following.id;
  }

  function onEscape() {
    if (draft.value) reset();
  }

  function editCondition(id: string, part: FilterBarStep) {
    const node = findNode(tree.value, id);
    if (node?.kind !== "condition") return;
    reset();
    editingId.value = id;
    values.value = [];
    open.value = true;
    if (node.operator === "match_all") {
      step.value = "field";
      text.value = node.values[0] ?? "";
      return;
    }
    const arity = arityOf(node.operator);
    const target: FilterBarStep = part === "value" && arity === "none" ? "operator" : part;
    editPart.value = target;
    step.value = target;
    if (target !== "value") {
      draft.value = {
        field: node.field,
        operator: target === "field" ? node.operator : null,
        values: [...node.values],
      };
      return;
    }
    draft.value = {
      field: node.field,
      operator: node.operator,
      values: arity === "many" ? [...node.values] : [],
    };
    if (arity === "one") {
      text.value = node.values[0] ?? "";
      editedValue.value = text.value;
    }
  }

  function removeCondition(id: string) {
    if (editingId.value === id) reset();
    if (caretBeforeId.value === id) {
      const parent = findParent(tree.value, id);
      const at = parent?.items.findIndex((item) => item.id === id) ?? -1;
      caretBeforeId.value = parent?.items[at + 1]?.id ?? null;
    }
    options.commit(removeNode(tree.value, id, openGroupId.value));
  }

  function setPendingConnector(connector: FilterConnector) {
    pendingConnector.value = connector;
  }

  const perGroup = computed(() => config.value.connectors === "per-group");

  /** Only offered where dropping the brackets leaves the filter meaning the same. */
  function canUngroup(id: string): boolean {
    return canUngroupNode(tree.value, id, perGroup.value);
  }

  function ungroup(id: string) {
    if (!canUngroup(id)) return;
    const parent = findParent(tree.value, id);
    const group = findNode(tree.value, id);
    const after = parent?.items[parent.items.findIndex((item) => item.id === id) + 1]?.id ?? null;
    // The lifted items keep their ids, so a caret inside or before the group stays where it was.
    if (openGroupId.value === id) {
      openGroupId.value = parent && parent.id !== tree.value.id ? parent.id : null;
      caretBeforeId.value ??= after;
    } else if (caretBeforeId.value === id && group?.kind === "group") {
      caretBeforeId.value = group.items[0]?.id ?? after;
    }
    let next = ungroupNode(tree.value, id);
    if (perGroup.value && parent && group?.kind === "group") {
      const own = groupConnector(group) ?? groupConnector(parent);
      if (own) next = setGroupConnector(next, parent.id, own);
    }
    options.commit(next);
  }

  return {
    text,
    open,
    step,
    draft,
    editingId,
    editPart,
    pendingConnector,
    openGroupId,
    caretBeforeId,
    caretIndex,
    armedId,
    advanced,
    multiValue,
    suggestions,
    autoHighlight,
    searchPlaceholder,
    valuesLoading,
    targetGroup,
    select,
    onEnter,
    onSeparator,
    applyValues,
    onTextChange,
    onBackspace,
    onDelete,
    onEscape,
    editCondition,
    removeCondition,
    startGroup,
    closeGroup,
    leaveGroups,
    addIn,
    addAfter,
    moveCaret,
    moveCaretTo,
    ungroup,
    canUngroup,
    canGroupIn,
    toggleConnector,
    togglePendingConnector,
    setPendingConnector,
    nextConnector,
    atConditionLimit,
    valuesAtLimit,
    fieldEmptyText,
    arityOf,
    reset,
  };
}
