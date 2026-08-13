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

/**
 * What a DBM empty-state button should actually DO.
 *
 * `DbmEmptyState` picks a cause and labels its primary button from it ("Show
 * me how to instrument it"), so every cause MUST map to an outcome: a cause a
 * page does not handle leaves the most prominent button on the page a dead
 * click, and on a fresh install — where the cause is always
 * `not-instrumented` — that button is the first thing a new user presses.
 *
 * Keeping the mapping in one pure function (rather than an `if` chain inside
 * each page) is what makes it testable and what stops the pages drifting
 * apart.
 */
import type { DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";

/** The outcomes a page knows how to perform. */
export type DbmEmptyActionKind =
  /** Send the user to the collector setup for databases. */
  | "open-setup"
  /** Drop search/insight/scope filters and re-read. */
  | "clear-filters"
  /** Re-run the current read; the data may simply not have landed yet. */
  | "reload"
  /** Nothing sensible to do — the page should stay put. */
  | "none";

/**
 * Map an empty-state cause to the action its button promises.
 *
 * `not-instrumented` is the default cause on a fresh install, so it is the one
 * that matters most: it must reach the setup instructions. `disabled` goes to
 * the same place because the setup page is where the prerequisite is explained.
 * `no-permission` is deliberately `none` — the user cannot fix their own grants
 * from here, and sending them to a setup page they cannot action is worse than
 * leaving the button inert.
 */
export const dbmEmptyAction = (cause: DbmEmptyCauseId): DbmEmptyActionKind => {
  switch (cause) {
    case "not-instrumented":
    case "disabled":
      return "open-setup";
    case "filtered":
      return "clear-filters";
    case "not-counted":
    case "window-empty":
    case "check-trace":
      return "reload";
    case "no-permission":
    case "empty":
      return "none";
  }
};

/** Route target for `open-setup`, so both pages send users to the same place. */
export const DBM_SETUP_ROUTE = "databases" as const;
