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

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() runs before any vi.mock() factory so the values are available
// inside factories without triggering the "Cannot access before initialization"
// TDZ error that affects regular `const` declarations.
// ─────────────────────────────────────────────────────────────────────────────
const { mockStore, mockShowErrorNotification, mockB64EncodeUnicode } =
  vi.hoisted(() => {
    const mockStore = {
      state: {
        zoConfig: {
          timestamp_column: "_timestamp",
          sql_base64_enabled: false,
        },
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    };
    const mockShowErrorNotification = vi.fn();
    const mockB64EncodeUnicode = vi.fn(
      (s: string) => btoa(unescape(encodeURIComponent(s)))
    );
    return { mockStore, mockShowErrorNotification, mockB64EncodeUnicode };
  });

vi.mock("vuex", () => ({
  useStore: vi.fn(() => mockStore),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({
    showErrorNotification: mockShowErrorNotification,
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: mockB64EncodeUnicode,
  addSpacesToOperators: vi.fn((s: string) => s),
}));

// Prevent onBeforeMount / onBeforeUnmount from running lifecycle callbacks
// outside of a component context (they would otherwise throw in tests).
vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    onBeforeMount: vi.fn(),
    onBeforeUnmount: vi.fn(),
  };
});

// Stub the SQL parser so importSqlParser() never hits the filesystem.
vi.mock("@/composables/useParser", () => ({
  default: vi.fn(() => ({
    sqlParser: vi.fn(async () => ({
      astify: vi.fn(),
      sqlify: vi.fn(),
    })),
  })),
}));

import useQuery from "./useQuery";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert seconds to microseconds */
const us = (seconds: number) => seconds * 1_000_000;

