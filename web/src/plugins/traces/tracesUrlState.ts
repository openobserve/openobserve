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

import {
  decodeColumns,
  encodeColumns,
  parseRowsParam,
  parseSharedPage,
} from "@/composables/useLogs/useLogsUrl";

export const TRACES_DEFAULT_ROWS_PER_PAGE = 25;

export const TRACES_LIST_URL_KEYS = ["columns", "rows", "page", "show_histogram"] as const;

export interface TracesListState {
  columns: string[];
  defaultColumns: string[];
  rowsPerPage: number;
  /** 0-based, as `searchObj.data.resultGrid.currentPage` holds it. */
  currentPage: number;
  showHistogram: boolean;
}

export interface DecodedTracesListState {
  columns: string[] | null;
  rowsPerPage: number | null;
  currentPage: number | null;
  showHistogram: boolean | null;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/** The list-view URL keys for `state`; a key equal to its default is left out. */
export function encodeTracesListState(
  state: TracesListState,
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};
  // An empty list means the columns are not loaded yet, not that the user hid them all.
  if (state.columns.length && !sameList(state.columns, state.defaultColumns)) {
    query.columns = encodeColumns(state.columns);
  }
  if (state.rowsPerPage !== TRACES_DEFAULT_ROWS_PER_PAGE) query.rows = state.rowsPerPage;
  if (state.currentPage > 0) query.page = state.currentPage + 1;
  if (!state.showHistogram) query.show_histogram = false;
  return query;
}

/** Reads the list-view keys; null means the link does not carry that value. */
export function decodeTracesListState(query: Record<string, unknown>): DecodedTracesListState {
  const columns = decodeColumns(query.columns);
  const page = parseSharedPage(query.page);
  const histogram = query.show_histogram;
  return {
    columns: columns?.length ? columns : null,
    rowsPerPage: parseRowsParam(query.rows),
    currentPage: page === null ? null : page - 1,
    showHistogram: histogram === "true" ? true : histogram === "false" ? false : null,
  };
}
