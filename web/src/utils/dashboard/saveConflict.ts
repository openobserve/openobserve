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

export type ConflictItemKind = "panel" | "tab" | "variable";
export type ConflictChangeType = "added" | "changed" | "removed";
export type DashboardSettingKey =
  "title" | "description" | "defaultDatetimeDuration" | "showDynamicFilters" | "other";

export interface ConflictChange {
  kind: ConflictItemKind;
  change: ConflictChangeType;
  key: string;
  name: string;
  /** Set on a change when the name itself changed (a rename). */
  previousName?: string;
}

export interface DashboardDiff {
  changes: ConflictChange[];
  changedSettings: DashboardSettingKey[];
}

export interface PanelComparison {
  theirsRemoved: boolean;
  theirsTitle: string;
  mineTitle: string;
  sameTitle: boolean;
  sameOtherFields: boolean;
}

export type ConflictCounts = Record<ConflictItemKind, Record<ConflictChangeType, number>>;

interface PanelLocation {
  panel: any;
  tabId: string;
  index: number;
}

const GRID_COLUMNS = 192;

// Server-managed fields that are not settings a person edits.
const NON_SETTING_FIELDS = new Set([
  "tabs",
  "variables",
  "dashboardId",
  "owner",
  "created",
  "role",
  "version",
  "hash",
  "updatedAt",
]);

const KNOWN_SETTINGS: DashboardSettingKey[] = ["title", "description", "defaultDatetimeDuration"];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const isBlank = (value: unknown) => value === null || value === undefined;

// Null and missing are the same to the dashboard; editors and the server differ on which they write.
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as object)
      .filter((key) => !isBlank((value as Record<string, unknown>)[key]))
      .sort()
      .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
  );
};

// Key order differs between server JSON and editor state, so compare canonically.
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

const isEmptyValue = (value: unknown) =>
  isBlank(value) ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);

// The editor fills in defaults the saved panel never had, so only fields both sides set are compared.
const sameWhereBothSet = (a: unknown, b: unknown): boolean => {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameWhereBothSet(item, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return Object.keys(left)
      .filter((key) => !isEmptyValue(left[key]) && !isEmptyValue(right[key]))
      .every((key) => sameWhereBothSet(left[key], right[key]));
  }
  return a === b;
};

// A relative range only means its period; the start/end a picker writes alongside it go stale at once.
const timeRangeShape = (range: any) => {
  const type = range?.type ?? "relative";
  return type === "relative"
    ? { type, period: range?.relativeTimePeriod ?? null }
    : { type, start: range?.startTime ?? null, end: range?.endTime ?? null };
};

const settingValue = (doc: any, key: string) =>
  key === "defaultDatetimeDuration" ? timeRangeShape(doc?.[key]) : (doc?.[key] ?? null);

const tabsOf = (doc: any): any[] => (Array.isArray(doc?.tabs) ? doc.tabs : []);

const variablesOf = (doc: any): any[] =>
  Array.isArray(doc?.variables?.list) ? doc.variables.list : [];

const panelsById = (doc: any): Map<string, PanelLocation> => {
  const out = new Map<string, PanelLocation>();
  for (const tab of tabsOf(doc)) {
    (tab?.panels ?? []).forEach((panel: any, index: number) => {
      if (panel?.id != null) out.set(String(panel.id), { panel, tabId: tab.tabId, index });
    });
  }
  return out;
};

const tabsById = (doc: any): Map<string, any> =>
  new Map(tabsOf(doc).map((tab: any) => [String(tab.tabId), tab]));

const variablesByName = (doc: any): Map<string, any> =>
  new Map(variablesOf(doc).map((v: any) => [String(v.name), v]));

// A tab's identity is its name and order; its panels are diffed separately.
const tabShape = (tab: any) => ({ ...tab, panels: undefined });

const diffMaps = (
  kind: ConflictItemKind,
  before: Map<string, any>,
  after: Map<string, any>,
  nameOf: (item: any) => string,
  shape: (item: any) => unknown = (item) => item,
): ConflictChange[] => {
  const out: ConflictChange[] = [];
  for (const [key, item] of after) {
    const prev = before.get(key);
    const name = nameOf(item) || key;
    if (!prev) out.push({ kind, change: "added", key, name });
    else if (!same(shape(prev), shape(item))) {
      const previousName = nameOf(prev) || key;
      out.push({
        kind,
        change: "changed",
        key,
        name,
        ...(previousName !== name ? { previousName } : {}),
      });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) out.push({ kind, change: "removed", key, name: nameOf(item) || key });
  }
  return out;
};

const changedSettingsOf = (base: any, latest: any): DashboardSettingKey[] => {
  const out: DashboardSettingKey[] = KNOWN_SETTINGS.filter(
    (key) => !same(settingValue(base, key), settingValue(latest, key)),
  );
  if (!same(!!base?.variables?.showDynamicFilters, !!latest?.variables?.showDynamicFilters))
    out.push("showDynamicFilters");
  const otherKeys = new Set([...Object.keys(base ?? {}), ...Object.keys(latest ?? {})]);
  const otherChanged = [...otherKeys].some(
    (key) =>
      !NON_SETTING_FIELDS.has(key) &&
      !KNOWN_SETTINGS.includes(key as DashboardSettingKey) &&
      !same(base?.[key] ?? null, latest?.[key] ?? null),
  );
  if (otherChanged) out.push("other");
  return out;
};

