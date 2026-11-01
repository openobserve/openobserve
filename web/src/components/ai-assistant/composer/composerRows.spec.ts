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

import { composerFitsOneRow, composerPopoverClass, type ComposerRowInput } from "./composerUi";

const ROW: ComposerRowInput = {
  narrow: false,
  extras: false,
  text: "",
  textWidth: 0,
  frameWidth: 406,
  controlsWidth: 216,
};

describe("composerFitsOneRow", () => {
  it("holds one row while the draft fits beside the controls", () => {
    expect(composerFitsOneRow(ROW)).toBe(true);
    expect(composerFitsOneRow({ ...ROW, text: "Find the cause", textWidth: 96 })).toBe(true);
  });

  it("moves the text above the controls once it no longer fits", () => {
    expect(composerFitsOneRow({ ...ROW, text: "long", textWidth: 180 })).toBe(false);
  });

  it("gives an empty draft's placeholder the same test, so it never wraps", () => {
    expect(composerFitsOneRow({ ...ROW, textWidth: 162 })).toBe(true);
    expect(composerFitsOneRow({ ...ROW, textWidth: 162.5 })).toBe(false);
  });

  it("always takes two rows when narrow, with extras, or on a second line", () => {
    expect(composerFitsOneRow({ ...ROW, narrow: true })).toBe(false);
    expect(composerFitsOneRow({ ...ROW, extras: true })).toBe(false);
    expect(composerFitsOneRow({ ...ROW, text: "a\nb" })).toBe(false);
  });

  it("stays on one row until the frame has been measured", () => {
    expect(composerFitsOneRow({ ...ROW, text: "x".repeat(200), frameWidth: 0 })).toBe(true);
  });
});

describe("composerPopoverClass", () => {
  it("takes 3 px a side off a 20 rem window", () => {
    expect(composerPopoverClass(true)).toContain("calc(20rem-0.375rem)");
    expect(composerPopoverClass(false)).toContain("min(20rem");
  });
});
