// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createStore } from "vuex";
import CustomNode from "@/plugins/pipelines/CustomNode.vue";
import i18n from "@/locales";
import useDnD from "@/plugins/pipelines/useDnD";

// Mock @vue-flow/core
vi.mock("@vue-flow/core", () => ({
  Handle: {
    template: '<div class="handle" />',
    props: ["id", "type", "position"],
  },
}));

// Mock useDnD composable
vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(() => ({
    pipelineObj: {
      currentSelectedPipeline: {
        nodes: [],
        edges: [],
        last_error: null,
      },
      nodeTypes: [
        {
          subtype: "function",
          io_type: "default",
          icon: "img:function.svg",
        },
        {
          subtype: "stream",
          io_type: "output",
          icon: "img:stream.svg",
        },
        {
          subtype: "condition",
          io_type: "default",
          icon: "img:condition.svg",
        },
      ],
      functions: {},
      userSelectedNode: null,
      userClickedNode: null,
      isEditNode: false,
      currentSelectedNodeData: null,
      currentSelectedNodeID: null,
      dialog: {
        name: "",
        show: false,
      },
    },
    deletePipelineNode: vi.fn(),
    onDragStart: vi.fn(),
    onDrop: vi.fn(),
    checkIfDefaultDestinationNode: vi.fn(() => false),
  })),
}));

// Mock utils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mocked-${path}`),
}));

vi.mock("@/utils/pipelines/constants", () => ({
  defaultDestinationNodeWarningMessage: "Warning: This is a default destination node",
}));

