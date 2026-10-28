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

import { computed, ref, shallowRef, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useLocalHideInternalStreams } from "@/utils/storage";

const STORAGE_KEY_PREFIX = "o2:hideInternalStreams";

// Module scope so every stream picker on the page reads and writes one setting.
const fallback = ref(false);
const stored = shallowRef<Ref<string | null> | undefined>();
let boundKey: string | null = null;

const bindStorageKey = (key: string | null) => {
  if (key === boundKey) return;
  boundKey = key;
  fallback.value = false;
  stored.value = key ? useLocalHideInternalStreams(key) : undefined;
};

const writeHideInternalStreams = (next: boolean) => {
  fallback.value = next;
  if (!boundKey) return;
  const written = useLocalHideInternalStreams(boundKey, next ? "true" : "false");
  // useLocalStorage hands back the value read before its write.
  if (written) written.value = String(next);
  stored.value = written;
};

const hideInternalStreams = computed<boolean>({
  get: () => (stored.value ? stored.value.value === "true" : fallback.value),
  set: writeHideInternalStreams,
});

/** localStorage key of the hide-internal-streams setting for one user in one org. */
export const hideInternalStreamsStorageKey = (
  email: string | null | undefined,
  org: string | null | undefined,
): string | null => (email && org ? `${STORAGE_KEY_PREFIX}:${email}:${org}` : null);

/** The shared "Hide internal streams" setting, persisted per user and org and followed across tabs. */
export function useHideInternalStreams() {
  const store = useStore();
  const storageKey = computed(() =>
    hideInternalStreamsStorageKey(
      store?.state?.userInfo?.email,
      store?.state?.selectedOrganization?.identifier,
    ),
  );
  watch(storageKey, bindStorageKey, { immediate: true });

  const showInternalStreams = () => {
    hideInternalStreams.value = false;
  };

  return { hideInternalStreams, showInternalStreams };
}
