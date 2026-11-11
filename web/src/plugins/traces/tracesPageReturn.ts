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

import type { LocationQuery } from "vue-router";
import { DEFAULT_TRACE_SEARCH_MODE } from "@/ts/interfaces/traces/trace.types";

// The org rides along on every app link, so it alone does not name a view.
const CARRIER_KEYS = new Set(["org_identifier"]);

const present = (value: LocationQuery[string] | undefined) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

/** The URL query reduced to what names the view: sorted keys, empty values dropped, so equal views compare equal. */
export function tracesQueryKey(query: LocationQuery | null | undefined): string {
  const entries = Object.entries(query ?? {})
    .filter(([, value]) => present(value))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/** A menu link (`/traces` with at most the same org) means "show what I had", not a new query. */
export function isBareTracesQuery(
  query: LocationQuery | null | undefined,
  shown: LocationQuery | null | undefined,
): boolean {
  const keys = Object.keys(query ?? {}).filter((key) => present(query![key]));
  // The route guard stamps the default tab on a link that has none, so that tab alone is still a bare link.
  const stampedTab = (key: string) => key === "tab" && query!.tab === DEFAULT_TRACE_SEARCH_MODE;
  if (keys.some((key) => !CARRIER_KEYS.has(key) && !stampedTab(key))) return false;
  const org = query?.org_identifier;
  return !present(org) || org === shown?.org_identifier;
}
