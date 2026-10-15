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

import { reactive } from "vue";
import streamService from "@/services/stream";
import {
  REPEAT_ALL_FETCH_SIZE,
  needsAllValuesFetch,
  type RepeatValueSources,
} from "@/utils/dashboard/repeatByVariable";

export interface RepeatTimeRange {
  start: number;
  end: number;
}

/** Fetches the values "All" stands for, since a variable's options stop at its record limit. */
export const useRepeatAllValues = (
  getOrg: () => string,
  getTimeRange: () => RepeatTimeRange | null,
) => {
  const fetched = reactive<Record<string, string[] | null>>({});
  // While a new time range loads, the previous range's values keep the copies mounted.
  const latest = reactive<Record<string, string[]>>({});
  const inFlight = new Set<string>();

  const variableKey = (variable: any) =>
    [
      getOrg(),
      variable.name,
      variable.query_data.stream_type ?? "logs",
      variable.query_data.stream,
      variable.query_data.field,
    ].join("|");

  const keyFor = (variable: any, range: RepeatTimeRange) =>
    `${variableKey(variable)}|${range.start}|${range.end}`;

  const currentKey = (variable: any) => {
    if (!needsAllValuesFetch(variable)) return null;
    const range = getTimeRange();
    return range ? keyFor(variable, range) : null;
  };

  /** What "All" resolves from for this variable: fetched values, or pending until they arrive. */
  const sourcesFor = (variable: any): RepeatValueSources => {
    const key = currentKey(variable);
    if (!key) return {};
    if (!(key in fetched)) {
      const previous = latest[variableKey(variable)];
      return previous ? { allValues: previous } : { allPending: true };
    }
    return fetched[key] ? { allValues: fetched[key] } : {};
  };

  const ensure = async (variable: any) => {
    const key = currentKey(variable);
    const range = getTimeRange();
    if (!key || !range || key in fetched || inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const response: any = await streamService.fieldValues({
        org_identifier: getOrg(),
        stream_name: variable.query_data.stream,
        fields: [variable.query_data.field],
        size: REPEAT_ALL_FETCH_SIZE,
        start_time: range.start,
        end_time: range.end,
        type: variable.query_data.stream_type ?? "logs",
        no_count: true,
      });
      const values = (response?.data?.hits?.[0]?.values ?? [])
        .map((entry: any) => entry?.zo_sql_key)
        .filter((value: any) => value !== undefined && value !== null && value !== "")
        .map(String);
      fetched[key] = values;
      latest[variableKey(variable)] = values;
    } catch {
      // A failed fetch falls back to the variable's options, which carry the "first N" notice.
      fetched[key] = null;
    } finally {
      inFlight.delete(key);
    }
  };

  return { sourcesFor, ensure };
};
