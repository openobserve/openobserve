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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import Query from "./Query.vue";
import searchService from "@/services/search";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "_timestamp", type: "datetime" },
        { name: "message", type: "string" },
        { name: "level", type: "string" },
        { name: "source", type: "string" },
      ],
    }),
    getStreams: vi.fn(),
  }),
}));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: {
        sql: "SELECT * FROM logs",
        start_time: 1_000_000_000,
        end_time: 2_000_000_000,
      },
      aggs: {},
    }),
  }),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getTimezoneOffset: vi.fn(() => -300),
    getUUID: vi.fn(() => "mock-uuid"),
  };
});

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let mockPipelineObj: any = {};

function makePipelineObj(overrides: any = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeData: null,
    currentSelectedNodeID: "query-node-1",
    userClickedNode: {},
    userSelectedNode: {},
    ...overrides,
  };
}

// ScheduledPipeline is stubbed for these owner-level tests — Query OWNS the real
// <OForm>, so the schema still runs on the form's values. The stub no longer
// needs a validateInputs() method (the gate moved into the schema).
function createWrapper(props: any = {}, pipelineObjOverrides: any = {}) {
  mockPipelineObj = makePipelineObj(pipelineObjOverrides);

  vi.mocked(useDnD).mockImplementation(() => ({
    pipelineObj: mockPipelineObj,
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
  }));

  return mount(Query, {
    global: {
      plugins: [i18n, store],
      stubs: {
        ScheduledPipeline: {
          name: "ScheduledPipeline",
          template: '<div class="scheduled-pipeline-stub"></div>',
          props: [
            "columns",
            "conditions",
            "alertData",
            "disableThreshold",
            "disableVrlFunction",
            "isValidSqlQuery",
            "disableQueryTypeSelection",
            "expandedLogs",
            "validatingSqlQuery",
          ],
          emits: [
            "validate-sql",
            "submit:form",
            "cancel:form",
            "delete:node",
            "update:fullscreen",
            "update:stream_type",
            "expandLog",
            "update:delay",
          ],
        },
        ConfirmDialog: true,
      },
    },
    props: {
      streamName: "test-stream",
      streamType: "logs",
      streamRoutes: {},
      editingRoute: null,
      ...props,
    },
  });
}

