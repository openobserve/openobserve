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
        selectedStreamFields: [] as any[],
        interestingFieldList: [] as string[],
        missingStreamMultiStreamFilter: [] as string[],
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
// Hoisted mocks — referencable from both vi.mock() factories and test code
// ---------------------------------------------------------------------------

// Semantic groups ref — allows tests to control what buildFieldToGroupIdMap sees
const {
  mockSemanticGroups,
  fnParsedSQLMock,
  fnUnparsedSQLMock,
  RESERVED_KEYWORD,
  quoteSqlIdentifierIfNeededMock,
} = vi.hoisted(() => {
  const RESERVED_KEYWORD = "user";
  return {
    mockSemanticGroups: { value: [] as any[] },
    fnParsedSQLMock: vi.fn(() => ({})),
    fnUnparsedSQLMock: vi.fn((_p: any) => 'select * from "t"'),
    RESERVED_KEYWORD,
    quoteSqlIdentifierIfNeededMock: vi.fn((identifier: string) =>
      identifier === RESERVED_KEYWORD ? `"${identifier}"` : identifier,
    ),
  };
});

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
    fnParsedSQL: fnParsedSQLMock,
    hasAggregation: vi.fn(() => false),
    isDistinctQuery: vi.fn(() => false),
    isWithQuery: vi.fn(() => false),
    isLimitQuery: vi.fn(() => false),
    extractTimestamps: vi.fn(),
    addTransformToQuery: vi.fn(),
    updateUrlQueryParams: vi.fn(),
    fnUnparsedSQL: fnUnparsedSQLMock,
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
  const actual =
    await vi.importActual<typeof import("@/utils/zincutils")>(
      "@/utils/zincutils",
    );
  return {
    ...actual,
    b64EncodeUnicode: vi.fn((s: string) => s),
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

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: vi.fn(() => ({
    semanticGroups: mockSemanticGroups,
    error: { value: null },
    findRelatedTelemetry: vi.fn(),
    loadSemanticGroups: vi.fn(),
    loadKeyFields: vi.fn(),
    loadFieldGrouping: vi.fn(),
    loadIdentityConfig: vi.fn(),
    clearCache: vi.fn(),
    clearAllCaches: vi.fn(),
    isCorrelationAvailable: vi.fn(),
  })),
}));

vi.mock("@/utils/telemetryCorrelation", async () => {
  const actual =
    await vi.importActual<
      typeof import("@/utils/telemetryCorrelation")
    >("@/utils/telemetryCorrelation");
  return {
    ...actual,
    buildFieldToGroupIdMap: vi.fn((groups: any[]) => {
      const map = new Map<string, string>();
      for (const group of groups) {
        for (const field of group.fields) {
          const lower = field.toLowerCase();
          if (!map.has(lower)) {
            map.set(lower, group.id);
          }
        }
      }
      return map;
    }),
  };
});

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

/**
 * Build an AST object compatible with extractFilterColumns.
 * Returns a where node with a binary_expr containing one column_ref
 * with `column: { expr: { value: fieldName } }`.
 */
