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

import PipelineEditor from "./PipelineEditor.vue";

import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import useDnD from "@/plugins/pipelines/useDnD";
import pipelineService from "@/services/pipelines";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));


const mockAddNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(),
  useDnD: () => ({ addNode: mockAddNode }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    search: vi.fn(),
    getStreams: vi.fn().mockResolvedValue({
      list: [
        { name: "test_stream1", stream_type: "logs" },
        { name: "test_stream2", stream_type: "logs" },
      ],
    }),
  }),
}));

vi.mock("@/composables/usePipelines", () => ({
  default: () => ({
    getUsedStreamsList: vi.fn().mockResolvedValue([]),
    getPipelineDestinations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: { list: [] } }),
  },
}));

vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn().mockResolvedValue({ data: { list: [] } }),
    createPipeline: vi.fn().mockResolvedValue({}),
    updatePipeline: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@vue-flow/core", () => ({
  MarkerType: { ArrowClosed: "arrowclosed" },
  useVueFlow: () => ({
    getSelectedEdges: { value: [] },
    removeEdges: vi.fn(),
  }),
}));

vi.mock("@/composables/contextProviders", () => ({
  contextRegistry: { register: vi.fn(), unregister: vi.fn(), setActive: vi.fn() },
  createPipelinesContextProvider: vi.fn(() => ({})),
}));

