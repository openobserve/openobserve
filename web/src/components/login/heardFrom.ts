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

/** Set when a new user leaves the onboarding page; the question waits for their first data. */
export function markHeardFromPending(email: string | undefined | null): void {
  try {
    window.localStorage.setItem(key(email), "true");
  } catch {
    // Without storage the question is never asked; signup is unaffected.
  }
}

export function isHeardFromPending(email: string | undefined | null): boolean {
  try {
    return window.localStorage.getItem(key(email)) === "true";
  } catch {
    return false;
  }
}

export function clearHeardFromPending(email: string | undefined | null): void {
  try {
    window.localStorage.removeItem(key(email));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
