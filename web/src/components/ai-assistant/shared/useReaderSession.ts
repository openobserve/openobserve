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

import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from "vue";

export interface ReaderSessionDeps {
  /** The signed-in user the app's login dispatch put in the store, if it ran. */
  storeEmail: () => string;
  /** The email in this browser's stored user info, which can outlive the session. */
  storedEmail: () => string;
  /** Whether the session behind the stored user info is still signed in. */
  verify: () => Promise<boolean>;
}

/** The reader's email: the store's, or the stored one once the server confirms its session. */
export function useReaderSession(deps: ReaderSessionDeps): {
  email: ComputedRef<string>;
  checking: ComputedRef<boolean>;
} {
  const stored = ref(deps.storedEmail());
  const verified = ref("");
  const pending = ref("");
  const email = computed(
    () =>
      deps.storeEmail() || (verified.value && verified.value === stored.value ? stored.value : ""),
  );
  watch(
    stored,
    (address) => {
      if (!address || deps.storeEmail() || verified.value === address) return;
      pending.value = address;
      void deps
        .verify()
        .then((alive) => {
          if (alive && stored.value === address) verified.value = address;
        })
        .catch(() => undefined)
        .finally(() => {
          if (pending.value === address) pending.value = "";
        });
    },
    { immediate: true },
  );
  // A sign-out or a sign-in in another tab rewrites the stored user info.
  const reread = () => {
    stored.value = deps.storedEmail();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", reread);
    if (getCurrentScope()) onScopeDispose(() => window.removeEventListener("storage", reread));
  }
  // Signed in or out is unknown until the probe for the stored user settles.
  const checking = computed(
    () => !deps.storeEmail() && !!stored.value && pending.value === stored.value,
  );
  return { email, checking };
}
