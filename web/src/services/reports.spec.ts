// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi } from "vitest";
import reports from "@/services/reports";
import http from "@/services/http";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("reports service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("list", () => {
    it("should make GET request with empty query string when no optional params provided", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports?`
      );
    });

    it("should include folder_id in query string when provided", async () => {
      const org_identifier = "org123";
      const folder_id = "folder456";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier, folder_id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports?folder_id=${folder_id}`
      );
    });

    it("should include dashboard_id in query string when provided", async () => {
      const org_identifier = "org123";
      const folder_id = "";
      const dashboard_id = "dash789";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier, folder_id, dashboard_id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports?dashboard_id=${dashboard_id}`
      );
    });

    it("should include cache=true in query string when cache is true", async () => {
      const org_identifier = "org123";
      const folder_id = "";
      const dashboard_id = "";
      const cache = true;

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier, folder_id, dashboard_id, cache);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports?cache=true`
      );
    });

    it("should include all optional params when all are provided", async () => {
      const org_identifier = "org123";
      const folder_id = "folder456";
      const dashboard_id = "dash789";
      const cache = true;

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier, folder_id, dashboard_id, cache);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports?folder_id=${folder_id}&dashboard_id=${dashboard_id}&cache=${cache}`
      );
    });

    it("should include folder_id and dashboard_id but not cache when cache is false", async () => {
      const org_identifier = "org123";
      const folder_id = "folder456";
      const dashboard_id = "dash789";
      const cache = false;

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier, folder_id, dashboard_id, cache);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports?folder_id=${folder_id}&dashboard_id=${dashboard_id}`
      );
    });

    it("should use default values when called with only org_identifier", async () => {
      const org_identifier = "prod-org";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await reports.list(org_identifier);

      const calledUrl = mockHttpInstance.get.mock.calls[0][0];
      expect(calledUrl).toContain(`/api/prod-org/reports`);
    });
  });

  describe("getReport", () => {
    it("should make GET request to fetch a report by name", async () => {
      const org_identifier = "org123";
      const reportName = "my-report";

      mockHttpInstance.get.mockResolvedValue({ data: { name: "my-report" } });

      await reports.getReport(org_identifier, reportName);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}`
      );
    });

    it("should encode special characters in the report name", async () => {
      const org_identifier = "org123";
      const reportName = "my report with spaces";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await reports.getReport(org_identifier, reportName);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/my%20report%20with%20spaces`
      );
    });

    it("should encode slashes and other special characters in report name", async () => {
      const org_identifier = "org123";
      const reportName = "report/with/slashes";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await reports.getReport(org_identifier, reportName);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}`
      );
    });
  });

  describe("createReport", () => {
    it("should make POST request to create a report", async () => {
      const org_identifier = "org123";
      const payload = {
        name: "new-report",
        dashboards: [{ id: "dash1" }],
        frequency: { type: "daily" },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "report-new-1" } });

      await reports.createReport(org_identifier, payload);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports`,
        payload
      );
    });

    it("should pass the payload as the POST body", async () => {
      const org_identifier = "staging-org";
      const payload = { name: "minimal-report" };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await reports.createReport(org_identifier, payload);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(payload);
    });
  });

  describe("updateReport", () => {
    it("should make PUT request to update a report with encoded name", async () => {
      const org_identifier = "org123";
      const payload = {
        name: "existing-report",
        dashboards: [{ id: "dash2" }],
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await reports.updateReport(org_identifier, payload);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(payload.name)}`,
        payload
      );
    });

    it("should encode report name with spaces in the PUT URL", async () => {
      const org_identifier = "org123";
      const payload = { name: "my report with spaces", frequency: { type: "weekly" } };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await reports.updateReport(org_identifier, payload);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/my%20report%20with%20spaces`,
        payload
      );
    });

    it("should send the full payload as the PUT body", async () => {
      const org_identifier = "prod-org";
      const payload = {
        name: "my-report",
        enabled: true,
        dashboards: [{ id: "d1" }, { id: "d2" }],
      };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await reports.updateReport(org_identifier, payload);

      const callArgs = mockHttpInstance.put.mock.calls[0];
      expect(callArgs[1]).toEqual(payload);
    });
  });

  describe("deleteReport", () => {
    it("should make DELETE request to remove a report by name", async () => {
      const org_identifier = "org123";
      const reportName = "my-report";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await reports.deleteReport(org_identifier, reportName);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}`
      );
    });

    it("should encode special characters in report name for DELETE", async () => {
      const org_identifier = "org123";
      const reportName = "report with spaces";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await reports.deleteReport(org_identifier, reportName);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/report%20with%20spaces`
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request to bulk delete reports", async () => {
      const org_identifier = "org123";
      const data = { report_names: ["report1", "report2"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await reports.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/bulk`,
        { data }
      );
    });

    it("should wrap the data in a data property for the DELETE config", async () => {
      const org_identifier = "staging-org";
      const data = { report_names: ["report-abc"] };

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await reports.bulkDelete(org_identifier, data);

      const callArgs = mockHttpInstance.delete.mock.calls[0];
      expect(callArgs[1]).toEqual({ data });
    });
  });

  describe("triggerReport", () => {
    it("should make PUT request to trigger a report immediately", async () => {
      const org_identifier = "org123";
      const reportName = "my-report";

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await reports.triggerReport(org_identifier, reportName);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}/trigger`
      );
    });

    it("should encode report name with special characters in trigger URL", async () => {
      const org_identifier = "org123";
      const reportName = "daily report summary";

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await reports.triggerReport(org_identifier, reportName);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/daily%20report%20summary/trigger`
      );
    });
  });

  describe("toggleReportState", () => {
    it("should make PUT request to enable a report", async () => {
      const org_identifier = "org123";
      const reportName = "my-report";
      const state = true;

      mockHttpInstance.put.mockResolvedValue({ data: { enabled: true } });

      await reports.toggleReportState(org_identifier, reportName, state);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}/enable?value=${state}`
      );
    });

    it("should make PUT request to disable a report", async () => {
      const org_identifier = "org123";
      const reportName = "my-report";
      const state = false;

      mockHttpInstance.put.mockResolvedValue({ data: { enabled: false } });

      await reports.toggleReportState(org_identifier, reportName, state);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}/enable?value=false`
      );
    });

    it("should encode report name with special characters in toggle URL", async () => {
      const org_identifier = "org123";
      const reportName = "weekly report";
      const state = true;

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await reports.toggleReportState(org_identifier, reportName, state);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/reports/weekly%20report/enable?value=true`
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from list", async () => {
      const error = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(reports.list("org123")).rejects.toThrow("Network error");
    });

    it("should propagate errors from getReport", async () => {
      const error = new Error("Not found");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(reports.getReport("org123", "missing-report")).rejects.toThrow("Not found");
    });

    it("should propagate errors from createReport", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        reports.createReport("org123", { name: "bad-report" })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from updateReport", async () => {
      const error = new Error("Conflict");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        reports.updateReport("org123", { name: "conflict-report" })
      ).rejects.toThrow("Conflict");
    });

    it("should propagate errors from deleteReport", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(reports.deleteReport("org123", "locked-report")).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from triggerReport", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(reports.triggerReport("org123", "my-report")).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from toggleReportState", async () => {
      const error = new Error("Server error");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        reports.toggleReportState("org123", "my-report", true)
      ).rejects.toThrow("Server error");
    });
  });
});
