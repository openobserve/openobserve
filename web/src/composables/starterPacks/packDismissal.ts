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
import { useMutation } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { readQuery } from "@/composables/query/readQuery";
import { kvValueQuery, setKvMutation, deleteKvMutation } from "@/services/kv.queries";

const storageKey = (surface: string, org: string, packId: string, email: string) =>
  `o2_starter_pack_${surface}:${org}:${packId}:${email}`;

// The prefix must not start with `starter_pack.`, which the install records own.
const hiddenKey = (packId: string) => `starter_pack_hidden.${packId}`;

/** Not now per user and surface, kept in this browser so it needs no write rights. */
export function usePackDismissal(surface: "home" | "landing", org: string, packId: string) {
  const store = useStore();
  const key = () => storageKey(surface, org, packId, store.state.userInfo?.email ?? "");
  const dismissed = ref(localStorage.getItem(key()) === "1");
  const dismiss = () => {
    localStorage.setItem(key(), "1");
    dismissed.value = true;
  };
  const restore = () => {
    localStorage.removeItem(key());
    dismissed.value = false;
  };
  return { dismissed, dismiss, restore };
}

/** Hide for everyone, an org setting an admin can undo from Home. */
export function usePackHiddenForOrg(org: string, packId: string) {
  const setKv = useMutation(() => setKvMutation(org));
  const deleteKv = useMutation(() => deleteKvMutation(org));
  const hidden = ref(false);
  const loaded = ref(false);

  const load = async () => {
    try {
      hidden.value = (await readQuery(kvValueQuery(org, hiddenKey(packId)), true)) === "1";
    } catch {
      hidden.value = false;
    }
    loaded.value = true;
  };

  const hide = async () => {
    await setKv.mutateAsync({ key: hiddenKey(packId), value: "1" });
    hidden.value = true;
  };

  const show = async () => {
    await deleteKv.mutateAsync(hiddenKey(packId));
    hidden.value = false;
  };

  return { hidden, loaded, load, hide, show };
}
