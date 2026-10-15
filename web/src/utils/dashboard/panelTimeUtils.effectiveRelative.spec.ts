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
import { isEffectivePanelTimeRelative } from "./panelTimeUtils";

const RELATIVE = { valueType: "relative" };
const ABSOLUTE = { valueType: "absolute" };

const panel = (config: Record<string, any> = {}) => ({ id: "P1", config });

describe("isEffectivePanelTimeRelative", () => {
  it("follows the global picker for a panel without its own time", () => {
    expect(isEffectivePanelTimeRelative(panel(), {}, RELATIVE)).toBe(true);
    expect(isEffectivePanelTimeRelative(panel(), {}, ABSOLUTE)).toBe(false);
  });

  it("uses the panel's saved range while panel time is on", () => {
    const relativePanel = panel({
      panel_time_enabled: true,
      panel_time_range: { type: "relative", relativeTimePeriod: "1h" },
    });
    const absolutePanel = panel({
      panel_time_enabled: true,
      panel_time_range: { type: "absolute", startTime: 1, endTime: 2 },
    });

    expect(isEffectivePanelTimeRelative(relativePanel, {}, ABSOLUTE)).toBe(true);
    expect(isEffectivePanelTimeRelative(absolutePanel, {}, RELATIVE)).toBe(false);
  });

  it("ignores a saved range while panel time is off", () => {
    const panelTimeOff = panel({
      panel_time_enabled: false,
      panel_time_range: { type: "absolute", startTime: 1, endTime: 2 },
    });

    expect(isEffectivePanelTimeRelative(panelTimeOff, {}, RELATIVE)).toBe(true);
  });

  it("lets the panel's URL time win over its saved range", () => {
    const savedRelative = panel({
      panel_time_enabled: true,
      panel_time_range: { type: "relative", relativeTimePeriod: "1h" },
    });

    expect(
      isEffectivePanelTimeRelative(savedRelative, { "pt-from.P1": "1", "pt-to.P1": "2" }, RELATIVE),
    ).toBe(false);
    expect(
      isEffectivePanelTimeRelative(
        panel({ panel_time_enabled: true }),
        { "pt-period.P1": "5m" },
        ABSOLUTE,
      ),
    ).toBe(true);
  });

  it("falls back to the global picker when panel time is on without a range", () => {
    expect(isEffectivePanelTimeRelative(panel({ panel_time_enabled: true }), {}, RELATIVE)).toBe(
      true,
    );
  });

  it("is not relative before the global picker is set", () => {
    expect(isEffectivePanelTimeRelative(panel(), {}, null)).toBe(false);
  });
});