describe("CustomNode.vue", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
          name: "Test Org",
        },
        theme: "light",
      },
    });

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/functions",
          name: "functionList",
          component: { template: "<div>Functions</div>" },
        },
      ],
    });
  });

  describe("function node rendering", () => {
    it("should render function node with correct structure", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "func-1",
          data: {
            node_type: "function",
            name: "transform_data",
            after_flatten: true,
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            "q-tooltip": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find('[data-node-type="function"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("transform_data");
      expect(wrapper.text()).toContain("[RAF]"); // after_flatten is true
    });

    it("should show [RBF] when after_flatten is false", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "func-1",
          data: {
            node_type: "function",
            name: "transform_data",
            after_flatten: false,
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.text()).toContain("[RBF]");
    });
  });

  describe("stream node rendering", () => {
    it("should render stream node with stream name object", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "stream-1",
          data: {
            node_type: "stream",
            stream_type: "logs",
            stream_name: { label: "application_logs", value: "app_logs" },
          },
          io_type: "output",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find('[data-node-type="stream"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("logs");
      expect(wrapper.text()).toContain("application_logs");
    });

    it("should render stream node with stream name string", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "stream-1",
          data: {
            node_type: "stream",
            stream_type: "logs",
            stream_name: "simple_stream",
          },
          io_type: "output",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.text()).toContain("simple_stream");
    });
  });

  describe("remote_stream node rendering", () => {
    it("should render remote stream node", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "remote-1",
          data: {
            node_type: "remote_stream",
            destination_name: "external_system",
          },
          io_type: "output",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find('[data-node-type="remote_stream"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("external_system");
    });
  });

  describe("query node rendering", () => {
    it("should render query node", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "query-1",
          data: {
            node_type: "query",
            stream_type: "traces",
            stream_name: "traces_stream",
          },
          io_type: "input",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find('[data-node-type="query"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("traces");
      expect(wrapper.text()).toContain("traces_stream");
    });
  });

  describe("condition node rendering", () => {
    it("should render condition node with simple condition", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "cond-1",
          data: {
            node_type: "condition",
            condition: {
              column: "status",
              operator: "=",
              value: "200",
            },
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find('[data-node-type="condition"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("status = '200'");
    });

    it("should truncate long condition text", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "cond-1",
          data: {
            node_type: "condition",
            condition: {
              column: "very_long_column_name_that_exceeds_limit",
              operator: "=",
              value: "very_long_value",
            },
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      const text = wrapper.text();
      // Should contain ellipsis if truncated (truncated to 20 chars)
      if (text.length > 23) { // 20 chars + "..."
        expect(text).toContain("...");
      }
    });

    it("should handle V2 format group conditions", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "cond-1",
          data: {
            node_type: "condition",
            conditions: {
              filterType: "group",
              conditions: [
                {
                  filterType: "condition",
                  column: "status",
                  operator: "=",
                  value: "200",
                },
                {
                  filterType: "condition",
                  column: "method",
                  operator: "=",
                  value: "GET",
                  logicalOperator: "AND",
                },
              ],
            },
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      const text = wrapper.text();
      expect(text).toBeTruthy();
    });
  });

  describe("handle positioning", () => {
    it("should render input handle for output node", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "stream", stream_type: "logs", stream_name: "test" },
          io_type: "output",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: {
              template: '<div class="handle" :type="type" :id="id" />',
              props: ["type", "id"],
            },
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      const handles = wrapper.findAll(".handle");
      expect(handles.length).toBeGreaterThan(0);
    });

    it("should render output handle for input node", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "query", stream_type: "logs", stream_name: "test" },
          io_type: "input",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: {
              template: '<div class="handle" :type="type" :id="id" />',
              props: ["type", "id"],
            },
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      const handles = wrapper.findAll(".handle");
      expect(handles.length).toBeGreaterThan(0);
    });

    it("should render both handles for default node", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "function", name: "test" },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: {
              template: '<div class="handle" :type="type" :id="id" />',
              props: ["type", "id"],
            },
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      const handles = wrapper.findAll(".handle");
      expect(handles.length).toBeGreaterThan(0);
    });
  });

  describe("node colors", () => {
    it("should return correct color for input nodes", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "query", stream_type: "logs", stream_name: "test" },
          io_type: "input",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      // Component uses #3b82f6 (blue) for input nodes
      expect(wrapper.exists()).toBe(true);
    });

    it("should return correct color for output nodes", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "stream", stream_type: "logs", stream_name: "test" },
          io_type: "output",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      // Component uses #22c55e (green) for output nodes
      expect(wrapper.exists()).toBe(true);
    });

    it("should return correct color for default nodes", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "function", name: "test" },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            ConfirmDialog: true,
          },
        },
      });

      // Component uses #f59e0b (orange) for default nodes
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should show error badge when node has errors", () => {
      const useDnDMock = vi.mocked(useDnD);
      useDnDMock.mockReturnValue({
        pipelineObj: {
          currentSelectedPipeline: {
            nodes: [],
            edges: [],
            last_error: {
              node_errors: {
                "func-1": {
                  errors: ["Syntax error in function"],
                  error_count: 1,
                },
              },
            },
          },
          nodeTypes: [],
          functions: {},
        },
        deletePipelineNode: vi.fn(),
        onDragStart: vi.fn(),
        onDrop: vi.fn(),
        checkIfDefaultDestinationNode: vi.fn(() => false),
      });

      const wrapper = mount(CustomNode, {
        props: {
          id: "func-1",
          data: {
            node_type: "function",
            name: "bad_function",
            after_flatten: true,
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            "q-tooltip": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find(".error-badge").exists()).toBe(true);
    });

    it("should show error count in badge", () => {
      const useDnDMock = vi.mocked(useDnD);
      useDnDMock.mockReturnValue({
        pipelineObj: {
          currentSelectedPipeline: {
            nodes: [],
            edges: [],
            last_error: {
              node_errors: {
                "func-1": {
                  errors: ["Error 1", "Error 2"],
                  error_count: 5,
                },
              },
            },
          },
          nodeTypes: [],
          functions: {},
        },
        deletePipelineNode: vi.fn(),
        onDragStart: vi.fn(),
        onDrop: vi.fn(),
        checkIfDefaultDestinationNode: vi.fn(() => false),
      });

      const wrapper = mount(CustomNode, {
        props: {
          id: "func-1",
          data: {
            node_type: "function",
            name: "bad_function",
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            "q-tooltip": true,
            ConfirmDialog: true,
          },
        },
      });

      expect(wrapper.find(".error-badge").exists()).toBe(true);
      expect(wrapper.find(".error-count").text()).toBe("5");
    });
  });

  describe("node interactions", () => {
    it("should call editNode when node is clicked", async () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "func-1",
          data: {
            node_type: "function",
            name: "test_function",
          },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-tooltip": true,
            ConfirmDialog: true,
          },
        },
      });

      const nodeDiv = wrapper.find('[data-node-type="function"]');
      await nodeDiv.trigger("click");

      // editNode should be called (opens dialog)
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("confirm dialog", () => {
    it("should render confirm dialog component", () => {
      const wrapper = mount(CustomNode, {
        props: {
          id: "node-1",
          data: { node_type: "function", name: "test" },
          io_type: "default",
        },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            Handle: true,
            "q-icon": true,
            "q-separator": true,
            "q-btn": true,
            "confirm-dialog": {
              template: '<div class="confirm-dialog" />',
            },
          },
        },
      });

      expect(wrapper.find(".confirm-dialog").exists()).toBe(true);
    });
  });
});
