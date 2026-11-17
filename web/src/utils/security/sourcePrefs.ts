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

// Per-browser source conveniences: dismissed suggestions and include choices made before they moved to the server.

export interface SourcePrefs {
  include: string[];
  exclude: string[];
  dismissed: string[];
}

export interface IncludeMigration {
  name: string;
  included: boolean;
}

const prefsKey = (orgId: string) => `oo_sec_sources_${orgId}`;
const migratedKey = (orgId: string) => `oo_sec_migrated_${orgId}`;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export function loadSourcePrefs(orgId: string): SourcePrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(prefsKey(orgId)) ?? "null");
    if (!parsed || typeof parsed !== "object") return { include: [], exclude: [], dismissed: [] };
    return {
      include: strings(parsed.include),
      exclude: strings(parsed.exclude),
      dismissed: strings(parsed.dismissed),
    };
  } catch {
    return { include: [], exclude: [], dismissed: [] };
  }
}

export function saveSourcePrefs(orgId: string, prefs: SourcePrefs) {
  try {
    localStorage.setItem(prefsKey(orgId), JSON.stringify(prefs));
  } catch {
    /* private mode / quota: preferences are a convenience, not state */
  }
}

export function isLocalPrefsMigrated(orgId: string): boolean {
  try {
    return localStorage.getItem(migratedKey(orgId)) === "1";
  } catch {
    return false;
  }
}

export function markLocalPrefsMigrated(orgId: string) {
  try {
    localStorage.setItem(migratedKey(orgId), "1");
  } catch {
    /* private mode / quota: migration simply reruns next load */
  }
}

/** Local include/exclude choices not yet on the server, skipping streams that already carry one. */
export function pendingIncludeMigrations(
  orgId: string,
  alreadySet: Set<string>,
): IncludeMigration[] {
  if (isLocalPrefsMigrated(orgId)) return [];
  const prefs = loadSourcePrefs(orgId);
  return [
    ...prefs.include.filter((n) => !alreadySet.has(n)).map((name) => ({ name, included: true })),
    ...prefs.exclude.filter((n) => !alreadySet.has(n)).map((name) => ({ name, included: false })),
  ];
}
