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

import { onActivated, onBeforeUnmount, onDeactivated, ref, toValue, watch, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useI18nTyped } from "@/types/i18n";
import { confirmForcedSignOutDiscard, draftSignOutForced } from "@/utils/drafts/draftSession";

export interface LeaveGuardOptions {
  /** Number of unsaved changes named in the dialog; without it the dialog names no number. */
  count?: () => number;
  /** Runs when the user chooses to leave, so a kept-alive page does not come back dirty. */
  onDiscard?: () => void;
}

// The guards of the pages on screen. A kept-alive page in the background is clean, or it could not have been left.
const guardsOnScreen = new Set<() => Promise<boolean>>();

/** Asks the dirty pages on screen before a change the router cannot stop. On `true` the caller must go on to navigate. */
export async function confirmLeave(): Promise<boolean> {
  for (const ask of [...guardsOnScreen]) {
    if (!(await ask())) return false;
  }
  return true;
}

/** Asks before a dirty page is left by navigation, organization switch, reload or tab close. Call once per page. */
export function useLeaveGuard(
  isDirty: Ref<boolean> | (() => boolean),
  options: LeaveGuardOptions = {},
) {
  const { t } = useI18nTyped();
  const { confirm } = useConfirmDialog();
  const active = ref(true);

  // Browsers show their own prompt only when the event is cancelled and returnValue is set.
  const onUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };

  async function mayLeave(): Promise<boolean> {
    if (!toValue(isDirty)) return true;
    // Staying cannot stop a forced sign-out, so no "Keep editing" is offered: the page only says what is lost.
    if (draftSignOutForced.value) {
      await confirmForcedSignOutDiscard(confirm, t);
      options.onDiscard?.();
      return true;
    }
    const count = options.count?.();
    const leave = await confirm({
      title: t("common.leaveGuard.title"),
      message: count ? t("common.leaveGuard.message", count) : t("common.unsavedMessage"),
      confirmLabel: t("common.discardChanges"),
      cancelLabel: t("common.leaveGuard.keepEditing"),
      confirmVariant: "destructive",
      focusCancel: true,
    });
    if (leave) options.onDiscard?.();
    return leave;
  }

  // Set when confirmLeave already got a yes, so the navigation that follows does not ask a second time.
  let answeredYes = false;
  const askFromOutside = async () => {
    const leave = await mayLeave();
    answeredYes = leave && toValue(isDirty);
    return leave;
  };
  const askOnNavigation = () => {
    if (!answeredYes) return mayLeave();
    answeredYes = false;
    return true;
  };

  watch(
    () => active.value && toValue(isDirty),
    (listen) => {
      answeredYes = false;
      if (listen) window.addEventListener("beforeunload", onUnload);
      else window.removeEventListener("beforeunload", onUnload);
    },
    { immediate: true, flush: "sync" },
  );
  watch(
    active,
    (onScreen) => {
      if (onScreen) guardsOnScreen.add(askFromOutside);
      else guardsOnScreen.delete(askFromOutside);
    },
    { immediate: true, flush: "sync" },
  );

  onActivated(() => (active.value = true));
  onDeactivated(() => (active.value = false));
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", onUnload);
    guardsOnScreen.delete(askFromOutside);
  });

  onBeforeRouteLeave(askOnNavigation);
  // An organization switch keeps the page and changes only the query, so it arrives as an update.
  onBeforeRouteUpdate((to, from) =>
    to.path !== from.path || to.query.org_identifier !== from.query.org_identifier
      ? askOnNavigation()
      : true,
  );
}
