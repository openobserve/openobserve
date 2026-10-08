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
    fnUnparsedSQLMock: vi.fn(() => 'select * from "t"'),
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

const { recordSeverityRequestMock } = vi.hoisted(() => ({ recordSeverityRequestMock: vi.fn() }));

vi.mock("./useLogSeverity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useLogSeverity")>()),
  recordSeverityRequest: recordSeverityRequestMock,
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
  const actual = await vi.importActual<typeof import("@/utils/telemetryCorrelation")>(
    "@/utils/telemetryCorrelation",
  );
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
import { buildLogsSignature } from "./useAutoRun";
import { Parser as SqlParser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { gt } from "@/types/i18n";

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
    ({ buildSearch } = useSearchQuery(gt));
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
      mockState.searchObj.data.stream.interestingFieldList = ["field1", "field2"];
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

  // ── VRL-derived fields must never reach the SELECT (o2-enterprise#2859) ────

  describe("SQL field list excludes VRL-derived fields", () => {
    beforeEach(() => {
      mockState.searchObj.meta.quickMode = true;
      mockState.searchObj.data.stream.selectedStream = ["my-stream"];
      // extractFields() appends hit-only fields — a VRL function's output — with
      // isSchemaField: false, alongside the stream's own schema fields.
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "field1", isSchemaField: true },
        { name: "vrl_field", isSchemaField: false },
      ];
      mockState.searchObj.data.stream.interestingFieldList = ["field1", "vrl_field"];
    });

    it("should keep a VRL-derived field out of the SELECT list", () => {
      const result = buildSearch(false, false);

      const sql = getSql(result);
      expect(sql).toContain("field1");
      // The VRL runs after the SQL, so selecting its output field fails the whole
      // query with "Search field not found: vrl_field".
      expect(sql).not.toContain("vrl_field");
    });

    it("should prune a VRL-derived field from interestingFieldList in normal mode", () => {
      buildSearch(false, false);

      expect(mockState.searchObj.data.stream.interestingFieldList).toEqual(["field1"]);
    });

    it("should not mutate interestingFieldList in readOnly mode", () => {
      const result = buildSearch(true, false);

      expect(getSql(result)).not.toContain("vrl_field");
      expect(mockState.searchObj.data.stream.interestingFieldList).toEqual(["field1", "vrl_field"]);
    });

    it("should use SELECT * when every interesting field is VRL-derived", () => {
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "vrl_field", isSchemaField: false },
      ];
      mockState.searchObj.data.stream.interestingFieldList = ["vrl_field"];

      const result = buildSearch(false, false);

      const sql = getSql(result);
      expect(sql).toContain("*");
      expect(sql).not.toContain("vrl_field");
    });

    it("should keep fields that carry no isSchemaField flag at all", () => {
      // Index.vue and useSearchBar.ts assign raw stream schema objects, which have
      // no isSchemaField property — those are schema fields and must stay selectable.
      mockState.searchObj.data.stream.selectedStreamFields = [
        { name: "field1" },
        { name: "field2" },
      ];
      mockState.searchObj.data.stream.interestingFieldList = ["field1", "field2"];

      const result = buildSearch(false, false);

      expect(getSql(result)).toContain("field1,field2");
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
    ({ buildSearch } = useSearchQuery(gt));
    mockState.searchObj.meta.sqlMode = false;
    mockState.searchObj.meta.quickMode = true;
    mockState.searchObj.data.stream.selectedStream = ["my-stream"];
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "message" },
      { name: RESERVED_KEYWORD },
    ];
    mockState.searchObj.data.stream.interestingFieldList = ["message", RESERVED_KEYWORD];
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

    const composable = useSearchQuery(gt);
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

      expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual([]);
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
      expect(mockState.searchObj.data.filterErrMsg).toContain("does not exist");
      expect(mockState.searchObj.data.filterErrMsg).toContain("nonexistent");
    });

    it("should set missingStreamMultiStreamFilter to all selected streams", () => {
      validateFilterForMultiStream();

      expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual([
        "streamA",
        "streamB",
      ]);
      expect(mockState.searchObj.data.missingStreamMessage).toContain("streamA, streamB");
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

      expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual([]);
    });
  });

  describe("when an equivalent field resolves only some missing streams", () => {
    beforeEach(() => {
      mockState.searchObj.data.stream.selectedStream = ["streamA", "streamB", "streamC"];
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

      expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual(["streamC"]);
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
      expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual([]);
    });
  });

  // ── Reset behaviour ──────────────────────────────────────────────────────

  describe("reset of filter state", () => {
    it("should clear filterErrMsg, missingStreamMessage, and missingStreamMultiStreamFilter before validation", () => {
      // Pre-set dirty state
      mockState.searchObj.data.filterErrMsg = "old error";
      mockState.searchObj.data.missingStreamMessage = "old message";
      mockState.searchObj.data.stream.missingStreamMultiStreamFilter = ["old-stream"];

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
      expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual([]);
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
    ({ buildSearch } = useSearchQuery(gt));

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
          col = typeof n.column === "string" ? n.column : (n.column?.expr?.value ?? "?");
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

    // buildSearch returns one UNION ALL BY NAME string for multi-stream.
    const sql = result?.query?.sql as string;
    expect(typeof sql).toBe("string");
    expect(sql).toContain(" UNION ALL BY NAME ");

    const arms = sql.split(" UNION ALL BY NAME ");

    // streamB should have "message" (the equivalent field) instead of "msg"
    const streamBSQL = arms.find((s: string) => s.includes('"streamB"'));
    expect(streamBSQL).toBeDefined();
    expect(streamBSQL).toContain("message");
    expect(streamBSQL).not.toContain('"msg"');

    // streamA should keep "msg" (it has the field directly, no rewrite needed)
    const streamASQL = arms.find((s: string) => s.includes('"streamA"'));
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

describe("useSearchQuery › handleMultiStream _stream_name filter", () => {
  let buildSearch: ReturnType<typeof useSearchQuery>["buildSearch"];
  const parser = new SqlParser();

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    mockSemanticGroups.value = [];
    ({ buildSearch } = useSearchQuery(gt));

    mockState.searchObj.meta.sqlMode = false;
    mockState.searchObj.meta.quickMode = false;
    mockState.searchObj.data.stream.selectedStream = ["app", "rum"];
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "level", streams: ["app", "rum"] },
    ];

    // The real parser, so the arms are exactly what the backend receives.
    fnParsedSQLMock.mockImplementation((sql?: string) => (sql ? parser.astify(sql) : {}) as any);
    fnUnparsedSQLMock.mockImplementation((ast: any) => parser.sqlify(ast));
  });

  // Rewritten arms keep the generated statement's keyword case; only the WHERE goes through the parser.
  const armFor = (sql: string, stream: string) =>
    sql
      .split(" UNION ALL BY NAME ")
      .find((arm: string) => arm.toLowerCase().includes(`from "${stream}"`));

  it("accepts a _stream_name filter and resolves it to each stream's own name", () => {
    mockState.searchObj.data.query = "_stream_name = 'rum'";

    const result = buildSearch(false, false);

    expect(result).not.toBeNull();
    expect(mockState.searchObj.data.filterErrMsg).toBe("");
    const sql = getSql(result);
    expect(armFor(sql, "app")).toContain("WHERE 'app' = 'rum'");
    expect(armFor(sql, "rum")).toContain("WHERE 'rum' = 'rum'");
    expect(armFor(sql, "rum")).toContain("'rum' as _stream_name");
  });

  it("keeps other conditions and excludes with !=", () => {
    mockState.searchObj.data.query = "level = 'error' and _stream_name != 'rum'";

    const sql = getSql(buildSearch(false, false));

    expect(armFor(sql, "app")).toMatch(/level.* = 'error' AND 'app' != 'rum'/);
    expect(armFor(sql, "rum")).toMatch(/level.* = 'error' AND 'rum' != 'rum'/);
  });

  it("still rewrites an equivalent field alongside _stream_name", () => {
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "msg", streams: ["app"] },
      { name: "message", streams: ["rum"] },
    ];
    mockSemanticGroups.value = [{ id: "group-1", display: "Message", fields: ["msg", "message"] }];
    mockState.searchObj.data.query = "msg = 'boom' and _stream_name = 'rum'";

    const sql = getSql(buildSearch(false, false));

    expect(armFor(sql, "rum")).toMatch(/message.* = 'boom' AND 'rum' = 'rum'/);
    expect(armFor(sql, "app")).toMatch(/msg.* = 'boom' AND 'app' = 'rum'/);
  });
});

