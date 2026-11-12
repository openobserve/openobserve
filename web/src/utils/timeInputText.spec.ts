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
import { parseTimeInput, type ParsedTimeInput, type TimeInputOptions } from "./dateTimeRangeParse";
import { formatTimeInputText } from "./timeInputText";

const NOW = new Date(Date.UTC(2026, 10, 11, 12, 41, 53));
const OPTS: TimeInputOptions = { now: NOW, locale: "en-US", timeZone: "UTC" };

const roundTrip = (reading: ParsedTimeInput) => parseTimeInput(formatTimeInputText(reading), OPTS);

describe("formatTimeInputText", () => {
  it("writes whole days with an inclusive last day [#4]", () => {
    const reading = parseTimeInput("Nov 4 - 6", OPTS) as ParsedTimeInput;
    expect(formatTimeInputText(reading)).toBe("2026-11-04 to 2026-11-06");
    expect(roundTrip(reading)).toMatchObject(reading);
    const day = parseTimeInput("2026/11/04", OPTS) as ParsedTimeInput;
    expect(formatTimeInputText(day)).toBe("2026-11-04");
  });

  it("names a finished calendar period previous [#7]", () => {
    expect(formatTimeInputText({ type: "relative", period: "calendar:quarter:-1" })).toBe(
      "previous quarter",
    );
    expect(formatTimeInputText({ type: "relative", period: "calendar:year:-1" })).toBe(
      "previous year",
    );
    expect(parseTimeInput("previous year", OPTS)).toEqual({
      type: "relative",
      period: "calendar:year:-1",
    });
  });

  it("writes a business period by its name [#35]", () => {
    const reading = parseTimeInput("q3 2025", OPTS) as ParsedTimeInput;
    expect(formatTimeInputText(reading)).toBe("Q3 2025");
    expect(roundTrip(reading)).toMatchObject(reading);
  });

  it("spells months out", () => {
    expect(formatTimeInputText({ type: "relative", period: "15M" })).toBe("15mo");
  });
});
