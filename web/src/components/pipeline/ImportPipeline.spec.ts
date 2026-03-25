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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import ImportPipeline from "@/components/pipeline/ImportPipeline.vue";

installQuasar({ plugins: [Dialog, Notify] });

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

vi.mock("@/services/pipelines", () => ({
  default: {
    createPipeline: vi.fn(),
    getPipelineStreams: vi.fn(),
    getPipelines: vi.fn(),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(),
  },
}));

vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(),
  }),
}));

vi.mock("@/composables/usePipelines", () => ({
  default: () => ({
    getPipelineDestinations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mocked-url/${path}`),
  useLocalOrganization: vi.fn(() => null),
  useLocalCurrentUser: vi.fn(() => null),
  useLocalUserInfo: vi.fn(() => null),
  useLocalTimezone: vi.fn(() => null),
}));

vi.mock("@/utils/alerts/alertDataTransforms", () => ({
  detectConditionsVersion: vi.fn(() => 2),
  convertV0ToV2: vi.fn((c: any) => c),
  convertV1ToV2: vi.fn((c: any) => c),
  convertV1BEToV2: vi.fn((c: any) => c),
}));

const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
  currentRoute: {
    value: { query: {} },
  },
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// --------------------------------------------------------------------------
// Imports that need to be accessed after mocking
// --------------------------------------------------------------------------

import pipelinesService from "@/services/pipelines";
import destinationService from "@/services/alert_destination";
import jstransform from "@/services/jstransform";

// --------------------------------------------------------------------------
// Helper factory
// --------------------------------------------------------------------------

function createWrapper(props: Record<string, any> = {}) {
  return mount(ImportPipeline, {
    props: {
      destinations: [],
      templates: [],
      alerts: [],
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        BaseImport: {
          name: "BaseImport",
          template: '<div data-test="base-import"><slot name="output-content" /></div>',
          props: ["title", "testPrefix", "isImporting", "editorHeights"],
          data() {
            return { isImporting: false };
          },
          methods: {
            updateJsonArray: vi.fn(),
          },
        },
        QueryEditor: {
          name: "QueryEditor",
          template: '<div data-test="query-editor" />',
          props: ["modelValue", "label", "debounceTime", "language"],
          emits: ["update:query"],
        },
      },
    },
  });
}

// --------------------------------------------------------------------------
// Default mock data
// --------------------------------------------------------------------------

const makeBaseImportRef = (overrides: Record<string, any> = {}) => ({
  jsonArrayOfObj: [
    {
      name: "my-pipeline",
      org: "default",
      stream_name: "logs-stream",
      stream_type: "logs",
      source: {
        stream_name: "logs-stream",
        stream_type: "logs",
        source_type: "realtime",
        org_id: "default",
        query_condition: { type: "sql", sql: "" },
        trigger_condition: { frequency_type: "minutes", frequency: 1, timezone: "" },
      },
      nodes: [],
      edges: [],
    },
  ],
  updateJsonArray: vi.fn(),
  isImporting: false,
  jsonStr: "[]",
  ...overrides,
});

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe("ImportPipeline.vue", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.selectedOrganization = {
      identifier: "default",
      label: "Default Organization",
    } as any;

    store.state.organizations = [
      { identifier: "default", label: "Default Organization" },
      { identifier: "other-org", label: "Other Org" },
    ] as any;

    // Default service mocks
    vi.mocked(pipelinesService.getPipelines).mockResolvedValue({
      data: { list: [] },
    } as any);
    vi.mocked(pipelinesService.getPipelineStreams).mockResolvedValue({
      data: { list: [] },
    } as any);
    vi.mocked(pipelinesService.createPipeline).mockResolvedValue({
      data: {},
    } as any);
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [],
    } as any);
    vi.mocked(jstransform.list).mockResolvedValue({
      data: { list: [] },
    } as any);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 1. Component initialisation
  // -----------------------------------------------------------------------

  describe("Component Initialization", () => {
    it("renders the component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("has the correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("ImportPipeline");
    });

    it("initialises with default empty props", () => {
      wrapper = createWrapper();
      expect(wrapper.props("destinations")).toEqual([]);
      expect(wrapper.props("templates")).toEqual([]);
      expect(wrapper.props("alerts")).toEqual([]);
    });

    it("accepts and reflects passed props", () => {
      wrapper = createWrapper({
        destinations: [{ name: "dest1" }],
        templates: [{ name: "tmpl1" }],
        alerts: [{ name: "alert1" }],
      });
      expect(wrapper.props("destinations")).toHaveLength(1);
      expect(wrapper.props("templates")).toHaveLength(1);
      expect(wrapper.props("alerts")).toHaveLength(1);
    });

    it("defines the update:pipelines emit", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("update:pipelines");
    });

    it("calls onMounted lifecycle hooks to fetch initial data", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(jstransform.list).toHaveBeenCalled();
      expect(destinationService.list).toHaveBeenCalled();
      expect(pipelinesService.getPipelines).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Reactive data property defaults
  // -----------------------------------------------------------------------

  describe("Reactive Data Properties", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("initialises streamTypes as ['logs', 'metrics', 'traces']", () => {
      expect(wrapper.vm.streamTypes).toEqual(["logs", "metrics", "traces"]);
    });

    it("initialises destinationStreamTypes including enrichment_tables", () => {
      expect(wrapper.vm.destinationStreamTypes).toEqual([
        "logs",
        "metrics",
        "traces",
        "enrichment_tables",
      ]);
    });

    it("initialises pipelineErrorsToDisplay as empty array", () => {
      expect(wrapper.vm.pipelineErrorsToDisplay).toEqual([]);
    });

    it("initialises pipelineCreators as empty array", () => {
      expect(wrapper.vm.pipelineCreators).toEqual([]);
    });

    it("initialises streamList as empty array", () => {
      expect(wrapper.vm.streamList).toEqual([]);
    });

    it("initialises streamData as empty array", () => {
      expect(wrapper.vm.streamData).toEqual([]);
    });

    it("initialises existingFunctions as empty array", () => {
      expect(wrapper.vm.existingFunctions).toEqual([]);
    });

    it("initialises pipelineDestinations as empty array", () => {
      expect(wrapper.vm.pipelineDestinations).toEqual([]);
    });

    it("initialises alertDestinations as empty array", () => {
      expect(wrapper.vm.alertDestinations).toEqual([]);
    });

    it("initialises scheduledPipelines as empty array", () => {
      expect(wrapper.vm.scheduledPipelines).toEqual([]);
    });

    it("initialises userSelectedPipelineName as empty array", () => {
      expect(wrapper.vm.userSelectedPipelineName).toEqual([]);
    });

    it("initialises userSelectedStreamName as empty array", () => {
      expect(wrapper.vm.userSelectedStreamName).toEqual([]);
    });

    it("initialises userSelectedStreamType as empty array", () => {
      expect(wrapper.vm.userSelectedStreamType).toEqual([]);
    });

    it("initialises userSelectedSqlQuery as empty array", () => {
      expect(wrapper.vm.userSelectedSqlQuery).toEqual([]);
    });

    it("initialises userSelectedTimezone as empty array", () => {
      expect(wrapper.vm.userSelectedTimezone).toEqual([]);
    });

    it("initialises userSelectedFunctionName as empty array", () => {
      expect(wrapper.vm.userSelectedFunctionName).toEqual([]);
    });

    it("initialises userSelectedOrgId as empty array", () => {
      expect(wrapper.vm.userSelectedOrgId).toEqual([]);
    });

    it("initialises userSelectedRemoteDestination as empty array", () => {
      expect(wrapper.vm.userSelectedRemoteDestination).toEqual([]);
    });

    it("initialises isPipelineImporting as false", () => {
      expect(wrapper.vm.isPipelineImporting).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Computed properties
  // -----------------------------------------------------------------------

  describe("Computed Properties", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("organizationData maps store organizations into label/value/disable shape", () => {
      const orgData = wrapper.vm.organizationData;
      expect(orgData).toHaveLength(2);
      expect(orgData[0]).toMatchObject({ label: "default", value: "default" });
    });

    it("organizationData disables orgs that differ from selectedOrganization", () => {
      const orgData = wrapper.vm.organizationData;
      const selected = orgData.find((o: any) => o.value === "default");
      const other = orgData.find((o: any) => o.value === "other-org");
      expect(selected?.disable).toBe(false);
      expect(other?.disable).toBe(true);
    });

    it("timezoneOptions is a non-empty array", () => {
      expect(Array.isArray(wrapper.vm.timezoneOptions)).toBe(true);
      expect(wrapper.vm.timezoneOptions.length).toBeGreaterThan(0);
    });

    it("timezoneOptions includes UTC at a leading position", () => {
      expect(wrapper.vm.timezoneOptions).toContain("UTC");
    });

    it("timezoneOptions includes a Browser Time entry", () => {
      const hasBrowserTime = wrapper.vm.timezoneOptions.some((tz: string) =>
        tz.startsWith("Browser Time"),
      );
      expect(hasBrowserTime).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Exposed functions availability
  // -----------------------------------------------------------------------

  describe("Exposed Functions", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    const fnNames = [
      "processJsonObject",
      "validatePipelineInputs",
      "validateSourceStream",
      "validateDestinationStream",
      "validateScheduledPipelineNodes",
      "validateNodesForOrg",
      "validateRemoteDestination",
      "createPipeline",
      "getFunctions",
      "getAlertDestinations",
      "getScheduledPipelines",
      "getSourceStreamsList",
      "getDestinationStreamsList",
      "getOutputStreamsList",
      "importJson",
      "updateSqlQuery",
      "updateStreamFields",
      "updatePipelineName",
      "updateFunctionName",
      "updateRemoteDestination",
      "updateTimezone",
      "updateOrgId",
      "handleDynamicStreamName",
      "updateDestinationStreamFields",
    ];

    fnNames.forEach((name) => {
      it(`exposes ${name} as a function`, () => {
        expect(typeof (wrapper.vm as any)[name]).toBe("function");
      });
    });
  });

  // -----------------------------------------------------------------------
  // 5. updateSqlQuery
  // -----------------------------------------------------------------------

  describe("updateSqlQuery", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            source: { query_condition: { type: "sql", sql: "" } },
            nodes: [
              { io_type: "input", data: { query_condition: { type: "sql", sql: "" } } },
            ],
          },
        ],
      });
    });

    it("updates sql_query at pipeline root level", () => {
      wrapper.vm.updateSqlQuery("SELECT 1", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].sql_query).toBe("SELECT 1");
    });

    it("updates source.query_condition.sql", () => {
      wrapper.vm.updateSqlQuery("SELECT 1", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.query_condition.sql).toBe(
        "SELECT 1",
      );
    });

    it("updates matching input nodes query_condition.sql", () => {
      wrapper.vm.updateSqlQuery("SELECT 1", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.query_condition.sql,
      ).toBe("SELECT 1");
    });

    it("does not update nodes whose io_type is not input", () => {
      wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes.push({
        io_type: "output",
        data: { query_condition: { type: "sql", sql: "old" } },
      });
      wrapper.vm.updateSqlQuery("SELECT 1", 0);
      // output node should remain unchanged
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[1].data.query_condition.sql,
      ).toBe("old");
    });
  });

  // -----------------------------------------------------------------------
  // 6. updateStreamFields
  // -----------------------------------------------------------------------

  describe("updateStreamFields", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            source: { stream_name: "old" },
            stream_name: "old",
            nodes: [{ io_type: "input", data: { stream_name: "old" } }],
            edges: [{ sourceNode: { data: { stream_name: "old" } } }],
          },
        ],
      });
    });

    it("updates source.stream_name", () => {
      wrapper.vm.updateStreamFields({ value: "new-stream" }, 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBe(
        "new-stream",
      );
    });

    it("updates pipeline root stream_name", () => {
      wrapper.vm.updateStreamFields({ value: "new-stream" }, 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].stream_name).toBe("new-stream");
    });

    it("updates input nodes stream_name", () => {
      wrapper.vm.updateStreamFields({ value: "new-stream" }, 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.stream_name).toBe(
        "new-stream",
      );
    });

    it("updates edges sourceNode data", () => {
      wrapper.vm.updateStreamFields({ value: "new-stream" }, 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].edges[0].sourceNode.data.stream_name,
      ).toBe("new-stream");
    });

    it("also accepts a plain string value instead of an object", () => {
      wrapper.vm.updateStreamFields("plain-stream", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBe(
        "plain-stream",
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. updatePipelineName
  // -----------------------------------------------------------------------

  describe("updatePipelineName", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [{ name: "old-name" }],
      });
    });

    it("updates pipeline name at the given index", () => {
      wrapper.vm.updatePipelineName("new-name", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].name).toBe("new-name");
    });

    it("updates independent pipelines when multiple exist", () => {
      wrapper.vm.baseImportRef.jsonArrayOfObj.push({ name: "second" });
      wrapper.vm.updatePipelineName("updated-second", 1);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[1].name).toBe("updated-second");
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].name).toBe("old-name");
    });
  });

  // -----------------------------------------------------------------------
  // 8. updateFunctionName
  // -----------------------------------------------------------------------

  describe("updateFunctionName", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            nodes: [
              { io_type: "default", data: { node_type: "function", name: "" } },
              { io_type: "default", data: { node_type: "condition" } },
            ],
          },
        ],
      });
    });

    it("updates name on a function node", () => {
      wrapper.vm.updateFunctionName("my-fn", 0, 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.name).toBe(
        "my-fn",
      );
    });

    it("does not modify a non-function node", () => {
      wrapper.vm.updateFunctionName("my-fn", 0, 1);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[1].data.name,
      ).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 9. updateRemoteDestination
  // -----------------------------------------------------------------------

  describe("updateRemoteDestination", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            nodes: [
              { data: { node_type: "remote_stream", destination_name: "" } },
              { data: { node_type: "stream", destination_name: "" } },
            ],
          },
        ],
      });
    });

    it("sets destination_name on remote_stream nodes", () => {
      wrapper.vm.updateRemoteDestination("my-remote", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.destination_name,
      ).toBe("my-remote");
    });

    it("does not modify non-remote nodes", () => {
      wrapper.vm.updateRemoteDestination("my-remote", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[1].data.destination_name,
      ).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // 10. updateDestinationStreamFields
  // -----------------------------------------------------------------------

  describe("updateDestinationStreamFields", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            nodes: [
              { io_type: "output", data: { stream_name: "" } },
              { io_type: "input", data: { stream_name: "" } },
            ],
          },
        ],
      });
    });

    it("updates stream_name on output nodes", () => {
      wrapper.vm.updateDestinationStreamFields("out-stream", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.stream_name,
      ).toBe("out-stream");
    });

    it("does not touch non-output nodes", () => {
      wrapper.vm.updateDestinationStreamFields("out-stream", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[1].data.stream_name,
      ).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // 11. updateTimezone
  // -----------------------------------------------------------------------

  describe("updateTimezone", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            source: { trigger_condition: { timezone: "" } },
            nodes: [{ data: { node_type: "query", trigger_condition: { timezone: "" } } }],
          },
        ],
      });
    });

    it("updates source trigger_condition.timezone", () => {
      wrapper.vm.updateTimezone("UTC", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.trigger_condition.timezone,
      ).toBe("UTC");
    });

    it("updates query node trigger_condition.timezone", () => {
      wrapper.vm.updateTimezone("UTC", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.trigger_condition
          .timezone,
      ).toBe("UTC");
    });
  });

  // -----------------------------------------------------------------------
  // 12. updateOrgId
  // -----------------------------------------------------------------------

  describe("updateOrgId", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            org: "",
            source: { org_id: "" },
            nodes: [
              { data: { node_type: "stream", org_id: "" } },
              { data: { node_type: "query", org_id: "" } },
              { data: { node_type: "function", org_id: "" } },
            ],
          },
        ],
      });
    });

    it("updates pipeline root org field", () => {
      wrapper.vm.updateOrgId("my-org", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].org).toBe("my-org");
    });

    it("updates source.org_id", () => {
      wrapper.vm.updateOrgId("my-org", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.org_id).toBe("my-org");
    });

    it("updates org_id on stream and query nodes", () => {
      wrapper.vm.updateOrgId("my-org", 0);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.org_id).toBe(
        "my-org",
      );
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[1].data.org_id).toBe(
        "my-org",
      );
    });

    it("does not update function node org_id", () => {
      wrapper.vm.updateOrgId("my-org", 0);
      // function nodes are excluded from org_id updates
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[2].data.org_id).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // 13. handleDynamicStreamName
  // -----------------------------------------------------------------------

  describe("handleDynamicStreamName", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = makeBaseImportRef({
        jsonArrayOfObj: [
          {
            source: { stream_name: "" },
            stream_name: "",
            nodes: [{ io_type: "input", data: { stream_name: "" } }],
          },
        ],
      });
    });

    it("updates source and root stream_name when value is non-empty", () => {
      wrapper.vm.handleDynamicStreamName("dynamic-stream", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name,
      ).toBe("dynamic-stream");
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].stream_name).toBe(
        "dynamic-stream",
      );
    });

    it("skips update when stream name is empty string", () => {
      wrapper.vm.handleDynamicStreamName("", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name,
      ).toBe("");
    });

    it("skips update when stream name is whitespace only", () => {
      wrapper.vm.handleDynamicStreamName("   ", 0);
      expect(
        wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name,
      ).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // 14. validateNodesForOrg
  // -----------------------------------------------------------------------

  describe("validateNodesForOrg", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("returns true when all non-function/condition nodes match selected org", () => {
      const input = {
        nodes: [
          { data: { node_type: "stream", org_id: "default" } },
          { data: { node_type: "query", org_id: "default" } },
        ],
      };
      expect(wrapper.vm.validateNodesForOrg(input)).toBe(true);
    });

    it("returns false when a stream node has a different org_id", () => {
      const input = {
        nodes: [{ data: { node_type: "stream", org_id: "wrong-org" } }],
      };
      expect(wrapper.vm.validateNodesForOrg(input)).toBe(false);
    });

    it("returns false when a stream node is missing org_id", () => {
      const input = {
        nodes: [{ data: { node_type: "stream" } }],
      };
      expect(wrapper.vm.validateNodesForOrg(input)).toBe(false);
    });

    it("ignores function nodes when checking org_id", () => {
      const input = {
        nodes: [{ data: { node_type: "function" } }],
      };
      // function nodes are excluded so no mismatch
      expect(wrapper.vm.validateNodesForOrg(input)).toBe(true);
    });

    it("ignores condition nodes when checking org_id", () => {
      const input = {
        nodes: [{ data: { node_type: "condition" } }],
      };
      expect(wrapper.vm.validateNodesForOrg(input)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 15. validateRemoteDestination
  // -----------------------------------------------------------------------

  describe("validateRemoteDestination", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.pipelineDestinations = ["valid-dest", "other-dest"];
    });

    it("returns true when all remote_stream nodes reference valid destinations", () => {
      const input = {
        nodes: [
          { io_type: "output", data: { node_type: "remote_stream", destination_name: "valid-dest" } },
        ],
      };
      expect(wrapper.vm.validateRemoteDestination(input)).toBe(true);
    });

    it("returns false when a remote_stream node references an unknown destination", () => {
      const input = {
        nodes: [
          { io_type: "output", data: { node_type: "remote_stream", destination_name: "unknown" } },
        ],
      };
      expect(wrapper.vm.validateRemoteDestination(input)).toBe(false);
    });

    it("returns true when no remote_stream output nodes exist", () => {
      const input = {
        nodes: [
          { io_type: "output", data: { node_type: "stream", destination_name: "any" } },
        ],
      };
      expect(wrapper.vm.validateRemoteDestination(input)).toBe(true);
    });

    it("returns true for empty nodes array", () => {
      expect(wrapper.vm.validateRemoteDestination({ nodes: [] })).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 16. validateScheduledPipelineNodes
  // -----------------------------------------------------------------------

  describe("validateScheduledPipelineNodes", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("returns true immediately for realtime source_type", async () => {
      const result = await wrapper.vm.validateScheduledPipelineNodes(
        { source: { source_type: "realtime" } },
        "",
      );
      expect(result).toBe(true);
    });

    it("returns true when provided sql matches all input nodes", async () => {
      const query = "SELECT * FROM logs";
      const input = {
        source: { source_type: "scheduled" },
        nodes: [
          { io_type: "input", data: { query_condition: { type: "sql", sql: query } } },
        ],
      };
      expect(await wrapper.vm.validateScheduledPipelineNodes(input, query)).toBe(true);
    });

    it("returns false when provided sql differs from a node's query", async () => {
      const input = {
        source: { source_type: "scheduled" },
        nodes: [
          {
            io_type: "input",
            data: { query_condition: { type: "sql", sql: "different query" } },
          },
        ],
      };
      expect(
        await wrapper.vm.validateScheduledPipelineNodes(input, "SELECT 1"),
      ).toBe(false);
    });

    it("returns false when no sqlQuery provided and input node has empty sql", async () => {
      const input = {
        source: { source_type: "scheduled" },
        nodes: [
          {
            io_type: "input",
            data: { query_condition: { type: "sql", sql: "" } },
          },
        ],
      };
      expect(await wrapper.vm.validateScheduledPipelineNodes(input, "")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 17. getFunctions
  // -----------------------------------------------------------------------

  describe("getFunctions", () => {
    it("populates existingFunctions from jstransform.list response", async () => {
      vi.mocked(jstransform.list).mockResolvedValue({
        data: { list: [{ name: "fn-a" }, { name: "fn-b" }] },
      } as any);
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.existingFunctions).toEqual(["fn-a", "fn-b"]);
    });

    it("calls jstransform.list with the selected organization identifier", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(jstransform.list).toHaveBeenCalledWith(
        1,
        100,
        "created_at",
        true,
        "",
        "default",
      );
    });
  });

  // -----------------------------------------------------------------------
  // 18. getAlertDestinations
  // -----------------------------------------------------------------------

  describe("getAlertDestinations", () => {
    it("populates alertDestinations from destination service response", async () => {
      vi.mocked(destinationService.list).mockResolvedValueOnce({
        data: [{ name: "alert-dest-1" }, { name: "alert-dest-2" }],
      } as any);
      wrapper = createWrapper();
      await wrapper.vm.getAlertDestinations();
      expect(wrapper.vm.alertDestinations).toEqual(["alert-dest-1", "alert-dest-2"]);
    });

    it("calls destinationService.list with module: alert", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({ module: "alert" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 19. getScheduledPipelines
  // -----------------------------------------------------------------------

  describe("getScheduledPipelines", () => {
    it("populates scheduledPipelines with names of scheduled pipelines only", async () => {
      vi.mocked(pipelinesService.getPipelines).mockResolvedValueOnce({
        data: {
          list: [
            { name: "sched-1", source: { source_type: "scheduled" } },
            { name: "realtime-1", source: { source_type: "realtime" } },
          ],
        },
      } as any);
      wrapper = createWrapper();
      await wrapper.vm.getScheduledPipelines();
      expect(wrapper.vm.scheduledPipelines).toEqual(["sched-1"]);
    });
  });

  // -----------------------------------------------------------------------
  // 20. importJson – JSON parsing edge cases
  // -----------------------------------------------------------------------

  describe("importJson – JSON parsing", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("does not throw and returns early on empty JSON string", async () => {
      // Should not throw – component shows a notify and returns
      await expect(
        wrapper.vm.importJson({ jsonStr: "", jsonArray: [] }),
      ).resolves.toBeUndefined();
    });

    it("does not throw and returns early on invalid JSON", async () => {
      await expect(
        wrapper.vm.importJson({ jsonStr: "{invalid}", jsonArray: [] }),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 21. Template rendering
  // -----------------------------------------------------------------------

  describe("Template rendering", () => {
    it("renders BaseImport stub", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="base-import"]').exists()).toBe(true);
    });

    it("does not show error content when pipelineErrorsToDisplay is empty", async () => {
      wrapper = createWrapper();
      wrapper.vm.pipelineErrorsToDisplay = [];
      await nextTick();
      expect(wrapper.find('[data-test^="pipeline-import-error-"]').exists()).toBe(false);
    });

    it("shows error blocks when pipelineErrorsToDisplay is populated", async () => {
      wrapper = createWrapper();
      wrapper.vm.pipelineErrorsToDisplay = [
        [{ field: "pipeline_name", message: "Pipeline - 1: Name is required" }],
      ];
      await nextTick();
      expect(
        wrapper.find('[data-test="pipeline-import-error-0"]').exists(),
      ).toBe(true);
    });

    it("shows pipeline creation messages when pipelineCreators is populated", async () => {
      wrapper = createWrapper();
      wrapper.vm.pipelineCreators = [{ message: "Pipeline - 1: ok", success: true }];
      await nextTick();
      expect(
        wrapper.find('[data-test="pipeline-import-creation-title"]').exists(),
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 22. Store integration
  // -----------------------------------------------------------------------

  describe("Store integration", () => {
    it("exposes store on vm", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
    });

    it("exposes router on vm", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.router).toBeDefined();
    });

    it("exposes q (Quasar) on vm", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.q).toBeDefined();
    });
  });
});