describe("useSearchQuery › buildSearch › LIMIT in filter mode", () => {
  let buildSearch: ReturnType<typeof useSearchQuery>["buildSearch"];

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    mockState.searchObj.meta.sqlMode = false;
    ({ buildSearch } = useSearchQuery());
  });

  it("should reject a filter carrying a LIMIT clause", () => {
    mockState.searchObj.data.query = "k8s_namespace_name = 'nginx-ingress' LIMIT 10";

    const result = buildSearch();

    expect(result).toBeNull();
    expect(mockState.notificationMsg.value).toContain("LIMIT");
  });

  it("should not splice the LIMIT into a generated statement", () => {
    mockState.searchObj.data.query = "code = 200 LIMIT 5";

    expect(buildSearch()).toBeNull();
  });

  it("should still build a payload for a filter without a LIMIT", () => {
    mockState.searchObj.data.query = "code = 200";

    const result = buildSearch();

    expect(result).not.toBeNull();
    expect(mockState.notificationMsg.value).toBe("");
  });

  it("should allow a field named limit", () => {
    mockState.searchObj.data.query = "limit = 5";

    expect(buildSearch()).not.toBeNull();
  });

  it("should ignore a LIMIT inside a commented-out line", () => {
    mockState.searchObj.data.query = "code = 200\n-- LIMIT 10";

    expect(buildSearch()).not.toBeNull();
  });

  it("should ignore a LIMIT in a trailing comment", () => {
    mockState.searchObj.data.query = "code = 200 -- limit 10";

    expect(buildSearch()).not.toBeNull();
  });

  it("should not apply the guard in SQL mode", () => {
    mockState.searchObj.meta.sqlMode = true;
    mockState.searchObj.data.query = 'SELECT * FROM "my-stream" LIMIT 10';

    expect(buildSearch()).not.toBeNull();
  });
});

