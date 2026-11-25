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

export const ORG_SWITCHER_MAX_FAVORITES = 10;
export const ORG_SWITCHER_RECENT_SHOWN = 3;

export type OrgSection = "favorites" | "recent" | "all";

export interface SwitcherOrg {
  label: string;
  identifier: string;
  [k: string]: unknown;
}

export type SwitcherRow<T extends SwitcherOrg = SwitcherOrg> =
  | { kind: "heading"; section: OrgSection; key: `heading-${OrgSection}` }
  | { kind: "row"; org: T; section: OrgSection | "flat" | "search"; key: string };

interface SwitcherPrefs {
  favorites: readonly string[];
  recents: readonly string[];
}

/** Lists of this size or smaller render flat, without section headings. */
const FLAT_LIST_MAX = 5;
const BRAND = "OpenObserve";

export function buildSections<T extends SwitcherOrg>(
  orgs: readonly T[],
  prefs: SwitcherPrefs,
  currentId: string | undefined,
): SwitcherRow<T>[] {
  const byId = new Map(orgs.map((o) => [o.identifier, o]));
  const favorites = pickPresent(prefs.favorites, byId).slice(0, ORG_SWITCHER_MAX_FAVORITES);
  const favoriteIds = new Set(favorites.map((o) => o.identifier));

  if (orgs.length <= FLAT_LIST_MAX) {
    const rest = sortAlpha(orgs.filter((o) => !favoriteIds.has(o.identifier)));
    return [...favorites, ...rest].map((org) => orgRow(org, "flat"));
  }

  const recent = pickPresent(prefs.recents, byId)
    .filter((o) => o.identifier !== currentId && !favoriteIds.has(o.identifier))
    .slice(0, ORG_SWITCHER_RECENT_SHOWN);
  const placed = new Set([...favoriteIds, ...recent.map((o) => o.identifier)]);
  const all = sortAlpha(orgs.filter((o) => !placed.has(o.identifier)));

  if (!favorites.length && !recent.length) return all.map((org) => orgRow(org, "all"));

  const rows: SwitcherRow<T>[] = [];
  const pushSection = (section: OrgSection, list: T[]) => {
    if (!list.length) return;
    rows.push({ kind: "heading", section, key: `heading-${section}` });
    for (const org of list) rows.push(orgRow(org, section));
  };
  pushSection("favorites", favorites);
  pushSection("recent", recent);
  pushSection("all", all);
  return rows;
}

export function rankSearch<T extends SwitcherOrg>(
  orgs: readonly T[],
  prefs: SwitcherPrefs,
  query: string,
): SwitcherRow<T>[] {
  const q = query.trim().toLowerCase();
  const favoriteIndex = new Map(prefs.favorites.map((id, i) => [id, i]));
  const recentIndex = new Map(prefs.recents.map((id, i) => [id, i]));

  const ranked: { org: T; rank: number }[] = [];
  for (const org of orgs) {
    const rank = matchRank(org, q);
    if (rank) ranked.push({ org, rank });
  }

  const tieGroup = (id: string) => (favoriteIndex.has(id) ? 0 : recentIndex.has(id) ? 1 : 2);
  const tieIndex = (id: string) => favoriteIndex.get(id) ?? recentIndex.get(id) ?? 0;

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const ga = tieGroup(a.org.identifier);
    const gb = tieGroup(b.org.identifier);
    if (ga !== gb) return ga - gb;
    if (ga < 2) return tieIndex(a.org.identifier) - tieIndex(b.org.identifier);
    return compareAlpha(a.org, b.org);
  });
  return ranked.map(({ org }) => orgRow(org, "search"));
}

export function buildDocumentTitle(orgName: string | undefined, page: string | undefined): string {
  if (orgName && page) return `${orgName} · ${page} · ${BRAND}`;
  if (orgName) return `${orgName} · ${BRAND}`;
  return page ? `${BRAND} - ${page}` : BRAND;
}

function orgRow<T extends SwitcherOrg>(
  org: T,
  section: OrgSection | "flat" | "search",
): SwitcherRow<T> {
  return { kind: "row", org, section, key: org.identifier };
}

function pickPresent<T extends SwitcherOrg>(ids: readonly string[], byId: Map<string, T>): T[] {
  const out: T[] = [];
  for (const id of ids) {
    const org = byId.get(id);
    if (org) out.push(org);
  }
  return out;
}

function compareAlpha(a: SwitcherOrg, b: SwitcherOrg): number {
  return (
    String(a.label ?? "").localeCompare(String(b.label ?? "")) ||
    a.identifier.localeCompare(b.identifier)
  );
}

function sortAlpha<T extends SwitcherOrg>(orgs: readonly T[]): T[] {
  return [...orgs].sort(compareAlpha);
}

/** 1 exact id, 2 exact name, 3 prefix, 4 substring, 0 no match. */
function matchRank(org: SwitcherOrg, q: string): number {
  const id = org.identifier.toLowerCase();
  const label = String(org.label ?? "").toLowerCase();
  if (id === q) return 1;
  if (label === q) return 2;
  if (label.startsWith(q) || id.startsWith(q)) return 3;
  if (label.includes(q) || id.includes(q)) return 4;
  return 0;
}
