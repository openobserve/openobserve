// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  getReferencedVariableNames,
  normalizeVariableSyntax,
  processVariableContent,
  replaceVariablePlaceholders,
} from "@/utils/dashboard/variables/variablesUtils";

export const REPEAT_ID_SEPARATOR = "__r__";
export const REPEAT_MAX_ITEMS = 50;
export const REPEAT_DEFAULT_MAX_PER_ROW = 4;
export const REPEAT_MAX_PER_ROW_OPTIONS = [2, 3, 4, 6, 8, 12] as const;
export const DASHBOARD_GRID_COLUMNS = 192;
export const DEFAULT_VARIABLE_OPTIONS_LIMIT = 10;
export const REPEAT_ALL_FETCH_SIZE = 5000;

const REPEATABLE_VARIABLE_TYPES = ["query_values", "custom"];
const DEFAULT_LAYOUT = { x: 0, y: 0, w: 96, h: 18 };

export type RepeatDirection = "h" | "v";

/** Saved on a panel or tab; only the source is ever persisted. */
export interface RepeatConfig {
  variable: string;
  direction?: RepeatDirection;
  maxPerRow?: number;
}

export interface RepeatValues {
  values: string[];
  total: number;
  /** True when "All" may cover more values than are known, so `total` is a lower bound. */
  more?: boolean;
  /** True while the values "All" stands for are still loading. */
  pending?: boolean;
}

/** Where "All" gets its values: the live options and, when fetched, the field's real values. */
export interface RepeatValueSources {
  options?: any[];
  allValues?: string[] | null;
  allPending?: boolean;
}

export interface GridLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RepeatMeta {
  sourceId: string;
  variable: string;
  value: string;
  index: number;
  count: number;
  total: number;
  more?: boolean;
}

export interface EmptyRepeat {
  variable: string;
  pending: boolean;
}

export interface ExpandedPanel<P> {
  id: string;
  panel: P;
  layout: GridLayout;
  repeat?: RepeatMeta;
  /** A repeated panel with no values renders this instead of unfiltered data. */
  emptyRepeat?: EmptyRepeat;
}

interface RepeatablePanel {
  id: string;
  layout?: Partial<GridLayout> | null;
  repeat?: RepeatConfig | null;
}

export const getRepeatId = (sourceId: string, value: string): string =>
  `${sourceId}${REPEAT_ID_SEPARATOR}${value}`;

export const parseRepeatId = (id: string): { sourceId: string; value: string } | null => {
  if (typeof id !== "string") return null;
  const index = id.indexOf(REPEAT_ID_SEPARATOR);
  if (index <= 0) return null;
  return { sourceId: id.slice(0, index), value: id.slice(index + REPEAT_ID_SEPARATOR.length) };
};

export const getRepeatSourceId = (id: string): string => parseRepeatId(id)?.sourceId ?? id;

/** Panel-scoped variables cannot repeat: their value lives on the panel being repeated. */
export const isRepeatableVariable = (variable: any): boolean =>
  !!variable &&
  variable.multiSelect === true &&
  REPEATABLE_VARIABLE_TYPES.includes(variable.type) &&
  variable.scope !== "panels";

export const getRepeatableVariables = (variables: any[] | undefined): any[] => {
  const seen = new Set<string>();
  return (variables ?? []).filter((variable) => {
    if (!isRepeatableVariable(variable) || seen.has(variable.name)) return false;
    seen.add(variable.name);
    return true;
  });
};

/** Tab scope wins over global, matching the merge order global → tab → panel. */
export const findRepeatVariable = (variables: any[] | undefined, name: string): any => {
  if (!name) return undefined;
  const candidates = (variables ?? []).filter((v) => v?.name === name && v.scope !== "panels");
  return candidates[candidates.length - 1];
};

const isRealValue = (value: any) =>
  value !== undefined && value !== null && value !== "" && value !== SELECT_ALL_VALUE;

const optionValues = (variable: any, options: any[] = variable?.options ?? []): string[] =>
  options
    .map((option: any) => option?.value)
    .filter(isRealValue)
    .map(String);

export const isAllSelected = (variable: any): boolean => {
  const raw = variable?.value;
  return Array.isArray(raw) ? raw.includes(SELECT_ALL_VALUE) : raw === SELECT_ALL_VALUE;
};

/** The options of a query_values variable stop at its max record size, while "All" queries every value. */
export const areOptionsTruncated = (variable: any, options?: any[]): boolean => {
  if (variable?.type !== "query_values") return false;
  const limit = Number(variable.query_data?.max_record_size) || DEFAULT_VARIABLE_OPTIONS_LIMIT;
  return optionValues(variable, options).length >= limit;
};