describe("useSearchQuery › getQueryReq › highlightQuery", () => {
  let getQueryReq: ReturnType<typeof useSearchQuery>["getQueryReq"];

  beforeEach(() => {
    mockState = createMockState();
    (mockState.searchObj.data.stream as any).streamLists = [{ name: "my-stream" }];
    vi.clearAllMocks();
    ({ getQueryReq } = useSearchQuery(gt));
  });

  // str_match and re_match highlight case-sensitively, so the query must keep its case.
  it("should keep the query case in quick/builder mode", () => {
    mockState.searchObj.data.query = "str_match(body, ERROR) AND re_match(body, ^Error)";
    getQueryReq(false);
    expect((mockState.searchObj.data as any).highlightQuery).toBe(
      "str_match(body, ERROR) AND re_match(body, ^Error)",
    );
  });

  it("should keep the WHERE clause case in SQL mode", () => {
    mockState.searchObj.meta.sqlMode = true;
    mockState.searchObj.data.query = 'SELECT * FROM "my-stream" WHERE str_match(body, WARN)';
    getQueryReq(false);
    expect((mockState.searchObj.data as any).highlightQuery).toBe(" str_match(body, WARN)");
  });
});

describe("useSearchQuery › getQueryReq records the severity guard of the dispatched request", () => {
  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    (mockState.searchObj.data.stream as any).streamLists = [
      { label: "my-stream", value: "my-stream" },
    ];
  });

  it("snapshots quick mode, interesting fields and streams at dispatch", () => {
    mockState.searchObj.meta.quickMode = true;
    mockState.searchObj.data.stream.interestingFieldList = ["_timestamp", "message"];
    const { getQueryReq } = useSearchQuery(gt);
    const req = getQueryReq(false);
    expect(req).not.toBeNull();
    expect(recordSeverityRequestMock).toHaveBeenCalledTimes(1);
    const snapshot = recordSeverityRequestMock.mock.calls[0][0];
    expect(snapshot).toMatchObject({
      sqlMode: false,
      quickMode: req!.query.quick_mode,
      selectedStreams: ["my-stream"],
      sqlColumns: "all",
    });
    expect(snapshot.interestingFields).toEqual(
      mockState.searchObj.data.stream.interestingFieldList,
    );
    mockState.searchObj.data.stream.interestingFieldList.push("level");
    expect(snapshot.interestingFields).not.toContain("level");
  });

  it("records nothing when no request is built", () => {
    mockState.searchObj.data.stream.selectedStream = [];
    const { getQueryReq } = useSearchQuery(gt);
    expect(getQueryReq(false)).toBeNull();
    expect(recordSeverityRequestMock).not.toHaveBeenCalled();
  });

  it("writes no URL at dispatch: the run publishes it when its first results arrive (4c C7b)", async () => {
    const { logsUtils } = await import("./logsUtils");
    const { getQueryReq } = useSearchQuery(gt);
    expect(getQueryReq(false)).not.toBeNull();
    for (const { value } of vi.mocked(logsUtils).mock.results) {
      expect(value.updateUrlQueryParams).not.toHaveBeenCalled();
    }
  });
});