// Lightweight stub for ODrawer so tests can assert on the props the component
// forwards (open / size / persistent / showClose) and drive button behaviour
// via emits — without rendering reka-ui portals.
const ODrawerStub = {
  name: "ODrawer",
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: true },
    width: { type: [String, Number], default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-persistent="String(!!persistent)"
      :data-show-close="String(!!showClose)"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-drawer-stub-primary"
        @click="$emit('click:primary')"
      >primary</button>
      <button
        data-test="o-drawer-stub-secondary"
        @click="$emit('click:secondary')"
      >secondary</button>
      <button
        data-test="o-drawer-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

describe("PipelineEditor", () => {
  let wrapper;
  let mockPipelineObj;

  const buildMockPipelineObj = (overrides = {}) =>
    reactive({
      currentSelectedPipeline: {
        nodes: [],
        edges: [],
        source: { source_type: "realtime" },
        name: "test-pipeline",
      },
      isEditPipeline: false,
      dirtyFlag: false,
      dialog: { show: false, name: "" },
      stepPicker: { show: false, source: "" },
      pendingEdge: null,
      nodeTypes: [],
      functions: { value: {} },
      currentSelectedNodeData: null,
      ...overrides,
    });

  beforeEach(() => {
    mockPipelineObj = buildMockPipelineObj();

    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      onDragStart: vi.fn(),
      onDragLeave: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onNodeChange: vi.fn(),
      onNodesChange: vi.fn(),
      onEdgesChange: vi.fn(),
      onConnect: vi.fn(),
      validateConnection: vi.fn(),
      addNode: vi.fn(),
      editNode: vi.fn(),
      deletePipelineNode: vi.fn(),
      resetPipelineData: vi.fn(),
      comparePipelinesById: vi.fn(),
    }));

    // Create teleport targets so Teleport to="#o2-page-actions" /
    // "#o2-page-title-trail" (the name input) don't error
    const teleportTarget = document.createElement("div");
    teleportTarget.id = "o2-page-actions";
    document.body.appendChild(teleportTarget);

    const titleTrailTarget = document.createElement("div");
    titleTrailTarget.id = "o2-page-title-trail";
    document.body.appendChild(titleTrailTarget);

    wrapper = mount(PipelineEditor, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          ODrawer: ODrawerStub,
          PipelineFlow: true,
          QueryForm: true,
          ConditionForm: true,
          AssociateFunction: true,
          StreamNode: true,
          ExternalDestination: true,
          ConfirmDialog: true,
          "confirm-dialog": true,
          OTooltip: true,
          Teleport: false,
        },
      },
    });
  });

  afterEach(async () => {
    await flushPromises();
    const teleportTarget = document.getElementById("o2-page-actions");
    if (teleportTarget) {
      teleportTarget.remove();
    }
    if (wrapper) {
      try {
        wrapper.vm.confirmDialogMeta.show = false;
        wrapper.vm.showJsonEditorDialog = false;
        wrapper.vm.confirmDialogBasicPipeline = false;
      } catch (_) {
        // ignore cleanup errors
      }
      wrapper.unmount();
      wrapper = null;
    }
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Component Mount and Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("initializes isPipelineSaving as false", () => {
      expect(wrapper.vm.isPipelineSaving).toBe(false);
    });

    it("initializes showJsonEditorDialog as false", () => {
      expect(wrapper.vm.showJsonEditorDialog).toBe(false);
    });

    it("initializes confirmDialogBasicPipeline as false", () => {
      expect(wrapper.vm.confirmDialogBasicPipeline).toBe(false);
    });

    it("initializes validationErrors as empty array", () => {
      expect(wrapper.vm.validationErrors).toEqual([]);
    });

    it("seeds the OForm name from the pipeline already loaded in the store at mount", () => {
      // Regression: `pipelineObj` is a module-level singleton that survives
      // navigation, so on re-editing a pipeline its name is already present at
      // mount (no post-mount change). The store→form watch is `immediate` so
      // metaForm is seeded here — otherwise a change-only watch never fires and
      // save wrongly reports "Pipeline name is required".
      expect(wrapper.vm.metaForm.state.values.name).toBe("test-pipeline");
    });

    it("initializes confirmDialogMeta as hidden", () => {
      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
    });

    it("exposes correct data attributes", () => {
      // These buttons are inside <Teleport to="#o2-page-actions">, query from document
      expect(
        document.querySelector('[data-test="pipeline-json-edit-btn"]')
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="add-pipeline-cancel-btn"]')
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="add-pipeline-save-btn"]')
      ).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("validatePipeline", () => {
    it("returns false when stream input targets enrichment_tables output", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { type: "input", data: { node_type: "stream" } },
        {
          type: "output",
          data: { node_type: "stream", stream_type: "enrichment_tables" },
        },
      ];
      expect(wrapper.vm.validatePipeline()).toBe(false);
    });

    it("returns true for valid stream-to-stream pipeline", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { type: "input", data: { node_type: "stream" } },
        {
          type: "output",
          data: { node_type: "stream", stream_type: "logs" },
        },
      ];
      expect(wrapper.vm.validatePipeline()).toBe(true);
    });

    it("returns true when input is query type (scheduled pipeline)", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { type: "input", data: { node_type: "query" } },
        {
          type: "output",
          data: { node_type: "stream", stream_type: "enrichment_tables" },
        },
      ];
      expect(wrapper.vm.validatePipeline()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Dialog Management", () => {
    it("openJsonEditor sets showJsonEditorDialog to true", () => {
      wrapper.vm.openJsonEditor();
      expect(wrapper.vm.showJsonEditorDialog).toBe(true);
    });

    it("resetDialog clears pipelineObj dialog and editing names", () => {
      mockPipelineObj.dialog.show = true;
      mockPipelineObj.dialog.name = "function";
      wrapper.vm.editingFunctionName = "testFunc";
      wrapper.vm.editingStreamRouteName = "testRoute";

      wrapper.vm.resetDialog();

      expect(mockPipelineObj.dialog.show).toBe(false);
      expect(mockPipelineObj.dialog.name).toBe("");
      expect(wrapper.vm.editingFunctionName).toBe("");
      expect(wrapper.vm.editingStreamRouteName).toBe("");
    });

    it("resetConfirmDialog clears all confirmDialogMeta fields", () => {
      wrapper.vm.confirmDialogMeta.show = true;
      wrapper.vm.confirmDialogMeta.title = "Title";
      wrapper.vm.confirmDialogMeta.message = "Message";
      wrapper.vm.confirmDialogMeta.data = { x: 1 };

      wrapper.vm.resetConfirmDialog();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
      expect(wrapper.vm.confirmDialogMeta.title).toBe("");
      expect(wrapper.vm.confirmDialogMeta.message).toBe("");
      expect(wrapper.vm.confirmDialogMeta.data).toBeNull();
    });

    it("openCancelDialog opens confirm dialog when pipeline is dirty", () => {
      mockPipelineObj.dirtyFlag = true;
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
      expect(wrapper.vm.confirmDialogMeta.title).toBeTruthy();
    });

    it("openCancelDialog navigates directly when pipeline is not dirty", async () => {
      const routerPushSpy = vi.spyOn(router, "push").mockImplementation(() => Promise.resolve());
      mockPipelineObj.dirtyFlag = false;
      mockPipelineObj.currentSelectedPipeline.nodes = [];
      mockPipelineObj.isEditPipeline = true;

      wrapper.vm.openCancelDialog();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
      routerPushSpy.mockRestore();
    });

    it("confirmSaveBasicPipeline closes the basic dialog and calls onSubmitPipeline", async () => {
      wrapper.vm.confirmDialogBasicPipeline = true;

      await wrapper.vm.confirmSaveBasicPipeline();
      await flushPromises();

      expect(wrapper.vm.confirmDialogBasicPipeline).toBe(false);
      // onSubmitPipeline delegates to the pipeline service
      expect(pipelineService.createPipeline).toHaveBeenCalled();
    });

    it("resetBasicDialog only closes the basic dialog and stays on the editor (no navigation)", async () => {
      const routerPushSpy = vi
        .spyOn(router, "push")
        .mockImplementation(() => Promise.resolve());
      wrapper.vm.confirmDialogBasicPipeline = true;

      wrapper.vm.resetBasicDialog();
      await flushPromises();

      expect(wrapper.vm.confirmDialogBasicPipeline).toBe(false);
      // Cancelling must NOT redirect to the pipelines listing.
      expect(routerPushSpy).not.toHaveBeenCalled();
      routerPushSpy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("findMissingEdges", () => {
    it("returns true when a non-default node has no edges", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "1", type: "input" },
        { id: "2", type: "output" },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [];
      expect(wrapper.vm.findMissingEdges()).toBe(true);
    });

    it("returns false when all nodes are connected", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "1", type: "input" },
        { id: "2", type: "output" },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "1", target: "2" },
      ];
      expect(wrapper.vm.findMissingEdges()).toBe(false);
    });

    it("returns true when a default-type node is missing an outgoing connection", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "1", type: "input" },
        { id: "2", type: "default" },
        { id: "3", type: "output" },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "1", target: "2" },
        // node 2 has no outgoing edge
      ];
      expect(wrapper.vm.findMissingEdges()).toBe(true);
    });

    it("returns false for a fully connected three-node pipeline", () => {
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "1", type: "input" },
        { id: "2", type: "default" },
        { id: "3", type: "output" },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "1", target: "2" },
        { source: "2", target: "3" },
      ];
      expect(wrapper.vm.findMissingEdges()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("isValidNodes", () => {
    it("returns true for a pipeline with more than 2 nodes", () => {
      const nodes = [
        { io_type: "input", data: { node_type: "stream" } },
        { io_type: "default", data: { node_type: "function" } },
        { io_type: "output", data: { node_type: "stream" } },
      ];
      expect(wrapper.vm.isValidNodes(nodes)).toBe(true);
    });

    it("returns false when input and output are the same stream", () => {
      const nodes = [
        {
          io_type: "input",
          data: { node_type: "stream", stream_name: "s1", stream_type: "logs" },
        },
        {
          io_type: "output",
          data: { node_type: "stream", stream_name: "s1", stream_type: "logs" },
        },
      ];
      expect(wrapper.vm.isValidNodes(nodes)).toBe(false);
    });

    it("returns true when input and output are different streams", () => {
      const nodes = [
        {
          io_type: "input",
          data: { node_type: "stream", stream_name: "in", stream_type: "logs" },
        },
        {
          io_type: "output",
          data: { node_type: "stream", stream_name: "out", stream_type: "logs" },
        },
      ];
      expect(wrapper.vm.isValidNodes(nodes)).toBe(true);
    });

    it("returns true when input is query type (non-stream)", () => {
      const nodes = [
        { io_type: "input", data: { node_type: "query" } },
        {
          io_type: "output",
          data: { node_type: "stream", stream_name: "out", stream_type: "logs" },
        },
      ];
      expect(wrapper.vm.isValidNodes(nodes)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("beforeUnloadHandler", () => {
    it("returns confirmation message when pipeline is dirty", () => {
      mockPipelineObj.dirtyFlag = true;
      const e = { returnValue: null };
      const result = wrapper.vm.beforeUnloadHandler(e);
      expect(e.returnValue).toBeTruthy();
      expect(result).toBeTruthy();
    });

    it("returns undefined when pipeline has no unsaved changes", () => {
      mockPipelineObj.dirtyFlag = false;
      mockPipelineObj.currentSelectedPipeline.nodes = [];
      mockPipelineObj.isEditPipeline = true;
      const e = { returnValue: null };
      const result = wrapper.vm.beforeUnloadHandler(e);
      expect(result).toBeUndefined();
    });

    it("returns confirmation message when new pipeline has nodes", () => {
      mockPipelineObj.dirtyFlag = false;
      mockPipelineObj.isEditPipeline = false;
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "1" },
        { id: "2" },
      ];
      const e = { returnValue: null };
      const result = wrapper.vm.beforeUnloadHandler(e);
      expect(result).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("savePipeline Validations", () => {
    beforeEach(async () => {
      wrapper.vm.onSubmitPipeline = vi.fn().mockResolvedValue(true);
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      vi.mocked(toast).mockClear();
    });

    it("shows error notification when pipeline name is empty", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "";
      await wrapper.vm.savePipeline();
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("required") })
      );
    });

    it("blocks the save when the pipeline name is empty", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "";
      await wrapper.vm.savePipeline();
      // OForm validation fails, so save never reaches the create call.
      expect(pipelineService.createPipeline).not.toHaveBeenCalled();
    });

    it("saves an edited pipeline whose name was only present at mount (no post-mount change)", async () => {
      // Regression: re-editing a pipeline leaves its name in the module-level
      // singleton store BEFORE mount, so there is no post-mount change to fire a
      // change-only watch. The name here ("test-pipeline") comes from the mount
      // fixture and is never reassigned — save must still clear name validation
      // and reach the update call instead of toasting "Pipeline name is required".
      mockPipelineObj.isEditPipeline = true;
      mockPipelineObj.currentSelectedPipeline.nodes = [
        {
          id: "n1",
          io_type: "input",
          type: "input",
          data: { node_type: "stream", stream_name: "in", stream_type: "logs" },
        },
        {
          id: "n2",
          io_type: "output",
          type: "output",
          data: { node_type: "stream", stream_name: "out", stream_type: "logs" },
        },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "n1", target: "n2" },
      ];

      await wrapper.vm.savePipeline();

      const { toast } = await import("@/lib/feedback/Toast/useToast");
      expect(toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("required") })
      );
      expect(pipelineService.updatePipeline).toHaveBeenCalled();
    });

    it("shows error notification when source node is missing", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { io_type: "output", data: { node_type: "stream" } },
      ];
      await wrapper.vm.savePipeline();
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
      );
    });

    it("shows error notification when destination node is missing", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { io_type: "input", data: { node_type: "stream" } },
      ];
      await wrapper.vm.savePipeline();
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
      );
    });

    it("shows error when nodes are not connected via edges", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "n1", io_type: "input", type: "input", data: { node_type: "stream" } },
        { id: "n2", io_type: "output", type: "output", data: { node_type: "stream" } },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [];
      await wrapper.vm.savePipeline();
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
      );
    });

    it("sets source_type to realtime when input node is stream", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        {
          id: "n1",
          io_type: "input",
          type: "input",
          data: { node_type: "stream" },
        },
        {
          id: "n2",
          io_type: "output",
          type: "output",
          data: { node_type: "stream" },
        },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "n1", target: "n2" },
      ];

      wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
      wrapper.vm.isValidNodes = vi.fn().mockReturnValue(true);

      await wrapper.vm.savePipeline();

      expect(
        mockPipelineObj.currentSelectedPipeline.source.source_type
      ).toBe("realtime");
    });

    it("sets source_type to scheduled when input node is query", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        {
          id: "n1",
          io_type: "input",
          type: "input",
          data: { node_type: "query" },
        },
        {
          id: "n2",
          io_type: "output",
          type: "output",
          data: { node_type: "stream" },
        },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "n1", target: "n2" },
      ];

      wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
      wrapper.vm.isValidNodes = vi.fn().mockReturnValue(true);

      await wrapper.vm.savePipeline();

      expect(
        mockPipelineObj.currentSelectedPipeline.source.source_type
      ).toBe("scheduled");
    });

    it("shows basic pipeline confirmation dialog when isValidNodes returns false", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        { id: "n1", io_type: "input", type: "input", data: { node_type: "stream" } },
        { id: "n2", io_type: "output", type: "output", data: { node_type: "stream" } },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "n1", target: "n2" },
      ];

      wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
      wrapper.vm.isValidNodes = vi.fn().mockReturnValue(false);
      wrapper.vm.showJsonEditorDialog = false;

      await wrapper.vm.savePipeline();

      expect(wrapper.vm.confirmDialogBasicPipeline).toBe(true);
    });

    it("sets isPipelineSaving to true when all validations pass and calls onSubmitPipeline", async () => {
      mockPipelineObj.currentSelectedPipeline.name = "my-pipeline";
      mockPipelineObj.currentSelectedPipeline.nodes = [
        {
          id: "n1",
          io_type: "input",
          type: "input",
          data: { node_type: "stream", stream_name: "in", stream_type: "logs" },
        },
        {
          id: "n2",
          io_type: "output",
          type: "output",
          data: { node_type: "stream", stream_name: "out", stream_type: "logs" },
        },
      ];
      mockPipelineObj.currentSelectedPipeline.edges = [
        { source: "n1", target: "n2" },
      ];

      await wrapper.vm.savePipeline();

      expect(wrapper.vm.isPipelineSaving).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("savePipelineJson", () => {
    it("sets validationErrors to ['Invalid JSON format'] for malformed JSON", async () => {
      await wrapper.vm.savePipelineJson("{ invalid json }");
      expect(wrapper.vm.validationErrors).toEqual(["Invalid JSON format"]);
    });

    it("clears validationErrors for valid JSON", async () => {
      wrapper.vm.validationErrors = ["some error"];
      wrapper.vm.savePipeline = vi.fn().mockResolvedValue(undefined);

      const validJson = JSON.stringify({
        name: "test",
        nodes: [],
        edges: [],
        source: { source_type: "realtime" },
      });

      await wrapper.vm.savePipelineJson(validJson);

      expect(wrapper.vm.validationErrors).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("ODrawer Migration", () => {
    it("renders the JSON-editor ODrawer instance", () => {
      const drawers = wrapper.findAllComponents(ODrawerStub);
      expect(drawers.length).toBe(1);
    });

    it("JSON-editor ODrawer is closed by default and uses width 70, persistent=true", () => {
      const drawers = wrapper.findAllComponents(ODrawerStub);
      const jsonDrawer = drawers[0];

      expect(jsonDrawer.props("open")).toBe(false);
      expect(jsonDrawer.props("width")).toBe(70);
      expect(jsonDrawer.props("persistent")).toBe(true);
      // showClose is not explicitly set on the ODrawer, defaults to true
      expect(jsonDrawer.props("showClose")).toBe(true);
    });

    it("JSON-editor ODrawer opens when openJsonEditor() is invoked", async () => {
      wrapper.vm.openJsonEditor();
      await flushPromises();

      const drawers = wrapper.findAllComponents(ODrawerStub);
      expect(drawers[0].props("open")).toBe(true);
    });

    it("JSON-editor ODrawer update:open=false closes the JSON editor", async () => {
      wrapper.vm.showJsonEditorDialog = true;
      await flushPromises();

      const drawers = wrapper.findAllComponents(ODrawerStub);
      await drawers[0].vm.$emit("update:open", false);
      await flushPromises();

      expect(wrapper.vm.showJsonEditorDialog).toBe(false);
    });

    it("clicking pipeline-json-edit-btn opens the JSON-editor ODrawer", async () => {
      // Button is inside <Teleport to="#o2-page-actions">, query from document
      const btn = document.querySelector('[data-test="pipeline-json-edit-btn"]');
      expect(btn).not.toBeNull();
      btn.click();
      await flushPromises();

      const drawers = wrapper.findAllComponents(ODrawerStub);
      expect(drawers[0].props("open")).toBe(true);
      expect(wrapper.vm.showJsonEditorDialog).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Method Exposure", () => {
    it("exposes all required methods", () => {
      const required = [
        "validatePipeline",
        "savePipeline",
        "savePipelineJson",
        "openCancelDialog",
        "resetConfirmDialog",
        "resetDialog",
        "openJsonEditor",
        "findMissingEdges",
        "isValidNodes",
        "beforeUnloadHandler",
        "confirmSaveBasicPipeline",
      ];
      required.forEach((m) => {
        expect(typeof wrapper.vm[m]).toBe("function");
      });
    });
  });
});
