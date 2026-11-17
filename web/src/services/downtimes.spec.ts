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
import downtimes, { type DowntimeRequest } from "./downtimes";
import analytics from "./product_analytics";

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

const client = vi.hoisted(() => {
  const ok = () => Promise.resolve({ data: {} });
  return { post: vi.fn(ok), put: vi.fn(ok), patch: vi.fn(ok), delete: vi.fn(ok) };
});
vi.mock("./http", () => ({ default: vi.fn(() => client) }));

const body: DowntimeRequest = {
  folder_id: "default",
  targets: [{ module: "alerts", folders: { kind: "all" } }],
  schedule: { repeat: "weekly", starts_at: 1, timezone: "UTC", duration_secs: 60, weekdays: [1] },
  show_banner: false,
  alert_groups: [{ alert_id: "a", group_key: "g" }],
};

describe("downtimes service analytics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks each mutation once it succeeds", async () => {
    await downtimes.create("acme", body);
    await downtimes.update("acme", "d1", body);
    await downtimes.cancel("acme", "d1");
    await downtimes.extend("acme", "d1", { by_secs: 3600 });
    await downtimes.extend("acme", "d1", { until: 5 });
    await downtimes.test("acme", "d1", ["slack", "email"]);
    await downtimes.remove("acme", "d1");
    await downtimes.move("acme", ["d1", "d2"], "f2");
    expect(vi.mocked(analytics.track).mock.calls).toEqual([
      [
        "downtime_created",
        { repeat: "weekly", targets: 1, group_scoped: true, end_on_clear: false },
      ],
      ["downtime_updated", { repeat: "weekly" }],
      ["downtime_cancelled"],
      ["downtime_extended", { mode: "by" }],
      ["downtime_extended", { mode: "until" }],
      ["downtime_notification_test_sent", { count: 2 }],
      ["downtime_deleted", { count: 1 }],
      ["downtime_moved", { count: 2 }],
    ]);
  });

  it("does not track a failed mutation", async () => {
    client.post.mockRejectedValueOnce(new Error("boom"));
    await expect(downtimes.create("acme", body)).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