describe("useSearchQuery › getQueryReq signature contract (AC5.2)", () => {
  // Every request field must be covered by the executed signature, or be explicitly ignored.
  const SIGNATURE_FIELDS_BY_REQUEST_FIELD: Record<string, string[]> = {
    sql: ["query", "sqlMode", "streams", "quickModeFields", "definedSchemas"],
    quick_mode: ["quickMode"],
    sql_mode: ["sqlMode"],
    query_fn: ["transform"],
    regions: ["regions"],
    clusters: ["clusters"],
  };
  // Resolved bounds, paging and transport encoding are recorded per execution, not part of the scope.
  const IGNORED = new Set([
    "from",
    "size",
    "start_time",
    "end_time",
    "track_total_hits",
    "encoding",
    "query",
  ]);

  const signatureKeys = Object.keys(
    buildLogsSignature({
      query: "",
      sqlMode: false,
      streams: [],
      streamType: "logs",
      time: { type: "relative", period: "15m" },
      transformContent: null,
      showTransformEditor: false,
      quickMode: false,
      refreshInterval: 0,
      sortOrder: "desc",
      definedSchemas: "",
    }),
  );

  const writtenFields = (setup: () => void) => {
    mockState = createMockState();
    (mockState.searchObj.data.stream as any).streamLists = [{ name: "my-stream" }];
    vi.clearAllMocks();
    setup();
    const req: any = useSearchQuery(gt).getQueryReq(false);
    expect(req).not.toBeNull();
    return [...Object.keys(req), ...Object.keys(req.query)];
  };

  it.each([
    ["filter mode", () => {}],
    [
      "quick mode with a field list",
      () => {
        mockState.searchObj.meta.quickMode = true;
        mockState.searchObj.data.stream.interestingFieldList = ["_timestamp", "message"];
        mockState.searchObj.data.stream.selectedStreamFields = [
          { name: "_timestamp" },
          { name: "message" },
        ];
      },
    ],
    [
      "SQL mode",
      () => {
        mockState.searchObj.meta.sqlMode = true;
        mockState.searchObj.data.query = 'SELECT * FROM "my-stream"';
      },
    ],
  ])("maps every field it writes in %s", (_name, setup) => {
    for (const field of writtenFields(setup)) {
      if (IGNORED.has(field)) continue;
      const covered = SIGNATURE_FIELDS_BY_REQUEST_FIELD[field];
      expect(
        covered,
        `request field "${field}" is neither in the signature nor ignored`,
      ).toBeTruthy();
      covered.forEach((key) => expect(signatureKeys).toContain(key));
    }
  });
});

