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

import { afterEach, describe, expect, it } from "vitest";

import { resetDecisions, switchDecisionsOrg, useDecisions } from "./useDecisions";

afterEach(() => resetDecisions());

describe("switchDecisionsOrg", () => {
  it("starts another org with no decisions and restores the first org's on the way back", () => {
    const { decisions, log, decide } = useDecisions();
    switchDecisionsOrg("u|a");
    decide("ask-1", "no");
    expect(decisions["ask-1"]).toBe("no");
    switchDecisionsOrg("u|b");
    expect(decisions["ask-1"]).toBeUndefined();
    expect(log).toHaveLength(0);
    decide("ask-2", "no");
    switchDecisionsOrg("u|a");
    expect(decisions).toEqual({ "ask-1": "no" });
    expect(log.map((entry) => entry.ledgerId)).toEqual(["ask-1"]);
  });

  it("keeps the same org's decisions when it is chosen again", () => {
    const { decisions, decide } = useDecisions();
    switchDecisionsOrg("u|c");
    decide("ask-3", "no");
    switchDecisionsOrg("u|c");
    expect(decisions["ask-3"]).toBe("no");
  });
});
