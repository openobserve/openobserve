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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createI18n } from "vue-i18n";
import CustomNode from "./CustomNode.vue";

installQuasar({});

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: {
        delete: "Delete",
      },
      pipeline: {
        llmEvaluationNodeTitle: "LLM Evaluation",
        nameLabel: "Name",
        samplingLabel: "Sampling",
        samplingOfTraces: "of traces",
        samplingAllTraces: "All traces",
        llmEvaluationDescription: "Evaluates traces using LLM",
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@vue-flow/core", () => ({
  Handle: {
    name: "Handle",
    template: '<div class="mock-handle" />',
    props: ["id", "type", "position", "class"],
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mock-url/${path}`),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    VUE_APP_NAME: "OpenObserve",
  },
}));

vi.mock("@/utils/pipelines/constants", () => ({
  defaultDestinationNodeWarningMessage:
    "This is the default destination node.",
}));

const mockPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ params: {}, query: {} }),
}));

const mockStore = {
  state: {
    selectedOrganization: { identifier: "test-org" },
  },
  getters: {},
  dispatch: vi.fn(),
  commit: vi.fn(),
};
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// useDnD mock – mutable so individual tests can override returned data
let mockPipelineObj: any;
const mockDeletePipelineNode = vi.fn();
const mockOnDragStart = vi.fn();
const mockOnDrop = vi.fn();
const mockCheckIfDefaultDestinationNode = vi.fn(() => false);

vi.mock("./useDnD", () => ({
  default: () => ({
    pipelineObj: mockPipelineObj,
    deletePipelineNode: mockDeletePipelineNode,
    onDragStart: mockOnDragStart,
    onDrop: mockOnDrop,
    checkIfDefaultDestinationNode: mockCheckIfDefaultDestinationNode,
  }),
}));

vi.mock("@/components/ConfirmDialog.vue", () => ({
  default: {
    name: "ConfirmDialog",
    template: `<div class="mock-confirm-dialog">
      <button data-test="confirm-ok-btn" @click="$emit('update:ok')">OK</button>
      <button data-test="confirm-cancel-btn" @click="$emit('update:cancel')">Cancel</button>
    </div>`,
    props: ["title", "message", "modelValue", "warningMessage"],
    emits: ["update:ok", "update:cancel", "update:modelValue"],
  },
}));

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildPipelineObj(overrides: Record<string, any> = {}) {
  return {
    currentSelectedPipeline: {
      nodes: [],
      edges: [],
      last_error: null,
    },
    userSelectedNode: null,
    userClickedNode: null,
    isEditNode: false,
    currentSelectedNodeData: null,
    currentSelectedNodeID: null,
    dialog: { name: "", show: false },
    functions: {},
    nodeTypes: [
      {
        subtype: "function",
        io_type: "default",
        icon: "img:mock-url/images/pipeline/function.svg",
      },
      {
        subtype: "stream",
        io_type: "output",
        icon: "img:mock-url/images/pipeline/outputStream.svg",
      },
      {
        subtype: "stream",
        io_type: "input",
        icon: "img:mock-url/images/pipeline/inputStream.svg",
      },
      {
        subtype: "condition",
        io_type: "default",
        icon: "img:mock-url/images/pipeline/condition.svg",
      },
      {
        subtype: "remote_stream",
        io_type: "output",
        icon: "img:mock-url/images/pipeline/externalOutput.svg",
      },
      {
        subtype: "query",
        io_type: "input",
        icon: "img:mock-url/images/pipeline/query.svg",
      },
      {
        subtype: "llm_evaluation",
        io_type: "default",
        icon: "img:mock-url/images/pipeline/llm.svg",
      },
    ],
    ...overrides,
  };
}

function createWrapper(
  propsOverrides: Record<string, unknown> = {},
  pipelineObjOverrides: Record<string, any> = {}
) {
  mockPipelineObj = buildPipelineObj(pipelineObjOverrides);

  return mount(CustomNode, {
    props: {
      id: "node-1",
      data: { node_type: "function", name: "myFunc", after_flatten: false },
      io_type: "default",
      ...propsOverrides,
    },
    global: {
      plugins: [i18n],
      stubs: {
        Handle: {
          name: "Handle",
          template: '<div class="mock-handle" />',
          props: ["id", "type", "position", "class"],
        },
        ConfirmDialog: {
          name: "ConfirmDialog",
          template: `<div class="mock-confirm-dialog">
            <button data-test="confirm-ok-btn" @click="$emit('update:ok')">OK</button>
            <button data-test="confirm-cancel-btn" @click="$emit('update:cancel')">Cancel</button>
          </div>`,
          props: ["title", "message", "modelValue", "warningMessage"],
          emits: ["update:ok", "update:cancel", "update:modelValue"],
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CustomNode.vue", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIfDefaultDestinationNode.mockReturnValue(false);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // =========================================================================
  describe("component mounting", () => {
    it("mounts without errors for a function node", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts without errors for a stream node", () => {
      wrapper = createWrapper({
        data: {
          node_type: "stream",
          stream_type: "logs",
          stream_name: "my-stream",
        },
        io_type: "output",
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts without errors for a condition node", () => {
      wrapper = createWrapper({
        data: { node_type: "condition", condition: null },
        io_type: "default",
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts without errors for a remote_stream node", () => {
      wrapper = createWrapper({
        data: { node_type: "remote_stream", destination_name: "ext-dest" },
        io_type: "output",
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts without errors for a query node", () => {
      wrapper = createWrapper({
        data: {
          node_type: "query",
          stream_type: "metrics",
          stream_name: "prom",
        },
        io_type: "input",
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts without errors for an llm_evaluation node", () => {
      wrapper = createWrapper({
        data: { node_type: "llm_evaluation", name: "my-eval", sampling_rate: 0.5 },
        io_type: "default",
      });
      expect(wrapper.exists()).toBe(true);
    });
  });

  // =========================================================================
  describe("Handle rendering", () => {
    it("renders target (input) Handle for output io_type", () => {
      wrapper = createWrapper(
        {
          data: { node_type: "stream", stream_type: "logs", stream_name: "s" },
          io_type: "output",
        }
      );
      const handles = wrapper.findAllComponents({ name: "Handle" });
      const targetHandle = handles.find(
        (h: any) => h.props("type") === "target"
      );
      expect(targetHandle).toBeDefined();
    });

    it("renders target (input) Handle for default io_type", () => {
      wrapper = createWrapper();
      const handles = wrapper.findAllComponents({ name: "Handle" });
      const targetHandle = handles.find(
        (h: any) => h.props("type") === "target"
      );
      expect(targetHandle).toBeDefined();
    });

    it("does NOT render target Handle for input io_type", () => {
      wrapper = createWrapper(
        {
          data: { node_type: "query", stream_type: "logs", stream_name: "s" },
          io_type: "input",
        }
      );
      const handles = wrapper.findAllComponents({ name: "Handle" });
      const targetHandle = handles.find(
        (h: any) => h.props("type") === "target"
      );
      expect(targetHandle).toBeUndefined();
    });

    it("renders source (output) Handle for input io_type", () => {
      wrapper = createWrapper(
        {
          data: { node_type: "query", stream_type: "logs", stream_name: "s" },
          io_type: "input",
        }
      );
      const handles = wrapper.findAllComponents({ name: "Handle" });
      const sourceHandle = handles.find(
        (h: any) => h.props("type") === "source"
      );
      expect(sourceHandle).toBeDefined();
    });

    it("renders source (output) Handle for default io_type", () => {
      wrapper = createWrapper();
      const handles = wrapper.findAllComponents({ name: "Handle" });
      const sourceHandle = handles.find(
        (h: any) => h.props("type") === "source"
      );
      expect(sourceHandle).toBeDefined();
    });

    it("does NOT render source Handle for output io_type", () => {
      wrapper = createWrapper(
        {
          data: { node_type: "stream", stream_type: "logs", stream_name: "s" },
          io_type: "output",
        }
      );
      const handles = wrapper.findAllComponents({ name: "Handle" });
      const sourceHandle = handles.find(
        (h: any) => h.props("type") === "source"
      );
      expect(sourceHandle).toBeUndefined();
    });

    it("sets data-test on the input handle using io_type", () => {
      wrapper = createWrapper({
        data: { node_type: "stream", stream_type: "logs", stream_name: "s" },
        io_type: "output",
      });
      expect(
        wrapper.find('[data-test="pipeline-node-output-input-handle"]').exists()
      ).toBe(true);
    });

    it("sets data-test on the output handle using io_type", () => {
      wrapper = createWrapper({
        data: { node_type: "query", stream_type: "logs", stream_name: "s" },
        io_type: "input",
      });
      expect(
        wrapper.find('[data-test="pipeline-node-input-output-handle"]').exists()
      ).toBe(true);
    });
  });

  // =========================================================================
  describe("function node rendering", () => {
    it("renders the function node container with correct data-test", () => {
      wrapper = createWrapper({
        data: { node_type: "function", name: "myFunc", after_flatten: false },
        io_type: "default",
      });
      expect(
        wrapper
          .find('[data-test="pipeline-node-default-function-node"]')
          .exists()
      ).toBe(true);
    });

    it("shows the function name", () => {
      wrapper = createWrapper({
        data: { node_type: "function", name: "transformLogs", after_flatten: false },
        io_type: "default",
      });
      expect(wrapper.text()).toContain("transformLogs");
    });

    it("shows [RAF] when after_flatten is true", () => {
      wrapper = createWrapper({
        data: { node_type: "function", name: "f", after_flatten: true },
        io_type: "default",
      });
      expect(wrapper.text()).toContain("[RAF]");
    });

    it("shows [RBF] when after_flatten is false", () => {
      wrapper = createWrapper({
        data: { node_type: "function", name: "f", after_flatten: false },
        io_type: "default",
      });
      expect(wrapper.text()).toContain("[RBF]");
    });

    it("does NOT render stream node markup for a function node", () => {
      wrapper = createWrapper({
        data: { node_type: "function", name: "f", after_flatten: false },
        io_type: "default",
      });
      expect(
        wrapper
          .find('[data-test="pipeline-node-default-stream-node"]')
          .exists()
      ).toBe(false);
    });
  });

  // =========================================================================
  describe("stream node rendering", () => {
    it("renders the stream node container with correct data-test", () => {
      wrapper = createWrapper({
        data: { node_type: "stream", stream_type: "logs", stream_name: "my-stream" },
        io_type: "output",
      });
      expect(
        wrapper.find('[data-test="pipeline-node-output-stream-node"]').exists()
      ).toBe(true);
    });

    it("shows stream_type and stream_name as plain string", () => {
      wrapper = createWrapper({
        data: { node_type: "stream", stream_type: "logs", stream_name: "my-stream" },
        io_type: "output",
      });
      expect(wrapper.text()).toContain("logs");
      expect(wrapper.text()).toContain("my-stream");
    });

    it("shows stream_name.label when stream_name is an object with label", () => {
      wrapper = createWrapper({
        data: {
          node_type: "stream",
          stream_type: "metrics",
          stream_name: { label: "pretty-name", value: "raw-name" },
        },
        io_type: "output",
      });
      expect(wrapper.text()).toContain("pretty-name");
    });
  });

  // =========================================================================
  describe("remote_stream node rendering", () => {
    it("renders the remote_stream node container", () => {
      wrapper = createWrapper({
        data: { node_type: "remote_stream", destination_name: "external-sink" },
        io_type: "output",
      });
      expect(
        wrapper
          .find('[data-test="pipeline-node-output-remote-stream-node"]')
          .exists()
      ).toBe(true);
    });

    it("shows the destination_name", () => {
      wrapper = createWrapper({
        data: { node_type: "remote_stream", destination_name: "external-sink" },
        io_type: "output",
      });
      expect(wrapper.text()).toContain("external-sink");
    });
  });

  // =========================================================================
  describe("query node rendering", () => {
    it("renders the query node container", () => {
      wrapper = createWrapper({
        data: { node_type: "query", stream_type: "logs", stream_name: "my-logs" },
        io_type: "input",
      });
      expect(
        wrapper.find('[data-test="pipeline-node-input-query-node"]').exists()
      ).toBe(true);
    });

    it("shows stream_type and stream_name", () => {
      wrapper = createWrapper({
        data: { node_type: "query", stream_type: "traces", stream_name: "t-stream" },
        io_type: "input",
      });
      expect(wrapper.text()).toContain("traces");
      expect(wrapper.text()).toContain("t-stream");
    });
  });

  // =========================================================================
  describe("condition node rendering", () => {
    it("renders the condition node container", () => {
      wrapper = createWrapper({
        data: { node_type: "condition", condition: null },
        io_type: "default",
      });
      expect(
        wrapper
          .find('[data-test="pipeline-node-default-condition-node"]')
          .exists()
      ).toBe(true);
    });
  });

  // =========================================================================
  describe("llm_evaluation node rendering", () => {
    it("renders the llm_evaluation node container", () => {
      wrapper = createWrapper({
        data: { node_type: "llm_evaluation", name: "eval-node", sampling_rate: 0.1 },
        io_type: "default",
      });
      expect(
        wrapper
          .find('[data-test="pipeline-node-default-llm-evaluation-node"]')
          .exists()
      ).toBe(true);
    });

    it("shows the node name", () => {
      wrapper = createWrapper({
        data: { node_type: "llm_evaluation", name: "my-llm", sampling_rate: 0.5 },
        io_type: "default",
      });
      expect(wrapper.text()).toContain("my-llm");
    });

    it("shows sampling rate as percentage when sampling_rate is set", () => {
      wrapper = createWrapper({
        data: { node_type: "llm_evaluation", name: "e", sampling_rate: 0.25 },
        io_type: "default",
      });
      expect(wrapper.text()).toContain("25%");
    });

    it("falls back to 'LLM Evaluation' label when name is absent", () => {
      wrapper = createWrapper({
        data: { node_type: "llm_evaluation" },
        io_type: "default",
      });
      expect(wrapper.text()).toContain("LLM Evaluation");
    });
  });

  // =========================================================================
  describe("computed: hasNodeError", () => {
    it("returns false when last_error is null", () => {
      wrapper = createWrapper({}, {
        currentSelectedPipeline: { nodes: [], edges: [], last_error: null },
      });
      const vm = wrapper.vm as any;
      expect(vm.hasNodeError).toBe(false);
    });

    it("returns false when last_error has no node_errors", () => {
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: { node_errors: null },
        },
      });
      const vm = wrapper.vm as any;
      expect(vm.hasNodeError).toBe(false);
    });

    it("returns false when node_errors does not contain current node id", () => {
      wrapper = createWrapper({ id: "node-1" }, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: { node_errors: { "other-node": { errors: [], error_count: 1 } } },
        },
      });
      const vm = wrapper.vm as any;
      expect(vm.hasNodeError).toBeFalsy();
    });

    it("returns truthy when node_errors contains the current node id", () => {
      wrapper = createWrapper({ id: "node-1" }, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: {
            node_errors: {
              "node-1": { errors: ["something went wrong"], error_count: 1 },
            },
          },
        },
      });
      const vm = wrapper.vm as any;
      expect(vm.hasNodeError).toBeTruthy();
    });

    it("renders error badge when hasNodeError is truthy", () => {
      wrapper = createWrapper({ id: "node-1" }, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: {
            node_errors: {
              "node-1": { errors: ["err"], error_count: 1 },
            },
          },
        },
      });
      expect(wrapper.find(".error-badge").exists()).toBe(true);
    });

    it("does NOT render error badge when hasNodeError is false", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".error-badge").exists()).toBe(false);
    });
  });

  // =========================================================================
  describe("computed: getNodeErrorInfo", () => {
    it("returns null when last_error is null", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getNodeErrorInfo).toBeNull();
    });

    it("returns error text joining all errors with double newline", () => {
      wrapper = createWrapper({ id: "node-1" }, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: {
            node_errors: {
              "node-1": {
                errors: ["error one", "error two"],
                error_count: 2,
              },
            },
          },
        },
      });
      const vm = wrapper.vm as any;
      expect(vm.getNodeErrorInfo).toContain("error one");
      expect(vm.getNodeErrorInfo).toContain("error two");
    });

    it("appends overflow message when error_count exceeds errors array length", () => {
      wrapper = createWrapper({ id: "node-1" }, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: {
            node_errors: {
              "node-1": {
                errors: ["error one"],
                error_count: 5,
              },
            },
          },
        },
      });
      const vm = wrapper.vm as any;
      expect(vm.getNodeErrorInfo).toContain("and 4 more errors");
    });
  });

  // =========================================================================
  describe("getNodeColor", () => {
    it("returns blue for input io_type", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getNodeColor("input")).toBe("#3b82f6");
    });

    it("returns green for output io_type", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getNodeColor("output")).toBe("#22c55e");
    });

    it("returns orange/amber for default io_type", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getNodeColor("default")).toBe("#f59e0b");
    });

    it("returns grey for unknown io_type", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getNodeColor("unknown")).toBe("#6b7280");
    });
  });

  // =========================================================================
  describe("getTruncatedConditions", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("returns empty string for null/undefined", () => {
      const vm = wrapper.vm as any;
      expect(vm.getTruncatedConditions(null)).toBe("");
      expect(vm.getTruncatedConditions(undefined)).toBe("");
    });

    it("truncates to 20 chars with ellipsis for long condition strings", () => {
      const vm = wrapper.vm as any;
      const longCondition = {
        filterType: "condition",
        column: "very_long_field_name",
        operator: "=",
        value: "something_really_long_here",
      };
      const result = vm.getTruncatedConditions(longCondition);
      expect(result.length).toBeLessThanOrEqual(23); // 20 + "..."
    });

    it("handles V2 group format with nested conditions", () => {
      const vm = wrapper.vm as any;
      const conditionData = {
        filterType: "group",
        conditions: [
          {
            filterType: "condition",
            column: "a",
            operator: "=",
            value: "1",
            logicalOperator: null,
          },
        ],
      };
      const result = vm.getTruncatedConditions(conditionData);
      expect(typeof result).toBe("string");
    });

    it("handles V1 backend OR format", () => {
      const vm = wrapper.vm as any;
      const conditionData = {
        or: [
          { column: "x", operator: "=", value: "y" },
        ],
      };
      const result = vm.getTruncatedConditions(conditionData);
      expect(typeof result).toBe("string");
    });

    it("handles V1 backend AND format", () => {
      const vm = wrapper.vm as any;
      const conditionData = {
        and: [
          { column: "a", operator: "!=", value: "b" },
        ],
      };
      const result = vm.getTruncatedConditions(conditionData);
      expect(typeof result).toBe("string");
    });

    it("handles V0 array format", () => {
      const vm = wrapper.vm as any;
      const conditionData = [
        { column: "field", operator: "=", value: "val" },
      ];
      const result = vm.getTruncatedConditions(conditionData);
      expect(result).toContain("field");
    });

    it("handles single condition with column and operator", () => {
      const vm = wrapper.vm as any;
      const conditionData = { column: "status", operator: "=", value: "200" };
      const result = vm.getTruncatedConditions(conditionData);
      expect(result).toContain("status");
    });

    it("returns empty string when conditionData has empty conditions array", () => {
      const vm = wrapper.vm as any;
      const conditionData = { filterType: "group", conditions: [] };
      const result = vm.getTruncatedConditions(conditionData);
      expect(result).toBe("");
    });
  });

  // =========================================================================
  describe("hover state management", () => {
    it("sets showButtons to true on mouseenter of function node", async () => {
      wrapper = createWrapper();
      const nodeEl = wrapper.find(
        '[data-test="pipeline-node-default-function-node"]'
      );
      await nodeEl.trigger("mouseenter");
      const vm = wrapper.vm as any;
      expect(vm.showButtons).toBe(true);
    });

    it("hides action buttons initially (v-show=false)", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showButtons).toBe(false);
    });

    it("calls updateEdgeColors with correct color on mouseenter", async () => {
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [
            { source: "node-1", style: {}, markerEnd: {} },
          ],
          last_error: null,
        },
      });
      const nodeEl = wrapper.find(
        '[data-test="pipeline-node-default-function-node"]'
      );
      await nodeEl.trigger("mouseenter");
      const edge = mockPipelineObj.currentSelectedPipeline.edges[0];
      expect(edge.style.stroke).toBe("#f59e0b"); // default color
    });

    it("sets showDeleteTooltip to true on mouseenter of delete button", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showButtons = true;
      await nextTick();
      const deleteBtn = wrapper.find(
        '[data-test="pipeline-node-default-delete-btn"]'
      );
      if (deleteBtn.exists()) {
        await deleteBtn.trigger("mouseenter");
        expect(vm.showDeleteTooltip).toBe(true);
      }
    });
  });

  // =========================================================================
  describe("editNode", () => {
    it("sets pipelineObj.isEditNode to true when editNode is called", async () => {
      const testNode = {
        id: "node-1",
        data: { node_type: "function", name: "fn" },
      };
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [testNode],
          edges: [],
          last_error: null,
        },
      });
      const vm = wrapper.vm as any;
      vm.editNode("node-1");
      await nextTick();
      expect(mockPipelineObj.isEditNode).toBe(true);
    });

    it("sets currentSelectedNodeID on editNode", async () => {
      const testNode = {
        id: "node-1",
        data: { node_type: "function", name: "fn" },
      };
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [testNode],
          edges: [],
          last_error: null,
        },
      });
      const vm = wrapper.vm as any;
      vm.editNode("node-1");
      await nextTick();
      expect(mockPipelineObj.currentSelectedNodeID).toBe("node-1");
    });

    it("sets dialog.show to true on editNode", async () => {
      const testNode = {
        id: "node-1",
        data: { node_type: "function", name: "fn" },
      };
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [testNode],
          edges: [],
          last_error: null,
        },
      });
      const vm = wrapper.vm as any;
      vm.editNode("node-1");
      await nextTick();
      expect(mockPipelineObj.dialog.show).toBe(true);
    });

    it("opens the edit dialog when a function node is clicked", async () => {
      const testNode = {
        id: "node-1",
        data: { node_type: "function", name: "fn", after_flatten: false },
      };
      wrapper = createWrapper(
        { id: "node-1", data: testNode.data, io_type: "default" },
        {
          currentSelectedPipeline: {
            nodes: [testNode],
            edges: [],
            last_error: null,
          },
        }
      );
      const nodeEl = wrapper.find(
        '[data-test="pipeline-node-default-function-node"]'
      );
      await nodeEl.trigger("click");
      expect(mockPipelineObj.dialog.show).toBe(true);
    });
  });

  // =========================================================================
  describe("deleteNode / confirm dialog", () => {
    it("opens confirm dialog when deleteNode is called", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      expect(vm.confirmDialogMeta.show).toBe(true);
    });

    it("sets the dialog title to the translated delete string", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      expect(vm.confirmDialogMeta.title).toBe("Delete");
    });

    it("sets the confirmation message", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      expect(vm.confirmDialogMeta.message).toBeTruthy();
    });

    it("calls deletePipelineNode when confirm OK is clicked", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      // Trigger the onConfirm callback directly
      vm.confirmDialogMeta.onConfirm();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-1");
    });

    it("resets confirmDialogMeta when resetConfirmDialog is called", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      vm.resetConfirmDialog();
      expect(vm.confirmDialogMeta.show).toBe(false);
      expect(vm.confirmDialogMeta.title).toBe("");
    });

    it("sets warningMessage for default destination stream node", async () => {
      mockCheckIfDefaultDestinationNode.mockReturnValue(true);
      wrapper = createWrapper({
        id: "node-1",
        data: { node_type: "stream", stream_type: "logs", stream_name: "s" },
        io_type: "output",
      });
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      expect(vm.confirmDialogMeta.warningMessage).toBeTruthy();
      expect(vm.confirmDialogMeta.warningMessage).toContain(
        "default destination node"
      );
    });

    it("does NOT set warningMessage for non-default destination node", async () => {
      mockCheckIfDefaultDestinationNode.mockReturnValue(false);
      wrapper = createWrapper({
        id: "node-1",
        data: { node_type: "stream", stream_type: "logs", stream_name: "s" },
        io_type: "output",
      });
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      expect(vm.confirmDialogMeta.warningMessage).toBe("");
    });

    it("does NOT set warningMessage for function nodes", async () => {
      wrapper = createWrapper({
        id: "node-1",
        data: { node_type: "function", name: "fn", after_flatten: false },
        io_type: "default",
      });
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      expect(vm.confirmDialogMeta.warningMessage).toBe("");
    });
  });

  // =========================================================================
  describe("navigateToFunction", () => {
    it("calls router.push with functionList route and function name", () => {
      wrapper = createWrapper({ id: "node-1" });
      const vm = wrapper.vm as any;
      vm.navigateToFunction("myFunc");
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "functionList",
          query: expect.objectContaining({
            action: "update",
            name: "myFunc",
            org_identifier: "test-org",
          }),
        })
      );
    });

    it("includes the error info in the query when getNodeErrorInfo is non-null", () => {
      wrapper = createWrapper({ id: "node-1" }, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [],
          last_error: {
            node_errors: {
              "node-1": { errors: ["oops"], error_count: 1 },
            },
          },
        },
      });
      const vm = wrapper.vm as any;
      vm.navigateToFunction("myFunc");
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ error: expect.any(String) }),
        })
      );
    });
  });

  // =========================================================================
  describe("getIcon", () => {
    it("returns the icon for a matching subtype and io_type", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const icon = vm.getIcon({ node_type: "function" }, "default");
      expect(icon).toBeDefined();
    });

    it("returns undefined for an unrecognised subtype", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const icon = vm.getIcon({ node_type: "nonexistent" }, "default");
      expect(icon).toBeUndefined();
    });
  });

  // =========================================================================
  describe("onFunctionClick", () => {
    it("sets pipelineObj.userSelectedNode to the given data", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const data = { node_type: "function", name: "f" };
      const event = new MouseEvent("click");
      vm.onFunctionClick(data, event, "node-1");
      expect(mockPipelineObj.userSelectedNode).toBe(data);
    });

    it("sets pipelineObj.userClickedNode to the given id", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onFunctionClick({}, event, "node-99");
      expect(mockPipelineObj.userClickedNode).toBe("node-99");
    });

    it("calls onDragStart with function dataToOpen object", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onFunctionClick({}, event, "node-1");
      expect(mockOnDragStart).toHaveBeenCalled();
      const callArg = mockOnDragStart.mock.calls[0][1];
      expect(callArg.subtype).toBe("function");
    });

    it("closes the menu after click", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.menu = true;
      const event = new MouseEvent("click");
      vm.onFunctionClick({}, event, "node-1");
      expect(vm.menu).toBe(false);
    });
  });

  // =========================================================================
  describe("onConditionClick", () => {
    it("sets pipelineObj.userClickedNode to the given id", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onConditionClick({ label: "" }, event, "cond-node");
      expect(mockPipelineObj.userClickedNode).toBe("cond-node");
    });

    it("updates data.label to the given id", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const data: any = { label: "" };
      const event = new MouseEvent("click");
      vm.onConditionClick(data, event, "cond-node");
      expect(data.label).toBe("cond-node");
    });

    it("calls onDragStart with condition subtype", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onConditionClick({}, event, "c-1");
      const callArg = mockOnDragStart.mock.calls[0][1];
      expect(callArg.subtype).toBe("condition");
    });
  });

  // =========================================================================
  describe("onStreamOutputClick", () => {
    it("sets userClickedNode to data.label when id is falsy", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const data = { label: "stream-label" };
      const event = new MouseEvent("click");
      vm.onStreamOutputClick(data, event, null);
      expect(mockPipelineObj.userClickedNode).toBe("stream-label");
    });

    it("sets userClickedNode to id when id is truthy", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onStreamOutputClick({}, event, "stream-id");
      expect(mockPipelineObj.userClickedNode).toBe("stream-id");
    });

    it("calls onDragStart with stream subtype and output io_type", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onStreamOutputClick({}, event, "s-1");
      const callArg = mockOnDragStart.mock.calls[0][1];
      expect(callArg.subtype).toBe("stream");
      expect(callArg.io_type).toBe("output");
    });
  });

  // =========================================================================
  describe("onExternalDestinationClick", () => {
    it("calls onDragStart with remote_stream subtype", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const event = new MouseEvent("click");
      vm.onExternalDestinationClick({}, event, "ext-1");
      const callArg = mockOnDragStart.mock.calls[0][1];
      expect(callArg.subtype).toBe("remote_stream");
    });

    it("sets userClickedNode to data.label when id is null", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const data = { label: "ext-label" };
      const event = new MouseEvent("click");
      vm.onExternalDestinationClick(data, event, null);
      expect(mockPipelineObj.userClickedNode).toBe("ext-label");
    });
  });

  // =========================================================================
  describe("updateEdgeColors", () => {
    it("updates stroke of edges that originate from the given nodeId", () => {
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [
            { source: "node-1", style: {}, markerEnd: {} },
            { source: "node-2", style: {}, markerEnd: {} },
          ],
          last_error: null,
        },
      });
      const vm = wrapper.vm as any;
      vm.updateEdgeColors("node-1", "#ff0000", false);
      expect(mockPipelineObj.currentSelectedPipeline.edges[0].style.stroke).toBe(
        "#ff0000"
      );
      // node-2 edge should not be changed
      expect(
        mockPipelineObj.currentSelectedPipeline.edges[1].style.stroke
      ).toBeUndefined();
    });

    it("resets edge stroke to grey when reset=true", () => {
      wrapper = createWrapper({}, {
        currentSelectedPipeline: {
          nodes: [],
          edges: [{ source: "node-1", style: { stroke: "#ff0000" }, markerEnd: {} }],
          last_error: null,
        },
      });
      const vm = wrapper.vm as any;
      vm.updateEdgeColors("node-1", null, true);
      expect(mockPipelineObj.currentSelectedPipeline.edges[0].style.stroke).toBe(
        "#6b7280"
      );
    });

    it("does nothing when currentSelectedPipeline has no edges", () => {
      wrapper = createWrapper({}, {
        currentSelectedPipeline: { nodes: [], edges: null, last_error: null },
      });
      // Should not throw
      const vm = wrapper.vm as any;
      expect(() => vm.updateEdgeColors("node-1", "#f00", false)).not.toThrow();
    });
  });

  // =========================================================================
  describe("functionInfo", () => {
    it("returns function info from pipelineObj.functions when present", () => {
      wrapper = createWrapper({}, {
        functions: {
          myFunc: { name: "myFunc", body: "." },
        },
      });
      const vm = wrapper.vm as any;
      const info = vm.functionInfo({ name: "myFunc" });
      expect(info).toEqual({ name: "myFunc", body: "." });
    });

    it("returns null when function is not in pipelineObj.functions", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const info = vm.functionInfo({ name: "notExists" });
      expect(info).toBeNull();
    });
  });

  // =========================================================================
  describe("ConfirmDialog integration", () => {
    it("renders ConfirmDialog component", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: "ConfirmDialog" }).exists()).toBe(
        true
      );
    });

    it("calls resetConfirmDialog when cancel is clicked", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      const cancelBtn = wrapper.find('[data-test="confirm-cancel-btn"]');
      await cancelBtn.trigger("click");
      expect(vm.confirmDialogMeta.show).toBe(false);
    });

    it("calls deletePipelineNode when OK is clicked in dialog", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deleteNode("node-1");
      await nextTick();
      const okBtn = wrapper.find('[data-test="confirm-ok-btn"]');
      await okBtn.trigger("click");
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-1");
    });
  });

  // =========================================================================
  describe("action buttons data-test attributes", () => {
    const ioTypes = ["default", "output", "input"] as const;

    ioTypes.forEach((ioType) => {
      it(`renders delete button data-test for io_type="${ioType}"`, async () => {
        const nodeDataMap: Record<string, object> = {
          default: { node_type: "function", name: "f", after_flatten: false },
          output: { node_type: "stream", stream_type: "logs", stream_name: "s" },
          input: { node_type: "query", stream_type: "logs", stream_name: "s" },
        };
        wrapper = createWrapper({ data: nodeDataMap[ioType], io_type: ioType });
        const vm = wrapper.vm as any;
        vm.showButtons = true;
        await nextTick();
        const deleteBtn = wrapper.find(
          `[data-test="pipeline-node-${ioType}-delete-btn"]`
        );
        expect(deleteBtn.exists()).toBe(true);
      });
    });
  });
});
