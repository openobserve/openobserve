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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AddStream from "./AddStream.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import { createStore } from "vuex";
import i18n from "@/locales";

installQuasar({ plugins: [Notify] });

const { mockGetStream, mockAddStream, mockCreateStream, mockSchemaStream } = vi.hoisted(() => ({
  mockGetStream: vi.fn(),
  mockAddStream: vi.fn(),
  mockCreateStream: vi.fn(),
  mockSchemaStream: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
    addStream: mockAddStream,
  }),
}));

vi.mock("@/services/stream", () => ({
  default: {
    createStream: mockCreateStream,
    schema: mockSchemaStream,
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({
    track: vi.fn(),
  }),
}));

vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

const ODrawerStub = {
  name: "ODrawer",
  template:
    '<div class="o-drawer-stub" :data-open="open"><slot name="header" /><slot /><slot name="footer" /></div>',
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryVariant",
    "secondaryVariant",
    "neutralVariant",
    "primaryDisabled",
    "secondaryDisabled",
    "neutralDisabled",
    "primaryLoading",
    "secondaryLoading",
    "neutralLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

const makeStore = (overrides = {}) =>
  createStore({
    state: {
      theme: "light",
      selectedOrganization: { identifier: "test-org" },
      zoConfig: {
        user_defined_schemas_enabled: false,
        data_retention_days: 0,
        ...overrides,
      },
    },
  });

describe("AddStream", () => {
  let store: any;

  const globalStubs = {
    StreamFieldInputs: true,
    ODrawer: ODrawerStub,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    // By default, stream doesn't exist
    mockGetStream.mockRejectedValue({ response: { status: 404 } });
    mockCreateStream.mockResolvedValue({});
    mockSchemaStream.mockResolvedValue({ data: { name: "new-stream" } });
  });

  const mountComp = (customStore?: any, extraProps: Record<string, any> = {}) =>
    mount(AddStream, {
      props: { isInPipeline: false, open: true, ...extraProps },
      global: { plugins: [i18n, customStore ?? store], stubs: globalStubs },
    });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mountComp();
      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render ODrawer with localized title and button labels", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("title")).toBeTruthy();
      expect(drawer.props("primaryButtonLabel")).toBeTruthy();
      expect(drawer.props("secondaryButtonLabel")).toBeTruthy();
    });

    it("should pass through the open prop to ODrawer", async () => {
      const wrapper = mountComp(undefined, { open: true });
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(true);
    });

    it("should pass open=false to ODrawer when closed", async () => {
      const wrapper = mountComp(undefined, { open: false });
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(false);
    });

    it("should render the stream name input", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find('[data-test="add-stream-name-input"]').exists()).toBe(true);
    });

    it("should render the stream type select", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find('[data-test="add-stream-type-input"]').exists()).toBe(true);
    });

    it("should render the data retention input", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find('[data-test="add-stream-data-retention-input"]').exists()).toBe(true);
    });
  });

  describe("Drawer event handling", () => {
    it("should emit update:open=false when ODrawer emits click:secondary", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:secondary");
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")!.at(-1)).toEqual([false]);
    });

    it("should propagate ODrawer's update:open event to parent", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")!.at(-1)).toEqual([false]);
    });

    it("should call submitForm (which submits the form) when ODrawer emits click:primary", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      // Stub out the underlying form ref's submit method.
      const submitSpy = vi.fn();
      vm.addStreamFormRef = { submit: submitSpy };

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:primary");

      expect(submitSpy).toHaveBeenCalled();
    });

    it("should not throw if click:primary fires while addStreamFormRef is null", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addStreamFormRef = null;

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(() => drawer.vm.$emit("click:primary")).not.toThrow();
    });
  });

  describe("Default State", () => {
    it("should initialize streamInputs with empty name", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamInputs.name).toBe("");
    });

    it("should initialize streamInputs with empty stream_type", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamInputs.stream_type).toBe("");
    });

    it("should initialize dataRetentionDays to 14", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamInputs.dataRetentionDays).toBe(14);
    });

    it("should initialize fields as empty array", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fields).toEqual([]);
    });
  });

  describe("filteredStreamTypes computed", () => {
    it("should return all three stream types", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const types = vm.filteredStreamTypes.map((t: any) => t.value);
      expect(types).toContain("logs");
      expect(types).toContain("metrics");
      expect(types).toContain("traces");
    });
  });

  describe("isSchemaUDSEnabled computed", () => {
    it("should return false when user_defined_schemas_enabled is false", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.isSchemaUDSEnabled).toBe(false);
    });

    it("should return true when user_defined_schemas_enabled is true", async () => {
      const customStore = makeStore({ user_defined_schemas_enabled: true });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.isSchemaUDSEnabled).toBe(true);
    });
  });

  describe("showDataRetention computed", () => {
    it("should return false when data_retention_days is 0", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.showDataRetention).toBe(false);
    });

    it("should return true when data_retention_days is set and stream_type is not enrichment_tables", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.stream_type = "logs";
      await flushPromises();
      expect(vm.showDataRetention).toBe(true);
    });

    it("should return false when stream_type is enrichment_tables even with data_retention_days", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.stream_type = "enrichment_tables";
      await flushPromises();
      expect(vm.showDataRetention).toBe(false);
    });
  });

  describe("addField", () => {
    it("should add a new field to fields array", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fields).toHaveLength(0);

      vm.addField();
      expect(vm.fields).toHaveLength(1);
    });

    it("should add field with empty name, type, and index_type", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addField();

      expect(vm.fields[0]).toEqual({ name: "", type: "", index_type: [] });
    });

    it("should allow adding multiple fields", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addField();
      vm.addField();
      vm.addField();

      expect(vm.fields).toHaveLength(3);
    });
  });

  describe("removeField", () => {
    it("should remove field at specified index", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addField();
      vm.addField();
      vm.fields[0].name = "first";
      vm.fields[1].name = "second";

      vm.removeField(vm.fields[0], 0);
      expect(vm.fields).toHaveLength(1);
      expect(vm.fields[0].name).toBe("second");
    });
  });

  describe("saveStream", () => {
    it("should call getStream to check if stream already exists", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.name = "test-stream";
      vm.streamInputs.stream_type = "logs";

      await vm.saveStream();
      await flushPromises();

      expect(mockGetStream).toHaveBeenCalledWith("test-stream", "logs", false);
    });

    it("should not call createStream if stream already exists", async () => {
      // Simulate stream existing
      mockGetStream.mockResolvedValue({ data: {} });

      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.name = "existing-stream";
      vm.streamInputs.stream_type = "logs";

      await vm.saveStream();
      await flushPromises();

      expect(mockCreateStream).not.toHaveBeenCalled();
    });

    it("should call createStream when stream does not exist", async () => {
      mockGetStream.mockRejectedValue({ response: { status: 404 } });

      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.name = "new-stream";
      vm.streamInputs.stream_type = "logs";

      await vm.saveStream();
      await flushPromises();

      expect(mockCreateStream).toHaveBeenCalled();
    });

    it("should emit streamAdded and close after successful creation", async () => {
      mockGetStream.mockRejectedValue({ response: { status: 404 } });
      mockCreateStream.mockResolvedValue({});
      mockSchemaStream.mockResolvedValue({ data: { name: "new-stream" } });

      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.name = "new-stream";
      vm.streamInputs.stream_type = "logs";

      await vm.saveStream();
      await flushPromises();

      expect(wrapper.emitted("streamAdded")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should not notify for 403 errors on createStream", async () => {
      mockGetStream.mockRejectedValue({ response: { status: 404 } });
      mockCreateStream.mockRejectedValue({ response: { status: 403, data: {} } });

      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamInputs.name = "new-stream";
      vm.streamInputs.stream_type = "logs";

      // Should not throw or show error for 403
      await expect(vm.saveStream()).resolves.not.toThrow();
      await flushPromises();
    });
  });

  describe("getStreamPayload", () => {
    it("should return stream payload with empty fields and settings", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const payload = vm.getStreamPayload();

      expect(payload).toBeDefined();
      expect(payload.fields).toEqual([]);
      expect(payload.settings.partition_keys).toEqual([]);
      expect(payload.settings.index_fields).toEqual([]);
      expect(payload.settings.full_text_search_keys).toEqual([]);
    });

    it("should add field to payload with FTS index type", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.fields.push({ name: "log_field", type: "", index_type: ["fullTextSearchKey"] });

      const payload = vm.getStreamPayload();
      expect(payload.settings.full_text_search_keys).toContain("log_field");
    });

    it("should add field to payload with secondary index type", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.fields.push({ name: "user_id", type: "", index_type: ["secondaryIndexKey"] });

      const payload = vm.getStreamPayload();
      expect(payload.settings.index_fields).toContain("user_id");
    });

    it("should add field to payload with bloom filter type", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.fields.push({ name: "session_id", type: "", index_type: ["bloomFilterKey"] });

      const payload = vm.getStreamPayload();
      expect(payload.settings.bloom_filter_fields).toContain("session_id");
    });

    it("should normalize field names (lowercase, replace spaces and dashes with underscores)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.fields.push({ name: "My Field-Name", type: "", index_type: [] });

      const payload = vm.getStreamPayload();
      expect(payload.fields[0].name).toBe("my_field_name");
    });

    it("should add field to defined_schema_fields when isSchemaUDSEnabled is true", async () => {
      const customStore = makeStore({ user_defined_schemas_enabled: true });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.fields.push({ name: "my_field", type: "", index_type: [] });

      const payload = vm.getStreamPayload();
      expect(payload.settings.defined_schema_fields).toContain("my_field");
    });
  });
});
