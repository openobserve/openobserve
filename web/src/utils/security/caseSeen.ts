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

/** Most cases one analyst's "last viewed" map keeps; the oldest views drop first. */
export const MAX_SEEN_CASES = 500;

/** When this analyst last opened each case, in microseconds. */
export type CaseSeenMap = Record<string, number>;

export function caseSeenKey(org: string, user: string): string {
  return `o2.security.caseSeen.${org}.${user}`;
}

// Storage can be absent or throw (private mode, blocked site data), so every access is guarded.
function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readCaseSeen(org: string, user: string): CaseSeenMap {
  try {
    const text = storage()?.getItem(caseSeenKey(org, user));
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CaseSeenMap = {};
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/** Records that the case was viewed at `at` and returns the map as stored. */
export function markCaseSeen(
  org: string,
  user: string,
  caseId: string,
  at: number,
  current: CaseSeenMap = readCaseSeen(org, user),
): CaseSeenMap {
  const entries = Object.entries({ ...current, [caseId]: at })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEEN_CASES);
  const next = Object.fromEntries(entries);
  try {
    storage()?.setItem(caseSeenKey(org, user), JSON.stringify(next));
  } catch {
    // A full or blocked store only loses the badge memory, never the case.
  }
  return next;
}

/** Another detection joined after this analyst last opened the case. */
export function isCaseUnread(
  row: { id: string; last_detection_at?: number | null; status?: string },
  seen: CaseSeenMap,
): boolean {
  const joined = Number(row.last_detection_at ?? 0);
  if (!joined || row.status === "resolved") return false;
  const viewed = seen[row.id];
  return viewed === undefined || joined > viewed;
}

/** Unread cases first, otherwise the server's order. */
export function unreadFirst<
  T extends { id: string; last_detection_at?: number | null; status?: string },
>(rows: T[], seen: CaseSeenMap): T[] {
  const unread = rows.filter((r) => isCaseUnread(r, seen));
  if (!unread.length) return rows;
  return [...unread, ...rows.filter((r) => !isCaseUnread(r, seen))];
}
