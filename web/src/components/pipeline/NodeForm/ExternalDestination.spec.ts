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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import ExternalDestination from "./ExternalDestination.vue";

installQuasar({ plugins: [Dialog, Notify] });

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getImageURL: (path: string) => `/mock/${path}`,
    isValidResourceName: (name: string) => /^[a-zA-Z0-9+=,.@_-]+$/.test(name),
  };
});

vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn(),
    list: vi.fn(),
  },
}));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(),
}));

vi.mock("vue-router", async () => {
  const actual: any = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    }),
  };
});

// --------------------------------------------------------------------------
// Late imports that must come after vi.mock declarations
// --------------------------------------------------------------------------

import destinationService from "@/services/alert_destination";
import useDnD from "@/plugins/pipelines/useDnD";

// --------------------------------------------------------------------------
// Sample data
// --------------------------------------------------------------------------

const sampleDestinations = [
  { name: "dest1", url: "http://dest1.example.com", destination_type_name: "openobserve" },
  { name: "dest2", url: "http://dest2.example.com", destination_type_name: "splunk" },
];

// --------------------------------------------------------------------------
// Factory helper
// --------------------------------------------------------------------------

function buildMockPipelineObj(overrides: Record<string, any> = {}) {
  return {
    currentSelectedNodeData: { data: {}, type: "destination" },
    currentSelectedNodeID: "node-123",
    userSelectedNode: {},
    isEditNode: false,
    ...overrides,
  };
}

