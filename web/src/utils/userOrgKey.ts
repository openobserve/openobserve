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

/**
 * Compute an opaque SHA-256 hash of "email:orgIdentifier".
 * Falls back to a synchronous djb2 hash in environments without crypto.subtle.
 *
 * Shared scoping identity for any per-user, per-org browser-local storage
 * (IndexedDB records, localStorage keys) — a shared org otherwise leaks one
 * user's data to the next login on the same browser profile.
 */
export const computeUserOrgKey = async (
  userEmail: string,
  orgIdentifier: string,
): Promise<string> => {
  const raw = `${userEmail}:${orgIdentifier}`;

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Synchronous djb2 fallback (test environments without crypto.subtle)
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (((hash << 5) + hash) ^ raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};
