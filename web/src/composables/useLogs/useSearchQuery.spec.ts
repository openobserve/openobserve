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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";

// ---------------------------------------------------------------------------
// Shared mock state — recreated before each test so tests are isolated
// ---------------------------------------------------------------------------
const createMockState = () => ({
  searchObj: {
    data: {
      query: "",
      filterErrMsg: "",
      missingStreamMessage: "",
      stream: {
        selectedStream: ["my-stream"],
        selectedStreamFields: [],
        interestingFieldList: [],
        missingStreamMultiStreamFilter: [],
      },
      resultGrid: { currentPage: 1 },
      queryResults: {},
      addToFilter: "",
      datetime: {
        type: "absolute",
        startTime: new Date().getTime() * 1000 - 900000 * 1000,
        endTime: new Date().getTime() * 1000,
      },
      histogram: {
        xData: [],
        yData: [],
        chartParams: { title: "", unparsed_x_data: [], timezone: "" },
        errorCode: 0,
        errorMsg: "",
        errorDetail: "",
      },
      histogramDirtyFlag: false,
    },
    meta: {
      sqlMode: false,
      quickMode: false,
      resultGrid: {
        rowsPerPage: 100,
        currentPage: 1,
        chartInterval: "10 second",
        chartKeyFormat: "HH:mm:ss",
        showPagination: true,
      },
      regions: [],
      clusters: [],
      showHistogram: true,
      refreshInterval: 0,
      logsVisualizeToggle: "logs",
    },
    loading: false,
  },
  notificationMsg: ref(""),
  initialQueryPayload: ref(null),
  searchAggData: { total: 0, hasAggregation: false },
});

let mockState: ReturnType<typeof createMockState>;

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    currentRoute: { value: { name: "logs", query: {} } },
  })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      zoConfig: {
        super_cluster_enabled: false,
        sql_base64_enabled: false,
        timestamp_column: "_timestamp",
      },
    },
  })),
}));

vi.mock("./searchState", () => ({
  searchState: vi.fn(() => mockState),
}));

vi.mock("./logsUtils", () => ({
  logsUtils: vi.fn(() => ({
    fnParsedSQL: vi.fn(() => ({})),
    hasAggregation: vi.fn(() => false),
    isDistinctQuery: vi.fn(() => false),
    isWithQuery: vi.fn(() => false),
    isLimitQuery: vi.fn(() => false),
    extractTimestamps: vi.fn(),
    addTransformToQuery: vi.fn(),
    updateUrlQueryParams: vi.fn(),
    fnUnparsedSQL: vi.fn((p: any) => JSON.stringify(p)),
    checkTimestampAlias: vi.fn(() => true),
  })),
}));

vi.mock("./usePatterns", () => ({
  patternsState: ref({ scanSize: 1000 }),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
    isCloud: "false",
  },
}));

vi.mock("@/utils/zincutils", async () => {
  const actual = await vi.importActual<typeof import("@/utils/zincutils")>("@/utils/zincutils");
  return {
    ...actual,
    b64EncodeUnicode: vi.fn((s: string) => s),
  };
});

const {
  RESERVED_KEYWORD,
  quoteSqlIdentifierIfNeededMock,
} = vi.hoisted(() => {
  const RESERVED_KEYWORD = "user";
  return {
    RESERVED_KEYWORD,
    quoteSqlIdentifierIfNeededMock: vi.fn((identifier: string) =>
      identifier === RESERVED_KEYWORD ? `"${identifier}"` : identifier,
    ),
  };
});

vi.mock("@/utils/query/sqlIdentifiers", () => ({
  quoteSqlIdentifierIfNeeded: quoteSqlIdentifierIfNeededMock,
}));

vi.mock("@/utils/date", () => ({
  convertDateToTimestamp: vi.fn(() => ({ timestamp: 1000000 })),
  getConsumableRelativeTime: vi.fn(() => ({
    startTime: new Date().getTime() * 1000 - 900000 * 1000,
    endTime: new Date().getTime() * 1000,
  })),
}));

// Import after all vi.mock() declarations so the mocks are in place
import { useSearchQuery } from "./useSearchQuery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the quick_mode value from a buildSearch result */
function getQuickMode(result: any): boolean {
  return result?.query?.quick_mode;
}

