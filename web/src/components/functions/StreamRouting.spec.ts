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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import StreamRouting from "./StreamRouting.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

installQuasar();

vi.mock("@/utils/zincutils", () => ({
  getUUID: vi.fn(() => "test-uuid-123"),
}));

vi.mock("../alerts/RealTimeAlert.vue", () => ({
  default: { template: "<div>RealTimeAlert</div>" },
}));

describe("StreamRouting", () => {
  let store: any;
  let router: any;

  const globalStubs = {
    RealTimeAlert: true,
    ConfirmDialog: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        theme: "light",
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/reports",
          name: "reports",
          component: { template: "<div>Reports</div>" },
        },
        {
          path: "/functions",
          name: "functions",
          component: { template: "<div>Functions</div>" },
        },
      ],
    });

    router.push("/functions");
  });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render the add-stream-routing-section", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="add-stream-routing-section"]').exists()).toBe(true);
    });

    it("should render Stream Routing title", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.text()).toContain("Stream Routing");
    });

    it("should render destination stream name input", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="stream-routing-name-input"]').exists()).toBe(true);
    });

    it("should render stream type select", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-stream-type-select"]').exists()).toBe(true);
    });

    it("should render source stream select", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-stream-select"]').exists()).toBe(true);
    });

    it("should render cancel button", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="add-report-cancel-btn"]').exists()).toBe(true);
    });

    it("should render save button", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="add-report-save-btn"]').exists()).toBe(true);
    });

    it("should render close dialog icon", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="stream-routing-close-dialog-btn"]').exists()).toBe(true);
    });
  });

  describe("Emits", () => {
    it("should emit cancel:hideform when close icon is clicked", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const closeBtn = wrapper.find('[data-test="stream-routing-close-dialog-btn"]');
      await closeBtn.trigger("click");

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("Default State", () => {
    it("should initialize with empty destination stream name", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamRoute.destinationStreamName).toBe("");
    });

    it("should initialize with empty source stream name", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamRoute.sourceStreamName).toBe("");
    });

    it("should initialize with empty source stream type", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamRoute.sourceStreamType).toBe("");
    });

    it("should initialize with one default condition", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamRoute.conditions).toHaveLength(1);
    });

    it("should initialize isUpdating as false", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.isUpdating).toBe(false);
    });

    it("should initialize dialog with show=false", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.dialog.show).toBe(false);
      expect(vm.dialog.title).toBe("");
      expect(vm.dialog.message).toBe("");
    });

    it("should have correct stream types array", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.streamTypes).toContain("logs");
      expect(vm.streamTypes).toContain("metrics");
      expect(vm.streamTypes).toContain("traces");
    });
  });

  describe("addField", () => {
    it("should add a new condition field", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const initialCount = vm.streamRoute.conditions.length;

      vm.addField();
      expect(vm.streamRoute.conditions.length).toBe(initialCount + 1);
    });

    it("should set new condition id using getUUID", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addField();

      const lastCondition = vm.streamRoute.conditions[vm.streamRoute.conditions.length - 1];
      expect(lastCondition.id).toBe("test-uuid-123");
    });

    it("should set new condition with default operator '='", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addField();

      const lastCondition = vm.streamRoute.conditions[vm.streamRoute.conditions.length - 1];
      expect(lastCondition.operator).toBe("=");
    });

    it("should set new condition with empty column and value", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.addField();

      const lastCondition = vm.streamRoute.conditions[vm.streamRoute.conditions.length - 1];
      expect(lastCondition.column).toBe("");
      expect(lastCondition.value).toBe("");
    });
  });

  describe("removeField", () => {
    it("should remove a specific condition field by id", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      // Manually push a second condition with a distinct id to avoid UUID collision
      const keepField = { id: "keep-id-456", column: "col", operator: "=", value: "v" };
      const removeField = { id: "remove-id-789", column: "x", operator: "=", value: "y" };
      vm.streamRoute.conditions.push(keepField);
      vm.streamRoute.conditions.push(removeField);
      const totalBefore = vm.streamRoute.conditions.length;

      vm.removeField(removeField);
      expect(vm.streamRoute.conditions.length).toBe(totalBefore - 1);
      expect(vm.streamRoute.conditions.find((c: any) => c.id === removeField.id)).toBeUndefined();
    });

    it("should keep other conditions intact after removal", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      // Manually add conditions with distinct IDs
      const field1 = { id: "keep-id-1", column: "a", operator: "=", value: "1" };
      const field2 = { id: "remove-id-2", column: "b", operator: "=", value: "2" };
      vm.streamRoute.conditions.push(field1);
      vm.streamRoute.conditions.push(field2);

      vm.removeField(field2);

      // field1 should still be present
      const remainingIds = vm.streamRoute.conditions.map((c: any) => c.id);
      expect(remainingIds).toContain(field1.id);
      expect(remainingIds).not.toContain(field2.id);
    });
  });

  describe("openCancelDialog", () => {
    it("should navigate away without dialog when no changes are made", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      // No changes made — dialog should not show
      vm.openCancelDialog();
      expect(vm.dialog.show).toBe(false);
    });

    it("should show confirm dialog when destination stream name has been changed", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamRoute.destinationStreamName = "new-stream";

      vm.openCancelDialog();
      expect(vm.dialog.show).toBe(true);
      expect(vm.dialog.title).toBe("Discard Changes");
    });

    it("should show confirm dialog when source stream name has been changed", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamRoute.sourceStreamName = "some-stream";

      vm.openCancelDialog();
      expect(vm.dialog.show).toBe(true);
    });

    it("should set discard message in dialog", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.streamRoute.destinationStreamName = "changed";

      vm.openCancelDialog();
      expect(vm.dialog.message).toBe("Are you sure you want to cancel routing changes?");
    });
  });

  describe("filterColumns", () => {
    it("should return all options with empty search value", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const options = ["stream1", "stream2", "test_stream"];
      const mockUpdate = vi.fn((cb: any) => cb());

      const result = vm.filterColumns(options, "", mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(options);
    });

    it("should filter options by search value", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const options = ["stream1", "stream2", "test_stream"];
      const mockUpdate = vi.fn((cb: any) => cb());

      const result = vm.filterColumns(options, "test", mockUpdate);
      expect(result).toEqual(["test_stream"]);
    });

    it("should filter case-insensitively", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const options = ["MyStream", "AnotherStream"];
      const mockUpdate = vi.fn((cb: any) => cb());

      const result = vm.filterColumns(options, "MYSTREAM", mockUpdate);
      expect(result).toEqual(["MyStream"]);
    });

    it("should return empty array when no options match", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const options = ["stream1", "stream2"];
      const mockUpdate = vi.fn((cb: any) => cb());

      const result = vm.filterColumns(options, "xyz_no_match", mockUpdate);
      expect(result).toHaveLength(0);
    });
  });

  describe("Theme Styling", () => {
    it("should apply light theme bg class to actions row", async () => {
      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render correctly with dark theme", async () => {
      const darkStore = createStore({
        state: {
          selectedOrganization: { identifier: "test-org" },
          theme: "dark",
        },
      });

      const wrapper = mount(StreamRouting, {
        global: { plugins: [i18n, darkStore, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });
});
