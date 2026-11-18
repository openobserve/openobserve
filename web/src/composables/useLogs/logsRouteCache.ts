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

const IDENTITY_PARAMS = [
  "stream_type",
  "query",
  "sql_mode",
  "period",
  "from",
  "to",
  "logs_visualize_toggle",
];

const sameStreams = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/** True when the cached search is what the route asks for; params the route omits are not compared. */
export const cachedSearchMatchesRoute = (
  routeQuery: Record<string, unknown>,
  cachedStreams: string[],
  cachedOrg: string,
  cachedUrlQuery: Record<string, unknown>,
): boolean => {
  if (routeQuery.org_identifier !== cachedOrg) return false;
  const routeStreams = String(routeQuery.stream ?? "")
    .split(",")
    .filter(Boolean);
  if (!sameStreams(routeStreams, cachedStreams)) return false;
  return IDENTITY_PARAMS.every(
    (key) => !(key in routeQuery) || String(routeQuery[key]) === String(cachedUrlQuery[key] ?? ""),
  );
};
