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

import * as composerUiModule from "./composerUi";
import { composerPopoverClass } from "./composerUi";

describe("composer rows (S1)", () => {
  it("has no one-row decision left: the controls always sit under the text", () => {
    expect("composerFitsOneRow" in composerUiModule).toBe(false);
    expect("ONE_ROW_TEXT_PX" in composerUiModule).toBe(false);
  });
});

describe("composerPopoverClass", () => {
  it("takes 3 px a side off a 20 rem window", () => {
    expect(composerPopoverClass(true)).toContain("calc(20rem-0.375rem)");
    expect(composerPopoverClass(false)).toContain("min(20rem");
  });
});
