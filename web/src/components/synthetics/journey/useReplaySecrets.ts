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

import { ref } from "vue";

const keyOf = (envId: string, name: string) => `${envId}\u0000${name}`;

/** Secrets typed for a replay, in memory only and never in web storage. */
export function useReplaySecrets() {
  // Per view instance: remount on a route change is the "leave the editor" that deletes typed secrets.
  const values = ref(new Map<string, string>());

  function valueFor(envId: string, name: string): string | undefined {
    return values.value.get(keyOf(envId, name));
  }

  function valuesFor(envId: string): Record<string, string> {
    const prefix = keyOf(envId, "");
    const out: Record<string, string> = {};
    for (const [key, value] of values.value) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    }
    return out;
  }

  function set(envId: string, name: string, value: string) {
    values.value.set(keyOf(envId, name), value);
  }

  function forget(envId: string, name: string) {
    values.value.delete(keyOf(envId, name));
  }

  function clear() {
    values.value.clear();
  }

  return { valueFor, valuesFor, set, forget, clear };
}