/** Extract the SQL string from a buildSearch result */
function getSql(result: any): string {
  return result?.query?.sql ?? "";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSearchQuery › buildSearch › ignoreQuickMode parameter", () => {
  let buildSearch: ReturnType<typeof useSearchQuery>["buildSearch"];

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    ({ buildSearch } = useSearchQuery());
  });

  // ── quick_mode flag ────────────────────────────────────────────────────────

  describe("quick_mode flag in the query payload", () => {
    it("should set quick_mode=true when quickMode=true and ignoreQuickMode=false (default)", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(false, false);

      expect(getQuickMode(result)).toBe(true);
    });

    it("should set quick_mode=false when quickMode=true and ignoreQuickMode=true", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(false, true);

      expect(getQuickMode(result)).toBe(false);
    });

    it("should set quick_mode=false when quickMode=false and ignoreQuickMode=false (default)", () => {
      mockState.searchObj.meta.quickMode = false;

      const result = buildSearch(false, false);

      expect(getQuickMode(result)).toBe(false);
    });

    it("should set quick_mode=false when quickMode=false and ignoreQuickMode=true", () => {
      mockState.searchObj.meta.quickMode = false;

      const result = buildSearch(false, true);

      expect(getQuickMode(result)).toBe(false);
    });
  });

  // ── SQL field list placeholder ─────────────────────────────────────────────

  describe("SQL field list selection", () => {
    beforeEach(() => {
      // Configure a single stream with two interesting fields present in the schema
      mockState.searchObj.data.stream.selectedStream = ["my-stream"];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "field1" },
        { name: "field2" },
      ];
      mockState.searchObj.data.stream.interestingFieldList = [
        "field1",
        "field2",
      ];
    });

    it("should use the interesting field list in SQL when quickMode=true and ignoreQuickMode=false", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(false, false);

      const sql = getSql(result);
      expect(sql).toContain("field1,field2");
      expect(sql).not.toContain("SELECT *");
      expect(sql).not.toMatch(/\bfrom\b.*\*/i);
    });

    it("should use SELECT * in SQL when quickMode=true and ignoreQuickMode=true", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(false, true);

      const sql = getSql(result);
      expect(sql).toContain("*");
      expect(sql).not.toContain("field1,field2");
    });

    it("should use SELECT * in SQL when quickMode=false regardless of ignoreQuickMode", () => {
      mockState.searchObj.meta.quickMode = false;

      const result = buildSearch(false, false);

      const sql = getSql(result);
      expect(sql).toContain("*");
      expect(sql).not.toContain("field1,field2");
    });

    it("should use SELECT * in SQL when quickMode=false and ignoreQuickMode=true", () => {
      mockState.searchObj.meta.quickMode = false;

      const result = buildSearch(false, true);

      const sql = getSql(result);
      expect(sql).toContain("*");
      expect(sql).not.toContain("field1,field2");
    });
  });

  // ── ignoreQuickMode does not affect non-quick-mode field list ──────────────

  describe("ignoreQuickMode with empty interestingFieldList", () => {
    it("should use SELECT * when interestingFieldList is empty even if quickMode=true", () => {
      mockState.searchObj.meta.quickMode = true;
      mockState.searchObj.data.stream.interestingFieldList = [];
      mockState.searchObj.data.stream.selectedStream = ["my-stream"];

      const result = buildSearch(false, false);

      const sql = getSql(result);
      expect(sql).toContain("*");
    });

    it("should use SELECT * when interestingFieldList is empty and ignoreQuickMode=true", () => {
      mockState.searchObj.meta.quickMode = true;
      mockState.searchObj.data.stream.interestingFieldList = [];
      mockState.searchObj.data.stream.selectedStream = ["my-stream"];

      const result = buildSearch(false, true);

      const sql = getSql(result);
      expect(sql).toContain("*");
    });
  });

  // ── readOnly + ignoreQuickMode interaction ────────────────────────────────

  describe("readOnly combined with ignoreQuickMode", () => {
    it("should honour ignoreQuickMode=true even in readOnly mode, setting quick_mode=false", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(true, true);

      expect(getQuickMode(result)).toBe(false);
    });

    it("should honour ignoreQuickMode=false in readOnly mode, setting quick_mode=true", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(true, false);

      expect(getQuickMode(result)).toBe(true);
    });
  });

  // ── result is a valid payload ─────────────────────────────────────────────

  describe("returned payload structure", () => {
    it("should return a non-null payload when state is valid", () => {
      const result = buildSearch(false, false);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("query");
      expect(result.query).toHaveProperty("sql");
      expect(result.query).toHaveProperty("start_time");
      expect(result.query).toHaveProperty("end_time");
    });

    it("should return a payload with quick_mode=false when ignoreQuickMode=true regardless of stored state", () => {
      mockState.searchObj.meta.quickMode = true;

      const result = buildSearch(false, true);

      expect(result).not.toBeNull();
      expect(result.query.quick_mode).toBe(false);
    });
  });
});

describe("useSearchQuery › SQL Reserved Keyword Quoting", () => {
  let buildSearch: ReturnType<typeof useSearchQuery>["buildSearch"];

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    ({ buildSearch } = useSearchQuery());
    mockState.searchObj.meta.sqlMode = false;
    mockState.searchObj.meta.quickMode = true;
    mockState.searchObj.data.stream.selectedStream = ["my-stream"];
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "message" },
      { name: RESERVED_KEYWORD },
    ];
    mockState.searchObj.data.stream.interestingFieldList = [
      "message",
      RESERVED_KEYWORD,
    ];
  });

  it("should quote reserved keywords in SELECT and WHERE, keep non-reserved unquoted", () => {
    mockState.searchObj.data.query = `${RESERVED_KEYWORD}='val1' AND message='val2'`;

    const result = buildSearch(false, false);
    const sql = getSql(result);

    expect(sql).toContain(`"${RESERVED_KEYWORD}"`);
    expect(sql).toContain("message");
    expect(sql).toContain(`"${RESERVED_KEYWORD}" = 'val1'`);
    expect(sql).toContain("message = 'val2'");
  });
});
