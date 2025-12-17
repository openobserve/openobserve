// Copyright 2025 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";
import incidents from "./incidents";
import http from "./http";

// Mock the http module
vi.mock("./http");

describe("incidents service", () => {
  const mockHttp = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (http as any).mockReturnValue(mockHttp);
  });

  describe("list", () => {
    it("should call http.get with correct URL for basic list", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=50&offset=0"
      );
    });

    it("should include status parameter when provided", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", "open");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=50&offset=0&status=open"
      );
    });

    it("should use custom limit and offset", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", undefined, 20, 10);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=20&offset=10"
      );
    });

    it("should include status with custom pagination", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", "resolved", 100, 50);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=100&offset=50&status=resolved"
      );
    });
  });

  describe("get", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          id: "incident-123",
          alerts: [],
        },
      });

      incidents.get("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123"
      );
    });
  });

  describe("updateStatus", () => {
    it("should call http.patch with correct URL and status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "acknowledged");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/status",
        { status: "acknowledged" }
      );
    });

    it("should handle open status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "open");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/status",
        { status: "open" }
      );
    });

    it("should handle resolved status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "resolved");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/status",
        { status: "resolved" }
      );
    });
  });

  describe("getStats", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          total_incidents: 10,
          open_incidents: 3,
          acknowledged_incidents: 2,
          resolved_incidents: 5,
        },
      });

      incidents.getStats("test-org");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/stats"
      );
    });
  });

  describe("triggerRca", () => {
    it("should call http.post with correct URL", () => {
      mockHttp.post.mockResolvedValue({
        data: { rca_content: "Analysis result" },
      });

      incidents.triggerRca("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca"
      );
    });
  });
});
