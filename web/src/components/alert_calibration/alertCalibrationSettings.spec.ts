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
import { changedFields, scheduleWarnings } from "./alertCalibrationSettings";

const saved = { enabled: true, frequency_minutes: 1440, window_minutes: 43_200 };

describe("saving the alert calibration settings", () => {
  it("sends only the fields that changed", () => {
    expect(changedFields(saved, { ...saved })).toEqual({});
    expect(changedFields(saved, { ...saved, window_minutes: 20_160 })).toEqual({
      window_minutes: 20_160,
    });
    expect(changedFields(saved, { ...saved, enabled: false, frequency_minutes: 60 })).toEqual({
      enabled: false,
      frequency_minutes: 60,
    });
  });
});

describe("the schedule warnings", () => {
  it("stay quiet for a window that covers every rule and every gap", () => {
    expect(scheduleWarnings(gt, 1440, 43_200)).toEqual([]);
  });

  it("name the rules a short window starves, with what each needs", () => {
    expect(scheduleWarnings(gt, 1440, 20_160)).toEqual([
      "A window of 14 days is too short for Silent (needs 30 days), so every run declines them for every alert.",
    ]);
  });

  it("warn that a cadence longer than the window leaves time unanalysed", () => {
    const [gap] = scheduleWarnings(gt, 10_080, 1440);
    expect(gap).toBe(
      "Runs every 7 days but looks back only 1 day, so the time between windows is never analysed.",
    );
  });
});
