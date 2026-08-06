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

import { ref } from "vue";
import { useRouter, isNavigationFailure, NavigationFailureType } from "vue-router";
import { useStore } from "vuex";
import type { AlertBuildOptions, AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { isPrefillBlocked, normalizePrefill } from "@/utils/alerts/alertPrefill";
import { writeAlertPrefill } from "@/utils/alerts/alertPrefillStorage";

export interface OpenAlertCreationOptions {
  /** Folder the alert lands in. Defaults to the org's default folder. */
  folder?: string;
}

export interface AlertCreationDialogState {
  open: boolean;
  prefill: AlertPrefill;
  options: OpenAlertCreationOptions;
  /**
   * The surface's builder, retained so the dialog can re-parameterise the
   * prefill (e.g. switching pattern mode) by asking the SOURCE to rebuild
   * rather than editing SQL itself. Kept out of the persisted payload — only
   * the resulting prefill is stored.
   */
  build?: (options?: AlertBuildOptions) => AlertPrefill;
}

/**
 * Module-level singleton, rendered by CreateAlertDialogProvider at the app root
 * — deliberately NOT owned by CreateAlertAction.
 *
 * Most entry points are dropdown items, and reka-ui unmounts a dropdown's
 * content the moment an item is selected. A dialog rendered inside the action
 * therefore died in the same tick it was born: the user saw it flash open and
 * vanish. Hoisting the state out of the trigger's subtree means the dialog
 * outlives whatever opened it.
 *
 * Same shape as useConfirmDialog — only one alert-creation dialog at a time.
 */
const dialogState = ref<AlertCreationDialogState | null>(null);

export const alertCreationDialog = dialogState;

/** Ask for the confirm dialog. Safe to call from a control that is about to unmount. */
export const requestAlertCreation = (
  prefill: AlertPrefill,
  options: OpenAlertCreationOptions = {},
  build?: (options?: AlertBuildOptions) => AlertPrefill,
): void => {
  dialogState.value = { open: true, prefill: normalizePrefill(prefill), options, build };
};

/**
 * Re-run the source's builder with new options and swap the result in. Used when
 * the dialog offers a choice only the source can act on — folding patterns into
 * the query, say — so the dialog never has to understand the query itself.
 */
export const rebuildAlertPrefill = (buildOptions: AlertBuildOptions): void => {
  const current = dialogState.value;
  if (!current?.build) return;

  dialogState.value = {
    ...current,
    prefill: normalizePrefill(current.build(buildOptions)),
  };
};

export const closeAlertCreationDialog = (): void => {
  dialogState.value = null;
};

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

    const target = {
      name: "addAlert",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        folder: opts.folder ?? "default",
        // Small, shareable, inert on its own — the payload rides sessionStorage.
        prefill: normalized.source,
      },
    };

    // Re-issue once if the navigation is cancelled.
    //
    // The alert form is a lazy-loaded route, so this push stays in flight while
    // its chunk downloads — and every surface that launches it (a dashboard, a
    // logs search) syncs its own query params on a timer or on data arrival. A
    // replace() that starts inside that window supersedes ours, vue-router
    // reports `cancelled`, and the user is left staring at the page they
    // clicked on with no error. The competing sync has landed by the time we
    // hear about it, so the retry is uncontested. Bounded at one — a second
    // cancellation means something is navigating in a loop, and ping-ponging
    // with it would be worse than stopping.
    router.push(target).then((failure: unknown) => {
      if (isNavigationFailure(failure, NavigationFailureType.cancelled)) {
        router.push(target);
      }
    });

    return true;
  };

  return { openAlertCreation };
};
