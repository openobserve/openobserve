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

// Drafts are keyed by user+org, so keeping them across a forced logout reload exposes nothing (round 1 E-01).
export const ASSISTANT_DRAFT_KEY = /^o2\.assistant\.draft:/;

/** Removes every `sessionStorage` key but the matching ones; a blocked store is left alone. */
export function clearSessionStorageExcept(keep: RegExp): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of keys) if (key !== null && !keep.test(key)) sessionStorage.removeItem(key);
  } catch {
    // Private mode can throw on any access; there is nothing to clear then.
  }
}

/** The forced-logout clear every 401 path uses, so a reload never loses an assistant draft. */
export function clearSessionStorageKeepingDrafts(): void {
  clearSessionStorageExcept(ASSISTANT_DRAFT_KEY);
}