/** "All" on an unfiltered query_values variable is resolved from the field's values, not its capped options. */
export const needsAllValuesFetch = (variable: any): boolean =>
  isRepeatableVariable(variable) &&
  variable.type === "query_values" &&
  isAllSelected(variable) &&
  !!variable.query_data?.stream &&
  !!variable.query_data?.field &&
  !(variable.query_data?.filter?.length > 0);

const isStillLoading = (variable: any): boolean =>
  variable?.type === "query_values" &&
  variable.isVariablePartialLoaded === false &&
  (variable.isLoading === true || variable.isVariableLoadingPending === true);

const PENDING: RepeatValues = { values: [], total: 0, pending: true };

const resolveAllValues = (variable: any, sources: RepeatValueSources) => {
  if (sources.allValues) {
    const values = [...new Set(sources.allValues.filter(isRealValue).map(String))];
    return { values, more: values.length >= REPEAT_ALL_FETCH_SIZE };
  }
  if (sources.allPending) return null;
  const options = sources.options ?? variable.options;
  const values = [...new Set(optionValues(variable, options))];
  if (!values.length && isStillLoading(variable)) return null;
  return { values, more: areOptionsTruncated(variable, options) };
};

/**
 * Selected values of a repeat variable, capped; empty values never become copies. "All" expands
 * to the field's fetched values when known, otherwise to the variable's options.
 */
export const resolveRepeatValues = (
  variable: any,
  cap: number = REPEAT_MAX_ITEMS,
  sources: RepeatValueSources = {},
): RepeatValues | null => {
  if (!isRepeatableVariable(variable)) return null;
  if (isAllSelected(variable)) {
    const all = resolveAllValues(variable, sources);
    if (!all) return PENDING;
    return {
      values: all.values.slice(0, cap),
      total: all.values.length,
      ...(all.more ? { more: true } : {}),
    };
  }
  if (isStillLoading(variable)) return PENDING;
  const raw = variable.value;
  const selected: any[] = Array.isArray(raw) ? raw : [raw];
  const values = [...new Set(selected.filter(isRealValue).map(String))];
  return { values: values.slice(0, cap), total: values.length };
};

/** Pins the repeat variable to one value so a copy's queries see only that value. */
export const pinRepeatValue = (variables: any[] | undefined, name: string, value: string): any[] =>
  (variables ?? []).map((variable) =>
    variable?.name === name && variable.scope !== "panels"
      ? { ...variable, value: Array.isArray(variable.value) ? [value] : value }
      : variable,
  );

const isNoValue = (value: any) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

// Titles show readable words; the query placeholder for "all" or "nothing" is internal.
const withReadableValues = (variablesData: any, allLabel: string, noneLabel: string) => {
  if (!variablesData?.values) return variablesData;
  return {
    ...variablesData,
    values: variablesData.values.map((variable: any) => {
      const value = variable?.value;
      if (variable?.type === "dynamic_filters") return variable;
      const isAll = Array.isArray(value)
        ? value.includes(SELECT_ALL_VALUE)
        : value === SELECT_ALL_VALUE;
      if (isAll) return { ...variable, value: allLabel };
      return isNoValue(value) ? { ...variable, value: noneLabel } : variable;
    }),
  };
};

export interface RepeatTitleParts {
  /** Text before the repeat value; truncates first. */
  title: string;
  /** The repeat value, kept visible; empty for a panel that does not repeat. */
  value: string;
  /** Text after the value when the title names the variable. */
  rest: string;
  /** True when the value is appended because the title does not name the variable. */
  dash: boolean;
  /** True when the title text ends in a space before the value. */
  spaced: boolean;
}

const VALUE_MARK = "\u0000";

