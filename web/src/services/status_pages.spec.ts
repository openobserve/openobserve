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
vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

import http from "./http";
import analytics from "./product_analytics";
import statusPagesService from "./status_pages";

describe("status_pages service analytics", () => {
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

  it("tracks page and slug writes once they succeed", async () => {
    await statusPagesService.create("org1", { name: "Public" });
    await statusPagesService.rotateSlug("org1", "p1");
    await statusPagesService.delete("org1", "p1");
    await statusPagesService.update("org1", "p1", { name: "Public" });
    expect(analytics.track).not.toHaveBeenCalledWith("status_page_updated");
    expect(analytics.track).toHaveBeenCalledWith("status_page_created");
    expect(analytics.track).toHaveBeenCalledWith("status_page_slug_rotated");
    expect(analytics.track).toHaveBeenCalledWith("status_page_deleted");
  });

  it("tracks notice writes with the notice kind but never its text", async () => {
    await statusPagesService.createNotice("org1", "p1", {
      kind: 1,
      impact: 2,
      title: "Planned upgrade",
      body: "Details",
    });
    await statusPagesService.updateNotice("org1", "n1", { state: 2 });
    await statusPagesService.addNoticeUpdate("org1", "n1", "Fixed");
    await statusPagesService.markFalsePositive("org1", "n1", "Probe network fault");
    await statusPagesService.deleteNotice("org1", "n1");
    expect(analytics.track).toHaveBeenCalledWith("status_page_notice_created", {
      kind: "maintenance",
      impact: 2,
    });
    expect(analytics.track).not.toHaveBeenCalledWith(
      "status_page_notice_updated",
      expect.anything(),
    );
    expect(analytics.track).not.toHaveBeenCalledWith("status_page_notice_update_posted");
    expect(analytics.track).toHaveBeenCalledWith("status_page_notice_marked_false_positive");
    expect(analytics.track).toHaveBeenCalledWith("status_page_notice_deleted");
  });

  it("tracks custom domain writes", async () => {
    await statusPagesService.createDomain("org1", "p1", "status.example.com");
    await statusPagesService.verifyDomain("org1", "d1");
    await statusPagesService.deleteDomain("org1", "d1");
    expect(analytics.track).toHaveBeenCalledWith("status_page_domain_added");
    expect(analytics.track).toHaveBeenCalledWith("status_page_domain_verification_checked");
    expect(analytics.track).toHaveBeenCalledWith("status_page_domain_deleted");
  });

  it("does not track a write the server refused, nor any read", async () => {
    mockHttp.post.mockRejectedValueOnce(new Error("403"));
    await expect(statusPagesService.create("org1", { name: "Public" })).rejects.toThrow();
    await statusPagesService.list("org1");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