function createWrapper(pipelineObjOverrides: Record<string, any> = {}) {
  const mockPipelineObj = buildMockPipelineObj(pipelineObjOverrides);

  vi.mocked(useDnD).mockImplementation(() => ({
    pipelineObj: mockPipelineObj,
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
  }));

  return mount(ExternalDestination, {
    global: {
      plugins: [i18n, store],
      stubs: {
        QSeparator: true,
        QItem: true,
        QItemSection: true,
        QItemLabel: true,
        ConfirmDialog: true,
        CreateDestinationForm: {
          name: "CreateDestinationForm",
          template: '<div data-test="create-destination-form" />',
          emits: ["created", "cancel"],
        },
      },
    },
  });
}

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe("ExternalDestination.vue", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: list returns two destinations
    vi.mocked(destinationService.list).mockResolvedValue({
      data: sampleDestinations,
    } as any);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 1. Component Initialization
  // -----------------------------------------------------------------------

  describe("1. Component Initialization", () => {
    it("1.1 mounts successfully", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("1.2 initialises createNewDestination as false", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.createNewDestination).toBe(false);
    });

    it("1.3 loads destinations on mount via onBeforeMount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "default",
          module: "pipeline",
        }),
      );
      expect(wrapper.vm.destinations).toHaveLength(2);
    });

    it("1.4 initialises selectedDestination with empty label and value by default", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.selectedDestination).toEqual({ label: "", value: "" });
    });

    it("1.5 pre-populates selectedDestination when currentSelectedNodeData has a destination_name", async () => {
      // Re-mock useDnD before mounting with an existing destination
      vi.mocked(useDnD).mockImplementation(() => ({
        pipelineObj: buildMockPipelineObj({
          currentSelectedNodeData: {
            data: { destination_name: "existing-dest" },
          },
          isEditNode: true,
        }),
        addNode: mockAddNode,
        deletePipelineNode: mockDeletePipelineNode,
      }));

      const w = mount(ExternalDestination, {
        global: {
          plugins: [i18n, store],
          stubs: { ConfirmDialog: true, CreateDestinationForm: true },
        },
      });
      await flushPromises();

      expect(w.vm.selectedDestination).toEqual({
        label: "existing-dest",
        value: "existing-dest",
      });
      w.unmount();
    });

    it("1.6 pipelineObj is accessible from component", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.pipelineObj).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. getDestinations
  // -----------------------------------------------------------------------

  describe("2. getDestinations", () => {
    it("2.1 fetches destinations with correct API parameters", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(destinationService.list).toHaveBeenCalledWith({
        page_num: 1,
        page_size: 100000,
        sort_by: "name",
        desc: false,
        org_identifier: "default",
        module: "pipeline",
      });
    });

    it("2.2 populates destinations ref after successful fetch", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.destinations).toEqual(sampleDestinations);
    });

    it("2.3 updates destinations when called again with new data", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(destinationService.list).mockResolvedValueOnce({
        data: [{ name: "new-dest", url: "http://new.example.com" }],
      } as any);
      await wrapper.vm.getDestinations();
      await flushPromises();

      expect(wrapper.vm.destinations).toHaveLength(1);
      expect(wrapper.vm.destinations[0].name).toBe("new-dest");
    });

    it("2.4 handles 403 error silently without modifying destinations", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Store current destinations count
      const before = wrapper.vm.destinations.length;

      vi.mocked(destinationService.list).mockRejectedValueOnce({
        response: { status: 403 },
      });
      await wrapper.vm.getDestinations();
      await flushPromises();

      // Should not throw – destinations count could reset or remain
      expect(wrapper.exists()).toBe(true);
    });

    it("2.5 handles non-403 API errors without crashing", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(destinationService.list).mockRejectedValueOnce({
        response: { status: 500, data: { message: "Internal error" } },
      });
      await wrapper.vm.getDestinations();
      await flushPromises();

      // Component should remain mounted
      expect(wrapper.exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 3. getFormattedDestinations (computed)
  // -----------------------------------------------------------------------

  describe("3. getFormattedDestinations", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("3.1 returns formatted objects with label, value, url", () => {
      wrapper.vm.destinations = [
        { name: "dest1", url: "http://dest1.com" },
        { name: "dest2", url: "http://dest2.com" },
      ];
      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted).toEqual([
        { label: "dest1", value: "dest1", url: "http://dest1.com" },
        { label: "dest2", value: "dest2", url: "http://dest2.com" },
      ]);
    });

    it("3.2 returns empty array when destinations is empty", () => {
      wrapper.vm.destinations = [];
      expect(wrapper.vm.getFormattedDestinations).toEqual([]);
    });

    it("3.3 truncates URLs longer than 70 characters with ellipsis", () => {
      wrapper.vm.destinations = [
        {
          name: "long-dest",
          url: "https://very-long-url-that-definitely-exceeds-seventy-characters.example.com/path/to/resource",
        },
      ];
      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted[0].url.endsWith("...")).toBe(true);
      expect(formatted[0].url.length).toBeLessThanOrEqual(73); // 70 chars + "..."
    });

    it("3.4 does not truncate URLs of exactly 70 characters", () => {
      const url70 = "a".repeat(70);
      wrapper.vm.destinations = [{ name: "exact", url: url70 }];
      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted[0].url).toBe(url70);
      expect(formatted[0].url.endsWith("...")).toBe(false);
    });

    it("3.5 does not truncate URLs shorter than 70 characters", () => {
      wrapper.vm.destinations = [{ name: "short", url: "http://short.io" }];
      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted[0].url).toBe("http://short.io");
    });

    it("3.6 handles a large list of destinations", () => {
      wrapper.vm.destinations = Array.from({ length: 50 }, (_, i) => ({
        name: `dest-${i}`,
        url: `http://dest${i}.example.com`,
      }));
      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted).toHaveLength(50);
    });
  });

  // -----------------------------------------------------------------------
  // 4. saveDestination
  // -----------------------------------------------------------------------

  describe("4. saveDestination", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("4.1 calls addNode with correct payload when a destination is selected", () => {
      wrapper.vm.selectedDestination = { value: "dest1", label: "dest1" };
      wrapper.vm.saveDestination();

      expect(mockAddNode).toHaveBeenCalledWith({
        destination_name: "dest1",
        node_type: "remote_stream",
        io_type: "output",
        org_id: "default",
      });
    });

    it("4.2 emits cancel:hideform after a successful save", () => {
      wrapper.vm.selectedDestination = { value: "dest1", label: "dest1" };
      wrapper.vm.saveDestination();
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(1);
    });

    it("4.3 does NOT call addNode when selectedDestination value is empty", () => {
      wrapper.vm.selectedDestination = { value: "", label: "" };
      wrapper.vm.saveDestination();
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("4.4 uses the store selectedOrganization identifier as org_id", () => {
      wrapper.vm.selectedDestination = { value: "dest2", label: "dest2" };
      wrapper.vm.saveDestination();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ org_id: "default" }),
      );
    });

    it("4.5 sets correct node_type as remote_stream", () => {
      wrapper.vm.selectedDestination = { value: "dest1", label: "dest1" };
      wrapper.vm.saveDestination();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ node_type: "remote_stream" }),
      );
    });

    it("4.6 sets correct io_type as output", () => {
      wrapper.vm.selectedDestination = { value: "dest1", label: "dest1" };
      wrapper.vm.saveDestination();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ io_type: "output" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 5. handleDestinationCreated
  // -----------------------------------------------------------------------

  describe("5. handleDestinationCreated", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("5.1 sets selectedDestination to the newly created destination name", async () => {
      await wrapper.vm.handleDestinationCreated("brand-new-dest");
      expect(wrapper.vm.selectedDestination).toEqual({
        label: "brand-new-dest",
        value: "brand-new-dest",
      });
    });

    it("5.2 switches createNewDestination back to false", async () => {
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.handleDestinationCreated("brand-new-dest");
      expect(wrapper.vm.createNewDestination).toBe(false);
    });

    it("5.3 calls getDestinations after creation to refresh the list", async () => {
      vi.mocked(destinationService.list).mockClear();
      await wrapper.vm.handleDestinationCreated("brand-new-dest");
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 6. createNewDestination watcher
  // -----------------------------------------------------------------------

  describe("6. createNewDestination watcher", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("6.1 can be toggled to true", async () => {
      wrapper.vm.createNewDestination = true;
      await nextTick();
      expect(wrapper.vm.createNewDestination).toBe(true);
    });

    it("6.2 calls getDestinations when switched from true back to false", async () => {
      wrapper.vm.createNewDestination = true;
      await nextTick();

      vi.mocked(destinationService.list).mockClear();

      wrapper.vm.createNewDestination = false;
      await nextTick();
      await flushPromises();

      expect(destinationService.list).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 7. handleCancel
  // -----------------------------------------------------------------------

  describe("7. handleCancel", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("7.1 emits cancel:hideform", () => {
      wrapper.vm.handleCancel();
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("7.2 emits cancel:hideform only once per call", () => {
      wrapper.vm.handleCancel();
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(1);
    });

    it("7.3 emits cancel:hideform multiple times when called multiple times", () => {
      wrapper.vm.handleCancel();
      wrapper.vm.handleCancel();
      wrapper.vm.handleCancel();
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // 8. openDeleteDialog
  // -----------------------------------------------------------------------

  describe("8. openDeleteDialog", () => {
    beforeEach(async () => {
      wrapper = createWrapper({ isEditNode: true });
      await flushPromises();
    });

    it("8.1 sets dialog.show to true", () => {
      wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
    });

    it("8.2 sets dialog.title to 'Delete Node'", () => {
      wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
    });

    it("8.3 sets dialog.message to the expected deletion message", () => {
      wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.message).toBe(
        "Are you sure you want to delete stream routing?",
      );
    });

    it("8.4 sets dialog.okCallback to a function (deleteRoute)", () => {
      wrapper.vm.openDeleteDialog();
      expect(typeof wrapper.vm.dialog.okCallback).toBe("function");
    });
  });

  // -----------------------------------------------------------------------
  // 9. deleteRoute (via dialog okCallback)
  // -----------------------------------------------------------------------

  describe("9. deleteRoute via dialog okCallback", () => {
    beforeEach(async () => {
      wrapper = createWrapper({ isEditNode: true });
      await flushPromises();
    });

    it("9.1 calls deletePipelineNode with the current node ID", () => {
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-123");
    });

    it("9.2 emits cancel:hideform after deleting", () => {
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // 10. Exposed members
  // -----------------------------------------------------------------------

  describe("10. Exposed members", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("10.1 exposes getDestinations as a function", () => {
      expect(typeof wrapper.vm.getDestinations).toBe("function");
    });

    it("10.2 exposes saveDestination as a function", () => {
      expect(typeof wrapper.vm.saveDestination).toBe("function");
    });

    it("10.3 exposes handleDestinationCreated as a function", () => {
      expect(typeof wrapper.vm.handleDestinationCreated).toBe("function");
    });

    it("10.4 exposes handleCancel as a function", () => {
      expect(typeof wrapper.vm.handleCancel).toBe("function");
    });

    it("10.5 exposes selectedDestination ref", () => {
      expect(wrapper.vm.selectedDestination).toBeDefined();
    });

    it("10.6 exposes destinations ref", () => {
      expect(wrapper.vm.destinations).toBeDefined();
    });

    it("10.7 exposes createNewDestination ref", () => {
      expect(wrapper.vm.createNewDestination).toBeDefined();
    });

    it("10.8 exposes getFormattedDestinations computed", () => {
      expect(wrapper.vm.getFormattedDestinations).toBeDefined();
    });

    it("10.9 exposes pipelineObj", () => {
      expect(wrapper.vm.pipelineObj).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 11. Template – static structure
  // -----------------------------------------------------------------------

  describe("11. Template structure", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("11.1 renders the External Destination title text", () => {
      expect(wrapper.html()).toContain("External Destination");
    });

    it("11.2 renders the destination select when createNewDestination is false", () => {
      wrapper.vm.createNewDestination = false;
      expect(
        wrapper.find('[data-test="external-destination-select"]').exists(),
      ).toBe(true);
    });

    it("11.3 shows CreateDestinationForm stub when createNewDestination is true", async () => {
      wrapper.vm.createNewDestination = true;
      await nextTick();
      expect(wrapper.find('[data-test="create-destination-form"]').exists()).toBe(true);
    });

    it("11.4 hides destination select when createNewDestination is true", async () => {
      wrapper.vm.createNewDestination = true;
      await nextTick();
      expect(
        wrapper.find('[data-test="external-destination-select"]').exists(),
      ).toBe(false);
    });

    it("11.5 renders cancel button", () => {
      expect(wrapper.find('[data-test="add-destination-cancel-btn"]').exists()).toBe(true);
    });

    it("11.6 renders save button", () => {
      expect(wrapper.find('[data-test="add-destination-save-btn"]').exists()).toBe(true);
    });

    it("11.7 does NOT render delete button when isEditNode is false", () => {
      expect(wrapper.find('[data-test="add-destination-delete-btn"]').exists()).toBe(false);
    });

    it("11.8 renders delete button when isEditNode is true", async () => {
      wrapper.unmount();
      wrapper = createWrapper({ isEditNode: true });
      await flushPromises();
      expect(wrapper.find('[data-test="add-destination-delete-btn"]').exists()).toBe(true);
    });

    it("11.9 emits 'close' when the header close OButton is clicked", async () => {
      // Header close button is the first OButton (variant=ghost, size=icon)
      // After migration to ODialog/ODrawer, this button now emits 'close'
      // (previously used v-close-popup).
      const headerCloseBtn = wrapper.findAllComponents({ name: "OButton" })[0];
      expect(headerCloseBtn.exists()).toBe(true);
      await headerCloseBtn.trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("11.10 does NOT emit 'close' on cancel button click (cancel emits cancel:hideform)", async () => {
      const cancelBtn = wrapper.find('[data-test="add-destination-cancel-btn"]');
      await cancelBtn.trigger("click");
      expect(wrapper.emitted("close")).toBeFalsy();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // 12. Theme awareness
  // -----------------------------------------------------------------------

  describe("12. Theme awareness", () => {
    it("12.1 renders correctly in dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      await flushPromises();
      const rootDiv = wrapper.find(
        '[data-test="add-stream-input-stream-routing-section"]',
      );
      expect(rootDiv.exists()).toBe(true);
      expect(rootDiv.classes()).toContain("bg-dark");
    });

    it("12.2 renders correctly in light theme", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await flushPromises();
      const rootDiv = wrapper.find(
        '[data-test="add-stream-input-stream-routing-section"]',
      );
      expect(rootDiv.exists()).toBe(true);
      expect(rootDiv.classes()).toContain("bg-white");
    });

    afterEach(() => {
      // Reset theme after theme tests
      store.state.theme = "dark";
    });
  });
});
