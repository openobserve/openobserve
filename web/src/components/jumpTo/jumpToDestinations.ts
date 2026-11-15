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

import type { RouteLocationRaw } from "vue-router";
import type { I18nText } from "@/types/i18n";

const VISITS_KEY = "o2.jumpTo.areaVisits";

/** One page the palette can open, with the rail area it belongs to. */
export interface JumpDestination {
  key: string;
  label: I18nText;
  icon: string;
  area: I18nText;
  /** Stable, untranslated id of the area, used for the visit counts. */
  areaKey: string;
  to: RouteLocationRaw;
}

export interface JumpGroup {
  areaKey: string;
  area: I18nText;
  items: JumpDestination[];
}

export type AreaVisits = Record<string, number>;

/** 0 the label starts with the query, 1 a word of it does, 2 it holds it, 3 only the area does; null no match. */
function matchScore(destination: JumpDestination, query: string): number | null {
  const label = String(destination.label).toLowerCase();
  if (label.startsWith(query)) return 0;
  if (label.split(/[\s/_-]+/).some((word) => word.startsWith(query))) return 1;
  if (label.includes(query)) return 2;
  return String(destination.area).toLowerCase().includes(query) ? 3 : null;
}

/** Groups by area. An empty query puts the most-visited areas first; a query puts the best matches first. */
export function rankDestinations(
  destinations: JumpDestination[],
  query: string,
  visits: AreaVisits,
): JumpGroup[] {
  const needle = query.trim().toLowerCase();
  type Scored = { destination: JumpDestination; score: number };
  const groups = new Map<
    string,
    { area: I18nText; scored: Scored[]; best: number; order: number }
  >();
  destinations.forEach((destination, order) => {
    const score = needle ? matchScore(destination, needle) : 0;
    if (score === null) return;
    const group = groups.get(destination.areaKey) ?? {
      area: destination.area,
      scored: [],
      best: score,
      order,
    };
    group.best = Math.min(group.best, score);
    group.scored.push({ destination, score });
    groups.set(destination.areaKey, group);
  });
  const visitsOf = (areaKey: string) => visits[areaKey] ?? 0;
  return [...groups.entries()]
    .sort(
      ([aKey, a], [bKey, b]) =>
        a.best - b.best || visitsOf(bKey) - visitsOf(aKey) || a.order - b.order,
    )
    .map(([areaKey, group]) => ({
      areaKey,
      area: group.area,
      items: [...group.scored].sort((a, b) => a.score - b.score).map((s) => s.destination),
    }));
}

/** The area holding `path`: the destination whose path is the longest prefix of it. */
export function areaForPath(
  destinations: JumpDestination[],
  path: string,
  resolvePath: (to: RouteLocationRaw) => string | null,
): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const destination of destinations) {
    const base = resolvePath(destination.to);
    if (!base) continue;
    const matches = base === "/" ? path === "/" : path === base || path.startsWith(`${base}/`);
    if (matches && base.length > bestLength) {
      best = destination.areaKey;
      bestLength = base.length;
    }
  }
  return best;
}

export function readAreaVisits(): AreaVisits {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VISITS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as AreaVisits) : {};
  } catch {
    return {};
  }
}

export function recordAreaVisit(visits: AreaVisits, areaKey: string): AreaVisits {
  const next = { ...visits, [areaKey]: (visits[areaKey] ?? 0) + 1 };
  try {
    window.localStorage.setItem(VISITS_KEY, JSON.stringify(next));
  } catch {
    // Without storage the order holds for this session only.
  }
  return next;
}
