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

import { wordFit } from "./wordFit";

const mono = (s: string) => s.length * 10;

describe("wordFit", () => {
  it("keeps text that fits", () => {
    expect(wordFit("Pause the alert", 150, mono)).toBe("Pause the alert");
  });

  it("cuts after the last whole word that fits with its ellipsis, never inside a word", () => {
    expect(wordFit("Pause the alert ta_approvals_rca_latency_high", 160, mono)).toBe(
      "Pause the alert…",
    );
    expect(wordFit("Pause the alert ta_approvals", 145, mono)).toBe("Pause the…");
  });

  it("cuts a first word too long for the room by character", () => {
    expect(wordFit("ta_approvals_rca_latency_high", 60, mono)).toBe("ta_ap…");
    expect(wordFit("abc", 5, mono)).toBe("");
  });
});
