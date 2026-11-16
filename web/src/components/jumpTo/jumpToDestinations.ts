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

/** The area of the palette's actions, which list only for a query. */
export const ACTIONS_AREA_KEY = "actions";

/** The one group that holds every matching page while a query is typed. */
export const PAGES_AREA_KEY = "pages";

/** Areas of the top-level rail links, which name the solution rather than a group of pages. */
export const SOLUTION_AREA_KEYS = new Set(["observability", "security"]);

/** One page the palette can open, with the rail area it belongs to. */
export interface JumpDestination {
  key: string;
  label: I18nText;
  icon: string;
  area: I18nText;
  /** Stable, untranslated id of the area, used for the visit counts. */
  areaKey: string;
  to: RouteLocationRaw;
  /** Where it lives, shown beside it: the page an action opens, or an object's folder or explorer. */
  hint?: I18nText;
  /** Untranslated words that also find it, such as the last segment of its path. */
  keywords?: string[];
}

export interface JumpGroup {
  areaKey: string;
  /** Empty for a group that needs no heading. */
  area: I18nText;
  items: JumpDestination[];
}

/** Named objects of one kind, such as alerts, that the palette finds by name. */
export interface JumpObjectKind {
  areaKey: string;
  area: I18nText;
  /** A tie in match keeps this order. */
  items: JumpDestination[];
  /** The row that ends the group and opens the kind's list, given the matches shown. */
  showAll?: (matches: JumpDestination[]) => JumpDestination;
}

export type AreaVisits = Record<string, number>;

/** 0 the label starts with the query, 1 a word of it does, 2 it holds it; null no match. */
function labelScore(label: string, query: string): number | null {
  if (label.startsWith(query)) return 0;
  if (label.split(/[\s/_.-]+/).some((word) => word.startsWith(query))) return 1;
  return label.includes(query) ? 2 : null;
}

/** As `labelScore`, with 3 when only the area, hint or a keyword holds the query. */
function matchScore(destination: JumpDestination, query: string): number | null {
  const score = labelScore(String(destination.label).toLowerCase(), query);
  if (score !== null) return score;
  const extras = [destination.area, destination.hint ?? "", ...(destination.keywords ?? [])];
  return extras.some((text) => String(text).toLowerCase().includes(query)) ? 3 : null;
}

/** Under a query a page names its rail group beside it, unless that group is the solution or the page itself. */
function withAreaHint(page: JumpDestination): JumpDestination {
  if (page.hint || SOLUTION_AREA_KEYS.has(page.areaKey) || page.area === page.label) return page;
  return { ...page, hint: page.area };
}

/**
 * An empty query lists no actions and groups pages by area, the most-visited first. A query lists
 * one Pages group and one Actions group, best match first, actions winning a tie.
 */
export function rankDestinations(
  destinations: JumpDestination[],
  query: string,
  visits: AreaVisits,
  pagesLabel: I18nText,
): JumpGroup[] {
  const needle = query.trim().toLowerCase();
  type Scored = { destination: JumpDestination; score: number; order: number };
  const groups = new Map<
    string,
    { area: I18nText; scored: Scored[]; best: number; order: number }
  >();
  destinations.forEach((destination, order) => {
    const isAction = destination.areaKey === ACTIONS_AREA_KEY;
    if (!needle && isAction) return;
    const score = needle ? matchScore(destination, needle) : 0;
    if (score === null) return;
    const asPage = !!needle && !isAction;
    const key = asPage ? PAGES_AREA_KEY : destination.areaKey;
    const group = groups.get(key) ?? {
      area: asPage ? pagesLabel : destination.area,
      scored: [],
      best: score,
      order,
    };
    group.best = Math.min(group.best, score);
    group.scored.push({
      destination: asPage ? withAreaHint(destination) : destination,
      score,
      order,
    });
    groups.set(key, group);
  });
  const visitsOf = (areaKey: string) => visits[areaKey] ?? 0;
  const isActions = (areaKey: string) => Number(areaKey === ACTIONS_AREA_KEY);
  return [...groups.entries()]
    .sort(
      ([aKey, a], [bKey, b]) =>
        a.best - b.best ||
        isActions(bKey) - isActions(aKey) ||
        visitsOf(bKey) - visitsOf(aKey) ||
        a.order - b.order,
    )
    .map(([areaKey, group]) => ({
      areaKey,
      area: group.area,
      items: [...group.scored]
        .sort(
          (a, b) =>
            a.score - b.score ||
            visitsOf(b.destination.areaKey) - visitsOf(a.destination.areaKey) ||
            a.order - b.order,
        )
        .map((s) => s.destination),
    }));
}

/** Each kind's objects whose name holds the query, best first and capped, then its "Show all" row; a kind with no match is left out. */
export function rankObjects(kinds: JumpObjectKind[], query: string, cap: number): JumpGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return kinds.flatMap((kind) => {
    const matches = kind.items
      .map((item, order) => ({
        item,
        order,
        score: labelScore(String(item.label).toLowerCase(), needle),
      }))
      .filter((m): m is { item: JumpDestination; order: number; score: number } => m.score !== null)
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .slice(0, cap)
      .map((m) => m.item);
    if (!matches.length) return [];
    const items = kind.showAll ? [...matches, kind.showAll(matches)] : matches;
    return [{ areaKey: kind.areaKey, area: kind.area, items }];
  });
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
    if (destination.areaKey === ACTIONS_AREA_KEY) continue;
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
