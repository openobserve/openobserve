/**
 * What a DBM empty-state button should actually DO.
 *
 * This exists because the button used to do nothing. `DbmEmptyState` picks a
 * cause and labels its primary button from it ("Show me how to instrument it"),
 * but both list pages only handled `filtered` and `not-counted` — so on a fresh
 * install, where the cause is always `not-instrumented`, the most prominent
 * button on the page was a dead click. Every cause now maps to an outcome here,
 * and the page's job is reduced to carrying that outcome out.
 *
 * Keeping the mapping in one pure function (rather than an `if` chain inside
 * each page) is what makes it testable and what stops the two pages drifting
 * apart again.
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
