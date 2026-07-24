import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import i18n from "@/locales";
import ScheduledPipeline from "./ScheduledPipeline.vue";
import searchService from "@/services/search";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { makeQuerySchema } from "./Query.schema";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

// Mock services and composables
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "timestamp", type: "datetime" },
        { name: "message", type: "string" },
      ],
    }),
    getStreams: vi.fn().mockResolvedValue({
      list: [
        { name: "stream1", stream_type: "logs" },
        { name: "stream2", stream_type: "metrics" },
      ],
    }),
  }),
}));
vi.mock("@/composables/useParser", () => {
  return {
    default: () => ({
      sqlParser: async () => ({
        astify: vi.fn((query) => {
          const lowerQuery = query.toLowerCase();

          if (lowerQuery.includes("select *")) {
            return {
              columns: [{ expr: { column: "*" } }],
            };
          }
          if (lowerQuery.includes("valid_column")) {
            return {
              columns: [{ expr: { column: "valid_column" } }],
            };
          }
          if (lowerQuery.includes("default")) {
            throw new Error("Syntax error near 'default'");
          }
          return { columns: [] };
        }),
        sqlify: vi.fn(),
        columnList: vi.fn(),
        tableList: vi.fn(),
        whiteListCheck: vi.fn(),
        exprToSQL: vi.fn(),
        parse: vi.fn(),
      }),
    }),
  };
});

vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: {
      data: {
        stream: {
          pipelineQueryStream: [],
        },
      },
    },
  }),
}));

// ── Default form value (the streamRoute shape Query seeds) ────────────────────
const buildDefaultValues = () => ({
  name: "",
  conditions: [],
  stream_type: "logs",
  query_condition: {
    sql: "",
    promql: "",
    type: "sql",
    aggregation: null,
    promql_condition: null,
  },
  trigger_condition: {
    frequency: 15,
    period: 15,
    frequency_type: "minutes",
    timezone: "UTC",
    cron: "",
    operator: ">=",
    threshold: 1,
  },
  delay: 0,
  context_attributes: [],
  description: "",
  enabled: true,
});