describe("useSearchQuery › free text (item 1)", () => {
  const parser = new SqlParser();
  const ftsStream = (name: string) => ({
    name,
    schema: [
      { name: "_timestamp", type: "Int64" },
      { name: "body", type: "Utf8" },
      { name: "level", type: "Utf8" },
    ],
    settings: { full_text_search_keys: ["body"] },
  });
  const noFtsStream = (name: string) => ({
    name,
    schema: [
      { name: "_timestamp", type: "Int64" },
      { name: "msg_text", type: "Utf8" },
      { name: "detail", type: "Utf8" },
    ],
    settings: {},
  });

  const select = (...streams: any[]) => {
    mockState.searchObj.data.stream.selectedStream = streams.map((s) => s.name);
    (mockState.searchObj.data as any).streamResults = { list: streams };
    (mockState.searchObj.data.stream as any).streamLists = streams.map((s) => ({ name: s.name }));
    mockState.searchObj.data.stream.selectedStreamFields = streams.flatMap((s) =>
      s.schema.map((f: any) => ({ name: f.name, streams: [s.name] })),
    );
  };

  beforeEach(() => {
    mockState = createMockState();
    vi.clearAllMocks();
    mockSemanticGroups.value = [];
    fnParsedSQLMock.mockImplementation((sql?: string) => {
      try {
        return (sql ? parser.astify(sql) : {}) as any;
      } catch {
        return { columns: [], from: [], where: null } as any;
      }
    });
    fnUnparsedSQLMock.mockImplementation((ast: any) => parser.sqlify(ast));
  });

  it("renders a bare word as match_all on a full-text stream (AC1.2)", () => {
    select(ftsStream("fts_a"));
    mockState.searchObj.data.query = "timeout";
    const { getQueryReq } = useSearchQuery(gt);

    const sql = getSql(getQueryReq(false));

    expect(sql).toBe(`select * from "fts_a"  WHERE match_all('timeout')`);
    expect(sql).not.toContain("WHERE timeout");
    expect((mockState.searchObj.data as any).highlightQuery).toBe("match_all('timeout')");
    expect(mockState.searchObj.data.query).toBe("timeout");
  });

  it.each([
    ["-debug", "NOT match_all('debug')"],
    ["error -debug", "match_all('error') AND NOT match_all('debug')"],
    ["-500", "match_all('-500')"],
    ["limit 50", "match_all('limit') AND match_all('50')"],
  ])("produces the exact request for %s without changing the query", (raw, where) => {
    select(ftsStream("fts_a"));
    mockState.searchObj.data.query = raw;
    const { getQueryReq } = useSearchQuery(gt);
    expect(getSql(getQueryReq(false))).toBe(`select * from "fts_a"  WHERE ${where}`);
    expect(mockState.searchObj.data.query).toBe(raw);
  });

  it("renders LIMIT words for every free-text arm in multi-stream requests", () => {
    select(ftsStream("fts_a"), ftsStream("fts_b"));
    mockState.searchObj.data.query = "limit 50";
    const { getQueryReq } = useSearchQuery(gt);
    const sql = getSql(getQueryReq(false));
    expect(sql.match(/WHERE match_all\('limit'\) AND match_all\('50'\)/g)).toHaveLength(2);
    expect(mockState.searchObj.data.query).toBe("limit 50");
  });

  it.each([false, true])(
    "keeps the LIMIT guard for field-like filters (multi-stream: %s)",
    (multi) => {
      const stream = ftsStream("fts_a");
      stream.schema.push({ name: "enabled", type: "Boolean" });
      select(...(multi ? [stream, { ...stream, name: "fts_b" }] : [stream]));
      mockState.searchObj.data.query = "enabled limit 5";
      const { getQueryReq } = useSearchQuery(gt);
      expect(getQueryReq(false)).toBeNull();
      expect(mockState.notificationMsg.value).toBe(
        "LIMIT is not supported without SQL mode. Remove it from the filter.",
      );
      expect(mockState.searchObj.data.query).toBe("enabled limit 5");
    },
  );

  it("joins words with AND, keeps OR/NOT and groups (J2)", () => {
    select(ftsStream("fts_a"));
    mockState.searchObj.data.query = 'timeout AND (error OR "connection refused") NOT x1';
    const { buildSearch } = useSearchQuery(gt);

    expect(getSql(buildSearch())).toContain(
      "WHERE match_all('timeout') AND (match_all('error') OR match_all('connection refused')) AND NOT match_all('x1')",
    );
  });

  it("sends a field filter byte-identical to the pre-change path (AC2.3)", () => {
    select(ftsStream("fts_a"));
    mockState.searchObj.data.query = "level='error' and timeout";
    const { buildSearch } = useSearchQuery(gt);

    expect(getSql(buildSearch())).toBe(`select * from "fts_a"  WHERE level = 'error' and timeout`);
  });

  it("sends the filter unchanged while the schema is not loaded", () => {
    select(ftsStream("fts_a"));
    (mockState.searchObj.data as any).streamResults = { list: [{ name: "fts_a" }] };
    mockState.searchObj.data.query = "timeout";
    const { buildSearch } = useSearchQuery(gt);

    expect(getSql(buildSearch())).toBe(`select * from "fts_a"  WHERE timeout`);
  });

  it("blocks a word on a stream with no full-text field: no request, no toast (AC3.1, AC3.8)", () => {
    select(noFtsStream("nofts_b"));
    mockState.searchObj.data.query = "timeout";
    (mockState.searchObj.data as any).errorCode = 20004;
    const { getQueryReq } = useSearchQuery(gt);

    expect(getQueryReq(false)).toBeNull();
    expect((mockState.searchObj.data as any).freeTextBlocked).toMatchObject({
      streams: ["nofts_b"],
    });
    expect(mockState.notificationMsg.value).toBe("");
    expect((mockState.searchObj.data as any).errorCode).toBe(0);
  });

  it("never sets the blocked state from a read-only build, and clears it at the next run (AC3.8)", () => {
    select(noFtsStream("nofts_b"));
    mockState.searchObj.data.query = "timeout";
    const { buildSearch, getQueryReq } = useSearchQuery(gt);

    expect(buildSearch(true)).toBeNull();
    expect((mockState.searchObj.data as any).freeTextBlocked ?? null).toBeNull();

    getQueryReq(false);
    expect((mockState.searchObj.data as any).freeTextBlocked).not.toBeNull();
    mockState.searchObj.data.query = "level='x'";
    select(ftsStream("fts_a"));
    expect(getQueryReq(false)).not.toBeNull();
    expect((mockState.searchObj.data as any).freeTextBlocked).toBeNull();
  });

  it("sends only the full-text arm and names the excluded stream (AC4.1, AC4.3)", () => {
    select(ftsStream("fts_a"), noFtsStream("nofts_b"));
    mockState.searchObj.data.query = "timeout";
    const { buildSearch } = useSearchQuery(gt);

    const sql = getSql(buildSearch());

    expect(sql).toContain(`from "fts_a"  WHERE match_all('timeout')`);
    expect(sql).not.toContain("nofts_b");
    expect(mockState.searchObj.data.filterErrMsg).toBe("");
    expect(mockState.searchObj.data.missingStreamMessage).toContain("nofts_b");
    expect(mockState.searchObj.data.missingStreamMessage).toContain("no full-text fields");
    expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter).toEqual(["nofts_b"]);
    expect((mockState.searchObj.data as any).freeTextExcluded).toEqual(["nofts_b"]);
  });

  it("blocks when no selected stream has a full-text field", () => {
    select(noFtsStream("nofts_b"), noFtsStream("nofts_c"));
    mockState.searchObj.data.query = "timeout";
    const { getQueryReq } = useSearchQuery(gt);

    expect(getQueryReq(false)).toBeNull();
    expect((mockState.searchObj.data as any).freeTextBlocked.streams).toEqual([
      "nofts_b",
      "nofts_c",
    ]);
  });

  it("excludes the union of streams missing any filter field (AC4.4, fixes the last-field-wins bug)", () => {
    const a = { name: "a", schema: [{ name: "f1", type: "Utf8" }], settings: {} };
    const b = { name: "b", schema: [{ name: "f2", type: "Utf8" }], settings: {} };
    const c = {
      name: "c",
      schema: [
        { name: "f1", type: "Utf8" },
        { name: "f2", type: "Utf8" },
      ],
      settings: {},
    };
    select(a, b, c);
    mockState.searchObj.data.stream.selectedStreamFields = [
      { name: "f1", streams: ["a", "c"] },
      { name: "f2", streams: ["b", "c"] },
    ];
    mockState.searchObj.data.query = "f1='x' and f2='y'";
    const { buildSearch } = useSearchQuery(gt);

    const sql = getSql(buildSearch());

    expect(mockState.searchObj.data.stream.missingStreamMultiStreamFilter.sort()).toEqual([
      "a",
      "b",
    ]);
    expect(sql).toContain(`from "c"`);
    expect(sql).not.toContain(`from "a"`);
    expect(sql).not.toContain(`from "b"`);
  });

  it("sends an unparseable multi-stream filter unchanged instead of a client error (AC5.6-multi)", () => {
    select(ftsStream("fts_a"), ftsStream("fts_d"));
    mockState.searchObj.data.query = "level='api' timeout";
    const { getQueryReq } = useSearchQuery(gt);

    const sql = getSql(getQueryReq(false));

    expect(mockState.notificationMsg.value).toBe("");
    expect(sql).toContain(`from "fts_a"  WHERE level = 'api' timeout`);
    expect(sql).toContain(`from "fts_d"  WHERE level = 'api' timeout`);
    expect((mockState.searchObj.data as any).errorCode).toBe(0);
  });

  it("decorates the searched words and names the fields on hover (AC1.4)", () => {
    select(ftsStream("fts_a"));
    mockState.searchObj.data.query = "timeout error";
    const { getQueryReq } = useSearchQuery(gt);

    getQueryReq(false);

    const deco = (mockState.searchObj.data as any).freeTextDecorations;
    expect(deco.ranges).toEqual([
      { start: 0, end: 7 },
      { start: 8, end: 13 },
    ]);
    expect(deco.hover).toContain("Full-text search in: body");
    expect(deco.hover).toContain("match_all('timeout') AND match_all('error')");
  });

  it("validates only SQL nodes: a word is never reported as a missing field", () => {
    select(ftsStream("fts_a"), ftsStream("fts_d"));
    mockState.searchObj.data.query = "timeout";
    const { validateFilterForMultiStream } = useSearchQuery(gt);

    expect(validateFilterForMultiStream()).toBe(true);
    expect(mockState.searchObj.data.filterErrMsg).toBe("");
  });
});
