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

export const DEFAULT_DOWNTIME_FOLDER = "default";

const lastFolderKey = (org: string) => `o2_downtimes_last_folder:${org}`;

/** The folder this browser last filed a downtime in for `org`, if any. */
export function readLastDowntimeFolder(org: string): string | null {
  try {
    return window.localStorage.getItem(lastFolderKey(org));
  } catch {
    return null;
  }
}

export function rememberDowntimeFolder(org: string, folderId: string): void {
  try {
    window.localStorage.setItem(lastFolderKey(org), folderId);
  } catch {
    // Not remembering the folder only costs a pick next time.
  }
}

/**
 * Where a new downtime is filed: the last used folder while it is still listed, else
 * "default" when listed, else the first listed folder, else `null` when the user may use none.
 * The list holds only the folders the user may use, so a folder-scoped user never lands on a
 * folder that answers 403.
 */
export function preferredDowntimeFolder(
  listed: string[] | undefined,
  lastUsed: string | null,
): string | null {
  if (!listed) return lastUsed || DEFAULT_DOWNTIME_FOLDER;
  if (lastUsed && listed.includes(lastUsed)) return lastUsed;
  if (listed.includes(DEFAULT_DOWNTIME_FOLDER)) return DEFAULT_DOWNTIME_FOLDER;
  return listed[0] ?? null;
}