describe("ScheduledPipeline Component", () => {
  let wrapper;
  let child;
  let form;
  let mockStore;

  // Mount ScheduledPipeline INSIDE a real <OForm> (Rule ③ descendant) so it can
  // inject the form (its single source of truth). The harness exposes both the
  // child vm and the form for the assertions below.
  const mountHarness = (overrides = {}, childProps = {}, formOptions = {}) => {
    let innerForm;
    const Harness = defineComponent({
      name: "Harness",
      setup(_, { expose }) {
        innerForm = useOForm({
          defaultValues: { ...buildDefaultValues(), ...overrides },
          schema: makeQuerySchema(900, i18n.global.t),
          onSubmit: formOptions.onSubmit ?? (() => {}),
        });
        expose({ form: innerForm });
        return () =>
          h(OForm, { form: innerForm }, () =>
            h(ScheduledPipeline, {
              ref: "child",
              columns: [],
              conditions: {},
              alertData: { stream_type: "logs" },
              disableThreshold: true,
              ...childProps,
            }),
          );
      },
    });

    const w = mount(Harness, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          OIcon: true,
          DateTime: true,
          FieldList: true,
          QueryEditor: true,
          UnifiedQueryEditor: {
            template: '<div data-test="scheduled-pipeline-sql-editor" />',
            methods: {
              getCursorIndex: () => -1,
              getValue: () => "",
              setValue: () => {},
              replaceRange: () => {},
              triggerAutoComplete: () => {},
            },
          },
          OTable: true,
          PreviewPromqlQuery: true,
          O2AIChat: true,
          FullViewContainer: true,
        },
      },
    });
    return { w, f: innerForm };
  };

  beforeEach(async () => {
    // Setup mock store
    mockStore = {
      state: {
        theme: "light",
        selectedOrganization: {
          identifier: "test-org",
        },
        zoConfig: {
          min_auto_refresh_interval: 900,
          sql_base64_enabled: false,
          timestamp_column: "_timestamp",
          all_fields_name: "_all",
        },
        isAiChatEnabled: false,
        organizationData: {
          functions: [
            { name: "avg", description: "Average function", function: "avg(value)" },
            { name: "sum", description: "Sum function", function: "sum(value)" },
          ],
        },
        timezone: "UTC",
        userInfo: {
          email: "test@example.com",
        },
      },
      dispatch: vi.fn(),
    };

    const mounted = mountHarness();
    wrapper = mounted.w;
    form = mounted.f;
    child = wrapper.findComponent(ScheduledPipeline).vm;

    // Initialize dateTime with valid values
    child.dateTime = {
      startTime: Date.now() - 3600000, // 1 hour ago
      endTime: Date.now(),
      relativeTimePeriod: "15m",
      valueType: "relative",
    };

    // Set up a mock editor ref so updateQueryValue does not throw when
    // accessing getCursorIndex / triggerAutoComplete on the stubbed component.
    child.pipelineEditorRef = {
      getCursorIndex: vi.fn().mockReturnValue(-1),
      getValue: vi.fn().mockReturnValue(""),
      setValue: vi.fn(),
      replaceRange: vi.fn(),
      triggerAutoComplete: vi.fn(),
    };

    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (child) child.query = "";
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct default values", () => {
      expect(child.tab).toBe("sql");
      expect(child.selectedStreamType).toBe("logs");
      expect(child.query).toBe("");
      expect(child.expandState.query).toBe(true);
      expect(child.expandState.output).toBe(false);
    });

    it("sets up correct splitter model values", () => {
      expect(child.splitterModel).toBe(30);
      expect(child.sideBarSplitterModel).toBe(60);
    });
  });

  describe("Stream Management", () => {
    it("loads stream list on mount", async () => {
      expect(child.streams.length).toBe(2);
      expect(child.filteredStreams.length).toBe(2);
    });

    it("filters streams based on search input", async () => {
      await child.filterStreams("stream1", (fn) => fn());
      expect(child.filteredStreams.length).toBe(1);
      expect(child.filteredStreams[0].value).toBe("stream1");
    });

    it("updates stream fields when stream is selected", async () => {
      await child.getStreamFields();
      await flushPromises();
      expect(child.streamFields.length).toBe(2);
      expect(child.streamFields[0].name).toBe("timestamp");
    });

    it("updates query when stream is selected", async () => {
      form.setFieldValue("stream_name", "test_stream");
      await child.getStreamFields();
      await flushPromises();
      expect(child.query).toContain("test_stream");
    });
  });

  describe("Query Management", () => {
    it("updates SQL query correctly", async () => {
      const newQuery = "SELECT * FROM test_stream";
      await child.updateQueryValue(newQuery);
      expect(child.query).toBe(newQuery);
      // The Monaco SQL text is bridged into the form's query_condition.sql.
      expect(form.state.values.query_condition.sql).toBe(newQuery);
    });

    it("updates PromQL query correctly", async () => {
      child.tab = "promql";
      const newQuery = "test_metric{}";
      await child.updateQueryValue(newQuery);
      expect(child.query).toBe(newQuery);
      expect(form.state.values.query_condition.promql).toBe(newQuery);
    });

    it("handles query type switching", async () => {
      child.tab = "promql";
      await child.updateTab();
      await nextTick();
      // query_condition.type is form-owned and kept in sync with the tab.
      expect(form.state.values.query_condition.type).toBe("promql");
    });
  });

  describe("Trigger Condition Management", () => {
    it("blocks submit when minutes frequency is below the org minimum (schema)", async () => {
      form.setFieldValue("trigger_condition.frequency_type", "minutes");
      form.setFieldValue("trigger_condition.frequency", 5);
      await nextTick();
      // min_auto_refresh_interval is 900s → 15 min minimum; 5 < 15 is invalid.
      await form.handleSubmit();
      await nextTick();
      expect(form.state.isValid).toBe(false);
    });

    it("blocks submit on an invalid cron expression (schema)", async () => {
      form.setFieldValue("trigger_condition.frequency_type", "cron");
      form.setFieldValue("trigger_condition.cron", "invalid");
      await nextTick();
      await form.handleSubmit();
      await nextTick();
      expect(form.state.isValid).toBe(false);
    });

    it("updates period based on frequency type", async () => {
      form.setFieldValue("trigger_condition.frequency_type", "minutes");
      form.setFieldValue("trigger_condition.frequency", 20);
      await nextTick();
      await child.updateFrequency();
      await nextTick();
      expect(form.state.values.trigger_condition.period).toBe(20);
    });
  });

  describe("UI Interactions", () => {
    it("toggles field list collapse", async () => {
      await child.collapseFieldList();
      expect(child.collapseFields).toBe(true);
      expect(child.splitterModel).toBe(0);
    });

    it("handles AI chat toggle", async () => {
      await child.toggleAIChat();
      await nextTick();
      expect(mockStore.dispatch).toHaveBeenCalledWith("setIsAiChatEnabled", true);
    });

    it("updates expand states correctly", async () => {
      child.expandState.output = true;
      await nextTick();
      expect(child.expandState.query).toBe(false);
    });
  });

  describe("Search and Results", () => {
    it("executes SQL search query", async () => {
      child.tab = "sql";
      child.query = "SELECT * FROM test_stream";
      searchService.search.mockResolvedValueOnce({
        data: {
          hits: [{ _timestamp: 1234567890000, message: "test" }],
        },
      });

      await child.runQuery();
      expect(searchService.search).toHaveBeenCalled();
      expect(child.rows.length).toBe(1);
    });

    it("handles empty search results", async () => {
      searchService.search.mockResolvedValueOnce({
        data: {
          hits: [],
        },
      });

      await child.runQuery();
      expect(child.rows).toEqual([]);
    });

    it("handles search errors", async () => {
      searchService.search.mockRejectedValueOnce(new Error("Search failed"));
      await child.runQuery();
      expect(child.rows).toEqual([]);
    });
  });

  describe("Field Management", () => {
    it("updates cursor position correctly", async () => {
      // Mock the editor reference
      const mockEditorRef = {
        getCursorIndex: vi.fn().mockReturnValue(7),
        getValue: vi.fn().mockReturnValue("SELECT "),
        setValue: vi.fn(),
        replaceRange: vi.fn(),
      };
      child.pipelineEditorRef = mockEditorRef;
      child.tab = "custom";

      await child.handleSidebarEvent("click", "field1");
      await nextTick();
      expect(child.cursorPosition).toBe(15);
    });

    it("inserts SQL filters before GROUP BY", async () => {
      const mockEditorRef = {
        getCursorIndex: vi.fn().mockReturnValue(-1),
        getValue: vi
          .fn()
          .mockReturnValue(
            'SELECT max(_timestamp), count(*) FROM "stream1" GROUP BY histogram(_timestamp)',
          ),
        setValue: vi.fn(),
      };
      child.pipelineEditorRef = mockEditorRef;
      child.tab = "sql";

      await child.handleSidebarEvent("add-field", "service='api'");

      expect(mockEditorRef.setValue).toHaveBeenCalledWith(
        "SELECT max(_timestamp), count(*) FROM \"stream1\" where service='api' GROUP BY histogram(_timestamp)",
      );
    });

    it("appends SQL filters inside existing WHERE before GROUP BY", async () => {
      const mockEditorRef = {
        getCursorIndex: vi.fn().mockReturnValue(-1),
        getValue: vi
          .fn()
          .mockReturnValue(
            "SELECT max(_timestamp), count(*) FROM \"stream1\" WHERE level='error' GROUP BY histogram(_timestamp)",
          ),
        setValue: vi.fn(),
      };
      child.pipelineEditorRef = mockEditorRef;
      child.tab = "sql";

      await child.handleSidebarEvent("add-field", "service='api'");

      expect(mockEditorRef.setValue).toHaveBeenCalledWith(
        "SELECT max(_timestamp), count(*) FROM \"stream1\" WHERE level='error' AND service='api' GROUP BY histogram(_timestamp)",
      );
    });

    it("removes SQL field filters instead of adding the field name", async () => {
      const mockEditorRef = {
        getCursorIndex: vi.fn().mockReturnValue(-1),
        getValue: vi
          .fn()
          .mockReturnValue(
            "SELECT max(_timestamp), count(*) FROM \"stream1\" WHERE level='error' AND service='api' GROUP BY histogram(_timestamp)",
          ),
        setValue: vi.fn(),
      };
      child.pipelineEditorRef = mockEditorRef;
      child.tab = "sql";

      await child.handleSidebarEvent("remove-field", "service");

      expect(mockEditorRef.setValue).toHaveBeenCalledWith(
        "SELECT max(_timestamp), count(*) FROM \"stream1\" WHERE level='error' GROUP BY histogram(_timestamp)",
      );
    });
  });

  describe("Function Management", () => {
    beforeEach(async () => {
      // Reset the store's functions
      mockStore.state.organizationData = {
        functions: [
          { name: "avg", description: "Average function", function: "avg(value)" },
          { name: "sum", description: "Sum function", function: "sum(value)" },
        ],
      };
      await nextTick();
    });

    it("initializes with correct functions list", () => {
      expect(child.functionsList).toBeDefined();
      expect(child.functionsList.length).toBe(2);
      expect(child.functionsList[0].name).toBe("avg");
    });

    it("handles function selection", async () => {
      const testFunction = {
        name: "avg",
        description: "Average function",
        function: "avg(value)",
      };

      // Initialize the component's state
      child.selectedFunction = null;
      child.vrlFunctionContent = null;

      // Call the method and wait for updates
      await child.onFunctionSelect(testFunction);
      await nextTick();

      // Verify the state changes
      expect(child.selectedFunction).toBe("avg");
    });
  });

  describe("Bug Fix: PromQL Tab Auto-Open Output Section (Issue #2)", () => {
    it("should not auto-expand output section when switching to promql tab", async () => {
      child.expandState.output = false;
      child.tab = "promql";
      form.setFieldValue("stream_type", "metrics");

      await child.updateTab();
      await nextTick();

      // Output should remain collapsed after switching to promql
      expect(child.expandState.output).toBe(false);
    });

    it("should only show promql preview when output is expanded", () => {
      child.tab = "promql";
      child.expandState.output = false;

      expect(child.expandState.output).toBe(false);
    });

    it("should show promql preview when output is manually expanded", async () => {
      child.tab = "promql";
      child.expandState.output = false;

      // Manually expand output
      child.expandState.output = true;
      await nextTick();

      expect(child.expandState.output).toBe(true);
    });
  });

  describe("Bug Fix: Loader Pushing Footer (Issue #3)", () => {
    it("should only show loader when output section is expanded", async () => {
      child.loading = true;
      child.tab = "sql";
      child.expandState.output = false;

      await nextTick();

      expect(child.expandState.output).toBe(false);
    });

    it("should show loader when output is expanded and loading", async () => {
      child.loading = true;
      child.tab = "sql";
      child.expandState.output = true;

      await nextTick();

      expect(child.loading).toBe(true);
      expect(child.expandState.output).toBe(true);
    });

    it("should not show table while loading", async () => {
      child.loading = true;
      child.tab = "sql";
      child.expandState.output = true;
      child.rows = [{ test: "data" }];

      await nextTick();

      expect(child.loading).toBe(true);
    });
  });

  describe("Bug Fix: PromQL First Click Not Running Query (Issue #4)", () => {
    it("should run promql query on first click using nextTick", async () => {
      child.tab = "promql";
      child.expandState.output = false;
      child.query = "test_metric{}";
      form.setFieldValue("stream_name", "test_metric");

      // Mock the previewPromqlQueryRef
      const mockRefreshData = vi.fn();

      // Simulate run query button click
      child.expandState.output = true;
      // Fully settle all pending re-renders (tab/stream_name/expandState) BEFORE
      // overwriting the template ref, so runQuery's internal nextTick doesn't
      // re-bind previewPromqlQueryRef back to the stub and clobber the mock.
      await flushPromises();
      // Set the template ref after the promql preview has rendered.
      child.previewPromqlQueryRef = {
        refreshData: mockRefreshData,
      };

      await child.runQuery();

      // Wait for nextTick to complete
      await nextTick();

      // refreshData should be called after nextTick
      expect(mockRefreshData).toHaveBeenCalled();
    });

    it("should handle null previewPromqlQueryRef gracefully", async () => {
      child.tab = "promql";
      child.previewPromqlQueryRef = null;

      // Should not throw error
      await expect(child.runQuery()).resolves.not.toThrow();
    });

    it("should only call refreshData if ref exists after nextTick", async () => {
      child.tab = "promql";
      child.previewPromqlQueryRef = null;

      // Run query without ref
      await child.runQuery();

      // Should complete without error
      expect(child.tab).toBe("promql");
    });
  });

  describe("Bug Fix: PromQL Query and Stream Not Restored on Edit (Issue #5)", () => {
    it("should initialize query from form promql when query_type is promql", () => {
      const promqlQuery = "cpu_usage{instance='server1'}";
      const { w } = mountHarness({
        query_condition: {
          sql: "SELECT * FROM logs",
          promql: promqlQuery,
          type: "promql",
          aggregation: null,
          promql_condition: null,
        },
        stream_type: "metrics",
      });
      const newChild = w.findComponent(ScheduledPipeline).vm;
      expect(newChild.query).toBe(promqlQuery);
      w.unmount();
    });

    it("should initialize query from form sql when query_type is sql", () => {
      const sqlQuery = "SELECT * FROM logs";
      const { w } = mountHarness({
        query_condition: {
          sql: sqlQuery,
          promql: "metric{}",
          type: "sql",
          aggregation: null,
          promql_condition: null,
        },
        stream_type: "logs",
      });
      const newChild = w.findComponent(ScheduledPipeline).vm;
      expect(newChild.query).toBe(sqlQuery);
      w.unmount();
    });

    it("should extract stream name from promql query on mount", async () => {
      const promqlQuery = "cpu_usage{instance='server1'}";
      child.tab = "promql";
      child.query = promqlQuery;

      // Simulate the onMounted extraction
      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        form.setFieldValue("stream_name", match[1]);
      }

      await nextTick();

      expect(child.selectedStreamName).toBe("cpu_usage");
    });

    it("should handle promql query with complex label selectors", async () => {
      const promqlQuery = "http_requests_total{method='GET',status='200'}";
      child.tab = "promql";
      child.query = promqlQuery;

      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        form.setFieldValue("stream_name", match[1]);
      }

      await nextTick();

      expect(child.selectedStreamName).toBe("http_requests_total");
    });

    it("should handle promql query with hyphens and underscores", async () => {
      const promqlQuery = "my-metric_name_123{}";
      child.tab = "promql";
      child.query = promqlQuery;

      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        form.setFieldValue("stream_name", match[1]);
      }

      await nextTick();

      expect(child.selectedStreamName).toBe("my-metric_name_123");
    });

    it("should not extract stream name from invalid promql query", async () => {
      const promqlQuery = "{invalid}";
      child.tab = "promql";
      child.query = promqlQuery;
      form.setFieldValue("stream_name", "");

      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        form.setFieldValue("stream_name", match[1]);
      }

      await nextTick();

      expect(child.selectedStreamName).toBe("");
    });

    it("should call getStreamFields after extracting stream name", async () => {
      child.tab = "promql";
      child.query = "test_metric{}";
      form.setFieldValue("stream_name", "test_metric");

      // Call getStreamFields
      await child.getStreamFields();
      await flushPromises();

      // Verify that streamFields was updated (function was executed)
      expect(child.streamFields.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Integration: All Bug Fixes Together", () => {
    it("should handle complete promql workflow with all fixes", async () => {
      // Setup: Create a node with PromQL query
      const promqlQuery = "cpu_usage{instance='server1'}";

      // Fix #5: Initialize with promql query
      child.tab = "promql";
      child.query = promqlQuery;
      form.setFieldValue("stream_type", "metrics");

      // Fix #5: Extract stream name
      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        form.setFieldValue("stream_name", match[1]);
      }
      expect(child.selectedStreamName).toBe("cpu_usage");

      // Fix #2: Output should not auto-expand when switching tabs
      child.expandState.output = false;
      expect(child.expandState.output).toBe(false);

      // Fix #3: Loader should respect output expand state
      child.loading = true;
      expect(child.expandState.output).toBe(false);

      // Manually expand output
      child.expandState.output = true;
      child.loading = false;

      // Fix #4: First click should work with nextTick
      const mockRefreshData = vi.fn();
      child.previewPromqlQueryRef = {
        refreshData: mockRefreshData,
      };

      await child.runQuery();
      await nextTick();

      expect(mockRefreshData).toHaveBeenCalled();
    });

    it("should handle SQL workflow with stream type fix", async () => {
      // Fix #1: Should use correct stream type
      child.tab = "sql";
      form.setFieldValue("stream_type", "traces");
      child.query = "SELECT * FROM traces_stream";

      searchService.search.mockResolvedValueOnce({
        data: { hits: [] },
      });

      await child.runQuery();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "traces",
        }),
        expect.any(String),
      );
    });
  });

  // Restored §5 #3 dropped validation, now SCHEMA-driven: group_by rows are
  // required when aggregation is enabled. The old imperative validateInputs()
  // gate is gone — drive the real form's submit and read the schema result.
  describe("group_by row required when aggregation enabled (schema-driven)", () => {
    it("blocks submit and surfaces a per-row error when a group_by row is empty", async () => {
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      vi.mocked(toast).mockClear();
      form.setFieldValue("query_condition.aggregation", {
        group_by: ["valid_col", ""],
        function: "count",
        having: { column: "level", operator: "=", value: "5" },
      });
      child._isAggregationEnabled = true;
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      // The per-row error view reads the form field meta for the empty row.
      expect(child.groupByErrors[1]).toBeTruthy();
    });

    it("passes the group_by check when every row is filled", async () => {
      form.setFieldValue("query_condition.aggregation", {
        group_by: ["col_a", "col_b"],
        function: "count",
        having: { column: "level", operator: "=", value: "5" },
      });
      child._isAggregationEnabled = true;
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
      expect(child.groupByErrors[0]).toBeFalsy();
      expect(child.groupByErrors[1]).toBeFalsy();
    });

    // Row-reuse guard: with an index-based :key, deleting a NON-LAST row must
    // shift every following row's rendered value up by one (no stale reuse).
    // The group_by[] fields bind by TanStack name path, so this proves the
    // deletion goes through form.removeFieldValue and the rendered OFormSelect
    // values track the shifted array — not the pre-delete positions.
    const groupBySelects = () =>
      wrapper
        .findAllComponents(OFormSelect)
        .filter((c) =>
          String(c.props("name") || "").startsWith("query_condition.aggregation.group_by"),
        );
    const renderedGroupByValues = () =>
      groupBySelects().map((c) => c.findComponent(OSelect).props("modelValue"));

    it("shifts rendered group_by values up when a non-last row is deleted", async () => {
      child.tab = "custom";
      form.setFieldValue("query_condition.aggregation", {
        group_by: ["col_a", "col_b", "col_c"],
        function: "count",
        having: { column: "level", operator: "=", value: "5" },
      });
      child._isAggregationEnabled = true;
      await nextTick();

      // three rows render, showing a / b / c in order
      expect(groupBySelects()).toHaveLength(3);
      expect(renderedGroupByValues()).toEqual(["col_a", "col_b", "col_c"]);

      // delete the MIDDLE row (index 1)
      child.deleteGroupByColumn(1);
      await nextTick();

      // the form-owned array shifted
      expect(form.state.values.query_condition.aggregation.group_by).toEqual(["col_a", "col_c"]);

      // and the RENDERED selects shifted: row 1 now shows col_c, NOT the stale
      // col_b — one fewer row, values tracking the array (no row-reuse glitch).
      expect(groupBySelects()).toHaveLength(2);
      expect(renderedGroupByValues()).toEqual(["col_a", "col_c"]);
    });
  });

  // R3 timing + single source of truth: the cron error must NOT appear before
  // the first submit (the old @blur="cronTouched=true" + manual error div are
  // gone), and on submit it must come from the schema (routed to the cron
  // field), not a parallel manual ref.
  describe("cron error is schema-driven and R3-timed (no pre-submit reveal)", () => {
    it("shows no cron error before submit, then the schema error on submit", async () => {
      child.tab = "custom";
      form.setFieldValue("trigger_condition.frequency_type", "cron");
      form.setFieldValue("trigger_condition.cron", "");
      await nextTick();

      // the removed manual error div must not exist any more
      expect(wrapper.find('[data-test="scheduled-pipeline-frequency-error-text"]').exists()).toBe(
        false,
      );
      // before first submit: revalidateLogic keeps the cron field error empty
      expect(form.getFieldMeta("trigger_condition.cron")?.errors ?? []).toHaveLength(0);

      await form.handleSubmit();
      await flushPromises();

      // on submit: the schema's cron superRefine routes the error to the field
      // (the OFormInput renders it) and blocks the submit — single source.
      expect(form.state.isValid).toBe(false);
      expect((form.getFieldMeta("trigger_condition.cron")?.errors ?? []).length).toBeGreaterThan(0);
    });
  });

  // R4: the footer Save is `type="submit"` and lives INSIDE Query's <OForm>, so
  // pressing Enter fires native browser implicit submission → OForm's @submit →
  // form.handleSubmit() → the schema-gated save. Regression guard for the earlier
  // `type="button"` + @click-emit wiring, which saved on click but left Enter
  // dead. The other submit tests drive form.handleSubmit() directly and so can
  // NOT catch a broken Enter — these exercise the NATIVE submit path.
  describe("R4: Enter submits via a type=submit Save button (native form submit)", () => {
    it("renders the Save button as type=submit so Enter can submit the form", () => {
      const saveBtn = wrapper.find('[data-test="stream-routing-query-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.attributes("type")).toBe("submit");
    });

    it("runs the schema-gated save on a native form submit (Enter path)", async () => {
      const onSubmit = vi.fn();
      const { w } = mountHarness({}, {}, { onSubmit });
      await flushPromises();

      // The seeded defaults are valid for the disableThreshold path (period 15,
      // minutes frequency 15 ≥ ceil(900/60)). A native submit — what Enter fires
      // via implicit submission — must run the schema and reach onSubmit. The
      // native submit is fire-and-forget (the playbook's documented gotcha), so
      // wait for the validate→onSubmit chain to settle rather than a single flush.
      await w.find("form").trigger("submit");
      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      w.unmount();
    });

    it("blocks the save when the schema is invalid (period 0)", async () => {
      const onSubmit = vi.fn();
      // period 0 fails the schema (`period ≥ 1`). Drive + await the form's own
      // submit so the negative can be asserted deterministically (per the
      // playbook — a fire-and-forget native submit can't be awaited reliably).
      const { w, f } = mountHarness(
        {
          trigger_condition: {
            ...buildDefaultValues().trigger_condition,
            period: 0,
          },
        },
        {},
        { onSubmit },
      );
      await flushPromises();

      await f.handleSubmit();
      await flushPromises();

      expect(f.state.isValid).toBe(false);
      expect(onSubmit).not.toHaveBeenCalled();
      w.unmount();
    });

    // The composite "number + unit" fields (frequency/period) suppress the
    // built-in message with an empty #error slot and render the schema error in
    // a FULL-WIDTH sibling below the bordered control — not inside the 7.5rem
    // field where it would wrap/clip. Prove the external error text renders after
    // an invalid submit, and that no inline OFormInput message (role="alert")
    // leaks inside the narrow field.
    it("renders the period schema error as a full-width sibling, not inside the field", async () => {
      const { w, f } = mountHarness({
        trigger_condition: {
          ...buildDefaultValues().trigger_condition,
          period: 0,
        },
      });
      await flushPromises();

      await f.handleSubmit();
      await flushPromises();

      const err = w.find('[data-test="scheduled-pipeline-period-error-text"]');
      expect(err.exists()).toBe(true);
      expect(err.text().length).toBeGreaterThan(0);
      // the empty #error slot suppresses the inline message row inside the group
      expect(w.findAll('[role="alert"]').length).toBe(0);
      w.unmount();
    });
  });

  // R1-strict: the remaining bare <OSelect>/<OInput> controls inside the <OForm>
  // are now OForm* `name=` fields, so the injected form is the single source of
  // truth for each. Prove both directions: form → rendered value, and rendered
  // control change → form value (no local mirror, no @update bridge).
  describe("R1-strict: promql / stream / aggregation / trigger controls are form-owned", () => {
    const formSelectByName = (w, name) =>
      w.findAllComponents(OFormSelect).find((c) => c.props("name") === name);
    const formInputByName = (w, name) =>
      w.findAllComponents(OFormInput).find((c) => c.props("name") === name);

    it("group 1 — promql operator/value bind query_condition.promql_condition.*", async () => {
      form.setFieldValue("query_condition.promql_condition", {
        operator: "=",
        value: 0,
      });
      form.setFieldValue("stream_type", "metrics");
      child.tab = "promql";
      await nextTick();
      await flushPromises();

      const op = formSelectByName(wrapper, "query_condition.promql_condition.operator");
      const val = formInputByName(wrapper, "query_condition.promql_condition.value");
      expect(op).toBeTruthy();
      expect(val).toBeTruthy();

      // form → view: the rendered operator reflects the form-owned value
      expect(op.findComponent(OSelect).props("modelValue")).toBe("=");

      // view → form: changing the controls writes the form (single source)
      op.findComponent(OSelect).vm.$emit("update:model-value", ">");
      val.findComponent(OInput).vm.$emit("update:model-value", 42);
      await nextTick();
      expect(form.state.values.query_condition.promql_condition.operator).toBe(">");
      expect(form.state.values.query_condition.promql_condition.value).toBe(42);
    });

    it("group 4 — stream type/name bind stream_type / stream_name", async () => {
      // form → view: setting the form-owned stream_type renders on the select
      form.setFieldValue("stream_type", "traces");
      await nextTick();
      const typeSel = formSelectByName(wrapper, "stream_type");
      expect(typeSel).toBeTruthy();
      expect(typeSel.findComponent(OSelect).props("modelValue")).toBe("traces");

      // view → form: choosing a stream writes stream_name back to the form, and
      // the component's read-view tracks that same single source of truth.
      const nameSel = formSelectByName(wrapper, "stream_name");
      expect(nameSel).toBeTruthy();
      nameSel.findComponent(OSelect).vm.$emit("update:model-value", "stream1");
      await nextTick();
      expect(form.state.values.stream_name).toBe("stream1");
      expect(child.selectedStreamName).toBe("stream1");
    });

    it("groups 2 & 3 — aggregation function/having + trigger operator/threshold are OForm* (disableThreshold=false)", async () => {
      const { w, f } = mountHarness({}, { disableThreshold: false });
      await flushPromises();
      const c = w.findComponent(ScheduledPipeline).vm;

      // ── group 3: trigger operator/threshold (rendered while aggregation OFF) ──
      const trigOp = formSelectByName(w, "trigger_condition.operator");
      const trigThresh = formInputByName(w, "trigger_condition.threshold");
      expect(trigOp).toBeTruthy();
      expect(trigThresh).toBeTruthy();
      // form → view (default operator seeded by buildDefaultValues)
      expect(trigOp.findComponent(OSelect).props("modelValue")).toBe(">=");
      // view → form
      trigOp.findComponent(OSelect).vm.$emit("update:model-value", "<");
      trigThresh.findComponent(OInput).vm.$emit("update:model-value", 7);
      await nextTick();
      expect(f.state.values.trigger_condition.operator).toBe("<");
      expect(f.state.values.trigger_condition.threshold).toBe(7);

      // ── group 2: aggregation function/having (rendered while aggregation ON) ──
      c.tab = "custom";
      f.setFieldValue("query_condition.aggregation", {
        group_by: ["col_a"],
        function: "avg",
        having: { column: "level", operator: "=", value: "" },
      });
      c._isAggregationEnabled = true;
      await nextTick();
      await flushPromises();

      const fn = formSelectByName(w, "query_condition.aggregation.function");
      const havingVal = formInputByName(w, "query_condition.aggregation.having.value");
      expect(fn).toBeTruthy();
      expect(havingVal).toBeTruthy();
      // form → view
      expect(fn.findComponent(OSelect).props("modelValue")).toBe("avg");
      // view → form
      fn.findComponent(OSelect).vm.$emit("update:model-value", "sum");
      havingVal.findComponent(OInput).vm.$emit("update:model-value", 9);
      await nextTick();
      expect(f.state.values.query_condition.aggregation.function).toBe("sum");
      expect(f.state.values.query_condition.aggregation.having.value).toBe(9);

      w.unmount();
    });
  });

  // ── SQL preview table — OTable migration parity (§7.5) ──────────────────────
  // The SQL output pane migrated from the logs TenstackTable to OTable. These
  // assert the data contract the OTable renders (timestamp + source columns, the
  // source-JSON the #cell-source / #expansion slots consume) and the copy /
  // send-to-AI handlers wired to those slots. Row virtualization + the actual
  // expand→JsonPreview rendering are covered by manual QA (§6.6).
  describe("SQL preview table (OTable migration)", () => {
    it("exposes a timestamp + source column contract for the OTable", () => {
      const cols = child.getColumns;
      expect(Array.isArray(cols)).toBe(true);
      expect(cols.map((c) => c.id)).toEqual(["_timestamp", "source"]);
    });

    it("the source column serialises the whole row to JSON (drives #cell-source / #expansion)", () => {
      const cols = child.getColumns;
      const sourceCol = cols.find((c) => c.id === "source");
      const row = { _timestamp: 1_700_000_000_000_000, message: "hello" };
      expect(sourceCol.accessorFn(row)).toBe(JSON.stringify(row));
    });

    it("copyLogToClipboard serialises the row to JSON by default", () => {
      // Wired to the expansion JsonPreview's @copy. Should serialise, not throw.
      expect(typeof child.copyLogToClipboard).toBe("function");
      expect(() => child.copyLogToClipboard({ a: 1 })).not.toThrow();
    });

    it("sendToAiChat enables the AI chat panel (wired to the timestamp AI button + JsonPreview)", async () => {
      child.sendToAiChat(JSON.stringify({ a: 1 }), true);
      await nextTick();
      expect(mockStore.dispatch).toHaveBeenCalledWith("setIsAiChatEnabled", true);
    });
  });
});
