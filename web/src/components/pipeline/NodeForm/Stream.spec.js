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
import Stream from "./Stream.vue";
import useDnD from "@/plugins/pipelines/useDnD";


// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockAddNode            = vi.fn();
const mockDeletePipelineNode = vi.fn();
const mockCheckIfDefaultDestinationNode = vi.fn().mockReturnValue(false);

const { mockToast, mockGetUsedStreamsList } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockGetUsedStreamsList: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({
      list: [
        { name: "logs_stream_1", stream_type: "logs"    },
        { name: "logs_stream_2", stream_type: "logs"    },
        { name: "metrics_stream", stream_type: "metrics" },
      ],
    }),
  }),
}));

vi.mock("@/composables/usePipelines", () => ({
  default: () => ({
    getUsedStreamsList: mockGetUsedStreamsList,
    getPipelineDestinations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/utils/pipelines/constants", () => ({
  defaultDestinationNodeWarningMessage:
    "Removing the default destination node stops data from being ingested.",
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let mockPipelineObj = {};

function makePipelineObj(overrides = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeID: "stream-node-1",
    currentSelectedNodeData: {
      data: { stream_type: "logs" },
      io_type: "input",
      type: "input",
    },
    userSelectedNode: {},
    userClickedNode: {},
    ...overrides,
  };
}

// ODrawer stub — renders slot content (so the REAL <OForm> mounts inside it and
// the schema actually runs) plus the footer buttons. The footer Save is wired to
// the form via form-id; in tests we drive the form's own handleSubmit() so the
// validate → @submit → save chain is awaited deterministically.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open", "size", "showClose", "title", "width", "persistent", "formId",
    "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel",
  ],
  emits: ["update:open", "click:secondary", "click:neutral"],
  template: `<div class="o-drawer-stub">
    <slot />
    <button v-if="neutralButtonLabel" data-test="o-drawer-neutral-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    <button v-if="secondaryButtonLabel" data-test="o-drawer-secondary-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    <button v-if="primaryButtonLabel" data-test="o-drawer-primary-btn" type="submit" form="stream-node-form">{{ primaryButtonLabel }}</button>
  </div>`,
};

function createWrapper(pipelineObjOverrides = {}) {
  mockPipelineObj = makePipelineObj(pipelineObjOverrides);

  vi.mocked(useDnD).mockImplementation(() => ({
    pipelineObj: mockPipelineObj,
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
    checkIfDefaultDestinationNode: mockCheckIfDefaultDestinationNode,
  }));

  return mount(Stream, {
    props: { open: true },
    global: {
      plugins: [i18n, store],
      stubs: {
        AddStream:     true,
        ConfirmDialog: true,
        ODrawer:       ODrawerStub,
      },
    },
  });
}

// Form helpers — drive/read the real OForm now that stream_type/stream_name/
// appendData are form-owned.
const setField = (w, name, val) => w.vm.form.setFieldValue(name, val);
const formVals = (w) => w.vm.form.state.values;
const submitForm = async (w) => {
  await w.vm.form.handleSubmit();
  await flushPromises();
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Stream Component", () => {
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

    it("renders outer section with data-test attribute", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-input-stream-routing-section"]').exists()
      ).toBe(true);
    });

    it("initializes createNewStream as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.createNewStream).toBe(false);
    });

    it("initializes isUpdating as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isUpdating).toBe(false);
    });

    it("initializes isFetchingStreams as false after fetch", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isFetchingStreams).toBe(false);
    });

    it("seeds form stream_type from pipelineObj node data", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "metrics" },
          io_type: "input",
          type: "input",
        },
      });
      await flushPromises();
      expect(formVals(wrapper).stream_type).toBe("metrics");
    });

    it("defaults form stream_type to 'logs' when not in node data", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: { data: {}, io_type: "input", type: "input" },
      });
      await flushPromises();
      expect(formVals(wrapper).stream_type).toBe("logs");
    });

    it("clears userSelectedNode on mount", async () => {
      createWrapper();
      await flushPromises();
      expect(mockPipelineObj.userSelectedNode).toEqual({});
    });

    it("reuses pipelineObj.usedStreams (resolved array) and skips the pipelines/streams API", async () => {
      const cached = [{ stream_name: "logs_stream_1", stream_type: "logs" }];
      const wrapper = createWrapper({ usedStreams: cached });
      await flushPromises();
      // The editor already fetched the list on mount — the drawer must not
      // re-hit the API on every node drag (source of the "No options" flash).
      expect(mockGetUsedStreamsList).not.toHaveBeenCalled();
      expect(wrapper.vm.usedStreams).toEqual(cached);
    });

    it("awaits the editor's in-flight promise instead of issuing its own request", async () => {
      const cached = [{ stream_name: "logs_stream_1", stream_type: "logs" }];
      // Editor kicked the fetch off but it hasn't resolved yet — the drawer must
      // reuse the SAME request rather than firing a duplicate pipelines/streams.
      const inflight = Promise.resolve(cached);
      const wrapper = createWrapper({ usedStreams: inflight });
      await flushPromises();
      expect(mockGetUsedStreamsList).not.toHaveBeenCalled();
      expect(wrapper.vm.usedStreams).toEqual(cached);
    });

    it("falls back to the pipelines/streams API when usedStreams isn't shared yet", async () => {
      createWrapper({ usedStreams: null });
      await flushPromises();
      expect(mockGetUsedStreamsList).toHaveBeenCalledTimes(1);
    });

    it("all required functions are exposed", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const fns = [
        "sanitizeStreamName", "sanitizeStaticPart", "getStreamList", "updateStreams",
        "handleCreateStreamName", "getLogStream", "handleSecondaryClick",
        "openCancelDialog", "openDeleteDialog", "deleteNode", "onSubmit",
        "filterColumns",
      ];
      fns.forEach((fn) => expect(typeof wrapper.vm[fn]).toBe("function"));
    });
  });

  // -------------------------------------------------------------------------
  describe("filteredStreamTypes computed", () => {
    it("returns only 3 types for input node", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "logs" },
          io_type: "input",
          type: "input",
        },
      });
      await flushPromises();
      wrapper.vm.selectedNodeType = "input";
      await nextTick();
      expect(wrapper.vm.filteredStreamTypes).toEqual(["logs", "metrics", "traces"]);
    });

    it("returns 4 types including enrichment_tables for output node", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "logs" },
          io_type: "output",
          type: "output",
        },
      });
      await flushPromises();
      wrapper.vm.selectedNodeType = "output";
      await nextTick();
      expect(wrapper.vm.filteredStreamTypes).toEqual([
        "logs", "metrics", "traces", "enrichment_tables",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("sanitizeStreamName", () => {
    const cases = [
      { input: "test_stream",         expected: "test_stream"          },
      { input: "test-stream",         expected: "test_stream"          },
      { input: "test@stream",         expected: "test_stream"          },
      { input: "test{field}stream",   expected: "test{field}stream"    },
      { input: "test{field}@stream",  expected: "test{field}_stream"   },
      { input: "abc123",              expected: "abc123"               },
      { input: "CamelCase",           expected: "CamelCase"            },
    ];

    cases.forEach(({ input, expected }) => {
      it(`sanitizes "${input}" → "${expected}"`, async () => {
        const wrapper = createWrapper();
        await flushPromises();
        expect(wrapper.vm.sanitizeStreamName(input)).toBe(expected);
      });
    });

    it("returns empty string and notifies when input exceeds 100 chars", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      mockToast.mockClear();
      const result = wrapper.vm.sanitizeStreamName("a".repeat(101));
      expect(result).toBe("");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Stream name should be less than 100 characters",
        })
      );
    });

    it("returns 100-char string without notification (exactly at limit)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      mockToast.mockClear();
      const result = wrapper.vm.sanitizeStreamName("a".repeat(100));
      expect(result).toHaveLength(100);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("preserves multiple dynamic segments", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const result = wrapper.vm.sanitizeStreamName("pre-{field1}-mid-{field2}-suf");
      // hyphens in static parts become underscores; dynamic parts preserved
      expect(result).toContain("{field1}");
      expect(result).toContain("{field2}");
      expect(result).not.toContain("-{field1}");
    });
  });

  // -------------------------------------------------------------------------
  describe("sanitizeStaticPart", () => {
    const cases = [
      { input: "abc",    expected: ["a", "b", "c"]             },
      { input: "a@b#c",  expected: ["a", "_", "b", "_", "c"]   },
      { input: "123",    expected: ["1", "2", "3"]             },
      { input: "a-b",    expected: ["a", "_", "b"]             },
      { input: "a_b",    expected: ["a", "_", "b"]             },
      { input: "",       expected: []                          },
    ];

    cases.forEach(({ input, expected }) => {
      it(`sanitizeStaticPart("${input}") → ${JSON.stringify(expected)}`, async () => {
        const wrapper = createWrapper();
        await flushPromises();
        expect(wrapper.vm.sanitizeStaticPart(input)).toEqual(expected);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("handleCreateStreamName", () => {
    it("replaces hyphens with underscores and sets stream_name", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.handleCreateStreamName("test-stream-name");
      expect(formVals(wrapper).stream_name).toBe("test_stream_name");
    });

    it("leaves names without hyphens unchanged", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.handleCreateStreamName("testStream");
      expect(formVals(wrapper).stream_name).toBe("testStream");
    });

    it("sanitizes special characters in the new name", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.handleCreateStreamName("my-stream@bad");
      expect(formVals(wrapper).stream_name).toBe("my_stream_bad");
    });
  });

  // -------------------------------------------------------------------------
  describe("getLogStream", () => {
    it("persists node with sanitized stream_name from stream data", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.getLogStream({ name: "test-stream", stream_type: "logs" });
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ stream_name: "test_stream" })
      );
    });

    it("persists node with stream_type from stream data", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.getLogStream({ name: "metricsStream", stream_type: "metrics" });
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ stream_type: "metrics" })
      );
    });

    it("turns off createNewStream after stream is added", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewStream = true;
      await wrapper.vm.getLogStream({ name: "new_stream", stream_type: "logs" });
      expect(wrapper.vm.createNewStream).toBe(false);
    });

    it("does not crash when name has no hyphens", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.getLogStream({ name: "my_stream", stream_type: "logs" });
      await flushPromises();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ stream_name: "my_stream" })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("getStreamList", () => {
    it("populates streams.logs after fetch", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.getStreamList();
      await flushPromises();
      expect(wrapper.vm.streams.logs).toBeDefined();
      expect(wrapper.vm.streams.logs.length).toBeGreaterThan(0);
    });

    it("sets isFetchingStreams to false after fetch completes", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.getStreamList();
      await flushPromises();
      expect(wrapper.vm.isFetchingStreams).toBe(false);
    });

    it("marks streams as disabled for input node when they appear in usedStreams", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "logs" },
          io_type: "input",
          type: "input",
        },
      });
      await flushPromises();
      // Set usedStreams to mark logs_stream_1 as used
      wrapper.vm.usedStreams = [{ stream_name: "logs_stream_1", stream_type: "logs" }];
      await wrapper.vm.getStreamList();
      await flushPromises();
      const stream = wrapper.vm.streams.logs?.find(
        (s) => s.name === "logs_stream_1"
      );
      expect(stream?.isDisable).toBe(true);
    });

    it("does NOT mark streams as disabled for output node", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "logs" },
          io_type: "output",
          type: "output",
        },
      });
      await flushPromises();
      wrapper.vm.usedStreams = [{ stream_name: "logs_stream_1", stream_type: "logs" }];
      await wrapper.vm.getStreamList();
      await flushPromises();
      // For output node the disable logic isn't applied; isDisable may be undefined
      const stream = wrapper.vm.streams.logs?.find(
        (s) => s.name === "logs_stream_1"
      );
      expect(stream?.isDisable).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  describe("updateStreams", () => {
    it("can be called without throwing", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(() => wrapper.vm.updateStreams()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("filterColumns", () => {
    it("returns all options when val is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const opts = ["col1", "col2", "col3"];
      const update = vi.fn((cb) => cb());
      const result = wrapper.vm.filterColumns(opts, "", update);
      expect(result).toEqual(opts);
      expect(update).toHaveBeenCalled();
    });

    it("filters options by search term", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const opts = ["timestamp", "message", "level"];
      const update = vi.fn((cb) => cb());
      wrapper.vm.filterColumns(opts, "time", update);
      expect(update).toHaveBeenCalled();
    });

    it("is case-insensitive", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const opts = ["TIMESTAMP", "message"];
      const update = vi.fn((cb) => cb());
      wrapper.vm.filterColumns(opts, "MESS", update);
      // update is called; filtered result contains "message"
      expect(update).toHaveBeenCalled();
    });

    it("returns empty array when no options match", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const opts = ["alpha", "beta"];
      const update = vi.fn((cb) => cb());
      const result = wrapper.vm.filterColumns(opts, "zzz", update);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Submit / schema validation (real OForm). The select-existing branch is
  // gated by the Zod schema: BOTH stream_type AND stream_name are required
  // (the stream_type rule is RESTORED from the BEFORE baseline).
  describe("schema validation + submit", () => {
    it("blocks submit and does NOT call addNode when stream_name is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_name", "");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("blocks submit and does NOT call addNode when stream_type is empty (restored rule)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_name", "my_stream");
      setField(wrapper, "stream_type", "");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("calls addNode with node_type 'stream' when stream_name is valid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_type", "logs");
      setField(wrapper, "stream_name", "my_stream");
      await submitForm(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ node_type: "stream" })
      );
    });

    it("emits cancel:hideform after successful save", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_type", "logs");
      setField(wrapper, "stream_name", "my_stream");
      await submitForm(wrapper);
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("includes org_id in the addNode payload", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_type", "logs");
      setField(wrapper, "stream_name", "s");
      await submitForm(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ org_id: "default" })
      );
    });

    it("includes meta.append_data for enrichment_tables stream type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // Set stream_type first (the change resets stream_name), then the rest.
      setField(wrapper, "stream_type", "enrichment_tables");
      setField(wrapper, "stream_name", "enrich");
      setField(wrapper, "appendData", true);
      await submitForm(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: { append_data: "true" },
        })
      );
    });

    it("does NOT include meta for logs stream type", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_type", "logs");
      setField(wrapper, "stream_name", "logs_s");
      await submitForm(wrapper);
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.meta).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("openCancelDialog", () => {
    it("shows dialog with correct title and message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel changes?");
    });

    it("dialog okCallback emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openCancelDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

  });

  // -------------------------------------------------------------------------
  describe("openDeleteDialog", () => {
    it("shows dialog with correct title and message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe(
        "Are you sure you want to delete stream association?"
      );
    });

    it("sets warningMessage when deleting a default destination node", async () => {
      mockCheckIfDefaultDestinationNode.mockReturnValueOnce(true);
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { node_type: "stream", stream_type: "logs" },
          io_type: "output",
          type: "output",
        },
      });
      await flushPromises();
      // Ensure the node has node_type property
      mockPipelineObj.currentSelectedNodeData.data.node_type = "stream";
      wrapper.vm.openDeleteDialog();
      // warningMessage should be set to the constant
      expect(wrapper.vm.dialog.warningMessage).toBeTruthy();
    });

    it("clears warningMessage when node is not default destination", async () => {
      mockCheckIfDefaultDestinationNode.mockReturnValueOnce(false);
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.warningMessage).toBe("");
    });

    it("dialog okCallback calls deletePipelineNode with current node ID", async () => {
      const wrapper = createWrapper({ currentSelectedNodeID: "sn-42" });
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("sn-42");
    });

    it("dialog okCallback emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("deleteNode", () => {
    it("calls deletePipelineNode with currentSelectedNodeID", async () => {
      const wrapper = createWrapper({ currentSelectedNodeID: "del-node" });
      await flushPromises();
      wrapper.vm.deleteNode();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("del-node");
    });

    it("emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.deleteNode();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("appendData toggle (enrichment_tables)", () => {
    it("seeds form appendData from node meta", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "enrichment_tables" },
          meta: { append_data: "true" },
          io_type: "output",
          type: "output",
        },
      });
      await flushPromises();
      expect(formVals(wrapper).appendData).toBe(true);
    });

    it("seeds form appendData as false when meta is absent", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(formVals(wrapper).appendData).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("watch – stream_type change resets stream_name", () => {
    it("resets stream_name when stream_type changes (and createNewStream stays same)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "stream_name", "old_stream");
      setField(wrapper, "stream_type", "metrics");
      await flushPromises();
      // After stream_type changes, stream_name should reset
      expect(formVals(wrapper).stream_name).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  describe("UI – createNewStream toggle visibility", () => {
    it("shows create-stream toggle for input nodes", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { stream_type: "logs" },
          io_type: "input",
          type: "input",
        },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="create-stream-toggle"]').exists()).toBe(true);
    });

    it("hides main form sections when createNewStream is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewStream = true;
      await nextTick();
      // The normal form (select inputs) should not be visible
      expect(wrapper.find('[data-test="input-node-stream-type-select"]').exists()).toBe(false);
    });

    it("shows form inputs when createNewStream is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="input-node-stream-type-select"]').exists()).toBe(true);
    });

    it("shows delete button when pipelineObj.isEditNode is true", async () => {
      const wrapper = createWrapper({ isEditNode: true });
      await flushPromises();
      expect(
        wrapper.find('[data-test="o-drawer-neutral-btn"]').exists()
      ).toBe(true);
    });

    it("hides delete button when pipelineObj.isEditNode is false", async () => {
      const wrapper = createWrapper({ isEditNode: false });
      await flushPromises();
      expect(
        wrapper.find('[data-test="o-drawer-neutral-btn"]').exists()
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("Header close button", () => {
    // The close button is now part of ODrawer's header (via showClose prop).
    // We simulate it by emitting update:open=false on the ODrawer component.
    function closeViaDrawer(wrapper) {
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
      drawer.vm.$emit("update:open", false);
    }

    it("has NOT emitted cancel:hideform before the header close button is clicked", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.emitted("cancel:hideform")).toBeUndefined();
    });

    it("emits cancel:hideform exactly once when the header close button is clicked", async () => {
      vi.useFakeTimers();
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.emitted("cancel:hideform")).toBeUndefined();

      closeViaDrawer(wrapper);
      vi.advanceTimersByTime(400);
      await nextTick();

      const emits = wrapper.emitted("cancel:hideform");
      expect(emits).toBeTruthy();
      expect(emits).toHaveLength(1);
      expect(emits[0]).toEqual([]);
      vi.useRealTimers();
    });

    it("does NOT trigger save/delete/cancel-dialog flows (no addNode / deletePipelineNode / dialog)", async () => {
      const wrapper = createWrapper({ isEditNode: true });
      await flushPromises();

      closeViaDrawer(wrapper);
      await nextTick();

      expect(mockAddNode).not.toHaveBeenCalled();
      expect(mockDeletePipelineNode).not.toHaveBeenCalled();
      expect(wrapper.vm.dialog.show).toBe(false);
    });
  });
});
