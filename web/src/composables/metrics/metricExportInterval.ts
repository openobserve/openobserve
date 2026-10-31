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

/** How long a measured export interval is trusted before it is measured again. */
export const EXPORT_INTERVAL_TTL_MS = 10 * 60_000;

/** One localStorage item per org, holding its streams' measured intervals. */
const STORAGE_PREFIX = "o2-metrics-export-intervals:";

interface Entry {
  /** Seconds, or null when the probe could not tell. */
  value: number | null;
  at: number;
}

export interface ExportIntervalCache {
  /** The last measured interval, however old; undefined when never measured. */
  peek(key: string): number | null | undefined;
  /** The cached interval while fresh, else one shared measurement; a rejected `measure` is not cached. */
  detect(key: string, measure: () => Promise<number | null>): Promise<number | null>;
  clear(): void;
}

/** Keys are `org|stream`; with `storage`, each org's fresh answers survive a reload. */
export function createExportIntervalCache(
  ttlMs: number = EXPORT_INTERVAL_TTL_MS,
  now: () => number = Date.now,
  storage: () => Storage | null = () => null,
): ExportIntervalCache {
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<number | null>>();
  const loadedOrgs = new Set<string>();
  const orgOf = (key: string) => key.slice(0, key.indexOf("|"));
  const fresh = (entry: Entry) => now() - entry.at < ttlMs;

  // Storage can be missing, full or throw on access; the cache then simply lives in memory.
  const load = (org: string) => {
    if (loadedOrgs.has(org)) return;
    loadedOrgs.add(org);
    try {
      const saved = JSON.parse(storage()?.getItem(STORAGE_PREFIX + org) ?? "{}");
      for (const [stream, entry] of Object.entries<Entry>(saved ?? {})) {
        const valid =
          (entry?.value === null || Number.isFinite(entry?.value)) && Number.isFinite(entry?.at);
        const key = `${org}|${stream}`;
        if (valid && fresh(entry) && !entries.has(key)) entries.set(key, entry);
      }
    } catch {
      // Unreadable storage is the same as an empty one.
    }
  };
  const save = (org: string) => {
    try {
      const out: Record<string, Entry> = {};
      for (const [key, entry] of entries) {
        if (orgOf(key) === org && fresh(entry)) out[key.slice(org.length + 1)] = entry;
      }
      storage()?.setItem(STORAGE_PREFIX + org, JSON.stringify(out));
    } catch {
      // Not persisted; this session still has it in memory.
    }
  };

  return {
    peek(key) {
      load(orgOf(key));
      return entries.get(key)?.value;
    },
    detect(key, measure) {
      load(orgOf(key));
      const entry = entries.get(key);
      if (entry && now() - entry.at < ttlMs) return Promise.resolve(entry.value);
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const run = measure()
        .then((value) => {
          entries.set(key, { value, at: now() });
          save(orgOf(key));
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, run);
      return run;
    },
    clear() {
      entries.clear();
      pending.clear();
      loadedOrgs.clear();
    },
  };
}

/** Shared by every explorer mount, so revisiting within the TTL aligns from the first query. */
export const exportIntervalCache = createExportIntervalCache(
  EXPORT_INTERVAL_TTL_MS,
  Date.now,
  () => (typeof localStorage === "undefined" ? null : localStorage),
);
