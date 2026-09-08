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

import { describe, it, expect, vi, beforeEach } from "vitest";

const reoTrack = vi.fn();
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: reoTrack }) }));
vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/aws-exports", () => ({
  default: { enableAnalytics: "true", isEnterprise: "false", isCloud: "false" },
}));

import segment from "@/services/segment_analytics";
import { usePaletteTelemetry } from "./usePaletteTelemetry";

const store = {
  state: { selectedOrganization: { identifier: "org1" }, userInfo: { email: "me@example.com" } },
};

describe("usePaletteTelemetry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the open event with its source to both sinks", () => {
    usePaletteTelemetry(store).trackOpen("header");
    const expected = { source: "header", user_org: "org1", user_id: "me@example.com" };
    expect(reoTrack).toHaveBeenCalledWith("Command Palette Open", expected);
    expect(segment.track).toHaveBeenCalledWith("Command Palette Open", expected);
  });

  it("sends the selection shape without the query text", () => {
    usePaletteTelemetry(store).trackSelect({
      type: "dashboard",
      position: 2,
      queryLength: 5,
      scopes: ["dashboard", "alert"],
    });
    const payload = (segment.track as any).mock.calls[0][1];
    expect(payload).toEqual({
      type: "dashboard",
      position: 2,
      query_length: 5,
      scopes: "dashboard,alert",
      user_org: "org1",
      user_id: "me@example.com",
    });
    expect(JSON.stringify(payload)).not.toContain('query":');
  });
});
