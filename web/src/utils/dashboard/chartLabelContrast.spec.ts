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
import { colorLuminance, labelColorOn, withLightness } from "./chartLabelContrast";

describe("chart label contrast", () => {
  it("reads hex, rgb and hsl colours and rejects anything else", () => {
    expect(colorLuminance("#ffffff")).toBeCloseTo(1);
    expect(colorLuminance("rgb(0, 0, 0)")).toBeCloseTo(0);
    expect(colorLuminance("hsl(0, 0%, 100%)")).toBeCloseTo(1);
    expect(colorLuminance("not a colour")).toBeNull();
    expect(colorLuminance(undefined)).toBeNull();
  });

  it("picks the text colour with the higher contrast, the same in both themes", () => {
    expect(labelColorOn("#7f1d1d")).toBe("#ffffff");
    expect(labelColorOn("#1d4ed8")).toBe("#ffffff");
    expect(labelColorOn("#fde68a")).toBe("#000000");
    expect(labelColorOn("#22d3ee")).toBe("#000000");
    // An unreadable colour falls back to the inverse text token.
    expect(labelColorOn("nope")).toBe("#ffffff");
  });

  it("sets HSL lightness the way a treemap colour range does", () => {
    expect(colorLuminance(withLightness("#ff0000", 0.9))!).toBeGreaterThan(
      colorLuminance("#ff0000")!,
    );
    expect(colorLuminance(withLightness("#ff0000", 0.2))!).toBeLessThan(colorLuminance("#ff0000")!);
  });
});
