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

import { describe, it, expect } from "vitest";

import { dbmEmptyAction, DBM_SETUP_ROUTE, type DbmEmptyActionKind } from "./emptyAction";
import type { DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";

/**
 * `DbmEmptyState` labels its primary button from the resolved cause ("Show me
 * how to instrument it"), so a cause with no mapped action is a dead click on
 * the most prominent button on the page — and on a fresh install the cause is
 * `not-instrumented`, the first thing a new user presses.
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

  it("maps the bare empty cause to no action", () => {
    // "empty" is the generic nothing-here cause: there is no filter to clear
    // and nothing to set up, so the honest outcome is to stay put.
    expect(dbmEmptyAction("empty")).toBe("none");
  });

  /**
   * What this sweep actually guarantees: every enumerated cause resolves to an
   * action the pages implement — a new ACTION kind nobody wired up fails here.
   * Exhaustiveness over new CAUSES is the compiler's job, not this test's: the
   * switch in emptyAction.ts has no default and a declared return type, so an
   * unhandled cause is a type error before it ever reaches this list.
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
