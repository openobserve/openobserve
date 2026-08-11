import { describe, it, expect } from "vitest";

import { dbmEmptyAction, DBM_SETUP_ROUTE, type DbmEmptyActionKind } from "./emptyAction";
import type { DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";

/**
 * The regression these tests exist for: on a fresh install `DbmEmptyState`
 * resolves its cause to `not-instrumented` and labels the primary button
 * "Show me how to instrument it" — but both list pages branched only on
 * `filtered` and `not-counted`, so that button did nothing at all. It was the
 * first thing a new user clicked and the first thing that failed.
 */
describe("dbmEmptyAction", () => {
  it("sends the fresh-install cause to the setup instructions", () => {
    // The whole point: this is the default cause on a new deployment.
    expect(dbmEmptyAction("not-instrumented")).toBe("open-setup");
  });

  it("sends the disabled cause to setup too, where the prerequisite is explained", () => {
    expect(dbmEmptyAction("disabled")).toBe("open-setup");
  });

  it("clears filters when the emptiness is self-inflicted", () => {
    expect(dbmEmptyAction("filtered")).toBe("clear-filters");
  });

  it("re-reads when the data may simply not have landed yet", () => {
    expect(dbmEmptyAction("not-counted")).toBe("reload");
    expect(dbmEmptyAction("window-empty")).toBe("reload");
    expect(dbmEmptyAction("check-trace")).toBe("reload");
  });

  it("stays put when the user cannot fix it from here", () => {
    // Sending someone to a setup page they lack the grants to action is worse
    // than an inert button — it looks like the product misunderstood them.
    expect(dbmEmptyAction("no-permission")).toBe("none");
  });

  /**
   * The guard against the original bug reappearing. The old code was a pair of
   * `if`s, so a new cause silently fell through to doing nothing. Enumerating
   * every variant here means adding a cause without an action fails this test.
   */
  it("maps every cause to an action, leaving none to fall through", () => {
    const ALL_CAUSES: DbmEmptyCauseId[] = [
      "no-permission",
      "disabled",
      "not-instrumented",
      "not-counted",
      "window-empty",
      "filtered",
      "check-trace",
      "empty",
    ];
    const VALID: DbmEmptyActionKind[] = ["open-setup", "clear-filters", "reload", "none"];

    for (const cause of ALL_CAUSES) {
      expect(VALID, `cause "${cause}" has no action`).toContain(dbmEmptyAction(cause));
    }
  });

  it("points setup at the databases ingestion route", () => {
    expect(DBM_SETUP_ROUTE).toBe("databases");
  });
});
