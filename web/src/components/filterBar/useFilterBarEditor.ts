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
  appendNode,
  findNode,
  makeCondition,
  newFilterId,
  OPERATORS,
  operatorsFor,
  removeNode,
  replaceNode,
  type FilterConnector,
  type FilterDialect,
  type FilterField,
  type FilterFieldType,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import { parseShorthand } from "@/utils/query/filterBarParser";

export type FilterBarStep = "field" | "operator" | "value";
export type FilterBarMode = "basic" | "advanced";

export interface FilterBarDraft {
  field: string;
  operator: FilterOperatorId | null;
  values: string[];
}

export interface FilterBarEditorOptions {
  tree: Ref<FilterGroup>;
  fields: Ref<FilterField[]>;
  dialect: Ref<FilterDialect>;
  mode: Ref<FilterBarMode>;
  freeText: Ref<boolean>;
  allowCustomFields: Ref<boolean>;
  loadValues: Ref<((field: string, search: string) => Promise<string[]>) | undefined>;
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
  const { tree, fields, dialect, mode, t } = options;

  const text = ref("");
  const open = ref(false);
  const step = ref<FilterBarStep>("field");
  const draft = ref<FilterBarDraft | null>(null);
  const editingId = ref<string | null>(null);
  const pendingConnector = ref<FilterConnector>("AND");
  const openGroupId = ref<string | null>(null);
  const armedId = ref<string | null>(null);
  const values = ref<string[]>([]);
  const valuesLoading = ref(false);

  const valueCache = new Map<string, string[]>();
  let valueTimer: ReturnType<typeof setTimeout> | undefined;
  let valueRequest = 0;

  const advanced = computed(() => mode.value === "advanced" && dialect.value === "sql");
  const fieldMap = computed(() => new Map(fields.value.map((field) => [field.name, field])));
  const draftType = computed<FilterFieldType>(
    () => fieldMap.value.get(draft.value?.field ?? "")?.type ?? "string",
  );
  const draftOperator = computed(() =>
    draft.value?.operator ? OPERATORS[draft.value.operator] : null,
  );
  const multiValue = computed(() => draftOperator.value?.arity === "many");

  const targetGroup = computed<FilterGroup>(() => {
    const group = openGroupId.value ? findNode(tree.value, openGroupId.value) : undefined;
    return group?.kind === "group" ? group : tree.value;
  });

  function reset() {
    text.value = "";
    step.value = "field";
    draft.value = null;
    editingId.value = null;
    armedId.value = null;
  }

  const fieldSuggestions = computed<ChipInputSuggestion[]>(() => {
    const needle = text.value.trim();
    const rows: ChipInputSuggestion[] = [];
    const shorthand = parseShorthand(needle);
    if (shorthand && fieldMap.value.has(shorthand.field)) {
      rows.push({
        key: SHORTHAND_KEY,
        label: raw(`${shorthand.field} ${OPERATORS[shorthand.operator].symbol} ${shorthand.value}`),
        detail: t("filterBar.addFilter"),
        icon: "filter-list",
      });
    }
    const names = rankByMatch(
      fields.value.map((field) => field.name),
      needle,
    ).slice(0, MAX_ROWS);
    for (const name of names) {
      const type = fieldMap.value.get(name)!.type;
      rows.push({
        key: name,
        label: raw(name),
        detail: t(`filterBar.types.${type}`),
        icon: TYPE_ICONS[type],
      });
    }
    if (
      needle &&
      options.allowCustomFields.value &&
      !fieldMap.value.has(needle) &&
      /^[A-Za-z_]\w*$/.test(needle)
    ) {
      rows.push({
        key: CUSTOM_FIELD_KEY,
        label: t(dialect.value === "promql" ? "filterBar.useLabel" : "filterBar.useField", {
          field: needle,
        }),
        icon: "add",
      });
    }
    if (needle && options.freeText.value && dialect.value === "sql" && !shorthand) {
      const row: ChipInputSuggestion = {
        key: FREE_TEXT_KEY,
        label: t("filterBar.searchText", { text: needle }),
        icon: "search",
      };
      if (names.length) rows.push(row);
      else rows.unshift(row);
    }
    return rows;
  });

  const operatorSuggestions = computed<ChipInputSuggestion[]>(() => {
    const needle = text.value.trim().toLowerCase();
    return operatorsFor(draftType.value, dialect.value)
      .filter((op) => {
        if (!needle) return true;
        return (
          op.symbol.toLowerCase().startsWith(needle) ||
          t(op.labelKey).toLowerCase().includes(needle)
        );
      })
      .map((op) => {
        const label = t(op.labelKey);
        // Word operators read the same as their label, so only symbols earn the detail column.
        return {
          key: op.id,
          label,
          detail: /^[a-z ]+$/.test(op.symbol) ? undefined : raw(op.symbol),
        };
      });
  });