function makeWhereASTWithField(fieldName: string) {
  return {
    where: {
      type: "binary_expr",
      operator: "=",
      left: {
        type: "column_ref",
        column: { expr: { value: fieldName } },
      },
      right: { type: "string", value: "'test'" },
    },
  };
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

// ---------------------------------------------------------------------------
// validateFilterForMultiStream tests
// ---------------------------------------------------------------------------

describe("useSearchQuery › validateFilterForMultiStream", () => {
  let validateFilterForMultiStream: ReturnType<
    typeof useSearchQuery
  >["validateFilterForMultiStream"];

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    // Reset semantic groups to empty by default
    mockSemanticGroups.value = [];

    const composable = useSearchQuery();
    validateFilterForMultiStream = composable.validateFilterForMultiStream;
  });

  // ── Basic validation ──────────────────────────────────────────────────────

  describe("when a filter field exists in all selected streams", () => {
    beforeEach(() => {
      mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "field1", streams: ["streamA", "streamB"] },
      ];
      mockState.searchObj.data.query = "field1 = 'test'";

      fnParsedSQLMock.mockImplementation((sql?: string) => {
        if (typeof sql === "string" && sql.includes("select * from stream where")) {
          return makeWhereASTWithField("field1");
        }
        return {};
      });
    });

    it("should return true and leave filterErrMsg empty", () => {
      const result = validateFilterForMultiStream();

      expect(result).toBe(true);
      expect(mockState.searchObj.data.filterErrMsg).toBe("");
    });

    it("should not set missingStreamMultiStreamFilter", () => {
      validateFilterForMultiStream();

      expect(
        mockState.searchObj.data.stream.missingStreamMultiStreamFilter,
      ).toEqual([]);
      expect(mockState.searchObj.data.missingStreamMessage).toBe("");
    });
  });

  // ── Field missing from all streams ────────────────────────────────────────

  describe("when a filter field does not exist in any stream", () => {
    beforeEach(() => {
      mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "other_field", streams: ["streamA", "streamB"] },
      ];
      mockState.searchObj.data.query = "nonexistent = 'test'";

      fnParsedSQLMock.mockImplementation((sql?: string) => {
        if (typeof sql === "string" && sql.includes("select * from stream where")) {
          return makeWhereASTWithField("nonexistent");
        }
        return {};
      });
    });

    it("should return false and set filterErrMsg", () => {
      const result = validateFilterForMultiStream();

      expect(result).toBe(false);
      expect(mockState.searchObj.data.filterErrMsg).toContain(
        "does not exist",
      );
      expect(mockState.searchObj.data.filterErrMsg).toContain("nonexistent");
    });

    it("should set missingStreamMultiStreamFilter to all selected streams", () => {
      validateFilterForMultiStream();

      expect(
        mockState.searchObj.data.stream.missingStreamMultiStreamFilter,
      ).toEqual(["streamA", "streamB"]);
      expect(mockState.searchObj.data.missingStreamMessage).toContain(
        "streamA, streamB",
      );
    });
  });

  // ── Semantic group equivalent field resolution ────────────────────────────

  describe("when a field is missing in one stream but an equivalent exists in the same semantic group", () => {
    beforeEach(() => {
      mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "msg", streams: ["streamA"] },
        { name: "message", streams: ["streamB"] },
      ];
      mockState.searchObj.data.query = "msg = 'test'";

      // semantic group: msg and message share the same group id
      mockSemanticGroups.value = [
        {
          id: "group-1",
          display: "Message",
          fields: ["msg", "message"],
        },
      ];

      fnParsedSQLMock.mockImplementation((sql?: string) => {
        if (typeof sql === "string" && sql.includes("select * from stream where")) {
          return makeWhereASTWithField("msg");
        }
        return {};
      });
    });

    it("should return true when equivalent field resolves the missing stream", () => {
      const result = validateFilterForMultiStream();

      expect(result).toBe(true);
      expect(mockState.searchObj.data.filterErrMsg).toBe("");
    });

    it("should not show an error even though the stream is missing the exact field name", () => {
      validateFilterForMultiStream();

      expect(mockState.searchObj.data.filterErrMsg).toBe("");
    });

    it("should clear missingStreamMultiStreamFilter for the resolved stream", () => {
      validateFilterForMultiStream();

      expect(
        mockState.searchObj.data.stream.missingStreamMultiStreamFilter,
      ).toEqual([]);
    });
  });

  describe("when an equivalent field resolves only some missing streams", () => {
    beforeEach(() => {
      mockState.searchObj.data.stream.selectedStream = [
        "streamA",
        "streamB",
        "streamC",
      ];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "msg", streams: ["streamA"] },
        { name: "message", streams: ["streamB"] },
      ];
      mockState.searchObj.data.query = "msg = 'test'";

      mockSemanticGroups.value = [
        {
          id: "group-1",
          display: "Message",
          fields: ["msg", "message"],
        },
      ];

      fnParsedSQLMock.mockImplementation((sql?: string) => {
        if (typeof sql === "string" && sql.includes("select * from stream where")) {
          return makeWhereASTWithField("msg");
        }
        return {};
      });
    });

    it("should return true because the field exists in at least one stream", () => {
      const result = validateFilterForMultiStream();

      expect(result).toBe(true);
    });

    it("should report streamC as still missing (no equivalent exists there)", () => {
      validateFilterForMultiStream();

      expect(
        mockState.searchObj.data.stream.missingStreamMultiStreamFilter,
      ).toEqual(["streamC"]);
    });
  });

  // ── multiStreamFieldMapping is populated correctly ─────────────────────────

  describe("multiStreamFieldMapping population via equivalent fields", () => {
    it("should populate the mapping when a semantic-group equivalent is found", () => {
      mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "msg", streams: ["streamA"] },
        { name: "message", streams: ["streamB"] },
      ];
      mockState.searchObj.data.query = "msg = 'test'";

      mockSemanticGroups.value = [
        {
          id: "group-1",
          display: "Message",
          fields: ["msg", "message"],
        },
      ];

      fnParsedSQLMock.mockImplementation((sql?: string) => {
        if (typeof sql === "string" && sql.includes("select * from stream where")) {
          return makeWhereASTWithField("msg");
        }
        return {};
      });

      // validateFilterForMultiStream should populate the internal
      // multiStreamFieldMapping. We verify this indirectly by calling
      // handleMultiStream (via buildSearch) and checking that the generated
      // SQL for streamB uses the equivalent field name.
      // The direct test is: validation passes, meaning the mapping was used.

      const result = validateFilterForMultiStream();

      // Validation passed — the mapping resolved streamB's missing field
      expect(result).toBe(true);
      expect(mockState.searchObj.data.filterErrMsg).toBe("");

      // missingStreamMultiStreamFilter is empty → streamB was resolved
      expect(
        mockState.searchObj.data.stream.missingStreamMultiStreamFilter,
      ).toEqual([]);
    });
  });

  // ── Reset behaviour ──────────────────────────────────────────────────────

  describe("reset of filter state", () => {
    it("should clear filterErrMsg, missingStreamMessage, and missingStreamMultiStreamFilter before validation", () => {
      // Pre-set dirty state
      mockState.searchObj.data.filterErrMsg = "old error";
      mockState.searchObj.data.missingStreamMessage = "old message";
      mockState.searchObj.data.stream.missingStreamMultiStreamFilter = [
        "old-stream",
      ];

      // Valid state — field exists in both streams
      mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "field1", streams: ["streamA", "streamB"] },
      ];
      mockState.searchObj.data.query = "field1 = 'test'";

      fnParsedSQLMock.mockImplementation((sql?: string) => {
        if (typeof sql === "string" && sql.includes("select * from stream where")) {
          return makeWhereASTWithField("field1");
        }
        return {};
      });

      validateFilterForMultiStream();

      expect(mockState.searchObj.data.filterErrMsg).toBe("");
      expect(mockState.searchObj.data.missingStreamMessage).toBe("");
      expect(
        mockState.searchObj.data.stream.missingStreamMultiStreamFilter,
      ).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// handleMultiStream — per-stream WHERE rewrite via multiStreamFieldMapping
// ---------------------------------------------------------------------------

describe("useSearchQuery › handleMultiStream WHERE rewrite", () => {
  let buildSearch: ReturnType<typeof useSearchQuery>["buildSearch"];

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    mockSemanticGroups.value = [];
    ({ buildSearch } = useSearchQuery());

    // Base setup: non-SQL mode, quick mode off
    mockState.searchObj.meta.sqlMode = false;
    mockState.searchObj.meta.quickMode = false;
  });

  it("should rewrite the WHERE clause for a stream when equivalent field mapping exists", () => {
    // Two streams: streamA has "msg", streamB only has "message".
    // Semantic group says msg ↔ message are equivalent.
    mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "msg", streams: ["streamA"] },
      { name: "message", streams: ["streamB"] },
    ];
    mockState.searchObj.data.stream.interestingFieldList = [];
    mockState.searchObj.data.query = "msg = 'test'";

    mockSemanticGroups.value = [
      {
        id: "group-1",
        display: "Message",
        fields: ["msg", "message"],
      },
    ];

    // fnParsedSQL returns ASTs including the table name so fnUnparsedSQL
    // can reconstruct SQL that preserves the stream identifier for assertions.
    fnParsedSQLMock.mockImplementation((sql?: string) => {
      if (!sql) return {};
      if (typeof sql === "string" && sql.includes("select * from stream where")) {
        return makeWhereASTWithField("msg");
      }
      // handleMultiStream per-stream parse — extract the stream name from the
      // FROM clause so fnUnparsedSQL can put it back.
      const fromMatch = sql.match(/from\s+"([^"]+)"/i);
      const streamName = fromMatch ? fromMatch[1] : "unknown";
      return {
        _stream: streamName,
        where: {
          type: "binary_expr",
          operator: "=",
          left: { type: "column_ref", column: "msg" },
          right: { type: "string", value: "'test'" },
        },
      };
    });

    // fnUnparsedSQL reconstructs SQL from the mutated AST, preserving the
    // stream name so we can identify per-stream entries in the result array.
    fnUnparsedSQLMock.mockImplementation((ast: any) => {
      const streamName = ast?._stream || "unknown";
      let col: string | undefined;
      const walk = (n: any) => {
        if (!n) return;
        if (n.type === "column_ref") {
          col =
            typeof n.column === "string"
              ? n.column
              : n.column?.expr?.value ?? "?";
        }
        walk(n.left);
        walk(n.right);
        walk(n.args);
        walk(n.expr);
      };
      walk(ast.where);

      return `select * from "${streamName}" WHERE ${col ?? "?"} = 'test'`;
    });

    const result = buildSearch(false, false);

    expect(result).not.toBeNull();

    // buildSearch returns req with query.sql as an array for multi-stream.
    const sqlArray = result?.query?.sql;
    expect(Array.isArray(sqlArray)).toBe(true);

    // streamB should have "message" (the equivalent field) instead of "msg"
    const streamBSQL = sqlArray.find((s: string) =>
      s.includes('"streamB"'),
    );
    expect(streamBSQL).toBeDefined();
    expect(streamBSQL).toContain("message");
    expect(streamBSQL).not.toContain('"msg"');

    // streamA should keep "msg" (it has the field directly, no rewrite needed)
    const streamASQL = sqlArray.find((s: string) =>
      s.includes('"streamA"'),
    );
    expect(streamASQL).toBeDefined();
    expect(streamASQL).toContain("msg");
  });

  it("should return null when a field does not exist in any stream (no equivalent)", () => {
    mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB"];
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "other_field", streams: ["streamA", "streamB"] },
    ];
    mockState.searchObj.data.stream.interestingFieldList = [];
    mockState.searchObj.data.query = "nonexistent = 'test'";

    // No semantic groups
    mockSemanticGroups.value = [];

    fnParsedSQLMock.mockImplementation((sql?: string) => {
      if (typeof sql === "string" && sql.includes("select * from stream where")) {
        return makeWhereASTWithField("nonexistent");
      }
      return {};
    });

    const result = buildSearch(false, false);

    // Validation failed, buildSearch returns null
    expect(result).toBeNull();
    expect(mockState.searchObj.data.filterErrMsg).toContain("nonexistent");
    expect(mockState.searchObj.data.filterErrMsg).toContain("does not exist");
  });
});
