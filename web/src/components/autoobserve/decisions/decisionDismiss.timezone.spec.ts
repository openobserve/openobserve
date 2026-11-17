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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decisionDismissDefaults } from "./decisionDismiss";

describe("planned work's default end in a half-hour zone", () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Kolkata";
  });
  afterAll(() => {
    process.env.TZ = zone;
  });

  it("ends_two_whole_local_hours_out", () => {
    // 21:10 IST is 15:40 UTC.
    const now = Date.UTC(2026, 10, 10, 15, 40);
    const form = decisionDismissDefaults(now);
    expect(form.untilDate).toBe("2026-11-10");
    expect(form.untilTime).toBe("23:00");
  });
});
