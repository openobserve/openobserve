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

import { describe, expect, it } from "vitest";

import { appliedPromotionOf, firstSentenceOf } from "./verdictText";

describe("appliedPromotionOf", () => {
  it("reads the applied level of an unclamped promotion", () => {
    expect(appliedPromotionOf("severity promoted P3 → P1: error rate tripled")).toBe("P1");
  });

  it("ignores a clamped promotion", () => {
    expect(
      appliedPromotionOf(
        "severity promoted P4 → P2 (the agent asked for P1, clamped to the promotion bound): x",
      ),
    ).toBeNull();
  });

  it("ignores a refused or discarded decision", () => {
    expect(appliedPromotionOf("severity unchanged (Refused { current: P3 }): x")).toBeNull();
    expect(appliedPromotionOf("")).toBeNull();
  });
});

describe("firstSentenceOf", () => {
  it("stops at the first sentence end", () => {
    expect(firstSentenceOf("Disk full on db-2. Paging the owner.")).toBe("Disk full on db-2.");
  });

  it("keeps a body with no sentence end and bounds its length", () => {
    expect(firstSentenceOf("  no stop here ")).toBe("no stop here");
    expect(firstSentenceOf("x".repeat(500))).toHaveLength(300);
  });
});