describe("useQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.state.zoConfig.sql_base64_enabled = false;
    mockStore.state.zoConfig.timestamp_column = "_timestamp";
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTimeInterval
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTimeInterval", () => {
    let getTimeInterval: ReturnType<typeof useQuery>["getTimeInterval"];

    beforeEach(() => {
      ({ getTimeInterval } = useQuery());
    });

    it("returns '10 second' / 'HH:mm:ss' for a range < 30 minutes", () => {
      const result = getTimeInterval(0, us(60 * 29));
      expect(result.interval).toBe("10 second");
      expect(result.keyFormat).toBe("HH:mm:ss");
    });

    it("returns '15 second' for a range >= 30 minutes", () => {
      const result = getTimeInterval(0, us(60 * 30));
      expect(result.interval).toBe("15 second");
      expect(result.keyFormat).toBe("HH:mm:ss");
    });

    it("returns '30 second' for a range >= 60 minutes", () => {
      const result = getTimeInterval(0, us(3600));
      expect(result.interval).toBe("30 second");
      expect(result.keyFormat).toBe("HH:mm:ss");
    });

    it("returns '1 minute' / 'MM-DD HH:mm' for a range >= 2 hours", () => {
      const result = getTimeInterval(0, us(3600 * 2));
      expect(result.interval).toBe("1 minute");
      expect(result.keyFormat).toBe("MM-DD HH:mm");
    });

    it("returns '5 minute' for a range >= 6 hours", () => {
      const result = getTimeInterval(0, us(3600 * 6));
      expect(result.interval).toBe("5 minute");
      expect(result.keyFormat).toBe("MM-DD HH:mm");
    });

    it("returns '30 minute' for a range >= 24 hours", () => {
      const result = getTimeInterval(0, us(3600 * 24));
      expect(result.interval).toBe("30 minute");
      expect(result.keyFormat).toBe("MM-DD HH:mm");
    });

    it("returns '1 hour' for a range >= 7 days", () => {
      const result = getTimeInterval(0, us(86400 * 7));
      expect(result.interval).toBe("1 hour");
      expect(result.keyFormat).toBe("MM-DD HH:mm");
    });

    it("returns '1 day' / 'YYYY-MM-DD' for a range >= 30 days", () => {
      const result = getTimeInterval(0, us(86400 * 30));
      expect(result.interval).toBe("1 day");
      expect(result.keyFormat).toBe("YYYY-MM-DD");
    });

    it("always returns an object with interval and keyFormat", () => {
      const result = getTimeInterval(0, 0);
      expect(result).toHaveProperty("interval");
      expect(result).toHaveProperty("keyFormat");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildQueryPayload
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildQueryPayload", () => {
    let buildQueryPayload: ReturnType<typeof useQuery>["buildQueryPayload"];

    beforeEach(() => {
      ({ buildQueryPayload } = useQuery());
    });

    it("returns an object with query and aggs keys", () => {
      const result = buildQueryPayload({
        streamName: "my-stream",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(result).toHaveProperty("query");
      expect(result).toHaveProperty("aggs");
    });

    it("replaces [INDEX_NAME] with the streamName", () => {
      const result = buildQueryPayload({
        streamName: "test-stream",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(result?.query.sql).toContain('"test-stream"');
      expect(result?.query.sql).not.toContain("[INDEX_NAME]");
    });

    it("replaces [INTERVAL] in the histogram aggregation", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "30 second",
      });
      expect(result?.aggs.histogram).toContain("'30 second'");
      expect(result?.aggs.histogram).not.toContain("[INTERVAL]");
    });

    it("replaces [WHERE_CLAUSE] with parsedQuery.whereClause", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
        parsedQuery: {
          queryFunctions: "",
          whereClause: "status = 'active'",
          limit: 0,
          query: "",
          offset: 0,
        },
      });
      expect(result?.query.sql).toContain("status = 'active'");
      expect(result?.query.sql).not.toContain("[WHERE_CLAUSE]");
    });

    it("replaces [QUERY_FUNCTIONS] with parsedQuery.queryFunctions", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
        parsedQuery: {
          queryFunctions: ", count(*) AS total",
          whereClause: "",
          limit: 0,
          query: "",
          offset: 0,
        },
      });
      expect(result?.query.sql).toContain(", count(*) AS total");
      expect(result?.query.sql).not.toContain("[QUERY_FUNCTIONS]");
    });

    it("uses default from=0 and size=100 when not provided", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(result?.query.from).toBe(0);
      expect(result?.query.size).toBe(100);
    });

    it("uses provided from and size values", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
        from: 50,
        size: 25,
      });
      expect(result?.query.from).toBe(50);
      expect(result?.query.size).toBe(25);
    });

    it("overrides start_time and end_time when timestamps are provided", () => {
      const startTime = 1_000_000;
      const endTime = 2_000_000;
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
        timestamps: { startTime, endTime },
      });
      expect(result?.query.start_time).toBe(startTime);
      expect(result?.query.end_time).toBe(endTime);
    });

    it("keeps default start/end_time (numbers) when timestamps are not provided", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(typeof result?.query.start_time).toBe("number");
      expect(typeof result?.query.end_time).toBe("number");
    });

    it("encodes sql and histogram with base64 when sql_base64_enabled is true", () => {
      mockStore.state.zoConfig.sql_base64_enabled = true;
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
        currentPage: 0,
      });
      expect(result?.encoding).toBe("base64");
      expect(mockB64EncodeUnicode).toHaveBeenCalled();
    });

    it("does not add encoding key when sql_base64_enabled is false", () => {
      mockStore.state.zoConfig.sql_base64_enabled = false;
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(result).not.toHaveProperty("encoding");
      expect(mockB64EncodeUnicode).not.toHaveBeenCalled();
    });

    it("uses store's timestamp_column in the histogram SQL", () => {
      mockStore.state.zoConfig.timestamp_column = "custom_ts";
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(result?.aggs.histogram).toContain("custom_ts");
    });

    it("uses _timestamp from store when timestamp_column is '_timestamp'", () => {
      const result = buildQueryPayload({
        streamName: "s",
        sqlMode: false,
        timeInterval: "10 second",
      });
      expect(result?.aggs.histogram).toContain("_timestamp");
    });

    it("calls showErrorNotification and returns undefined on internal error", () => {
      const result = buildQueryPayload(null as any);
      expect(mockShowErrorNotification).toHaveBeenCalledWith("Invalid SQL Syntax");
      expect(result).toBeUndefined();
    });
  });
});
