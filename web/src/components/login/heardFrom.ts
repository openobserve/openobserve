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

import { computed, reactive, ref, type InjectionKey } from "vue";

/** Provided by a page that asks the question itself, so the first-event bars inside it do not ask again. */
export const HEARD_FROM_ASKED_BY_HOST: InjectionKey<boolean> = Symbol("heard-from-asked-by-host");

/** Stable codes sent as `from`; the order follows how often past signups named each one. */
export const HEARD_FROM_VALUES = [
  "search_engine",
  "friend_or_colleague",
  "ai_assistant",
  "github",
  "linkedin",
  "reddit",
  "youtube",
  "other",
] as const;

export type HeardFromValue = (typeof HEARD_FROM_VALUES)[number];

export const HEARD_FROM_PENDING_PREFIX = "o2.onboarding.heardFromPending.";

const key = (email: string | undefined | null) =>
  `${HEARD_FROM_PENDING_PREFIX}${email || "anonymous"}`;

// Answered or skipped on this page load; shared, so every mounted prompt hides at once.
const settled = reactive(new Set<string>());
// Bumped on each mark, so a prompt mounted before the mark (a slow start record) asks too.
const marks = ref(0);
// Users whose answer is on its way; shared, so a second prompt cannot send too.
const inFlight = reactive(new Set<string>());

/** Set when a new user leaves the onboarding page; the question waits for their first data. */
export function markHeardFromPending(email: string | undefined | null): void {
  settled.delete(key(email));
  try {
    window.localStorage.setItem(key(email), "true");
  } catch {
    // Without storage the question is never asked; signup is unaffected.
  }
  marks.value++;
}

export function isHeardFromPending(email: string | undefined | null): boolean {
  try {
    return window.localStorage.getItem(key(email)) === "true";
  } catch {
    return false;
  }
}

export function clearHeardFromPending(email: string | undefined | null): void {
  settled.add(key(email));
  try {
    window.localStorage.removeItem(key(email));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** Whether a prompt asks; false for every prompt once any one is answered or skipped. */
export function useHeardFromPending(email: () => string | undefined | null) {
  return computed(() => {
    void marks.value;
    return isHeardFromPending(email()) && !settled.has(key(email()));
  });
}

/** True while any prompt sends this user's answer. */
export function useHeardFromSending(email: () => string | undefined | null) {
  return computed({
    get: () => inFlight.has(key(email())),
    set: (on: boolean) => {
      if (on) inFlight.add(key(email()));
      else inFlight.delete(key(email()));
    },
  });
}
