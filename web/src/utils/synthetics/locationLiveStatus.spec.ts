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

import { describe, it, expect } from "vitest";
import { locationLiveStatus } from "./locationLiveStatus";

describe("locationLiveStatus", () => {
  /**
   * The bug this exists for: a private location whose agents registered in
   * another region replicates here with no agent rows, so the server reports
   * `pending` — "go install an agent" — for a location that is up.
   */
  it("should report unknown when the region cannot see the agents", () => {
    expect(locationLiveStatus({ status: "pending", live_status_unknown: true })).toBe("unknown");
  });

  it("should pass the server status through when the flag is absent", () => {
    expect(locationLiveStatus({ status: "online" })).toBe("online");
    expect(locationLiveStatus({ status: "offline" })).toBe("offline");
    expect(locationLiveStatus({ status: "pending" })).toBe("pending");
  });

  /** A server without super cluster never sends the flag, so the old payload
   *  must resolve exactly as it did before the field existed. */
  it("should never report unknown for an explicitly false flag", () => {
    expect(locationLiveStatus({ status: "pending", live_status_unknown: false })).toBe("pending");
    expect(locationLiveStatus({ status: "offline", live_status_unknown: false })).toBe("offline");
  });

  /** Callers have their own handling for a payload with no status at all;
   *  inventing one here would change how they render an old server. */
  it("should pass undefined through untouched", () => {
    expect(locationLiveStatus({})).toBeUndefined();
  });
});
