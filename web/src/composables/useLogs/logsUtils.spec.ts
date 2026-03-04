import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, reactive } from "vue";

// Create mock searchObj that will be used by logsUtils
const mockSearchObj = reactive({
  data: {
    query: "",
    datetime: {
      type: "relative",
      startTime: new Date().getTime(),
      endTime: new Date().getTime(),
      relativeTimePeriod: "15m",
    },
    stream: {
      streamType: "logs",
      selectedStream: ["default"],
      selectedFields: [],
    },
    queryResults: {
      hits: [],
      is_histogram_eligible: true,
    },
    tempFunctionContent: "",
    transformType: "",
    selectedTransform: null,
    searchRequestTraceIds: [] as string[],
  },
  meta: {
    sqlMode: true,
    showTransformEditor: false,
    pageType: "logs",
    showHistogram: true,
    quickMode: true,
    refreshInterval: 0,
    useUserDefinedSchemas: false,
    regions: [],
    clusters: [],
    logsVisualizeToggle: "logs",
  },
  organizationIdentifier: "default",
  communicationMethod: "http",
});

// Mock searchState
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: mockSearchObj,
  }),
}));

// Mock logsVisualization
vi.mock("@/composables/useLogs/logsVisualization", () => ({
  encodeVisualizationConfig: vi.fn().mockReturnValue("encoded"),
  getVisualizationConfig: vi.fn().mockReturnValue({}),
  encodeBuildConfig: vi.fn().mockReturnValue("encoded"),
  getBuildConfig: vi.fn().mockReturnValue({}),
}));

// Mock vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    zoConfig: {
      timestamp_column: "_timestamp",
      actions_enabled: false,
      super_cluster_enabled: false,
    },
    theme: "light",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock quasar
const mockNotify = vi.fn();
vi.mock("quasar", () => ({
  useQuasar: () => ({
    notify: mockNotify,
  }),
}));

// Mock vue-router
const mockRouterPush = vi.fn();
const mockCurrentRoute = ref({
  query: {},
});

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    currentRoute: mockCurrentRoute,
  }),
}));

// Mock aws-exports
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
    isCloud: "false",
  },
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((str) => Buffer.from(str).toString("base64")),
  useLocalLogFilterField: vi.fn().mockReturnValue({ value: {} }),
}));

