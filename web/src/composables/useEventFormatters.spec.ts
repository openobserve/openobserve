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

import { describe, expect, it, vi, beforeEach } from "vitest";

// All external dependencies must be mocked before importing the composable.
vi.mock("@/utils/date", () => ({
  formatDate: vi.fn().mockReturnValue("Jan 01, 2024 00:00:00.000 +0000"),
}));

vi.mock("@/utils/zincutils", () => ({
  formatDuration: vi.fn().mockReturnValue("1.5s"),
}));

import { useEventFormatters } from "./useEventFormatters";
import { formatDate } from "@/utils/date";
import { formatDuration } from "@/utils/zincutils";

describe("useEventFormatters", () => {
  let formatters: ReturnType<typeof useEventFormatters>;

  beforeEach(() => {
    vi.clearAllMocks();
    formatters = useEventFormatters();
  });

  describe("formatTimestamp", () => {
    it("returns 'N/A' for 0 (falsy)", () => {
      expect(formatters.formatTimestamp(0)).toBe("N/A");
    });

    it("returns 'N/A' for null-like values cast to number", () => {
      expect(formatters.formatTimestamp(null as unknown as number)).toBe("N/A");
    });

    it("calls formatDate with Math.floor of the timestamp", () => {
      formatters.formatTimestamp(1704067200500.9);
      expect(formatDate).toHaveBeenCalledWith(
        1704067200500,
        "MMM DD, YYYY HH:mm:ss.SSS Z"
      );
    });

    it("returns the formatted string from formatDate", () => {
      const result = formatters.formatTimestamp(1704067200000);
      expect(result).toBe("Jan 01, 2024 00:00:00.000 +0000");
    });
  });

  describe("formatId", () => {
    it("returns empty string for empty string input", () => {
      expect(formatters.formatId("")).toBe("");
    });

    it("returns empty string for null-like input", () => {
      expect(formatters.formatId(null as unknown as string)).toBe("");
    });

    it("returns the id unchanged for a valid id", () => {
      expect(formatters.formatId("abc123")).toBe("abc123");
    });

    it("returns the id unchanged for a complex id string", () => {
      const id = "550e8400-e29b-41d4-a716-446655440000";
      expect(formatters.formatId(id)).toBe(id);
    });
  });

  describe("getStatusIcon", () => {
    it("returns 'help-outline' for 0 (falsy)", () => {
      expect(formatters.getStatusIcon(0)).toBe("help-outline");
    });

    it("returns 'help-outline' for null-like input", () => {
      expect(formatters.getStatusIcon(null as unknown as number)).toBe("help-outline");
    });

    it("returns 'check-circle' for status 200", () => {
      expect(formatters.getStatusIcon(200)).toBe("check-circle");
    });

    it("returns 'check-circle' for status 299 (boundary of 2xx)", () => {
      expect(formatters.getStatusIcon(299)).toBe("check-circle");
    });

    it("returns 'info' for status 301", () => {
      expect(formatters.getStatusIcon(301)).toBe("info");
    });

    it("returns 'info' for status 399 (boundary of 3xx)", () => {
      expect(formatters.getStatusIcon(399)).toBe("info");
    });

    it("returns 'warning' for status 400", () => {
      expect(formatters.getStatusIcon(400)).toBe("warning");
    });

    it("returns 'warning' for status 404", () => {
      expect(formatters.getStatusIcon(404)).toBe("warning");
    });

    it("returns 'error' for status 500", () => {
      expect(formatters.getStatusIcon(500)).toBe("error");
    });

    it("returns 'error' for status 503", () => {
      expect(formatters.getStatusIcon(503)).toBe("error");
    });
  });

  describe("getStatusColorClass", () => {
    it("returns 'tw:text-gray-500' for 0 (falsy)", () => {
      expect(formatters.getStatusColorClass(0)).toBe("tw:text-gray-500");
    });

    it("returns 'tw:text-gray-500' for null-like input", () => {
      expect(formatters.getStatusColorClass(null as unknown as number)).toBe("tw:text-gray-500");
    });

    it("returns positive color class for status 200", () => {
      expect(formatters.getStatusColorClass(200)).toBe("tw:text-[var(--o2-positive)]");
    });

    it("returns positive color class for status 201", () => {
      expect(formatters.getStatusColorClass(201)).toBe("tw:text-[var(--o2-positive)]");
    });

    it("returns info color class for status 301", () => {
      expect(formatters.getStatusColorClass(301)).toBe("tw:text-[var(--o2-info)]");
    });

    it("returns warning color class for status 404", () => {
      expect(formatters.getStatusColorClass(404)).toBe("tw:text-[var(--o2-warning)]");
    });

    it("returns negative color class for status 500", () => {
      expect(formatters.getStatusColorClass(500)).toBe("tw:text-[var(--o2-negative)]");
    });

    it("returns negative color class for status 502", () => {
      expect(formatters.getStatusColorClass(502)).toBe("tw:text-[var(--o2-negative)]");
    });
  });

  describe("formatResourceDuration", () => {
    it("returns 'N/A' for 0 (falsy)", () => {
      expect(formatters.formatResourceDuration(0)).toBe("N/A");
    });

    it("returns 'N/A' for null-like input", () => {
      expect(formatters.formatResourceDuration(null as unknown as number)).toBe("N/A");
    });

    it("converts milliseconds: divides by 1000 and calls formatDuration", () => {
      formatters.formatResourceDuration(1000);
      expect(formatDuration).toHaveBeenCalledWith(1);
    });

    it("returns the value from formatDuration when using milliseconds", () => {
      expect(formatters.formatResourceDuration(1000)).toBe("1.5s");
    });

    it("converts microseconds: divides by 1_000_000 and calls formatDuration", () => {
      formatters.formatResourceDuration(1000000, true);
      expect(formatDuration).toHaveBeenCalledWith(1);
    });

    it("returns the value from formatDuration when using microseconds", () => {
      expect(formatters.formatResourceDuration(1000000, true)).toBe("1.5s");
    });

    it("fromMicroseconds=false is the default behaviour", () => {
      formatters.formatResourceDuration(2000);
      expect(formatDuration).toHaveBeenCalledWith(2);
    });
  });

  describe("getEventTypeClass", () => {
    it("returns error CSS classes for type 'error'", () => {
      expect(formatters.getEventTypeClass("error")).toBe(
        "tw:bg-red-100 tw:text-red-700 tw:border tw:border-solid tw:border-red-300"
      );
    });

    it("returns action CSS classes for type 'action'", () => {
      expect(formatters.getEventTypeClass("action")).toBe(
        "tw:bg-blue-100 tw:text-blue-700 tw:border tw:border-solid tw:border-blue-300"
      );
    });

    it("returns view CSS classes for type 'view'", () => {
      expect(formatters.getEventTypeClass("view")).toBe(
        "tw:bg-green-100 tw:text-green-700 tw:border tw:border-solid tw:border-green-300"
      );
    });

    it("returns resource CSS classes for type 'resource'", () => {
      expect(formatters.getEventTypeClass("resource")).toBe(
        "tw:bg-purple-100 tw:text-purple-700 tw:border tw:border-solid tw:border-purple-300"
      );
    });

    it("returns default classes for an unknown type", () => {
      expect(formatters.getEventTypeClass("unknown")).toBe(
        "tw:bg-grey-100 tw:text-grey-700"
      );
    });

    it("returns default classes for an empty string type", () => {
      expect(formatters.getEventTypeClass("")).toBe("tw:bg-grey-100 tw:text-grey-700");
    });
  });
});