/** Panels, tabs and variables that differ between two dashboard versions, matched by id (variables by name). */
export const diffDashboards = (base: any, latest: any): DashboardDiff => {
  const panelShape = (loc: PanelLocation) => ({ tabId: loc.tabId, panel: loc.panel });
  const changes = [
    ...diffMaps(
      "panel",
      panelsById(base),
      panelsById(latest),
      (loc) => loc.panel?.title,
      panelShape,
    ),
    ...diffMaps("tab", tabsById(base), tabsById(latest), (tab) => tab?.name, tabShape),
    ...diffMaps("variable", variablesByName(base), variablesByName(latest), (v) => v?.name),
  ];
  return { changes, changedSettings: changedSettingsOf(base, latest) };
};

/** Their version of my panel against mine, for the panel editor's same-panel conflict. */
export const comparePanel = (
  latest: any,
  mine: any,
  panelId: string | undefined,
): PanelComparison | null => {
  if (!panelId) return null;
  const minePanel = panelsById(mine).get(String(panelId))?.panel;
  if (!minePanel) return null;
  const theirsPanel = panelsById(latest).get(String(panelId))?.panel;
  const withoutTitle = (p: any) => ({ ...p, id: undefined, title: undefined, layout: undefined });
  return {
    theirsRemoved: !theirsPanel,
    theirsTitle: theirsPanel?.title ?? "",
    mineTitle: minePanel.title ?? "",
    sameTitle: (theirsPanel?.title ?? "") === (minePanel.title ?? ""),
    sameOtherFields:
      !!theirsPanel && sameWhereBothSet(withoutTitle(theirsPanel), withoutTitle(minePanel)),
  };
};

export const countChanges = (changes: ConflictChange[]): ConflictCounts => {
  const empty = () => ({ added: 0, changed: 0, removed: 0 });
  const counts: ConflictCounts = { panel: empty(), tab: empty(), variable: empty() };
  for (const c of changes) counts[c.kind][c.change] += 1;
  return counts;
};

export const isPanelTouched = (changes: ConflictChange[], panelId: string | undefined) =>
  !!panelId &&
  changes.some((c) => c.kind === "panel" && c.key === String(panelId) && c.change !== "added");

const overlaps = (a: any, b: any) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// A new panel was laid out against my version; their new panels may now occupy that spot.
const placeNewPanel = (panel: any, tab: any) => {
  const others = (tab.panels ?? []).map((p: any) => p?.layout).filter(Boolean);
  const layout = panel.layout;
  if (!layout) return;
  const maxI = others.reduce((m: number, l: any) => Math.max(m, Number(l.i) || 0), 0);
  if (others.some((l: any) => String(l.i) === String(layout.i))) layout.i = maxI + 1;
  if (!others.some((l: any) => overlaps(layout, l))) return;
  layout.x = 0;
  layout.y = others.reduce((m: number, l: any) => Math.max(m, (l.y ?? 0) + (l.h ?? 0)), 0);
  layout.w = Math.min(layout.w ?? GRID_COLUMNS / 2, GRID_COLUMNS);
};

// Variables I added, or changed where they did not, are carried onto the latest version.
const mergeVariables = (merged: any, mine: any, base: any) => {
  const baseVars = variablesByName(base);
  if (!merged.variables) merged.variables = { showDynamicFilters: false, list: [] };
  if (!Array.isArray(merged.variables.list)) merged.variables.list = [];
  const list: any[] = merged.variables.list;
  for (const v of variablesOf(mine)) {
    const name = String(v.name);
    const before = baseVars.get(name);
    const index = list.findIndex((l: any) => String(l.name) === name);
    if (!before && index === -1) list.push(clone(v));
    else if (before && index !== -1 && same(list[index], before) && !same(v, before))
      list[index] = clone(v);
  }
};

/** The latest dashboard with my version of one panel (and my variable edits) applied on top. */
export const mergePanelOntoLatest = (
  latest: any,
  mine: any,
  panelId: string,
  base: any,
): any | null => {
  const minePanel = panelsById(mine).get(String(panelId));
  if (!minePanel) return null;
  const merged = clone(latest);
  const theirs = panelsById(merged).get(String(panelId));
  const tabs = tabsOf(merged);
  if (!tabs.length) return null;
  const panel = clone(minePanel.panel);

  if (theirs && theirs.tabId === minePanel.tabId) {
    tabsById(merged).get(String(theirs.tabId)).panels[theirs.index] = panel;
  } else {
    if (theirs) {
      const from = tabsById(merged).get(String(theirs.tabId));
      from.panels.splice(theirs.index, 1);
    }
    const target = tabsById(merged).get(String(minePanel.tabId)) ?? tabs[0];
    if (!Array.isArray(target.panels)) target.panels = [];
    placeNewPanel(panel, target);
    target.panels.push(panel);
  }

  mergeVariables(merged, mine, base);
  return merged;
};

/** Microsecond (backend) or millisecond epoch to milliseconds; null when unknown. */
export const toEpochMs = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? Math.floor(n / 1000) : n;
};

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** Localised "4 minutes ago" for a past epoch-ms value. */
export const formatRelativeTime = (ms: number, locale: string, now = Date.now()) => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  let amount = Math.round((ms - now) / 1000);
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(amount) < size) return rtf.format(Math.min(amount, 0), unit);
    amount = Math.round(amount / size);
  }
  return rtf.format(amount, "year");
};

/** Minute-precision clock time, with the date when it is not today. */
export const formatClockTime = (ms: number, locale: string, now = Date.now()) => {
  const date = new Date(ms);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
};