// Mock constants
vi.mock("@/utils/logs/constants", () => ({
  TIME_MULTIPLIERS: {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Mock node-sql-parser
const mockParserInstance = {
  astify: vi.fn(),
  sqlify: vi.fn(),
};

vi.mock("@openobserve/node-sql-parser/build/datafusionsql", () => ({
  Parser: class MockParser {
    astify = mockParserInstance.astify;
    sqlify = mockParserInstance.sqlify;
  },
}));

// Import the module under test (after mocks are set up)
import { logsUtils } from "./logsUtils";

describe("logsUtils", () => {
  let utils: ReturnType<typeof logsUtils>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockSearchObj
    mockSearchObj.data.query = "";
    mockSearchObj.data.searchRequestTraceIds = [];
    mockSearchObj.meta.sqlMode = true;
    // Get fresh instance of logsUtils
    utils = logsUtils();
  });

  describe("fnParsedSQL", () => {
    it("should parse a valid SQL query", () => {
      const mockAst = {
        columns: [{ expr: { type: "column", column: "field1" } }],
        from: [{ table: "logs" }],
        where: null,
        groupby: null,
        orderby: null,
        limit: null,
      };
      mockParserInstance.astify.mockReturnValue(mockAst);

      const result = utils.fnParsedSQL("SELECT field1 FROM logs");
      expect(mockParserInstance.astify).toHaveBeenCalled();
      expect(result).toEqual(mockAst);
    });

    it("should return default result when parser throws error", () => {
      mockParserInstance.astify.mockImplementation(() => {
        throw new Error("Parse error");
      });

      const result = utils.fnParsedSQL("INVALID SQL");
      expect(result).toEqual({
        columns: [],
        from: [],
        orderby: null,
        limit: null,
        groupby: null,
        where: null,
      });
    });

    it("should filter out comment lines starting with --", () => {
      const mockAst = { columns: [], from: [], orderby: null, limit: null, groupby: null, where: null };
      mockParserInstance.astify.mockReturnValue(mockAst);

      utils.fnParsedSQL("-- this is a comment\nSELECT * FROM logs");

      // The call should have the comment filtered out
      expect(mockParserInstance.astify).toHaveBeenCalledWith("SELECT * FROM logs");
    });

    it("should use searchObj.data.query when no query provided", () => {
      const mockAst = { columns: [], from: [], orderby: null, limit: null, groupby: null, where: null };
      mockParserInstance.astify.mockReturnValue(mockAst);
      mockSearchObj.data.query = "SELECT * FROM default_stream";

      utils.fnParsedSQL("");

      expect(mockParserInstance.astify).toHaveBeenCalledWith("SELECT * FROM default_stream");
    });
  });

  describe("fnUnparsedSQL", () => {
    it("should convert AST back to SQL string", () => {
      mockParserInstance.sqlify.mockReturnValue("SELECT * FROM logs");

      const result = utils.fnUnparsedSQL({ columns: [], from: [] });
      expect(result).toBe("SELECT * FROM logs");
    });

    it("should return empty string when sqlify throws error", () => {
      mockParserInstance.sqlify.mockImplementation(() => {
        throw new Error("Sqlify error");
      });

      const result = utils.fnUnparsedSQL({ invalid: "object" });
      expect(result).toBe("");
    });

    it("should return empty string when sqlify returns undefined", () => {
      mockParserInstance.sqlify.mockReturnValue(undefined);

      const result = utils.fnUnparsedSQL({});
      expect(result).toBe("");
    });
  });

  describe("extractTimestamps", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should extract timestamps for seconds (s)", () => {
      const result = utils.extractTimestamps("30s");
      expect(result).toBeDefined();
      expect(result!.to).toBe(new Date("2024-06-15T12:00:00.000Z").getTime());
      expect(result!.from).toBe(new Date("2024-06-15T12:00:00.000Z").getTime() - 30 * 1000);
    });

    it("should extract timestamps for minutes (m)", () => {
      const result = utils.extractTimestamps("5m");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(5 * 60 * 1000);
    });

    it("should extract timestamps for hours (h)", () => {
      const result = utils.extractTimestamps("2h");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(2 * 60 * 60 * 1000);
    });

    it("should extract timestamps for days (d)", () => {
      const result = utils.extractTimestamps("1d");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(24 * 60 * 60 * 1000);
    });

    it("should extract timestamps for weeks (w)", () => {
      const result = utils.extractTimestamps("1w");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("should extract timestamps for months (M)", () => {
      const result = utils.extractTimestamps("1M");
      expect(result).toBeDefined();
      // Month calculation is variable, just check it's a valid range
      expect(result!.from).toBeLessThan(result!.to);
    });

    it("should return undefined for invalid period format", () => {
      const result = utils.extractTimestamps("5x");
      expect(result).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      const result = utils.extractTimestamps("");
      expect(result).toBeUndefined();
    });

    it("should return undefined for null/undefined", () => {
      const result = utils.extractTimestamps(null as any);
      expect(result).toBeUndefined();
    });

    it("should return undefined for negative values", () => {
      const result = utils.extractTimestamps("-5m");
      expect(result).toBeUndefined();
    });

    it("should return undefined for zero value", () => {
      const result = utils.extractTimestamps("0m");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-numeric value", () => {
      const result = utils.extractTimestamps("abcm");
      expect(result).toBeUndefined();
    });
  });

  describe("hasAggregation", () => {
    it("should return true when column has aggr_func type", () => {
      const columns = [
        { expr: { type: "aggr_func", name: "count" } },
      ];
      expect(utils.hasAggregation(columns)).toBe(true);
    });

    it("should return false when columns have no aggregation", () => {
      const columns = [
        { expr: { type: "column", column: "field1" } },
        { expr: { type: "column", column: "field2" } },
      ];
      expect(utils.hasAggregation(columns)).toBe(false);
    });

    it("should return true when query contains GROUP BY", () => {
      mockSearchObj.data.query = "SELECT field1, COUNT(*) FROM logs GROUP BY field1";
      const columns = [{ expr: { type: "column" } }];
      expect(utils.hasAggregation(columns)).toBe(true);
    });

    it("should return false for empty columns array", () => {
      mockSearchObj.data.query = "";
      expect(utils.hasAggregation([])).toBe(false);
    });

    it("should handle null/undefined columns", () => {
      mockSearchObj.data.query = "";
      expect(utils.hasAggregation(null as any)).toBe(false);
      expect(utils.hasAggregation(undefined as any)).toBe(false);
    });
  });

  describe("isLimitQuery", () => {
    it("should return true when LIMIT is present with values", () => {
      const parsedSQL = {
        limit: {
          value: [{ type: "number", value: 10 }],
        },
      };
      expect(utils.isLimitQuery(parsedSQL as any)).toBe(true);
    });

    it("should return false when LIMIT is not present", () => {
      const parsedSQL = { limit: null };
      expect(utils.isLimitQuery(parsedSQL as any)).toBe(false);
    });

    it("should return false when limit value is empty array", () => {
      const parsedSQL = { limit: { value: [] } };
      expect(utils.isLimitQuery(parsedSQL as any)).toBe(false);
    });

    it("should return false for null input", () => {
      expect(utils.isLimitQuery(null)).toBe(false);
    });

    it("should return false for undefined input", () => {
      expect(utils.isLimitQuery(undefined as any)).toBe(false);
    });
  });

  describe("isDistinctQuery", () => {
    it("should return true when DISTINCT is present", () => {
      const parsedSQL = {
        distinct: { type: "DISTINCT" },
      };
      expect(utils.isDistinctQuery(parsedSQL)).toBe(true);
    });

    it("should return false when DISTINCT is not present", () => {
      const parsedSQL = { distinct: null };
      expect(utils.isDistinctQuery(parsedSQL)).toBe(false);
    });

    it("should return false for null input", () => {
      expect(utils.isDistinctQuery(null)).toBe(false);
    });

    it("should return false when distinct has different type", () => {
      const parsedSQL = { distinct: { type: "ALL" } };
      expect(utils.isDistinctQuery(parsedSQL)).toBe(false);
    });
  });

  describe("isWithQuery", () => {
    it("should return true when WITH clause is present", () => {
      const parsedSQL = {
        with: [{ name: "cte", expr: {} }],
      };
      expect(utils.isWithQuery(parsedSQL)).toBe(true);
    });

    it("should return false when WITH is not present", () => {
      const parsedSQL = { with: null };
      expect(utils.isWithQuery(parsedSQL)).toBe(false);
    });

    it("should return false when WITH is empty array", () => {
      const parsedSQL = { with: [] };
      expect(utils.isWithQuery(parsedSQL)).toBe(false);
    });

    it("should return false for null input", () => {
      expect(utils.isWithQuery(null)).toBe(false);
    });
  });

  describe("addTraceId", () => {
    beforeEach(() => {
      mockSearchObj.data.searchRequestTraceIds = [];
    });

    it("should add trace ID to the collection", () => {
      utils.addTraceId("trace-123");
      expect(mockSearchObj.data.searchRequestTraceIds).toContain("trace-123");
    });

    it("should not add duplicate trace ID", () => {
      mockSearchObj.data.searchRequestTraceIds = ["trace-123"];
      utils.addTraceId("trace-123");
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual(["trace-123"]);
    });

    it("should add multiple unique trace IDs", () => {
      utils.addTraceId("trace-1");
      utils.addTraceId("trace-2");
      utils.addTraceId("trace-3");
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual([
        "trace-1",
        "trace-2",
        "trace-3",
      ]);
    });

    it("should not add empty string trace ID", () => {
      utils.addTraceId("");
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual([]);
    });

    it("should not add null/undefined trace ID", () => {
      utils.addTraceId(null as any);
      utils.addTraceId(undefined as any);
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual([]);
    });
  });

  describe("removeTraceId", () => {
    beforeEach(() => {
      mockSearchObj.data.searchRequestTraceIds = ["trace-1", "trace-2", "trace-3"];
    });

    it("should remove trace ID from the collection", () => {
      utils.removeTraceId("trace-2");
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual([
        "trace-1",
        "trace-3",
      ]);
    });

    it("should handle removing non-existent trace ID", () => {
      utils.removeTraceId("trace-999");
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual([
        "trace-1",
        "trace-2",
        "trace-3",
      ]);
    });

    it("should handle empty collection", () => {
      mockSearchObj.data.searchRequestTraceIds = [];
      utils.removeTraceId("trace-1");
      expect(mockSearchObj.data.searchRequestTraceIds).toEqual([]);
    });

    it("should not throw for empty string", () => {
      expect(() => utils.removeTraceId("")).not.toThrow();
    });

    it("should not throw for null/undefined", () => {
      expect(() => utils.removeTraceId(null as any)).not.toThrow();
      expect(() => utils.removeTraceId(undefined as any)).not.toThrow();
    });
  });

  describe("isTimestampASC", () => {
    it("should return true when timestamp is ordered ASC", () => {
      const orderby = [
        { expr: { column: "_timestamp" }, type: "ASC" },
      ];
      expect(utils.isTimestampASC(orderby)).toBe(true);
    });

    it("should return false when timestamp is ordered DESC", () => {
      const orderby = [
        { expr: { column: "_timestamp" }, type: "DESC" },
      ];
      expect(utils.isTimestampASC(orderby)).toBe(false);
    });

    it("should return false when no orderby", () => {
      expect(utils.isTimestampASC(null)).toBe(false);
      expect(utils.isTimestampASC(undefined)).toBe(false);
    });

    it("should return false when ordering different column", () => {
      const orderby = [
        { expr: { column: "other_field" }, type: "ASC" },
      ];
      expect(utils.isTimestampASC(orderby)).toBe(false);
    });

    it("should check timestamp column from store config", () => {
      mockStore.state.zoConfig.timestamp_column = "custom_ts";
      const orderby = [
        { expr: { column: "custom_ts" }, type: "ASC" },
      ];
      // Re-get utils to pick up new config
      const newUtils = logsUtils();
      expect(newUtils.isTimestampASC(orderby)).toBe(true);
    });
  });

  describe("checkTimestampAlias", () => {
    beforeEach(() => {
      mockStore.state.zoConfig.timestamp_column = "_timestamp";
    });

    it("should return true for query without timestamp alias", () => {
      mockParserInstance.astify.mockReturnValue({
        columns: [{ as: "my_field" }, { as: "other_field" }],
      });
      expect(utils.checkTimestampAlias("SELECT field1 as my_field FROM logs")).toBe(true);
    });

    it("should return false when column is aliased as timestamp", () => {
      mockParserInstance.astify.mockReturnValue({
        columns: [{ as: "_timestamp" }],
      });
      expect(utils.checkTimestampAlias("SELECT field1 as _timestamp FROM logs")).toBe(false);
    });

    it("should return false for AS '_timestamp' pattern in query", () => {
      mockParserInstance.astify.mockReturnValue({ columns: [] });
      expect(utils.checkTimestampAlias("SELECT field1 AS '_timestamp' FROM logs")).toBe(false);
    });

    it("should return false for AS \"_timestamp\" pattern in query", () => {
      mockParserInstance.astify.mockReturnValue({ columns: [] });
      expect(utils.checkTimestampAlias('SELECT field1 AS "_timestamp" FROM logs')).toBe(false);
    });

    it("should return false for AS _timestamp (unquoted) pattern in query", () => {
      mockParserInstance.astify.mockReturnValue({ columns: [] });
      expect(utils.checkTimestampAlias("SELECT field1 AS _timestamp FROM logs")).toBe(false);
    });

    it("should handle columns not being an array", () => {
      mockParserInstance.astify.mockReturnValue({ columns: null });
      expect(utils.checkTimestampAlias("SELECT * FROM logs")).toBe(true);
    });
  });

  describe("isNonAggregatedSQLMode", () => {
    it("should return true when not in SQL mode", () => {
      const searchObjParam = { meta: { sqlMode: false }, data: { queryResults: { is_histogram_eligible: true } } };
      const parsedSQL = {};
      expect(utils.isNonAggregatedSQLMode(searchObjParam, parsedSQL)).toBe(true);
    });

    it("should return false when SQL mode with LIMIT query", () => {
      const searchObjParam = { meta: { sqlMode: true }, data: { queryResults: { is_histogram_eligible: true } } };
      const parsedSQL = { limit: { value: [{ value: 10 }] } };
      expect(utils.isNonAggregatedSQLMode(searchObjParam, parsedSQL)).toBe(false);
    });

    it("should return false when SQL mode with DISTINCT query", () => {
      const searchObjParam = { meta: { sqlMode: true }, data: { queryResults: { is_histogram_eligible: true } } };
      const parsedSQL = { distinct: { type: "DISTINCT" } };
      expect(utils.isNonAggregatedSQLMode(searchObjParam, parsedSQL)).toBe(false);
    });

    it("should return false when SQL mode with WITH query", () => {
      const searchObjParam = { meta: { sqlMode: true }, data: { queryResults: { is_histogram_eligible: true } } };
      const parsedSQL = { with: [{ name: "cte" }] };
      expect(utils.isNonAggregatedSQLMode(searchObjParam, parsedSQL)).toBe(false);
    });

    it("should return false when not histogram eligible", () => {
      const searchObjParam = { meta: { sqlMode: true }, data: { queryResults: { is_histogram_eligible: false } } };
      const parsedSQL = {};
      expect(utils.isNonAggregatedSQLMode(searchObjParam, parsedSQL)).toBe(false);
    });

    it("should return true for simple SQL mode query", () => {
      const searchObjParam = { meta: { sqlMode: true }, data: { queryResults: { is_histogram_eligible: true } } };
      const parsedSQL = {};
      expect(utils.isNonAggregatedSQLMode(searchObjParam, parsedSQL)).toBe(true);
    });
  });

  describe("showCancelSearchNotification", () => {
    it("should call notify with correct parameters", () => {
      utils.showCancelSearchNotification();
      expect(mockNotify).toHaveBeenCalledWith({
        message: "Running query cancelled successfully",
        color: "positive",
        position: "bottom",
        timeout: 4000,
      });
    });
  });

  describe("generateURLQuery", () => {
    beforeEach(() => {
      mockSearchObj.data.datetime = {
        type: "relative",
        startTime: new Date().getTime(),
        endTime: new Date().getTime(),
        relativeTimePeriod: "15m",
      };
      mockSearchObj.data.stream = {
        streamType: "logs",
        selectedStream: ["default"],
        selectedFields: [],
      };
      mockSearchObj.data.query = "SELECT * FROM logs";
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.meta.quickMode = true;
      mockSearchObj.meta.showHistogram = true;
      mockSearchObj.meta.refreshInterval = 0;
      mockSearchObj.meta.logsVisualizeToggle = "logs";
    });

    it("should generate query params with stream info", () => {
      const query = utils.generateURLQuery();
      expect(query.stream_type).toBe("logs");
      expect(query.stream).toBe("default");
    });

    it("should include relative time period for relative datetime", () => {
      const query = utils.generateURLQuery();
      expect(query.period).toBe("15m");
    });

    it("should include from/to for absolute datetime", () => {
      mockSearchObj.data.datetime.type = "absolute";
      mockSearchObj.data.datetime.startTime = 1000000;
      mockSearchObj.data.datetime.endTime = 2000000;

      const query = utils.generateURLQuery();
      expect(query.from).toBe(1000000);
      expect(query.to).toBe(2000000);
    });

    it("should include from/to for share link even with relative time", () => {
      mockSearchObj.data.datetime.startTime = 1000000;
      mockSearchObj.data.datetime.endTime = 2000000;

      const query = utils.generateURLQuery(true);
      expect(query.from).toBe(1000000);
      expect(query.to).toBe(2000000);
    });

    it("should include sql_mode and query when query exists", () => {
      const query = utils.generateURLQuery();
      expect(query.sql_mode).toBe(true);
      expect(query.query).toBeDefined();
    });

    it("should include quick_mode setting", () => {
      const query = utils.generateURLQuery();
      expect(query.quick_mode).toBe(true);
    });

    it("should include show_histogram setting", () => {
      const query = utils.generateURLQuery();
      expect(query.show_histogram).toBe(true);
    });

    it("should include organization identifier", () => {
      const query = utils.generateURLQuery();
      expect(query.org_identifier).toBe("test-org");
    });

    it("should include logsVisualizeToggle when set", () => {
      mockSearchObj.meta.logsVisualizeToggle = "visualize";
      const query = utils.generateURLQuery();
      expect(query.logs_visualize_toggle).toBe("visualize");
    });

    it("should handle stream as object with value property", () => {
      mockSearchObj.data.stream.selectedStream = { value: "my-stream" } as any;
      const query = utils.generateURLQuery();
      expect(query.stream).toBe("my-stream");
    });
  });

  describe("shouldAddFunctionToSearch", () => {
    it("should return true when transform editor is shown with content", () => {
      mockSearchObj.data.tempFunctionContent = "function content";
      mockSearchObj.meta.showTransformEditor = true;
      expect(utils.shouldAddFunctionToSearch()).toBe(true);
    });

    it("should return false when no function content", () => {
      mockSearchObj.data.tempFunctionContent = "";
      mockSearchObj.meta.showTransformEditor = true;
      expect(utils.shouldAddFunctionToSearch()).toBe(false);
    });

    it("should return false when transform editor is not shown", () => {
      mockSearchObj.data.tempFunctionContent = "function content";
      mockSearchObj.meta.showTransformEditor = false;
      expect(utils.shouldAddFunctionToSearch()).toBe(false);
    });
  });

  describe("addTransformToQuery", () => {
    it("should add query_fn when function should be added", () => {
      mockSearchObj.data.tempFunctionContent = "function content";
      mockSearchObj.meta.showTransformEditor = true;

      const queryReq = { query: {} };
      utils.addTransformToQuery(queryReq);

      expect(queryReq.query).toHaveProperty("query_fn");
    });

    it("should add action_id when transform type is action", () => {
      mockSearchObj.data.transformType = "action";
      mockSearchObj.data.selectedTransform = { id: "action-123" };

      const queryReq = { query: {} };
      utils.addTransformToQuery(queryReq);

      expect(queryReq.query).toHaveProperty("action_id", "action-123");
    });

    it("should not modify query when no transform to add", () => {
      mockSearchObj.data.tempFunctionContent = "";
      mockSearchObj.data.transformType = "";
      mockSearchObj.data.selectedTransform = null;

      const queryReq = { query: {} };
      utils.addTransformToQuery(queryReq);

      expect(queryReq.query).not.toHaveProperty("query_fn");
      expect(queryReq.query).not.toHaveProperty("action_id");
    });
  });
});
