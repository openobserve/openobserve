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

import { solutionModeForPath, type SolutionMode } from "@/utils/security/solutionMode";

export const SOLUTION_HOME: Record<SolutionMode, string> = {
  observability: "/",
  security: "/security/overview",
};

/** Pages that do the same job in both solutions; a page listed twice lands on its first pair. */
export const MATCHING_PAGES: ReadonlyArray<Record<SolutionMode, string>> = [
  { observability: "/", security: "/security/overview" },
  { observability: "/logs", security: "/security/events" },
  { observability: "/alerts", security: "/security/alerts" },
  { observability: "/alerts", security: "/security/detections" },
  { observability: "/incidents", security: "/security/cases" },
  { observability: "/ingestion", security: "/security/sources" },
];

// "/" is the Observability home only, never a prefix of every page.
const under = (path: string, prefix: string) =>
  prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`);

/** Where switching to `target` lands from `path`: the matching page, else the target's home; null stays on a shared page. */
export function solutionLanding(
  path: string,
  target: SolutionMode,
  exists: (path: string) => boolean = () => true,
): string | null {
  if (solutionModeForPath(path, target) === target) return null;
  const source: SolutionMode = target === "security" ? "observability" : "security";
  const page = MATCHING_PAGES.find((pair) => under(path, pair[source]))?.[target];
  return page && exists(page) ? page : SOLUTION_HOME[target];
}
