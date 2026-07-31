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
import { shouldReloadStreamFieldsForVisualize } from "./visualizeStreamFields";

describe("shouldReloadStreamFieldsForVisualize", () => {
  it("returns true when stream fields are not loaded yet", () => {
    expect(
      shouldReloadStreamFieldsForVisualize({
        selectedStream: ["default"],
        selectedStreamFields: [],
        interestingFieldList: [],
        quickMode: false,
      }),
    ).toBe(true);
  });

  it("returns true in quick mode when interesting fields are not loaded (refresh race)", () => {
    // On page reload the visualize toggle can run after selectedStreamFields
    // are restored but before interestingFieldList is populated. In quick
    // mode buildSearch() would then produce SELECT * and visualization
    // rejects it — so fields must be (re)extracted first.
    expect(
      shouldReloadStreamFieldsForVisualize({
        selectedStream: ["default"],
        selectedStreamFields: [{ name: "_timestamp" }],
        interestingFieldList: [],
        quickMode: true,
      }),
    ).toBe(true);
  });

  it("returns false when stream and interesting fields are loaded", () => {
    expect(
      shouldReloadStreamFieldsForVisualize({
        selectedStream: ["default"],
        selectedStreamFields: [{ name: "_timestamp" }],
        interestingFieldList: ["_timestamp"],
        quickMode: true,
      }),
    ).toBe(false);
  });

  it("returns false when no stream is selected", () => {
    expect(
      shouldReloadStreamFieldsForVisualize({
        selectedStream: [],
        selectedStreamFields: [],
        interestingFieldList: [],
        quickMode: true,
      }),
    ).toBe(false);
  });

  it("returns false outside quick mode when stream fields are loaded", () => {
    expect(
      shouldReloadStreamFieldsForVisualize({
        selectedStream: ["default"],
        selectedStreamFields: [{ name: "_timestamp" }],
        interestingFieldList: [],
        quickMode: false,
      }),
    ).toBe(false);
  });
});
