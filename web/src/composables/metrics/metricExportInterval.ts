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

export function createExportIntervalCache(
  ttlMs: number = EXPORT_INTERVAL_TTL_MS,
  now: () => number = Date.now,
): ExportIntervalCache {
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<number | null>>();
  return {
    peek: (key) => entries.get(key)?.value,
    detect(key, measure) {
      const entry = entries.get(key);
      if (entry && now() - entry.at < ttlMs) return Promise.resolve(entry.value);
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const run = measure()
        .then((value) => {
          entries.set(key, { value, at: now() });
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, run);
      return run;
    },
    clear() {
      entries.clear();
      pending.clear();
    },
  };
}

/** Shared by every explorer mount, so revisiting within the TTL aligns from the first query. */
export const exportIntervalCache = createExportIntervalCache();
