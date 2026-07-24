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

/**
 * URL <-> explorer filter state.
 *
 * The explorer keeps its filters in the URL so leaving the page (e.g. into the
 * editor) and coming back restores them. Defaults are omitted, so an
 * unfiltered grid keeps a bare `/metrics` URL.
 *
 * None of these keys may appear in METRICS_EDITOR_PARAM_KEYS — a `/metrics`
 * URL carrying an editor key redirects to `/metrics/editor` and the filters
 * would never be seen.
 */

import type { LocationQuery } from "vue-router";
import type { LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

export interface ExplorerFilterState {
  searchTerm: string;
  selectedPrefixes: Set<string>;
  selectedSuffixes: Set<string>;
  selectedTypes: Set<string>;
  labelFilters: LabelFilter[];
  showFavoritesOnly: boolean;
  hideEmptyPanels: boolean;
  sortBy: "a-z" | "z-a";
  viewMode: "grid" | "rows";
  /** Page mode — the Explore grid vs the query-driven Visualize workspace. */
  mode: "explore" | "visualize" | "workspace";
}

/** Every key this module may write — cleared before each sync so a removed filter leaves the URL. */
export const EXPLORER_FILTER_PARAM_KEYS = [
  "search",
  "prefix",
  "suffix",
  "type",
  "labels",
  "show_empty",
  "sort",
  "view",
  "mode",
] as const;

const TYPE_IDS = new Set(["counter", "gauge", "histogram", "summary", "other"]);

// Sorted for a stable URL: the same selection always serializes identically,
// so the change-guard in the component can compare strings.
const joinSet = (set: Set<string>): string => [...set].sort().join(",");

const splitList = (raw: unknown): string[] =>
  typeof raw === "string"
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

export function explorerFiltersToQuery(
  state: ExplorerFilterState,
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  if (state.searchTerm) query.search = state.searchTerm;
  if (state.selectedPrefixes.size) query.prefix = joinSet(state.selectedPrefixes);
  if (state.selectedSuffixes.size) query.suffix = joinSet(state.selectedSuffixes);
  if (state.selectedTypes.size) query.type = joinSet(state.selectedTypes);
  // One param per filter, in PromQL matcher form (`code=~5..`). Values are
  // arbitrary strings, but a label NAME cannot contain `=` or `!`, so the
  // first operator token splits unambiguously — no JSON needed.
  if (state.labelFilters.length) {
    query.labels = state.labelFilters.map((f) => `${f.label}${f.operator ?? "="}${f.value}`);
  }
  // `showFavoritesOnly` is NOT serialized: it is now derived from the mode
  // (Workspace ⇒ pinned-only), so `?mode=workspace` already implies it. Keeping
  // it out of the URL removes the double-source that could flip it unexpectedly.
  if (!state.hideEmptyPanels) query.show_empty = "true";
  if (state.sortBy === "z-a") query.sort = "z-a";
  if (state.viewMode === "rows") query.view = "rows";
  // Explore is the default landing mode, so only the non-default is serialized.
  if (state.mode === "visualize" || state.mode === "workspace") query.mode = state.mode;
  return query;
}

/** Only the keys present and valid come back — absence means "keep the default". */
export function queryToExplorerFilters(
  query: LocationQuery | Record<string, any>,
): Partial<ExplorerFilterState> {
  const out: Partial<ExplorerFilterState> = {};

  if (typeof query.search === "string" && query.search) out.searchTerm = query.search;

  const prefixes = splitList(query.prefix);
  if (prefixes.length) out.selectedPrefixes = new Set(prefixes);

  const suffixes = splitList(query.suffix);
  if (suffixes.length) out.selectedSuffixes = new Set(suffixes);

  const types = splitList(query.type).filter((t) => TYPE_IDS.has(t));
  if (types.length) out.selectedTypes = new Set(types);

  const rawLabels = Array.isArray(query.labels)
    ? query.labels
    : query.labels != null
      ? [query.labels]
      : [];
  const labelFilters = rawLabels.map(parseMatcher).filter((f): f is LabelFilter => f !== null);
  if (labelFilters.length) out.labelFilters = labelFilters;

  // `favorites` is intentionally not read from the URL — the mode drives
  // showFavoritesOnly (see explorerFiltersToQuery).
  if (query.show_empty === "true") out.hideEmptyPanels = false;
  if (query.sort === "z-a") out.sortBy = "z-a";
  if (query.view === "rows") out.viewMode = "rows";
  if (query.mode === "visualize" || query.mode === "workspace") out.mode = query.mode;

  return out;
}

// `=~` before `=` so the regex operator is not split into `=` + a value
// starting with `~`. The `s` flag lets a matcher value carry newlines.
const MATCHER = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(=~|!~|!=|=)(.*)$/s;

/** A hand-edited or truncated URL must degrade to "no filter", never throw. */
function parseMatcher(raw: unknown): LabelFilter | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(MATCHER);
  if (!m) return null;
  return { label: m[1], operator: m[2], value: m[3] };
}
