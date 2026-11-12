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

import { reactive } from "vue";

// Tokens are stored hashed, so a plaintext exists only in the create response; held in memory per org, never persisted.
const held = reactive(new Map<string, Map<string, string>>());

let epoch = 0;

/** Read before a create request; a clear in between makes its plaintext unholdable. */
export function secretsEpoch(): number {
  return epoch;
}

/** Holds the plaintext unless the store was cleared since `since`; returns whether it held it. */
export function holdTokenSecret(org: string, id: string, secret: string, since: number): boolean {
  if (since !== epoch) return false;
  const forOrg = held.get(org) ?? new Map<string, string>();
  forOrg.set(id, secret);
  held.set(org, forOrg);
  return true;
}

export function heldTokenSecret(org: string, id: string): string | null {
  return held.get(org)?.get(id) ?? null;
}

/** The most recently created of `ids` in `org` whose plaintext is still held. */
export function newestHeldToken(org: string, ids: string[]): string | null {
  const forOrg = held.get(org);
  if (!forOrg) return null;
  return [...forOrg.keys()].reverse().find((id) => ids.includes(id)) ?? null;
}

/** Called on org switch and logout, so a plaintext never outlives the session or org it came from. */
export function clearHeldTokenSecrets() {
  epoch += 1;
  held.clear();
}
