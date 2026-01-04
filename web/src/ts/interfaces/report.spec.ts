// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import type { ScheduledDashboardReport } from "./report";

describe("Report Interfaces", () => {
  describe("ScheduledDashboardReport", () => {
    it("should accept valid ScheduledDashboardReport with all fields", () => {
      const report: ScheduledDashboardReport = {
        "#": 1,
        name: "Daily Sales Report",
        tab: "overview",
        time_range: "Last 24 hours",
        frequency: "daily",
        last_triggered_at: "2024-01-15T08:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "org-123",
        isCached: true,
      };

      expect(report["#"]).toBe(1);
      expect(report.name).toBe("Daily Sales Report");
      expect(report.tab).toBe("overview");
      expect(report.time_range).toBe("Last 24 hours");
      expect(report.frequency).toBe("daily");
      expect(report.orgId).toBe("org-123");
      expect(report.isCached).toBe(true);
    });

    it("should accept report with null tab", () => {
      const report: ScheduledDashboardReport = {
        "#": 2,
        name: "Weekly Metrics Report",
        tab: null,
        time_range: "Last 7 days",
        frequency: "weekly",
        last_triggered_at: "2024-01-14T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "org-456",
        isCached: false,
      };

      expect(report.tab).toBeNull();
      expect(report.isCached).toBe(false);
    });

    it("should accept report with null time_range", () => {
      const report: ScheduledDashboardReport = {
        "#": 3,
        name: "Custom Report",
        tab: "metrics",
        time_range: null,
        frequency: "monthly",
        last_triggered_at: "2024-01-01T00:00:00Z",
        created_at: "2023-12-01T00:00:00Z",
        orgId: "org-789",
        isCached: true,
      };

      expect(report.time_range).toBeNull();
      expect(report.frequency).toBe("monthly");
    });

    it("should accept report with numeric orgId", () => {
      const report: ScheduledDashboardReport = {
        "#": 4,
        name: "Error Analysis Report",
        tab: "errors",
        time_range: "Last hour",
        frequency: "hourly",
        last_triggered_at: "2024-01-15T14:00:00Z",
        created_at: "2024-01-15T00:00:00Z",
        orgId: 12345,
        isCached: false,
      };

      expect(typeof report.orgId).toBe("number");
      expect(report.orgId).toBe(12345);
    });

    it("should accept report with string orgId", () => {
      const report: ScheduledDashboardReport = {
        "#": 5,
        name: "Performance Report",
        frequency: "daily",
        last_triggered_at: "2024-01-15T08:00:00Z",
        created_at: "2024-01-10T00:00:00Z",
        orgId: "org-abc-123",
        isCached: true,
      };

      expect(typeof report.orgId).toBe("string");
      expect(report.orgId).toBe("org-abc-123");
    });

    it("should handle different frequency values", () => {
      const frequencies = ["hourly", "daily", "weekly", "monthly", "custom"];

      frequencies.forEach((frequency, index) => {
        const report: ScheduledDashboardReport = {
          "#": index + 1,
          name: `${frequency} Report`,
          frequency,
          last_triggered_at: "2024-01-15T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId: `org-${index}`,
          isCached: index % 2 === 0,
        };

        expect(report.frequency).toBe(frequency);
        expect(report.isCached).toBe(index % 2 === 0);
      });
    });

    it("should handle sequential report numbers", () => {
      const reports: ScheduledDashboardReport[] = Array.from({ length: 10 }, (_, i) => ({
        "#": i + 1,
        name: `Report ${i + 1}`,
        frequency: "daily",
        last_triggered_at: "2024-01-15T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "org-test",
        isCached: false,
      }));

      reports.forEach((report, index) => {
        expect(report["#"]).toBe(index + 1);
        expect(report.name).toBe(`Report ${index + 1}`);
      });
    });

    it("should accept report with ISO timestamp formats", () => {
      const report: ScheduledDashboardReport = {
        "#": 1,
        name: "Timestamp Test Report",
        frequency: "daily",
        last_triggered_at: "2024-01-15T08:30:45.123Z",
        created_at: "2024-01-01T12:00:00.000Z",
        orgId: "org-timestamps",
        isCached: true,
      };

      expect(report.last_triggered_at).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(report.created_at).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should accept report with various time_range values", () => {
      const timeRanges = [
        "Last 5 minutes",
        "Last hour",
        "Last 24 hours",
        "Last 7 days",
        "Last 30 days",
        "Last 90 days",
        "Custom range",
        null,
      ];

      timeRanges.forEach((timeRange, index) => {
        const report: ScheduledDashboardReport = {
          "#": index + 1,
          name: `Report with ${timeRange || "no"} time range`,
          time_range: timeRange,
          frequency: "daily",
          last_triggered_at: "2024-01-15T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId: "org-test",
          isCached: false,
        };

        expect(report.time_range).toBe(timeRange);
      });
    });

    it("should accept report with various tab values", () => {
      const tabs = ["overview", "metrics", "logs", "traces", "alerts", "custom-tab", null];

      tabs.forEach((tab, index) => {
        const report: ScheduledDashboardReport = {
          "#": index + 1,
          name: `Report for ${tab || "no"} tab`,
          tab,
          frequency: "daily",
          last_triggered_at: "2024-01-15T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId: "org-test",
          isCached: true,
        };

        expect(report.tab).toBe(tab);
      });
    });

    it("should handle cached vs non-cached reports", () => {
      const cachedReport: ScheduledDashboardReport = {
        "#": 1,
        name: "Cached Report",
        frequency: "daily",
        last_triggered_at: "2024-01-15T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "org-1",
        isCached: true,
      };

      const nonCachedReport: ScheduledDashboardReport = {
        "#": 2,
        name: "Non-Cached Report",
        frequency: "hourly",
        last_triggered_at: "2024-01-15T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "org-2",
        isCached: false,
      };

      expect(cachedReport.isCached).toBe(true);
      expect(nonCachedReport.isCached).toBe(false);
    });

    it("should maintain type safety for all fields", () => {
      const report: ScheduledDashboardReport = {
        "#": 999,
        name: "Type Safety Test",
        tab: "test-tab",
        time_range: "Test Range",
        frequency: "custom",
        last_triggered_at: "2024-01-15T23:59:59Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "type-test-org",
        isCached: true,
      };

      // Type assertions to verify field types
      const reportNumber: number = report["#"];
      const reportName: string = report.name;
      const reportTab: string | null | undefined = report.tab;
      const reportTimeRange: string | null | undefined = report.time_range;
      const reportFrequency: string = report.frequency;
      const reportLastTriggered: string = report.last_triggered_at;
      const reportCreated: string = report.created_at;
      const reportOrgId: string | number = report.orgId;
      const reportCached: boolean = report.isCached;

      expect(typeof reportNumber).toBe("number");
      expect(typeof reportName).toBe("string");
      expect(typeof reportFrequency).toBe("string");
      expect(typeof reportLastTriggered).toBe("string");
      expect(typeof reportCreated).toBe("string");
      expect(["string", "number"]).toContain(typeof reportOrgId);
      expect(typeof reportCached).toBe("boolean");
    });

    it("should handle reports across different organizations", () => {
      const orgs = ["org-1", "org-2", "org-3", 123, 456, 789];

      orgs.forEach((orgId, index) => {
        const report: ScheduledDashboardReport = {
          "#": index + 1,
          name: `Org ${orgId} Report`,
          frequency: "daily",
          last_triggered_at: "2024-01-15T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId,
          isCached: index % 2 === 0,
        };

        expect(report.orgId).toBe(orgId);
      });
    });

    it("should handle report creation and trigger timestamps", () => {
      const now = new Date().toISOString();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const report: ScheduledDashboardReport = {
        "#": 1,
        name: "Recent Report",
        frequency: "daily",
        last_triggered_at: now,
        created_at: yesterday,
        orgId: "org-recent",
        isCached: false,
      };

      expect(new Date(report.last_triggered_at).getTime()).toBeGreaterThan(
        new Date(report.created_at).getTime()
      );
    });

    it("should handle reports with long names", () => {
      const longName =
        "Very Long Report Name That Describes Multiple Metrics And Analysis Points Across Different Time Periods And Services";

      const report: ScheduledDashboardReport = {
        "#": 1,
        name: longName,
        frequency: "weekly",
        last_triggered_at: "2024-01-15T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        orgId: "org-long-name",
        isCached: true,
      };

      expect(report.name).toBe(longName);
      expect(report.name.length).toBeGreaterThan(50);
    });

    it("should handle multiple reports in a collection", () => {
      const reports: ScheduledDashboardReport[] = [
        {
          "#": 1,
          name: "Morning Report",
          frequency: "daily",
          last_triggered_at: "2024-01-15T08:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId: "org-1",
          isCached: true,
        },
        {
          "#": 2,
          name: "Afternoon Report",
          frequency: "daily",
          last_triggered_at: "2024-01-15T14:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId: "org-1",
          isCached: false,
        },
        {
          "#": 3,
          name: "Evening Report",
          frequency: "daily",
          last_triggered_at: "2024-01-15T20:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          orgId: "org-1",
          isCached: true,
        },
      ];

      expect(reports).toHaveLength(3);
      expect(reports.every((r) => r.orgId === "org-1")).toBe(true);
      expect(reports.every((r) => r.frequency === "daily")).toBe(true);
    });
  });
});
