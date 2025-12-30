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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSearchPagination } from "./useSearchPagination";
import { searchState } from "./searchState";

// Create a shared mock state
const createMockState = () => ({
  searchObj: {
    data: {
      queryResults: {
        hits: [],
        aggs: [],
        total: 0,
        from: 0,
        scan_size: 0,
        took: 0,
        pagination: [],
        pageCountTotal: undefined,
      },
      resultGrid: { currentPage: 1 },
    },
    meta: {
      jobId: "",
      resultGrid: { rowsPerPage: 100 },
      refreshInterval: 0,
    },
  },
  notificationMsg: { value: "" },
});

let mockState: ReturnType<typeof createMockState>;

// Mock dependencies
vi.mock("./searchState", () => ({
  searchState: vi.fn(() => mockState),
}));

describe("useSearchPagination", () => {
  let pagination: ReturnType<typeof useSearchPagination>;

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    pagination = useSearchPagination();
  });

  describe("getAggsTotal", () => {
    it("should return 0 for empty aggs", () => {
      mockState.searchObj.data.queryResults.aggs = [];

      const total = pagination.getAggsTotal();
      expect(total).toBe(0);
    });

    it("should sum zo_sql_num values from aggs", () => {
      mockState.searchObj.data.queryResults.aggs = [
        { zo_sql_key: "2024-01-01", zo_sql_num: 100 },
        { zo_sql_key: "2024-01-02", zo_sql_num: 150 },
        { zo_sql_key: "2024-01-03", zo_sql_num: 200 },
      ];

      const total = pagination.getAggsTotal();
      expect(total).toBe(450);
    });

    it("should handle null aggs array", () => {
      mockState.searchObj.data.queryResults.aggs = null as any;

      const total = pagination.getAggsTotal();
      expect(total).toBe(0);
    });
  });

  describe("refreshPagination", () => {
    it("should generate pagination for multiple pages", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 1;
      mockState.searchObj.data.queryResults.aggs = [
        { zo_sql_key: "key1", zo_sql_num: 250 },
      ];

      pagination.refreshPagination();

      expect(mockState.searchObj.data.queryResults.total).toBe(250);
      expect(mockState.searchObj.data.queryResults.pagination.length).toBe(3);
      expect(mockState.searchObj.data.queryResults.pagination[0]).toEqual({
        from: 1,
        size: 100,
      });
      expect(mockState.searchObj.data.queryResults.pagination[1]).toEqual({
        from: 101,
        size: 100,
      });
    });

    it("should use pageCountTotal when greater than aggs total", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 1;
      mockState.searchObj.data.queryResults.aggs = [
        { zo_sql_key: "key1", zo_sql_num: 100 },
      ];
      mockState.searchObj.data.queryResults.pageCountTotal = 500;

      pagination.refreshPagination();

      expect(mockState.searchObj.data.queryResults.total).toBe(500);
    });

    it("should limit pagination to currentPage + 10", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 10;
      mockState.searchObj.data.resultGrid.currentPage = 5;
      mockState.searchObj.data.queryResults.aggs = [
        { zo_sql_key: "key1", zo_sql_num: 1000 },
      ];

      pagination.refreshPagination();

      // Should generate pages up to currentPage + 10 = 15
      expect(mockState.searchObj.data.queryResults.pagination.length).toBe(15);
    });

    it("should set rowsPerPage to 100 when jobId is set", () => {
      // Use mockState directly
      mockState.searchObj.meta.jobId = "job-123";
      mockState.searchObj.meta.resultGrid.rowsPerPage = 50;
      mockState.searchObj.data.queryResults.aggs = [];

      pagination.refreshPagination();

      expect(mockState.searchObj.meta.resultGrid.rowsPerPage).toBe(100);
    });

    it("should handle errors gracefully", () => {
      // Use mockState directly
      // Intentionally corrupt the state to trigger error by making resultGrid throw on access
      Object.defineProperty(mockState.searchObj.meta, "resultGrid", {
        get() {
          throw new Error("Test error");
        },
      });

      const result = pagination.refreshPagination();

      expect(result).toBe(false);
      expect(mockState.notificationMsg.value).toContain(
        "Error while refreshing partition pagination"
      );
    });
  });

  describe("calculatePageInfo", () => {
    it("should calculate page info correctly", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 2;
      mockState.searchObj.data.queryResults.total = 350;

      const pageInfo = pagination.calculatePageInfo();

      expect(pageInfo).toEqual({
        totalPages: 4,
        from: 101,
        to: 200,
        total: 350,
        currentPage: 2,
        rowsPerPage: 100,
      });
    });

    it("should handle last page correctly", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 4;
      mockState.searchObj.data.queryResults.total = 350;

      const pageInfo = pagination.calculatePageInfo();

      expect(pageInfo.to).toBe(350);
      expect(pageInfo.totalPages).toBe(4);
    });

    it("should handle empty results", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 1;
      mockState.searchObj.data.queryResults.total = 0;

      const pageInfo = pagination.calculatePageInfo();

      expect(pageInfo).toEqual({
        totalPages: 0,
        from: 1,
        to: 0,
        total: 0,
        currentPage: 1,
        rowsPerPage: 100,
      });
    });
  });

  describe("resetPagination", () => {
    it("should reset pagination state", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.pagination = [
        { from: 1, size: 100 },
        { from: 101, size: 100 },
      ];
      mockState.searchObj.data.queryResults.total = 500;
      mockState.searchObj.data.queryResults.pageCountTotal = 500;

      pagination.resetPagination();

      expect(mockState.searchObj.data.queryResults.pagination).toEqual([]);
      expect(mockState.searchObj.data.queryResults.total).toBe(0);
      expect(mockState.searchObj.data.queryResults.pageCountTotal).toBeUndefined();
    });
  });

  describe("shouldGetPageCount", () => {
    it("should return false for queries with LIMIT", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM stream LIMIT 100" },
      };

      const result = pagination.shouldGetPageCount(queryReq);
      expect(result).toBe(false);
    });

    it("should return false for queries with DISTINCT", () => {
      const queryReq = {
        query: { sql: "SELECT DISTINCT field FROM stream" },
      };

      const result = pagination.shouldGetPageCount(queryReq);
      expect(result).toBe(false);
    });

    it("should return false for queries with GROUP BY", () => {
      const queryReq = {
        query: { sql: "SELECT COUNT(*) FROM stream GROUP BY field" },
      };

      const result = pagination.shouldGetPageCount(queryReq);
      expect(result).toBe(false);
    });

    it("should return true for simple queries", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM stream" },
      };

      const result = pagination.shouldGetPageCount(queryReq);
      expect(result).toBe(true);
    });

    it("should return false for invalid queryReq", () => {
      expect(pagination.shouldGetPageCount(null)).toBe(false);
      expect(pagination.shouldGetPageCount({})).toBe(false);
      // Empty query object without SQL returns true (since there's no LIMIT/DISTINCT/GROUP BY)
      expect(pagination.shouldGetPageCount({ query: {} })).toBe(true);
    });
  });

  describe("updatePageCountTotal", () => {
    it("should update page count when at boundary", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 2;

      const queryReq = {
        query: { size: 100, sql: "SELECT * FROM stream" },
      };

      pagination.updatePageCountTotal(queryReq, 100, 100);

      expect(mockState.searchObj.data.queryResults.pageCountTotal).toBe(201);
    });

    it("should update page count when not at boundary", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 2;

      const queryReq = {
        query: { size: 100, sql: "SELECT * FROM stream" },
      };

      pagination.updatePageCountTotal(queryReq, 75, 75);

      expect(mockState.searchObj.data.queryResults.pageCountTotal).toBe(175);
    });

    it("should not update for queries that do not support page count", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.pageCountTotal = undefined;

      const queryReq = {
        query: { size: 100, sql: "SELECT * FROM stream LIMIT 100" },
      };

      pagination.updatePageCountTotal(queryReq, 100, 100);

      expect(mockState.searchObj.data.queryResults.pageCountTotal).toBeUndefined();
    });
  });

  describe("trimPageCountExtraHit", () => {
    it("should trim last hit when at page boundary", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ];

      const queryReq = {
        query: { size: 3, sql: "SELECT * FROM stream" },
      };

      pagination.trimPageCountExtraHit(queryReq, 3);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(2);
      expect(mockState.searchObj.data.queryResults.hits[1].id).toBe(2);
    });

    it("should not trim when not at boundary", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [{ id: 1 }, { id: 2 }];

      const queryReq = {
        query: { size: 3, sql: "SELECT * FROM stream" },
      };

      pagination.trimPageCountExtraHit(queryReq, 2);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(2);
    });

    it("should not trim for queries with LIMIT", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.hits = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ];

      const queryReq = {
        query: { size: 3, sql: "SELECT * FROM stream LIMIT 100" },
      };

      pagination.trimPageCountExtraHit(queryReq, 3);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(3);
    });
  });

  describe("getCurrentPageData", () => {
    it("should return current page data", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 2;
      mockState.searchObj.data.resultGrid.currentPage = 2;
      mockState.searchObj.data.queryResults.total = 5;
      mockState.searchObj.data.queryResults.hits = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ];

      const result = pagination.getCurrentPageData();

      expect(result.data.length).toBe(2);
      expect(result.data[0].id).toBe(3);
      expect(result.data[1].id).toBe(4);
      expect(result.pageInfo.currentPage).toBe(2);
    });

    it("should handle empty hits", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.resultGrid.currentPage = 1;
      mockState.searchObj.data.queryResults.hits = [];

      const result = pagination.getCurrentPageData();

      expect(result.data).toEqual([]);
    });
  });

  describe("chunkedAppend", () => {
    it("should append items in chunks", async () => {
      const target: any[] = [];
      const source = Array.from({ length: 15000 }, (_, i) => ({ id: i }));

      await pagination.chunkedAppend(target, source);

      expect(target.length).toBe(15000);
      expect(target[0].id).toBe(0);
      expect(target[14999].id).toBe(14999);
    });

    it("should handle small arrays", async () => {
      const target: any[] = [];
      const source = [{ id: 1 }, { id: 2 }, { id: 3 }];

      await pagination.chunkedAppend(target, source);

      expect(target.length).toBe(3);
    });

    it("should append to existing array", async () => {
      const target = [{ id: 0 }];
      const source = [{ id: 1 }, { id: 2 }];

      await pagination.chunkedAppend(target, source);

      expect(target.length).toBe(3);
      expect(target[0].id).toBe(0);
      expect(target[2].id).toBe(2);
    });
  });

  describe("handlePageCountResponse", () => {
    it("should process page count response", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.queryResults.aggs = [];

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            hits: Array.from({ length: 100 }, (_, i) => ({
              zo_sql_key: `key-${i}`,
              zo_sql_num: 10,
            })),
            scan_size: 5000,
            took: 100,
          },
        },
      };

      pagination.handlePageCountResponse(queryReq, "trace-123", response);

      expect(mockState.searchObj.data.queryResults.aggs.length).toBe(100);
      expect(mockState.searchObj.data.queryResults.scan_size).toBe(5000);
      expect(mockState.searchObj.data.queryResults.took).toBe(100);
    });

    it("should initialize aggs if null", () => {
      // Use mockState directly
      mockState.searchObj.data.queryResults.aggs = null as any;

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            hits: [],
            scan_size: 0,
            took: 0,
          },
        },
      };

      pagination.handlePageCountResponse(queryReq, "trace-123", response);

      expect(Array.isArray(mockState.searchObj.data.queryResults.aggs)).toBe(true);
    });

    it("should set regenerate flag when hits length differs from rowsPerPage", () => {
      // Use mockState directly
      mockState.searchObj.meta.resultGrid.rowsPerPage = 100;
      mockState.searchObj.data.queryResults.aggs = [];

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            hits: Array.from({ length: 75 }, (_, i) => ({
              zo_sql_key: `key-${i}`,
              zo_sql_num: 10,
            })),
            scan_size: 3750,
            took: 80,
          },
        },
      };

      pagination.handlePageCountResponse(queryReq, "trace-123", response);

      expect(mockState.searchObj.data.queryResults.aggs.length).toBe(75);
    });
  });

  describe("updateResult", () => {
    beforeEach(() => {
      // Mock window.location
      Object.defineProperty(window, "location", {
        value: { pathname: "/logs" },
        writable: true,
      });
    });

    it("should update results for refresh interval mode", async () => {
      // Use mockState directly
      mockState.searchObj.meta.refreshInterval = 5000;

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            from: 0,
            scan_size: 1000,
            took: 50,
            aggs: [{ zo_sql_key: "key1", zo_sql_num: 100 }],
            hits: [{ id: 1 }],
          },
        },
      };

      await pagination.updateResult(queryReq, response, false);

      expect(mockState.searchObj.data.queryResults.from).toBe(0);
      expect(mockState.searchObj.data.queryResults.scan_size).toBe(1000);
      expect(mockState.searchObj.data.queryResults.took).toBe(50);
    });

    it("should append results when appendResult is true", async () => {
      // Use mockState directly
      mockState.searchObj.meta.refreshInterval = 0;
      mockState.searchObj.data.queryResults.hits = [{ id: 1 }];
      mockState.searchObj.data.queryResults.total = 100;
      mockState.searchObj.data.queryResults.took = 50;
      mockState.searchObj.data.queryResults.scan_size = 500;

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            hits: [{ id: 2 }, { id: 3 }],
            total: 50,
            took: 30,
            scan_size: 300,
          },
        },
      };

      await pagination.updateResult(queryReq, response, false, true);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(3);
      expect(mockState.searchObj.data.queryResults.total).toBe(150);
      expect(mockState.searchObj.data.queryResults.took).toBe(80);
      expect(mockState.searchObj.data.queryResults.scan_size).toBe(800);
    });

    it("should handle pagination mode", async () => {
      // Use mockState directly
      mockState.searchObj.meta.refreshInterval = 0;

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            hits: [{ id: 10 }, { id: 11 }],
            from: 100,
            scan_size: 200,
            took: 25,
            total: 500,
          },
        },
      };

      await pagination.updateResult(queryReq, response, true, false);

      expect(mockState.searchObj.data.queryResults.hits.length).toBe(2);
      expect(mockState.searchObj.data.queryResults.from).toBe(100);
      expect(mockState.searchObj.data.queryResults.total).toBe(500);
    });

    it("should handle streaming aggs", async () => {
      // Use mockState directly
      mockState.searchObj.meta.refreshInterval = 0;
      mockState.searchObj.data.queryResults.took = 100;
      mockState.searchObj.data.queryResults.scan_size = 1000;

      const queryReq = { query: {} };
      const response = {
        content: {
          streaming_aggs: true,
          results: {
            hits: [{ id: 1 }],
            took: 50,
            scan_size: 500,
            aggs: [],
          },
        },
      };

      await pagination.updateResult(queryReq, response, false, false);

      expect(mockState.searchObj.data.queryResults.took).toBe(150);
      expect(mockState.searchObj.data.queryResults.scan_size).toBe(1500);
    });

    it("should set time_offset from response", async () => {
      // Use mockState directly
      mockState.searchObj.meta.refreshInterval = 0;

      const queryReq = { query: {} };
      const response = {
        content: {
          results: {
            hits: [],
          },
          time_offset: {
            start_time: 1000,
            end_time: 2000,
          },
        },
      };

      await pagination.updateResult(queryReq, response, false);

      expect(mockState.searchObj.data.queryResults.time_offset).toEqual({
        start_time: 1000,
        end_time: 2000,
      });
    });
  });
});
