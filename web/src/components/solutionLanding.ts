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

const LAST_PAGES_KEY = "o2.solutionSwitcher.lastPages";

export const SOLUTION_HOME: Record<SolutionMode, string> = {
  observability: "/",
  security: "/security/overview",
};

/** Pages that do the same job in both solutions; a page listed twice lands on its first pair. */
export const MATCHING_PAGES: ReadonlyArray<Record<SolutionMode, string>> = [
  { observability: "/logs", security: "/security/events" },
  { observability: "/alerts", security: "/security/alerts" },
  { observability: "/alerts", security: "/security/detections" },
  { observability: "/incidents", security: "/security/cases" },
  { observability: "/ingestion", security: "/security/sources" },
];

/** What the switcher knows about the target solution: the page it last showed, and whether the user came here by switching and has not moved since. */
export interface SolutionMemory {
  lastPage?: string | null;
  justSwitched?: boolean;
}

type LastPages = Record<string, Partial<Record<SolutionMode, string>>>;

// "/" is the Observability home only, never a prefix of every page.
const under = (path: string, prefix: string) =>
  prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`);

const pathOf = (page: string) => page.split(/[?#]/)[0];

/**
 * Where switching to `target` lands from `path`: straight back when the user just switched here,
 * else the matching page, else the page `target` last showed, else its home; null stays on a shared page.
 */
export function solutionLanding(
  path: string,
  target: SolutionMode,
  exists: (path: string) => boolean = () => true,
  memory: SolutionMemory = {},
): string | null {
  if (solutionModeForPath(path, target) === target) return null;
  const last = memory.lastPage && exists(pathOf(memory.lastPage)) ? memory.lastPage : null;
  if (memory.justSwitched && last) return last;
  const source: SolutionMode = target === "security" ? "observability" : "security";
  const page = MATCHING_PAGES.find((pair) => under(path, pair[source]))?.[target];
  if (page && exists(page)) return page;
  return last ?? SOLUTION_HOME[target];
}

/** The solution a page belongs to, or null for a page both share. */
export function solutionOfPath(path: string): SolutionMode | null {
  const mode = solutionModeForPath(path, "observability");
  return mode === solutionModeForPath(path, "security") ? mode : null;
}

function readLastPages(): LastPages {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_PAGES_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as LastPages) : {};
  } catch {
    return {};
  }
}

/** Keeps `page` (path and query, without the org) as the page its solution last showed in `org`. */
export function rememberSolutionPage(org: string, page: string): void {
  const solution = solutionOfPath(pathOf(page));
  if (!org || !solution) return;
  const pages = readLastPages();
  pages[org] = { ...pages[org], [solution]: page };
  try {
    window.localStorage.setItem(LAST_PAGES_KEY, JSON.stringify(pages));
  } catch {
    // Without storage a switch lands on the matching page or the home.
  }
}

export function lastSolutionPage(org: string, solution: SolutionMode): string | null {
  const page = readLastPages()[org]?.[solution];
  return typeof page === "string" ? page : null;
}
