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
import { pickerSlack, toggleGroupWidths } from "./logsToolbarLayout";

const box = (width: number) =>
  ({ getBoundingClientRect: () => ({ width }) }) as unknown as HTMLElement;

describe("toggleGroupWidths (B1)", () => {
  it("counts the Timechart tab when it is on", () => {
    expect(toggleGroupWidths(true, false)).toEqual({ labels: 367, icons: 168 });
    expect(toggleGroupWidths(true, true)).toEqual({ labels: 483, icons: 204 });
    expect(toggleGroupWidths(false, true)).toEqual({ labels: 503, icons: 204 });
  });
});

describe("pickerSlack (B1, V1)", () => {
  it("is what the trigger button can shed, not the whole picker group", () => {
    const picker = { $el: box(386), triggerElement: box(272), shortestFormWidth: () => 180 };
    expect(pickerSlack(picker)).toBe(92);
  });

  it("is 0 before the picker can measure its forms", () => {
    expect(pickerSlack(null)).toBe(0);
    expect(pickerSlack({ triggerElement: box(200), shortestFormWidth: () => 0 })).toBe(0);
    expect(pickerSlack({ triggerElement: box(150), shortestFormWidth: () => 180 })).toBe(0);
  });
});
