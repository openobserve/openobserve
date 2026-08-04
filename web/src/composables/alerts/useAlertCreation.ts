// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * The launcher every "create an alert from here" entry point goes through.
 *
 * A surface supplies a pure adapter that returns an AlertPrefill; this
 * normalizes it (enforcing the contract's invariants), stashes it, and routes to
 * the alert form. Surfaces never touch the router, the storage key, or the
 * query-param shape.
 */

import { useRouter } from "vue-router";
import { useStore } from "vuex";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { isPrefillBlocked, normalizePrefill } from "@/utils/alerts/alertPrefill";
import { writeAlertPrefill } from "@/utils/alerts/alertPrefillStorage";

export interface OpenAlertCreationOptions {
  /** Folder the alert lands in. Defaults to the org's default folder. */
  folder?: string;
}

export interface UseAlertCreationDeps {
  /** Supplied by callers outside a setup() context, which cannot call useRouter/useStore. */
  router?: any;
  store?: any;
}

export const useAlertCreation = (deps: UseAlertCreationDeps = {}) => {
  const router = deps.router ?? useRouter();
  const store = deps.store ?? useStore();

  /**
   * Normalize + persist + navigate. Returns false without navigating when the
   * prefill carries a blocking warning — the caller (CreateAlertAction) has
   * already shown the user why, and taking them to a form that cannot work
   * would be worse than staying put.
   */
  const openAlertCreation = (
    prefill: AlertPrefill,
    opts: OpenAlertCreationOptions = {},
  ): boolean => {
    const normalized = normalizePrefill(prefill);

    if (isPrefillBlocked(normalized)) return false;

    writeAlertPrefill(normalized);

    router.push({
      name: "addAlert",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        folder: opts.folder ?? "default",
        // Small, shareable, inert on its own — the payload rides sessionStorage.
        prefill: normalized.source,
      },
    });

    return true;
  };

  return { openAlertCreation };
};
