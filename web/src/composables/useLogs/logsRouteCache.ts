//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { b64DecodeUnicode } from "@/utils/zincutils";
import type { ShownEntry } from "@/composables/useLogs/useLogsUrl";

export interface CachedLogsSearch {
  streams: string[];
  org: string;
  streamType?: string;
  query?: string;
  sqlMode?: boolean;
  timeType?: string;
  period?: string | null;
  startTime?: number | string;
  endTime?: number | string;
  toggle?: string;
}

const sameStreams = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

const decodeQuery = (value: unknown) => (b64DecodeUnicode(String(value ?? "")) ?? "").trim();

/** True when the cached search is what the route asks for; params the route omits are not compared. */
export const cachedSearchMatchesRoute = (
  route: Record<string, unknown>,
  cache: CachedLogsSearch,
): boolean => {
  if (route.org_identifier !== cache.org) return false;
  const routeStreams = String(route.stream ?? "")
    .split(",")
    .filter(Boolean);
  if (!sameStreams(routeStreams, cache.streams)) return false;
  if (String(route.stream_type || "logs") !== (cache.streamType || "logs")) return false;
  if ("query" in route && decodeQuery(route.query) !== (cache.query ?? "").trim()) return false;
  if ("sql_mode" in route && String(route.sql_mode) !== String(!!cache.sqlMode)) return false;
  if ("period" in route && (cache.timeType !== "relative" || route.period !== cache.period)) {
    return false;
  }
  if ("from" in route || "to" in route) {
    const sameRange =
      String(route.from) === String(cache.startTime) && String(route.to) === String(cache.endTime);
    if (cache.timeType === "relative" || !sameRange) return false;
  }
  return !("logs_visualize_toggle" in route) || route.logs_visualize_toggle === cache.toggle;
};

/** The URL carries the last run search, so unrun editor edits in the cache must not count as a difference. */
export const lastRunSearch = (
  cache: CachedLogsSearch,
  shown: ShownEntry | null,
): CachedLogsSearch => {
  if (!shown) return cache;
  const { inputs, period } = shown;
  return {
    ...cache,
    streams: inputs.streams,
    streamType: inputs.streamType,
    query: inputs.query,
    sqlMode: inputs.sqlMode,
    timeType: period.type,
    period: period.type === "relative" ? period.period : null,
    startTime: period.type === "absolute" ? period.startUs : cache.startTime,
    endTime: period.type === "absolute" ? period.endUs : cache.endTime,
  };
};
