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
import { gt } from "@/types/i18n";
import { buildCalendarToken } from "@/utils/dashboard/calendarPeriods";
import {
  buildPanelTimeRange,
  convertPanelTimeRangeToPicker,
} from "@/utils/dashboard/panelTimeUtils";
import { dashboardShareKind, panelTimeChipLabel } from "./dashboardTimeLabels";

const MICROS = 1_000;
const chip = (value: Parameters<typeof buildPanelTimeRange>[0], timezone = "UTC") =>
  String(
    panelTimeChipLabel(convertPanelTimeRangeToPicker(buildPanelTimeRange(value)), timezone, gt),
  );

describe("panelTimeChipLabel", () => {
  it("names a rolling panel range by its short form", () => {
    expect(chip({ type: "relative", valueType: "relative", relativeTimePeriod: "15m" })).toBe(
      "15m",
    );
    expect(chip({ type: "relative", valueType: "relative", relativeTimePeriod: "2M" })).toBe("2mo");
  });

  it("names a calendar panel range by its period name", () => {
    expect(
      chip({
        type: "relative",
        valueType: "relative",
        relativeTimePeriod: buildCalendarToken("day", -1),
      }),
    ).toBe("Yesterday");
  });

  it("shows a fixed panel range's dates in the dashboard zone", () => {
    const start = Date.UTC(2026, 10, 15, 20, 0) * MICROS;
    const end = Date.UTC(2026, 10, 15, 20, 15) * MICROS;
    const label = chip(
      { type: "absolute", valueType: "absolute", startTime: start, endTime: end },
      "Asia/Kolkata",
    );
    expect(label).toMatch(/^Nov 16, (2026, )?01:30 – 01:45$/);
  });

  it("writes a fixed panel range's dates in the user's locale", () => {
    const start = Date.UTC(2026, 10, 15, 20, 0) * MICROS;
    const value = convertPanelTimeRangeToPicker(
      buildPanelTimeRange({
        type: "absolute",
        valueType: "absolute",
        startTime: start,
        endTime: start + 15 * 60e6,
      }),
    );
    expect(String(panelTimeChipLabel(value, "UTC", gt, "fr-FR"))).toMatch(/^15 nov\./);
  });

  it("is empty with no panel range", () => {
    expect(String(panelTimeChipLabel(null, "UTC", gt))).toBe("");
  });
});

describe("dashboardShareKind", () => {
  it("shares a finished calendar period as fixed dates (owner decision b)", () => {
    expect(dashboardShareKind(buildCalendarToken("day", -1))).toBe("fixed");
    expect(dashboardShareKind(buildCalendarToken("month", -1))).toBe("fixed");
    expect(dashboardShareKind(buildCalendarToken("quarter", -2))).toBe("fixed");
  });

  it("keeps rolling ranges and periods still running live", () => {
    expect(dashboardShareKind("6h")).toBe("live");
    expect(dashboardShareKind(buildCalendarToken("week", 0))).toBe("live");
  });

  it("has nothing live to share for a fixed range", () => {
    expect(dashboardShareKind(null)).toBe("fixed");
  });
});