  const valueSuggestions = computed<ChipInputSuggestion[]>(() => {
    const needle = text.value.trim();
    const source = draftType.value === "boolean" ? ["true", "false"] : values.value;
    const chosen = new Set(draft.value?.values ?? []);
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

  const header = computed<I18nText>(() => {
    if (step.value === "operator")
      return t("filterBar.pickOperator", { field: draft.value!.field });
    if (step.value === "value") {
      return multiValue.value ? t("filterBar.pickValues") : t("filterBar.pickValue");
    }
    return t(dialect.value === "promql" ? "filterBar.pickLabel" : "filterBar.pickField");
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

  // A typed needle is passed to the loader so high-cardinality fields search server side.
  watch([step, () => draft.value?.field, text], ([currentStep, field, typed]) => {
    if (currentStep !== "value" || !field) return;
    clearTimeout(valueTimer);
    const search = typed.trim();
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
    if (OPERATORS[current.operator].arity !== "none" && !filled.length) return;
    let next: FilterGroup;
    if (editingId.value) {
      const previous = findNode(tree.value, editingId.value);
      const connector = previous?.connector ?? "AND";
      const condition = makeCondition(current.field, current.operator, filled, connector);
      next = replaceNode(tree.value, editingId.value, { ...condition, id: editingId.value });
    } else {
      const connector = advanced.value ? pendingConnector.value : "AND";
      next = appendNode(
        tree.value,
        makeCondition(current.field, current.operator, filled, connector),
        openGroupId.value,
      );
    }
    pendingConnector.value = "AND";
    reset();
    options.commit(next);
    open.value = true;
  }

  function pickOperator(id: FilterOperatorId) {
    if (!draft.value) return;
    draft.value = { ...draft.value, operator: id, values: [] };
    text.value = "";
    if (OPERATORS[id].arity === "none") commitDraft();
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
    draft.value = {
      ...draft.value,
      values: chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value],
    };
    text.value = "";
  }

  function addShorthand() {
    const shorthand = parseShorthand(text.value.trim());
    if (!shorthand) return;
    const allowed = operatorsFor(
      fieldMap.value.get(shorthand.field)?.type ?? "string",
      dialect.value,
    ).some((op) => op.id === shorthand.operator);
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
    if (key === SHORTHAND_KEY) return addShorthand();
    if (key === FREE_TEXT_KEY) {
      draft.value = { field: "", operator: "match_all", values: [text.value.trim()] };
      return commitDraft();
    }
    startDraft(key === CUSTOM_FIELD_KEY ? text.value.trim() : key);
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

  function onSeparator() {
    if (step.value === "value" && multiValue.value && text.value.trim())
      addValue(text.value.trim());
  }

  function startGroup() {
    const group: FilterNode = {
      kind: "group",
      id: newFilterId(),
      connector: pendingConnector.value,
      items: [],
    };
    pendingConnector.value = "AND";
    openGroupId.value = group.id;
    options.commit(appendNode(tree.value, group));
  }

  function closeGroup() {
    const id = openGroupId.value;
    openGroupId.value = null;
    const group = id ? findNode(tree.value, id) : undefined;
    if (group?.kind === "group" && !group.items.length)
      options.commit(removeNode(tree.value, group.id));
  }

  // Advanced mode reads `(`, `)`, `and ` and `or ` as tokens the moment they are typed.
  function onTextChange(value: string) {
    text.value = value;
    armedId.value = null;
    if (step.value !== "field" || !advanced.value) return;
    const typed = value.trimStart().toLowerCase();
    if (typed === "(" && !openGroupId.value) {
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
      pendingConnector.value = connector.toUpperCase() as FilterConnector;
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
    const last = group.items[group.items.length - 1];
    if (!last) return;
    if (armedId.value === last.id) {
      armedId.value = null;
      options.commit(removeNode(tree.value, last.id, openGroupId.value));
    } else armedId.value = last.id;
  }

  function onEscape() {
    if (draft.value) reset();
  }

  function editCondition(id: string) {
    const node = findNode(tree.value, id);
    if (node?.kind !== "condition") return;
    editingId.value = id;
    armedId.value = null;
    if (node.operator === "match_all") {
      draft.value = null;
      step.value = "field";
      text.value = node.values[0] ?? "";
      options.commit(removeNode(tree.value, id, openGroupId.value));
      editingId.value = null;
      open.value = true;
      return;
    }
    const arity = OPERATORS[node.operator].arity;
    values.value = [];
    draft.value = {
      field: node.field,
      operator: arity === "none" ? null : node.operator,
      values: arity === "many" ? [...node.values] : [],
    };
    text.value = arity === "one" ? (node.values[0] ?? "") : "";
    step.value = arity === "none" ? "operator" : "value";
    open.value = true;
  }

  function removeCondition(id: string) {
    if (editingId.value === id) reset();
    options.commit(removeNode(tree.value, id, openGroupId.value));
  }

  function setPendingConnector(connector: FilterConnector) {
    pendingConnector.value = connector;
  }

  return {
    text,
    open,
    step,
    draft,
    editingId,
    pendingConnector,
    openGroupId,
    armedId,
    advanced,
    multiValue,
    suggestions,
    autoHighlight,
    header,
    valuesLoading,
    targetGroup,
    select,
    onEnter,
    onSeparator,
    onTextChange,
    onBackspace,
    onEscape,
    editCondition,
    removeCondition,
    startGroup,
    closeGroup,
    setPendingConnector,
    reset,
  };
}