// Drive submit through the OWNED form (the schema gates the save). Mirrors the
// Condition.spec real-OForm pattern.
async function submit(wrapper: any) {
  await wrapper.vm.form.handleSubmit();
  await flushPromises();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Query Component", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("Component Initialization", () => {
    it("mounts successfully", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes streamRoute with default values", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const r = wrapper.vm.streamRoute;
      expect(r.stream_type).toBe("logs");
      expect(r.query_condition.type).toBe("sql");
      expect(r.enabled).toBe(true);
      expect(r.delay).toBe(0);
      expect(r.description).toBe("");
    });

    it("initializes trigger condition defaults", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const t = wrapper.vm.streamRoute.trigger_condition;
      expect(t.period).toBe(15);
      expect(t.frequency_type).toBe("minutes");
      expect(t.timezone).toBe("UTC");
      expect(t.cron).toBe("");
    });

    it("initializes conditions with a single blank entry", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.streamRoute.conditions).toHaveLength(1);
      expect(wrapper.vm.streamRoute.conditions[0]).toEqual({
        column: "",
        operator: "",
        value: "",
        id: "mock-uuid",
      });
    });

    it("initializes context_attributes with a single blank entry", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(1);
      expect(wrapper.vm.streamRoute.context_attributes[0]).toMatchObject({
        key: "",
        value: "",
        id: "mock-uuid",
      });
    });

    it("initializes isValidSqlQuery as true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
    });

    it("initializes validatingSqlQuery as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
    });

    it("initializes isAggregationEnabled as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isAggregationEnabled).toBe(false);
    });

    it("initializes isFullscreenMode as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isFullscreenMode).toBe(false);
    });

    it("exposes streamTypes array", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.streamTypes).toEqual(["logs", "metrics", "traces"]);
    });

    it("initializes expandedLogs as empty array", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(Array.isArray(wrapper.vm.expandedLogs)).toBe(true);
      expect(wrapper.vm.expandedLogs).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("Edit Mode", () => {
    it("loads existing node data when isEditNode is true", async () => {
      const nodeData = {
        name: "existing-query",
        stream_type: "metrics",
        query_condition: {
          type: "sql",
          sql: "SELECT * FROM m",
          aggregation: null,
          promql_condition: null,
        },
        trigger_condition: {
          period: 30,
          frequency_type: "minutes",
          cron: "",
          frequency: 30,
          timezone: "UTC",
        },
        delay: 5,
        conditions: [],
        context_attributes: [],
        description: "test desc",
        enabled: false,
      };
      const wrapper = createWrapper(
        {},
        {
          isEditNode: true,
          currentSelectedNodeData: { data: nodeData },
        },
      );
      await flushPromises();
      expect(wrapper.vm.streamRoute.stream_type).toBe("metrics");
      expect(wrapper.vm.streamRoute.delay).toBe(5);
      expect(wrapper.vm.streamRoute.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("Props Handling", () => {
    it("accepts streamType prop", async () => {
      const wrapper = createWrapper({ streamType: "traces" });
      await flushPromises();
      expect(wrapper.props("streamType")).toBe("traces");
    });

    it("accepts streamRoutes prop", async () => {
      const wrapper = createWrapper({ streamRoutes: { route1: {} } });
      await flushPromises();
      expect(wrapper.props("streamRoutes")).toMatchObject({ route1: {} });
    });

    it("accepts null editingRoute", async () => {
      const wrapper = createWrapper({ editingRoute: null });
      await flushPromises();
      expect(wrapper.props("editingRoute")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("Stream Type Management", () => {
    it("updateStreamType updates stream_type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateStreamType("metrics");
      await nextTick();
      expect(wrapper.vm.streamRoute.stream_type).toBe("metrics");
    });

    it("updateStreamType handles traces", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateStreamType("traces");
      await nextTick();
      expect(wrapper.vm.streamRoute.stream_type).toBe("traces");
    });

    it("updateStreamType handles empty string", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateStreamType("");
      await nextTick();
      expect(wrapper.vm.streamRoute.stream_type).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  describe("Query Type Management", () => {
    it("updateQueryType sets type to promql and clears sql", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.sql", "SELECT 1");
      wrapper.vm.updateQueryType("promql");
      await nextTick();
      expect(wrapper.vm.streamRoute.query_condition.type).toBe("promql");
      expect(wrapper.vm.streamRoute.query_condition.sql).toBe("");
    });

    it("updateQueryType sets type to sql without clearing sql", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.sql", "SELECT 1");
      wrapper.vm.updateQueryType("sql");
      await nextTick();
      expect(wrapper.vm.streamRoute.query_condition.type).toBe("sql");
      expect(wrapper.vm.streamRoute.query_condition.sql).toBe("SELECT 1");
    });
  });

  // -------------------------------------------------------------------------
  // isValidStreamName remains an exposed computed (never an actual submit gate,
  // and not a schema field — the live drawer doesn't edit streamRoute.name).
  describe("Stream Name Validation (isValidStreamName)", () => {
    const cases = [
      { name: "valid123", expected: true },
      { name: "valid_name", expected: true },
      { name: "valid-name", expected: true },
      { name: "valid.name", expected: true },
      { name: "valid@name", expected: true },
      { name: "valid+name", expected: true },
      { name: "valid=name", expected: true },
      { name: "valid,name", expected: true },
      { name: "invalid!name", expected: false },
      { name: "invalid#name", expected: false },
      { name: "invalid$name", expected: false },
      { name: "", expected: false },
    ];
    cases.forEach(({ name, expected }) => {
      it(`isValidStreamName for "${name}" is ${expected}`, async () => {
        const wrapper = createWrapper();
        await flushPromises();
        wrapper.vm.form.setFieldValue("name", name);
        await nextTick();
        expect(wrapper.vm.isValidStreamName).toBe(expected);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("Delay Management", () => {
    it("updateDelay converts string to integer", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateDelay("30");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBe(30);
    });

    it("updateDelay truncates float strings", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateDelay("15.9");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBe(15);
    });

    it("updateDelay handles zero", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateDelay("0");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBe(0);
    });

    it("updateDelay handles negative value", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateDelay("-5");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBe(-5);
    });

    it("updateDelay with non-numeric string results in NaN", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateDelay("abc");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBeNaN();
    });
  });

  // -------------------------------------------------------------------------
  describe("Fullscreen Mode", () => {
    it("updateFullscreenMode sets isFullscreenMode to true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateFullscreenMode(true);
      expect(wrapper.vm.isFullscreenMode).toBe(true);
    });

    it("updateFullscreenMode sets isFullscreenMode to false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.updateFullscreenMode(true);
      wrapper.vm.updateFullscreenMode(false);
      expect(wrapper.vm.isFullscreenMode).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("Expanded Logs", () => {
    it("toggleExpandLog resets expandedLogs to []", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.expandedLogs = [0, 1, 2];
      wrapper.vm.toggleExpandLog(1);
      expect(wrapper.vm.expandedLogs).toEqual([]);
    });

    it("toggleExpandLog clears logs regardless of index value", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.expandedLogs = [5, 10];
      wrapper.vm.toggleExpandLog(99);
      expect(wrapper.vm.expandedLogs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("Variables (context_attributes)", () => {
    it("addVariable appends a new blank entry", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const initial = wrapper.vm.streamRoute.context_attributes.length;
      wrapper.vm.addVariable();
      await nextTick();
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(initial + 1);
    });

    it("removeVariable removes entry by id", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("context_attributes", [
        { key: "k1", value: "v1", id: "id1" },
        { key: "k2", value: "v2", id: "id2" },
      ]);
      await nextTick();
      wrapper.vm.removeVariable({ id: "id1" });
      await nextTick();
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(1);
      expect(wrapper.vm.streamRoute.context_attributes[0].id).toBe("id2");
    });

    it("removeVariable with unknown id leaves array unchanged", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("context_attributes", [{ key: "k", value: "v", id: "id1" }]);
      await nextTick();
      wrapper.vm.removeVariable({ id: "does-not-exist" });
      await nextTick();
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("getDefaultPromqlCondition", () => {
    it("returns the correct default promql condition object", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.getDefaultPromqlCondition()).toEqual({
        column: "value",
        operator: ">=",
        value: 0,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("SQL Query Validation", () => {
    it("sets validatingSqlQuery to true immediately on validation start", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      wrapper.vm.validateSqlQuery(); // don't await
      expect(wrapper.vm.validatingSqlQuery).toBe(true);
    });

    it("resolves isValidSqlQuery to true on success", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
    });

    it("sets isValidSqlQuery to false on search error with message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      vi.mocked(toast).mockClear();
      const errMsg = "Syntax error near SELECT";
      (searchService.search as any).mockRejectedValueOnce({
        response: { data: { message: errMsg } },
      });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Invalid SQL Query: ${errMsg}`,
        }),
      );
    });

    it("sets isValidSqlQuery to false when error has no message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      vi.mocked(toast).mockClear();
      (searchService.search as any).mockRejectedValueOnce({
        response: { data: {} },
      });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid SQL Query" }));
    });

    it("skips search call entirely for promql query type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.type", "promql");
      await wrapper.vm.validateSqlQuery();
      expect(searchService.search).not.toHaveBeenCalled();
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
    });

    it("uses stream_type as page_type in the search call", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      wrapper.vm.form.setFieldValue("stream_type", "metrics");
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ page_type: "metrics" }),
      );
    });

    it("does not use hardcoded 'logs' when stream_type is traces", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      wrapper.vm.form.setFieldValue("stream_type", "traces");
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalledWith(
        expect.objectContaining({ page_type: "logs" }),
      );
    });

    it("passes validate:true in the search call", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ validate: true }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("normalizeLimit utility", () => {
    it("caps LIMIT values above maxLimit to maxLimit", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const result = wrapper.vm.normalizeLimit("SELECT * FROM t LIMIT 500", 100);
      expect(result).toBe("SELECT * FROM t LIMIT 100");
    });

    it("leaves LIMIT values at or below maxLimit unchanged", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const result = wrapper.vm.normalizeLimit("SELECT * FROM t LIMIT 50", 100);
      expect(result).toBe("SELECT * FROM t LIMIT 50");
    });

    it("leaves queries without LIMIT unchanged", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const sql = "SELECT * FROM t WHERE level = 'error'";
      expect(wrapper.vm.normalizeLimit(sql, 100)).toBe(sql);
    });

    it("handles LIMIT with OFFSET", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const result = wrapper.vm.normalizeLimit("SELECT * FROM t LIMIT 200 OFFSET 10", 100);
      expect(result).toBe("SELECT * FROM t LIMIT 100 OFFSET 10");
    });

    it("handles multiple LIMIT clauses in subqueries", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const sql = "SELECT * FROM (SELECT * FROM t LIMIT 300) AS sub LIMIT 200";
      const result = wrapper.vm.normalizeLimit(sql, 100);
      expect(result).not.toContain("LIMIT 300");
      expect(result).not.toContain("LIMIT 200");
    });

    it("handles empty sql gracefully", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.normalizeLimit("", 100)).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  describe("Dialog Management", () => {
    it("openCancelDialog shows dialog when streamRoute was changed", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("name", "changed-name");
      await nextTick();
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel routing changes?");
    });

    it("openCancelDialog directly closes when no changes were made", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(false);
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("openCancelDialog ok restores original route and closes", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const originalName = wrapper.vm.streamRoute.name;
      wrapper.vm.form.setFieldValue("name", "changed");
      await nextTick();
      wrapper.vm.openCancelDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.vm.streamRoute.name).toBe(originalName);
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("openDeleteDialog shows correct title and message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to delete stream routing?");
    });

    it("openDeleteDialog ok callback deletes node and emits cancel:hideform", async () => {
      const wrapper = createWrapper({}, { currentSelectedNodeID: "node-1" });
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-1");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("closeDialog emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.closeDialog();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Submission is now schema-gated through the OWNED form (validateInputs() gone).
  describe("saveQueryData (schema-gated submit)", () => {
    it("blocks submit and does NOT call addNode when period < 1 (schema invalid)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("trigger_condition.period", 0);
      await nextTick();
      await submit(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("blocks submit when an empty cron is set with frequency_type=cron", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("trigger_condition.frequency_type", "cron");
      wrapper.vm.form.setFieldValue("trigger_condition.cron", "");
      await nextTick();
      await submit(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("blocks submit when an aggregation group_by row is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.aggregation", {
        group_by: ["col_a", ""],
        function: "count",
        having: { column: "", operator: "=", value: "" },
      });
      await nextTick();
      await submit(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("calls addNode and emits cancel:hideform on a valid submit (sql)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await submit(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(mockAddNode).toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("addNode payload has node_type 'query'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      await submit(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith(expect.objectContaining({ node_type: "query" }));
    });

    it("converts period string to integer in payload", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("trigger_condition.period", "30");
      await submit(wrapper);
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.trigger_condition.period).toBe(30);
    });

    it("converts delay string to integer in payload", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      // OFormInput (type="number") writes a string; the payload must send i32.
      wrapper.vm.form.setFieldValue("delay", "-1");
      await submit(wrapper);
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.delay).toBe(-1);
      expect(typeof payload.delay).toBe("number");
    });

    it("sets promql_condition for promql query type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.type", "promql");
      await submit(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          query_condition: expect.objectContaining({
            sql: "",
            promql_condition: { column: "value", operator: ">=", value: 0 },
          }),
        }),
      );
    });

    it("includes tz_offset for cron frequency type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      // a 30-minute cron interval comfortably exceeds the 900s min, so the
      // frequency/cron superRefine passes.
      wrapper.vm.form.setFieldValue("trigger_condition.frequency_type", "cron");
      wrapper.vm.form.setFieldValue("trigger_condition.cron", "0 */30 * * * *");
      wrapper.vm.form.setFieldValue("trigger_condition.timezone", "America/New_York");
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await submit(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(mockAddNode).toHaveBeenCalledWith(expect.objectContaining({ tz_offset: -300 }));
    });

    it("does NOT include tz_offset for minutes frequency type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("trigger_condition.frequency_type", "minutes");
      await submit(wrapper);
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.tz_offset).toBeUndefined();
    });

    it("does NOT call addNode when SQL validation fails (pre-submit guard)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockRejectedValueOnce({
        response: { data: { message: "bad sql" } },
      });
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await submit(wrapper);
      expect(mockAddNode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("deleteRoute", () => {
    it("calls deletePipelineNode with the current node ID", async () => {
      const wrapper = createWrapper({}, { currentSelectedNodeID: "node-delete" });
      await flushPromises();
      wrapper.vm.deleteRoute();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-delete");
    });

    it("emits cancel:hideform after deleting", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.deleteRoute();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("getDefaultStreamRoute", () => {
    it("returns edit node data when isEditNode is true", async () => {
      const editData = {
        name: "edit-q",
        stream_type: "metrics",
        query_condition: { type: "sql", sql: "", aggregation: null, promql_condition: null },
        trigger_condition: {
          period: 5,
          frequency_type: "cron",
          cron: "* * * * *",
          frequency: 5,
          timezone: "UTC",
        },
        delay: 2,
        conditions: [],
        context_attributes: [],
        description: "",
        enabled: true,
      };
      const wrapper = createWrapper(
        {},
        {
          isEditNode: true,
          currentSelectedNodeData: { data: editData },
        },
      );
      await flushPromises();
      const result = wrapper.vm.getDefaultStreamRoute();
      expect(result.name).toBe("edit-q");
      expect(result.stream_type).toBe("metrics");
    });

    it("returns default structure when isEditNode is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const result = wrapper.vm.getDefaultStreamRoute();
      expect(result.name).toBe("");
      expect(result.stream_type).toBe("logs");
      expect(result.enabled).toBe(true);
      expect(result.description).toBe("");
      expect(result.delay).toBe(0);
      expect(result.conditions).toHaveLength(1);
      expect(result.query_condition.type).toBe("sql");
      expect(result.trigger_condition.timezone).toBe("UTC");
    });

    it("uses zoConfig.min_auto_refresh_interval for frequency if set", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const result = wrapper.vm.getDefaultStreamRoute();
      // frequency defaults to 15 if zoConfig is absent; with 1800 it becomes 30
      expect([15, 30]).toContain(result.trigger_condition.frequency);
    });
  });

  // -------------------------------------------------------------------------
  describe("updateStreamFields", () => {
    it("populates filteredColumns from schema", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.updateStreamFields();
      expect(wrapper.vm.filteredColumns).toHaveLength(4);
      expect(wrapper.vm.filteredColumns[0]).toMatchObject({
        label: "_timestamp",
        value: "_timestamp",
        type: "datetime",
      });
    });

    it("populates originalStreamFields from schema", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.updateStreamFields();
      expect(wrapper.vm.originalStreamFields).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  describe("Integration – full workflow", () => {
    it("completes create > validate > save cycle", async () => {
      vi.clearAllMocks();
      const wrapper = createWrapper();
      await flushPromises();
      (searchService.search as any).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.form.setFieldValue("name", "integration-test");
      wrapper.vm.form.setFieldValue(
        "query_condition.sql",
        "SELECT * FROM logs WHERE level='error'",
      );
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      await submit(wrapper);
      expect(mockAddNode).toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("completes delete workflow via dialog", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(mockDeletePipelineNode).toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("completes cancel workflow via dialog with changes", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.form.setFieldValue("name", "dirty-state");
      await nextTick();
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });
});
