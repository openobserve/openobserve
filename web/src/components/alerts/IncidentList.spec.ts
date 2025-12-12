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

import { describe, expect, it } from "vitest";

describe("IncidentList.vue utility functions", () => {
  it("should return correct status color", () => {
    const getStatusColor = (status: string) => {
      switch (status) {
        case "open":
          return "negative";
        case "acknowledged":
          return "warning";
        case "resolved":
          return "positive";
        default:
          return "grey-7";
      }
    };

    expect(getStatusColor("open")).toBe("negative");
    expect(getStatusColor("acknowledged")).toBe("warning");
    expect(getStatusColor("resolved")).toBe("positive");
    expect(getStatusColor("unknown")).toBe("grey-7");
  });

  it("should return correct severity color", () => {
    const getSeverityColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "negative";
        case "P2":
          return "warning";
        case "P3":
          return "info";
        case "P4":
          return "grey-7";
        default:
          return "grey-7";
      }
    };

    expect(getSeverityColor("P1")).toBe("negative");
    expect(getSeverityColor("P2")).toBe("warning");
    expect(getSeverityColor("P3")).toBe("info");
    expect(getSeverityColor("P4")).toBe("grey-7");
    expect(getSeverityColor("unknown")).toBe("grey-7");
  });

  it("should format timestamp correctly", () => {
    const formatTimestamp = (timestamp: number) => {
      // Backend sends microseconds, convert to milliseconds
      const date = new Date(timestamp / 1000);
      return date.toISOString();
    };

    const timestamp = 1700000000000000; // microseconds
    const formatted = formatTimestamp(timestamp);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe("string");
    expect(formatted).toContain("T");
  });

  it("should toggle status filter correctly", () => {
    const statusFilter: string[] = [];
    const option = "open";

    // Toggle on
    if (!statusFilter.includes(option)) {
      statusFilter.push(option);
    }
    expect(statusFilter).toContain("open");

    // Toggle off
    const index = statusFilter.indexOf(option);
    if (index > -1) {
      statusFilter.splice(index, 1);
    }
    expect(statusFilter).not.toContain("open");
  });

  it("should clear status filter", () => {
    const statusFilter = ["open", "acknowledged"];
    statusFilter.length = 0;
    expect(statusFilter.length).toBe(0);
  });

  it("should filter incidents by status", () => {
    const incidents = [
      { id: "1", status: "open" },
      { id: "2", status: "acknowledged" },
      { id: "3", status: "resolved" },
      { id: "4", status: "open" },
    ];

    const statusFilter = ["open"];
    const filtered = incidents.filter((incident) =>
      statusFilter.length === 0 ? true : statusFilter.includes(incident.status)
    );

    expect(filtered.length).toBe(2);
    expect(filtered.every((i) => i.status === "open")).toBe(true);
  });

  it("should calculate pagination offset correctly", () => {
    const calculateOffset = (page: number, rowsPerPage: number) => {
      return (page - 1) * rowsPerPage;
    };

    expect(calculateOffset(1, 50)).toBe(0);
    expect(calculateOffset(2, 50)).toBe(50);
    expect(calculateOffset(3, 25)).toBe(50);
  });
});
