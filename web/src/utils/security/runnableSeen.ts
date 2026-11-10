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

// Per-browser memory of which rules each stream could run when Content last showed them.

export type RunnableSeen = Record<string, string[]>;

const seenKey = (orgId: string) => `oo_sec_runnable_seen_${orgId}`;

export function loadRunnableSeen(orgId: string): RunnableSeen {
  try {
    const parsed = JSON.parse(localStorage.getItem(seenKey(orgId)) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, keys]) => Array.isArray(keys))
        .map(([stream, keys]) => [stream, (keys as unknown[]).map(String)]),
    );
  } catch {
    return {};
  }
}

export function saveRunnableSeen(orgId: string, seen: RunnableSeen) {
  try {
    localStorage.setItem(seenKey(orgId), JSON.stringify(seen));
  } catch {
    /* private mode / quota: the count is a convenience, not state */
  }
}

/** Rules runnable now that were not when the stream was last seen; none on its first sighting. */
export function newlyRunnable(seen: string[] | undefined, current: string[]): string[] {
  if (!seen) return [];
  const known = new Set(seen);
  return current.filter((key) => !known.has(key));
}

/** A first sighting or a stream with nothing new takes the current set; one with new rules waits for review. */
export function syncRunnableSeen(seen: RunnableSeen, current: Map<string, string[]>): RunnableSeen {
  const next = { ...seen };
  for (const [stream, keys] of current) {
    if (!next[stream] || !newlyRunnable(next[stream], keys).length) next[stream] = keys;
  }
  return next;
}