/** Resolves $var / ${var} in a title and splits out the repeat value so it can stay visible. */
export const splitRepeatTitle = (
  title: string | undefined,
  variablesData: any,
  repeat?: { variable: string; value: string } | null,
  allLabel = "All",
  noneLabel = "(none)",
): RepeatTitleParts => {
  const text = title ?? "";
  const readable = withReadableValues(variablesData, allLabel, noneLabel);
  const substitute = (part: string) => (part ? processVariableContent(part, readable) : part);
  const whole = (value: string) => ({
    title: value,
    value: "",
    rest: "",
    dash: false,
    spaced: false,
  });
  if (!repeat) return whole(substitute(text));
  const names = (variablesData?.values ?? []).map((variable: any) => variable?.name);
  const referenced = getReferencedVariableNames([text], [...names, repeat.variable]);
  if (referenced.has(repeat.variable)) {
    const marked = replaceVariablePlaceholders(
      normalizeVariableSyntax(text),
      [repeat.variable],
      () => VALUE_MARK,
    );
    const at = marked.indexOf(VALUE_MARK);
    const before = substitute(marked.slice(0, at));
    const rest = marked
      .slice(at + 1)
      .split(VALUE_MARK)
      .join(repeat.value);
    return {
      title: before.trimEnd(),
      value: repeat.value,
      rest: substitute(rest),
      dash: false,
      spaced: /\s$/.test(before),
    };
  }
  const substituted = substitute(text);
  if (!substituted) return whole(repeat.value);
  return { title: substituted, value: repeat.value, rest: "", dash: true, spaced: true };
};

/** A saved name with its variables shown as placeholders, e.g. "Status: <status>". */
export const readableTemplate = (text: string | undefined): string =>
  normalizeVariableSyntax(text ?? "").replace(
    /\{\{([\w-]+)(?::\w+)?\}\}|\$\{([\w-]+)(?::\w+)?\}|\$([\w-]+)/g,
    (_, mustache, braced, bare) => `<${mustache ?? braced ?? bare}>`,
  );

/** Splits a value so its start can be cut while its distinguishing end stays visible. */
export const splitForMiddleEllipsis = (value: string, tailLength = 8) =>
  value.length > tailLength * 2
    ? { head: value.slice(0, -tailLength), tail: value.slice(-tailLength) }
    : { head: value, tail: "" };

export const formatRepeatTitle = (
  title: string | undefined,
  variablesData: any,
  repeat?: { variable: string; value: string } | null,
  allLabel = "All",
  noneLabel = "(none)",
): string => {
  const parts = splitRepeatTitle(title, variablesData, repeat, allLabel, noneLabel);
  if (!parts.value) return parts.title;
  if (parts.dash) return `${parts.title} — ${parts.value}`;
  return `${parts.title}${parts.spaced ? " " : ""}${parts.value}${parts.rest}`;
};

const normalizeMaxPerRow = (maxPerRow: number | undefined): number =>
  maxPerRow && maxPerRow > 0 ? Math.floor(maxPerRow) : REPEAT_DEFAULT_MAX_PER_ROW;

const readLayout = (panel: RepeatablePanel): GridLayout => ({
  x: panel.layout?.x || DEFAULT_LAYOUT.x,
  y: panel.layout?.y || DEFAULT_LAYOUT.y,
  w: panel.layout?.w || DEFAULT_LAYOUT.w,
  h: panel.layout?.h || DEFAULT_LAYOUT.h,
});

/** Grid positions for `count` copies starting at the source's slot. */
export const layoutRepeatCopies = (
  source: GridLayout,
  count: number,
  direction: RepeatDirection = "h",
  maxPerRow?: number,
  columns: number = DASHBOARD_GRID_COLUMNS,
): GridLayout[] => {
  if (count <= 0) return [];
  if (direction === "v") {
    return Array.from({ length: count }, (_, i) => ({
      x: source.x,
      y: source.y + i * source.h,
      w: source.w,
      h: source.h,
    }));
  }
  const perRow = Math.min(count, normalizeMaxPerRow(maxPerRow));
  const width = Math.floor(columns / perRow);
  return Array.from({ length: count }, (_, i) => ({
    x: (i % perRow) * width,
    y: source.y + Math.floor(i / perRow) * source.h,
    w: width,
    h: source.h,
  }));
};

const overlapsColumns = (a: GridLayout, b: GridLayout): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w;

const restingY = (placed: GridLayout[], layout: GridLayout): number =>
  Math.max(0, ...placed.filter((p) => overlapsColumns(p, layout)).map((p) => p.y + p.h));

/** One grid unit to pack: a plain panel, or a repeat block whose copies move together. */
interface LayoutItem<P> {
  entries: ExpandedPanel<P>[];
  origin: GridLayout;
}

const blockItem = <P extends RepeatablePanel>(
  panel: P,
  base: GridLayout,
  config: RepeatConfig,
  resolved: RepeatValues,
): LayoutItem<P> => {
  const { values, total, more } = resolved;
  const layouts = layoutRepeatCopies(base, values.length, config.direction, config.maxPerRow);
  const entries = values.map((value, index) => ({
    id: getRepeatId(panel.id, value),
    panel,
    layout: layouts[index],
    repeat: {
      sourceId: panel.id,
      variable: config.variable,
      value,
      index,
      count: values.length,
      total,
      ...(more ? { more } : {}),
    },
  }));
  return { entries, origin: base };
};

