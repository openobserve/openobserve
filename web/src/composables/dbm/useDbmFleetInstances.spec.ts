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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDbmFleetInstances } from "@/composables/dbm/useDbmFleetInstances";
import dbMonitoringService from "@/services/db_monitoring";

vi.mock("@/services/db_monitoring", () => ({
  default: { getInstances: vi.fn() },
}));

const service = vi.mocked(dbMonitoringService);

/** Micros, five seconds past a minute boundary, so a nudge stays in the bucket. */
const START = 1_700_000_005_000_000;
const END = START + 3_600_000_000;

describe("loadDbmFleetInstances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getInstances.mockResolvedValue({
      data: { hits: [{ db_system: "postgresql", db_instance: "pg-1" }] },
    } as any);
  });

  /// Six DBM routes render the same picker, and each re-pins its anchor to the
  /// microsecond on load — which is why the key buckets the window instead of
  /// keying on the bounds it was handed.
  it("answers every tab in the same minute from one request", async () => {
    const first = await loadDbmFleetInstances({ org: "default", startTime: START, endTime: END });
    const second = await loadDbmFleetInstances({
      org: "default",
      startTime: START + 12_000_000,
      endTime: END + 12_000_000,
    });

    expect(service.getInstances).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  /// The bounds the request carries are the caller's own: bucketing the key
  /// must never round what is actually asked of the server.
  it("sends the caller's exact window, not the bucketed one", async () => {
    await loadDbmFleetInstances({ org: "default", startTime: START, endTime: END });

    expect(service.getInstances).toHaveBeenCalledWith("default", {
      startTime: START,
      endTime: END,
    });
  });

  it("re-asks once the window moves into another bucket", async () => {
    await loadDbmFleetInstances({ org: "default", startTime: START, endTime: END });
    await loadDbmFleetInstances({
      org: "default",
      startTime: START + 120_000_000,
      endTime: END + 120_000_000,
    });

    expect(service.getInstances).toHaveBeenCalledTimes(2);
  });

  /// One org's fleet is not another's.
  it("keeps orgs apart", async () => {
    await loadDbmFleetInstances({ org: "default", startTime: START, endTime: END });
    await loadDbmFleetInstances({ org: "other", startTime: START, endTime: END });

    expect(service.getInstances).toHaveBeenCalledTimes(2);
  });

  /// An empty picker and a failed one look identical, so a failure must not be
  /// held as though it were an answer.
  it("does not cache a failed read", async () => {
    service.getInstances.mockRejectedValueOnce(new Error("boom"));

    const failed = await loadDbmFleetInstances({ org: "default", startTime: START, endTime: END });
    const retried = await loadDbmFleetInstances({ org: "default", startTime: START, endTime: END });

    expect(failed).toEqual([]);
    expect(retried).toHaveLength(1);
    expect(service.getInstances).toHaveBeenCalledTimes(2);
  });
});
