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
import alertCalibration from "./alert_calibration";
import analytics from "./product_analytics";

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

const client = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock("./http", () => ({ default: vi.fn(() => client) }));

describe("alert calibration service analytics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks a saved config with its stored values", async () => {
    client.put.mockResolvedValue({
      data: { enabled: true, frequency_minutes: 1440, window_minutes: 10080 },
    });
    await alertCalibration.updateConfig("acme", { enabled: true });
    expect(analytics.track).toHaveBeenCalledWith("alert_calibration_settings_updated", {
      enabled: true,
      frequency_minutes: 1440,
      window_minutes: 10080,
    });
  });

  it("tracks a requested run, and nothing when the request fails", async () => {
    client.post.mockResolvedValueOnce({ data: {} });
    await alertCalibration.requestRun("acme");
    expect(analytics.track).toHaveBeenCalledWith("alert_calibration_run_requested");
    vi.mocked(analytics.track).mockClear();
    client.post.mockRejectedValueOnce(new Error("boom"));
    await expect(alertCalibration.requestRun("acme")).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