const panelItem = <P extends RepeatablePanel>(
  panel: P,
  base: GridLayout,
  resolved: RepeatValues | null | undefined,
): LayoutItem<P> => {
  const entry: ExpandedPanel<P> = { id: panel.id, panel, layout: base };
  if (resolved && panel.repeat) {
    entry.emptyRepeat = { variable: panel.repeat.variable, pending: !!resolved.pending };
  }
  return { entries: [entry], origin: base };
};

const byOrigin = (a: LayoutItem<unknown>, b: LayoutItem<unknown>) =>
  a.origin.y - b.origin.y || a.origin.x - b.origin.x;

/** Floats a unit up as far as its columns allow, like GridStack's float:false; a block keeps its shape. */
const settleItem = <P>(placed: GridLayout[], item: LayoutItem<P>) => {
  const top = Math.max(
    ...item.entries.map((e) => restingY(placed, e.layout) - (e.layout.y - item.origin.y)),
  );
  item.entries.forEach((entry) => {
    entry.layout = { ...entry.layout, y: top + (entry.layout.y - item.origin.y) };
  });
  placed.push(...item.entries.map((entry) => entry.layout));
};

/**
 * Expands repeated panels into virtual copies for view mode, then packs the grid in saved (y, x)
 * order so nothing overlaps and no gap is left; layouts are derived, never saved.
 */
export const expandRepeats = <P extends RepeatablePanel>(
  panels: P[],
  resolve: (panel: P) => RepeatValues | null,
): ExpandedPanel<P>[] => {
  const items = panels.map((panel) => {
    const base = readLayout(panel);
    const resolved = panel?.repeat?.variable ? resolve(panel) : undefined;
    return panel.repeat && resolved?.values.length
      ? blockItem(panel, base, panel.repeat, resolved)
      : panelItem(panel, base, resolved);
  });
  const entries = items.flatMap((item) => item.entries);
  if (!entries.some((entry) => entry.repeat)) return entries;

  const placed: GridLayout[] = [];
  [...items].sort(byOrigin).forEach((item) => settleItem(placed, item));
  return entries;
};

interface RepeatableTab {
  tabId: string;
  repeat?: RepeatConfig | null;
}

export interface ExpandedTab<T> {
  tabId: string;
  tab: T;
  repeat?: RepeatMeta;
  emptyRepeat?: EmptyRepeat;
}

/** Replaces each repeated tab with one virtual tab per value, in place; zero values keep the source as an empty state. */
export const expandRepeatTabs = <T extends RepeatableTab>(
  tabs: T[],
  resolve: (tab: T) => RepeatValues | null,
): ExpandedTab<T>[] =>
  tabs.flatMap((tab): ExpandedTab<T>[] => {
    const config = tab?.repeat;
    const resolved = config?.variable ? resolve(tab) : null;
    if (!config || !resolved) return [{ tabId: tab.tabId, tab }];
    if (!resolved.values.length) {
      return [
        {
          tabId: tab.tabId,
          tab,
          emptyRepeat: { variable: config.variable, pending: !!resolved.pending },
        },
      ];
    }
    const { values, total, more } = resolved;
    return values.map((value, index) => ({
      tabId: getRepeatId(tab.tabId, value),
      tab,
      repeat: {
        sourceId: tab.tabId,
        variable: config.variable,
        value,
        index,
        count: values.length,
        total,
        ...(more ? { more } : {}),
      },
    }));
  });

/**
 * The tab to show for a requested id: itself when rendered, else the first copy of its source
 * tab, else the first tab. While the source's values load the request is kept as is.
 */
export const resolveSelectedTab = <T extends RepeatableTab>(
  requested: string | null | undefined,
  expanded: ExpandedTab<T>[],
): string | null => {
  if (!expanded.length) return requested ?? null;
  if (requested && expanded.some((entry) => entry.tabId === requested)) return requested;
  const sourceId = requested ? getRepeatSourceId(requested) : null;
  const group = expanded.filter((entry) => entry.tab.tabId === sourceId);
  const sourcePending = group.some((entry) => entry.emptyRepeat?.pending);
  if (requested && sourcePending && requested !== sourceId) return requested;
  return group[0]?.tabId ?? expanded[0].tabId;
};
