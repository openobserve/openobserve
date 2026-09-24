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

vi.mock("./http", () => ({
  default: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() })),
}));

import http from "./http";
import service from "./public_dashboards_admin";

describe("public_dashboards_admin service", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);
  });

  it("get() reads the share for a dashboard", async () => {
    await service.get("org1", "dash1");
    expect(mockHttp.get).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public");
  });

  it("publish() posts the config to the dashboard's public route", async () => {
    const cfg = { visibility: "public", rebuild_secs: 60 };
    await service.publish("org1", "dash1", cfg);
    expect(mockHttp.post).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public", cfg);
  });

  it("revoke() deletes the share", async () => {
    await service.revoke("org1", "dash1");
    expect(mockHttp.delete).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public");
  });
});
