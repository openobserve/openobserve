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
import { isFiringNow, type FiringRow } from "./firingAlerts";

const row = (over: Partial<FiringRow>): FiringRow => ({
  alert_id: "a",
  folder_id: "f",
  folder_name: "payments",
  name: "checkout_5xx_rate",
  alert_type: "scheduled",
  ...over,
});

describe("isFiringNow", () => {
  it.each([
    [{ last_outcome: "firing" }, true],
    [{ last_outcome: "notify_failed" }, true],
    [{ last_outcome: "normal", firing_started_at: 5 }, true],
    [{ last_outcome: "error", groups_firing: 2 }, true],
    [{ last_outcome: "error" }, false],
    [{ last_outcome: "normal" }, false],
    [{ last_outcome: "firing", enabled: false, firing_started_at: 5 }, false],
    [{ last_outcome: "firing", enabled: true }, true],
  ])("reads %j", (over, expected) => {
    expect(isFiringNow(row(over))).toBe(expected);
  });
});
