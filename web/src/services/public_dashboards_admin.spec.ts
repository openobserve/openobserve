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
import type { AxiosInstance } from "axios";

vi.mock("./http", () => ({ default: vi.fn() }));

import http from "./http";
import service, { type PublicLinkConfig } from "./public_dashboards_admin";

const cfg: PublicLinkConfig = {
  name: "NOC",
  visibility: "public",
  time_range: {
    ranges: [{ type: "relative", secs: 3600 }],
    default: { type: "relative", secs: 3600 },
  },
  frozen_variables: {},
  rebuild_secs: 60,
  expires_at: null,
};

describe("public_dashboards_admin service", () => {
  const mockHttp = {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(http).mockReturnValue(mockHttp as unknown as AxiosInstance);
  });

  it("lists the org's links and a dashboard's links", async () => {
    await service.listOrg("org1");
    await service.list("org1", "dash1");
    expect(mockHttp.get).toHaveBeenCalledWith("/api/org1/public_dashboards");
    expect(mockHttp.get).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public_links");
  });

  it("creates with POST and edits one link with PUT, without the global 403 toast", async () => {
    await service.create("org1", "dash1", cfg);
    await service.update("org1", "dash1", "l1", cfg);
    const silent = { silentForbidden: true };
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/org1/dashboards/dash1/public_links",
      cfg,
      silent,
    );
    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/org1/dashboards/dash1/public_links/l1",
      cfg,
      silent,
    );
  });

  it("pauses, resumes, rebuilds and revokes one link", async () => {
    await service.pause("org1", "dash1", "l1");
    await service.resume("org1", "dash1", "l1");
    await service.rebuild("org1", "dash1", "l1");
    await service.revoke("org1", "dash1", "l1");
    expect(mockHttp.post).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public_links/l1/pause");
    expect(mockHttp.post).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public_links/l1/resume");
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/org1/dashboards/dash1/public_links/l1/rebuild",
    );
    expect(mockHttp.delete).toHaveBeenCalledWith("/api/org1/dashboards/dash1/public_links/l1");
  });
});
