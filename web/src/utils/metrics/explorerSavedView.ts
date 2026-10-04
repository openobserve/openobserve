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

// A view is the grid's URL slice, so applying one is a navigation.

export const METRICS_EXPLORER_VIEW_TYPE = "metrics_explorer";

const VIEW_VERSION = 1;

// Grid keys and time range only: the detail view, refresh interval and Visualize chart never travel.
const VIEW_STATE_KEYS = [
  "search",
  "prefix",
  "suffix",
  "type",
  "labels",
  "show_empty",
  "sort",
  "view",
  "mode",
  "period",
  "from",
  "to",
];

export type ExplorerViewState = Record<string, string | string[]>;

export interface ExplorerViewData {
  version: number;
  state: ExplorerViewState;
}

const pickViewState = (query: Record<string, unknown>): ExplorerViewState => {
  const state: ExplorerViewState = {};
  for (const key of VIEW_STATE_KEYS) {
    const value = query[key];
    if (typeof value === "string" || typeof value === "number") {
      state[key] = String(value);
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      state[key] = [...value];
    }
  }
  if (state.mode === "visualize") delete state.mode;
  return state;
};

/** The payload saved for the grid's current URL slice. */
export const buildExplorerViewData = (query: Record<string, unknown>): ExplorerViewData => ({
  version: VIEW_VERSION,
  state: pickViewState(query),
});

/** The allow-listed query a saved payload applies, or null for one this version cannot read. */
export const explorerViewToQuery = (data: unknown): ExplorerViewState | null => {
  const payload = data as Partial<ExplorerViewData> | null;
  if (!payload || payload.version !== VIEW_VERSION) return null;
  if (!payload.state || typeof payload.state !== "object") return null;
  return pickViewState(payload.state);
};
