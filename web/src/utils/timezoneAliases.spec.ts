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
import { canonicalTimezone } from "./timezoneAliases";

describe("canonicalTimezone", () => {
  it("maps a legacy ICU name to the current tz-database name", () => {
    expect(canonicalTimezone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalTimezone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(canonicalTimezone("Etc/UTC")).toBe("UTC");
  });

  it("leaves a canonical name alone", () => {
    expect(canonicalTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(canonicalTimezone("America/New_York")).toBe("America/New_York");
  });
});
