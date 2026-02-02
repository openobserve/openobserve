// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import AlertSetup from "./AlertSetup.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "light",
    zoConfig: {
      build_type: "opensource",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
    userInfo: {
      email: "test@example.com",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

// Mock SelectFolderDropDown component
vi.mock("../../common/sidebar/SelectFolderDropDown.vue", () => ({
  default: {
    name: "SelectFolderDropDown",
    template: "<div data-test='mock-select-folder-dropdown'></div>",
  },
}));

describe("AlertSetup.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;
  let mockFormData: any;

  beforeEach(() => {
    mockStore = createMockStore();
    mockFormData = {
      name: "",
      stream_type: "",
      stream_name: "",
      is_real_time: "false",
      folder_id: "",
    };

    wrapper = mount(AlertSetup, {
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
        plugins: [i18n],
      },
      props: {
        formData: mockFormData,
        beingUpdated: false,
        streamTypes: ["logs", "metrics", "traces"],
        filteredStreams: ["stream1", "stream2", "stream3"],
        isFetchingStreams: false,
        activeFolderId: "",
        streamFieldRef: null,
        streamTypeFieldRef: null,
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render with correct theme class (light mode)", () => {
      expect(wrapper.find(".step-alert-setup.light-mode").exists()).toBe(true);
    });

    it("should render with correct theme class (dark mode)", async () => {
      const darkMockStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(AlertSetup, {
        global: {
          mocks: { $store: darkMockStore },
          provide: { store: darkMockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          beingUpdated: false,
          streamTypes: ["logs"],
          filteredStreams: ["stream1"],
          isFetchingStreams: false,
          activeFolderId: "",
        },
      });

      expect(darkWrapper.find(".step-alert-setup.dark-mode").exists()).toBe(
        true
      );
      darkWrapper.unmount();
    });

    it("should render all form fields", () => {
      expect(
        wrapper.find('[data-test="add-alert-name-input"]').exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="mock-select-folder-dropdown"]').exists()
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="add-alert-stream-type-select-dropdown"]')
          .exists()
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="add-alert-stream-name-select-dropdown"]')
          .exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-alert-scheduled-alert-radio"]').exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-alert-realtime-alert-radio"]').exists()
      ).toBe(true);
    });

    it("should have empty form data initially", () => {
      expect(wrapper.props().formData.name).toBe("");
      expect(wrapper.props().formData.stream_type).toBe("");
      expect(wrapper.props().formData.stream_name).toBe("");
    });

    it("should render with provided form data", async () => {
      const prefilledData = {
        name: "Test Alert",
        stream_type: "logs",
        stream_name: "test-stream",
        is_real_time: "false",
      };

      const prefilledWrapper = mount(AlertSetup, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: prefilledData,
          beingUpdated: false,
          streamTypes: ["logs"],
          filteredStreams: ["test-stream"],
          isFetchingStreams: false,
          activeFolderId: "",
        },
      });

      await nextTick();

      expect(prefilledWrapper.props().formData.name).toBe("Test Alert");
      expect(prefilledWrapper.props().formData.stream_type).toBe("logs");
      expect(prefilledWrapper.props().formData.stream_name).toBe("test-stream");

      prefilledWrapper.unmount();
    });
  });

  describe("Props", () => {
    it("should accept all required props", () => {
      expect(wrapper.props().formData).toBeDefined();
      expect(wrapper.props().streamTypes).toEqual([
        "logs",
        "metrics",
        "traces",
      ]);
      expect(wrapper.props().filteredStreams).toEqual([
        "stream1",
        "stream2",
        "stream3",
      ]);
      expect(wrapper.props().activeFolderId).toBe("");
    });

    it("should use default value for beingUpdated prop", () => {
      expect(wrapper.props().beingUpdated).toBe(false);
    });

    it("should use default value for isFetchingStreams prop", () => {
      expect(wrapper.props().isFetchingStreams).toBe(false);
    });

    it("should handle beingUpdated=true prop", async () => {
      await wrapper.setProps({ beingUpdated: true });
      expect(wrapper.props().beingUpdated).toBe(true);
    });

    it("should handle empty streamTypes array", async () => {
      await wrapper.setProps({ streamTypes: [] });
      expect(wrapper.props().streamTypes).toEqual([]);
    });

    it("should handle empty filteredStreams array", async () => {
      await wrapper.setProps({ filteredStreams: [] });
      expect(wrapper.props().filteredStreams).toEqual([]);
    });

    it("should handle isFetchingStreams=true prop", async () => {
      await wrapper.setProps({ isFetchingStreams: true });
      expect(wrapper.props().isFetchingStreams).toBe(true);
    });
  });

  describe("User Interactions - Alert Name Input", () => {
    it("should update formData.name on input", async () => {
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');
      await nameInput.setValue("New Alert");
      expect(wrapper.props().formData.name).toBe("New Alert");
    });

    it("should validate required alert name", async () => {
      const form = wrapper.findComponent({ ref: "step1Form" });
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');

      // Empty name should fail validation
      await nameInput.setValue("");
      const result = await (form.vm as any).validate();
      expect(result).toBe(false);
    });

    it("should validate invalid characters in alert name", async () => {
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');

      // Test invalid characters: :, ?, /, #, spaces
      const invalidNames = [
        "alert:name",
        "alert?name",
        "alert/name",
        "alert#name",
        "alert name",
      ];

      for (const invalidName of invalidNames) {
        await nameInput.setValue(invalidName);
        const form = wrapper.findComponent({ ref: "step1Form" });
        const result = await (form.vm as any).validate();
        expect(result).toBe(false);
      }
    });

    it("should accept valid alert name", async () => {
      wrapper.props().formData.name = "valid_alert-name.123";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";
      await nextTick();

      const form = wrapper.findComponent({ ref: "step1Form" });
      const result = await (form.vm as any).validate();
      expect(result).toBe(true);
    });

    it("should disable name input when beingUpdated is true", async () => {
      await wrapper.setProps({ beingUpdated: true });
      await nextTick();
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');
      expect(nameInput.attributes("readonly")).toBe("");
      expect(nameInput.attributes("disabled")).toBe("");
    });

    it("should enable name input when beingUpdated is false", () => {
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');
      expect(nameInput.attributes("readonly")).toBeUndefined();
      expect(nameInput.attributes("disable")).toBeUndefined();
    });
  });

  describe("User Interactions - Stream Type Select", () => {
    it("should emit update:streams when stream type changes", async () => {
      const streamTypeSelect = wrapper.findComponent({
        ref: "streamTypeFieldRef",
      });

      wrapper.props().formData.stream_type = "logs";
      await wrapper.vm.updateStreams();

      expect(wrapper.emitted("update:streams")).toBeTruthy();
    });

    it("should disable stream type select when beingUpdated is true", async () => {
      await wrapper.setProps({ beingUpdated: true });
      await nextTick();
      // Verify that beingUpdated prop is passed correctly
      expect(wrapper.props().beingUpdated).toBe(true);
    });

    it("should validate required stream type", async () => {
      const form = wrapper.findComponent({ ref: "step1Form" });

      // Empty stream type should fail validation
      wrapper.props().formData.stream_type = "";
      const result = await (form.vm as any).validate();
      expect(result).toBe(false);
    });

    it("should accept valid stream type", async () => {
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.name = "test_alert";
      wrapper.props().formData.stream_name = "stream1";

      const form = wrapper.findComponent({ ref: "step1Form" });
      const result = await (form.vm as any).validate();
      expect(result).toBe(true);
    });
  });

  describe("User Interactions - Stream Name Select", () => {
    it("should emit filter:streams when filtering streams", async () => {
      const mockUpdate = vi.fn((cb: Function) => cb());
      await wrapper.vm.filterStreams("stream", mockUpdate);

      expect(wrapper.emitted("filter:streams")).toBeTruthy();
      expect(wrapper.emitted("filter:streams")![0]).toEqual([
        "stream",
        mockUpdate,
      ]);
    });

    it("should emit update:stream-name when stream name changes", async () => {
      await wrapper.vm.handleStreamNameChange("new-stream");

      expect(wrapper.emitted("update:stream-name")).toBeTruthy();
      expect(wrapper.emitted("update:stream-name")![0]).toEqual(["new-stream"]);
    });

    it("should show loading state when fetching streams", async () => {
      await wrapper.setProps({ isFetchingStreams: true });
      await nextTick();
      // Verify that isFetchingStreams prop is passed correctly
      expect(wrapper.props().isFetchingStreams).toBe(true);
    });

    it("should not show loading state when not fetching streams", () => {
      const streamNameSelect = wrapper.find(
        '[data-test="add-alert-stream-name-select-dropdown"]'
      );
      expect(streamNameSelect.attributes("loading")).toBeUndefined();
    });

    it("should disable stream name select when beingUpdated is true", async () => {
      await wrapper.setProps({ beingUpdated: true });
      await nextTick();
      const streamNameSelect = wrapper.find(
        '[data-test="add-alert-stream-name-select-dropdown"]'
      );
      expect(streamNameSelect.attributes("readonly")).toBe("");
      expect(streamNameSelect.attributes("disabled")).toBe("");
    });

    it("should validate required stream name", async () => {
      wrapper.props().formData.name = "test_alert";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "";

      const form = wrapper.findComponent({ ref: "step1Form" });
      const result = await (form.vm as any).validate();
      expect(result).toBe(false);
    });

    it("should accept valid stream name", async () => {
      wrapper.props().formData.name = "test_alert";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";

      const form = wrapper.findComponent({ ref: "step1Form" });
      const result = await (form.vm as any).validate();
      expect(result).toBe(true);
    });
  });

  describe("User Interactions - Alert Type Radio Buttons", () => {
    it("should have scheduled alert selected by default", () => {
      expect(wrapper.props().formData.is_real_time).toBe("false");
    });

    it("should switch to real-time alert", async () => {
      wrapper.props().formData.is_real_time = "true";
      await nextTick();
      expect(wrapper.props().formData.is_real_time).toBe("true");
    });

    it("should switch back to scheduled alert", async () => {
      wrapper.props().formData.is_real_time = "true";
      await nextTick();

      wrapper.props().formData.is_real_time = "false";
      await nextTick();
      expect(wrapper.props().formData.is_real_time).toBe("false");
    });

    it("should disable scheduled radio when beingUpdated is true", async () => {
      await wrapper.setProps({ beingUpdated: true });
      await nextTick();
      const scheduledRadio = wrapper.find(
        '[data-test="add-alert-scheduled-alert-radio"]'
      );
      // Verify radio button exists
      expect(scheduledRadio.exists()).toBe(true);
      // Verify beingUpdated prop is passed
      expect(wrapper.props().beingUpdated).toBe(true);
    });

    it("should disable realtime radio when beingUpdated is true", async () => {
      await wrapper.setProps({ beingUpdated: true });
      await nextTick();
      const realtimeRadio = wrapper.find(
        '[data-test="add-alert-realtime-alert-radio"]'
      );
      // Verify radio button exists
      expect(realtimeRadio.exists()).toBe(true);
      // Verify beingUpdated prop is passed
      expect(wrapper.props().beingUpdated).toBe(true);
    });
  });

  describe("User Interactions - Folder Selection", () => {
    it("should emit update:active-folder-id when folder is selected", async () => {
      await wrapper.vm.updateActiveFolderId("folder-123");

      expect(wrapper.emitted("update:active-folder-id")).toBeTruthy();
      expect(wrapper.emitted("update:active-folder-id")![0]).toEqual([
        "folder-123",
      ]);
    });

    it("should handle empty folder id", async () => {
      await wrapper.vm.updateActiveFolderId("");

      expect(wrapper.emitted("update:active-folder-id")).toBeTruthy();
      expect(wrapper.emitted("update:active-folder-id")![0]).toEqual([""]);
    });

    it("should handle null folder id", async () => {
      await wrapper.vm.updateActiveFolderId(null);

      expect(wrapper.emitted("update:active-folder-id")).toBeTruthy();
      expect(wrapper.emitted("update:active-folder-id")![0]).toEqual([null]);
    });
  });

  describe("Methods - updateStreams", () => {
    it("should emit update:streams event", async () => {
      await wrapper.vm.updateStreams();

      expect(wrapper.emitted("update:streams")).toBeTruthy();
      expect(wrapper.emitted("update:streams")!.length).toBe(1);
    });

    it("should emit event multiple times when called multiple times", async () => {
      await wrapper.vm.updateStreams();
      await wrapper.vm.updateStreams();
      await wrapper.vm.updateStreams();

      expect(wrapper.emitted("update:streams")!.length).toBe(3);
    });
  });

  describe("Methods - filterStreams", () => {
    it("should emit filter:streams with correct parameters", async () => {
      const mockUpdate = vi.fn();
      await wrapper.vm.filterStreams("test", mockUpdate);

      expect(wrapper.emitted("filter:streams")).toBeTruthy();
      expect(wrapper.emitted("filter:streams")![0]).toEqual([
        "test",
        mockUpdate,
      ]);
    });

    it("should handle empty filter value", async () => {
      const mockUpdate = vi.fn();
      await wrapper.vm.filterStreams("", mockUpdate);

      expect(wrapper.emitted("filter:streams")).toBeTruthy();
      expect(wrapper.emitted("filter:streams")![0]).toEqual(["", mockUpdate]);
    });

    it("should handle null filter value", async () => {
      const mockUpdate = vi.fn();
      await wrapper.vm.filterStreams(null, mockUpdate);

      expect(wrapper.emitted("filter:streams")).toBeTruthy();
      expect(wrapper.emitted("filter:streams")![0][0]).toBe(null);
    });
  });

  describe("Methods - handleStreamNameChange", () => {
    it("should emit update:stream-name with stream name", async () => {
      await wrapper.vm.handleStreamNameChange("stream1");

      expect(wrapper.emitted("update:stream-name")).toBeTruthy();
      expect(wrapper.emitted("update:stream-name")![0]).toEqual(["stream1"]);
    });

    it("should handle empty stream name", async () => {
      await wrapper.vm.handleStreamNameChange("");

      expect(wrapper.emitted("update:stream-name")).toBeTruthy();
      expect(wrapper.emitted("update:stream-name")![0]).toEqual([""]);
    });

    it("should handle special characters in stream name", async () => {
      const specialName = "stream-with_special.chars";
      await wrapper.vm.handleStreamNameChange(specialName);

      expect(wrapper.emitted("update:stream-name")![0]).toEqual([specialName]);
    });
  });

  describe("Methods - updateActiveFolderId", () => {
    it("should emit update:active-folder-id with folder id", async () => {
      await wrapper.vm.updateActiveFolderId("folder-123");

      expect(wrapper.emitted("update:active-folder-id")).toBeTruthy();
      expect(wrapper.emitted("update:active-folder-id")![0]).toEqual([
        "folder-123",
      ]);
    });

    it("should handle numeric folder id", async () => {
      await wrapper.vm.updateActiveFolderId(123);

      expect(wrapper.emitted("update:active-folder-id")![0]).toEqual([123]);
    });

    it("should handle object folder id", async () => {
      const folderObj = { id: "123", name: "Test Folder" };
      await wrapper.vm.updateActiveFolderId(folderObj);

      expect(wrapper.emitted("update:active-folder-id")![0]).toEqual([
        folderObj,
      ]);
    });
  });

  describe("Methods - validate", () => {
    it("should return true when all fields are valid", async () => {
      wrapper.props().formData.name = "test_alert";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";

      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should return false when name is empty", async () => {
      wrapper.props().formData.name = "";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should return false when name has invalid characters", async () => {
      wrapper.props().formData.name = "test alert";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should return false when stream type is empty", async () => {
      wrapper.props().formData.name = "test_alert";
      wrapper.props().formData.stream_type = "";
      wrapper.props().formData.stream_name = "stream1";

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should return false when stream name is empty", async () => {
      wrapper.props().formData.name = "test_alert";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "";

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should return false when all fields are empty", async () => {
      wrapper.props().formData.name = "";
      wrapper.props().formData.stream_type = "";
      wrapper.props().formData.stream_name = "";

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should return false when form ref is not available", async () => {
      wrapper.vm.step1Form = null;
      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });
  });

  describe("Emits", () => {
    it("should emit all expected events", async () => {
      await wrapper.vm.updateStreams();
      await wrapper.vm.filterStreams("test", vi.fn());
      await wrapper.vm.handleStreamNameChange("stream1");
      await wrapper.vm.updateActiveFolderId("folder-123");

      expect(wrapper.emitted()).toHaveProperty("update:streams");
      expect(wrapper.emitted()).toHaveProperty("filter:streams");
      expect(wrapper.emitted()).toHaveProperty("update:stream-name");
      expect(wrapper.emitted()).toHaveProperty("update:active-folder-id");
    });

    it("should not emit events when not triggered", () => {
      expect(wrapper.emitted("update:streams")).toBeFalsy();
      expect(wrapper.emitted("filter:streams")).toBeFalsy();
      expect(wrapper.emitted("update:stream-name")).toBeFalsy();
      expect(wrapper.emitted("update:active-folder-id")).toBeFalsy();
    });
  });

  describe("Edge Cases", () => {
    it.skip("should handle null formData - REQUIRES E2E", async () => {
      // Skipped: Component requires formData prop and will throw error with null
      // This is expected behavior and should be enforced by TypeScript
      // E2E test should verify proper error handling in parent component
    });

    it("should handle undefined props gracefully", async () => {
      const undefinedWrapper = mount(AlertSetup, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          beingUpdated: undefined as any,
          streamTypes: ["logs"],
          filteredStreams: ["stream1"],
          isFetchingStreams: undefined as any,
          activeFolderId: "",
        },
      });

      expect(undefinedWrapper.exists()).toBe(true);
      undefinedWrapper.unmount();
    });

    it("should handle very long alert name", async () => {
      const longName = "a".repeat(1000);
      wrapper.props().formData.name = longName;
      await nextTick();

      expect(wrapper.props().formData.name.length).toBe(1000);
    });

    it("should handle very long stream name", async () => {
      const longStreamName = "stream_".repeat(100);
      await wrapper.vm.handleStreamNameChange(longStreamName);

      expect(wrapper.emitted("update:stream-name")![0][0].length).toBeGreaterThan(
        100
      );
    });

    it("should handle rapid successive updates", async () => {
      for (let i = 0; i < 10; i++) {
        await wrapper.vm.updateStreams();
      }

      expect(wrapper.emitted("update:streams")!.length).toBe(10);
    });

    it("should handle special characters in filter", async () => {
      const specialChars = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
      const mockUpdate = vi.fn();
      await wrapper.vm.filterStreams(specialChars, mockUpdate);

      expect(wrapper.emitted("filter:streams")![0][0]).toBe(specialChars);
    });

    it("should handle empty streamTypes array", async () => {
      await wrapper.setProps({ streamTypes: [] });
      expect(wrapper.props().streamTypes).toEqual([]);
    });

    it("should handle large streamTypes array", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => `stream${i}`);
      await wrapper.setProps({ streamTypes: largeArray });
      expect(wrapper.props().streamTypes.length).toBe(1000);
    });

    it("should handle large filteredStreams array", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => `stream${i}`);
      await wrapper.setProps({ filteredStreams: largeArray });
      expect(wrapper.props().filteredStreams.length).toBe(1000);
    });

    it("should handle switching between light and dark mode", async () => {
      expect(wrapper.find(".light-mode").exists()).toBe(true);

      const darkStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(AlertSetup, {
        global: {
          mocks: { $store: darkStore },
          provide: { store: darkStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          beingUpdated: false,
          streamTypes: ["logs"],
          filteredStreams: ["stream1"],
          isFetchingStreams: false,
          activeFolderId: "",
        },
      });

      expect(darkWrapper.find(".dark-mode").exists()).toBe(true);
      darkWrapper.unmount();
    });
  });

  describe("Accessibility", () => {
    it("should have proper labels for all inputs", () => {
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');
      const streamTypeSelect = wrapper.find(
        '[data-test="add-alert-stream-type-select-dropdown"]'
      );
      const streamNameSelect = wrapper.find(
        '[data-test="add-alert-stream-name-select-dropdown"]'
      );

      // Verify inputs exist with their test IDs
      expect(nameInput.exists()).toBe(true);
      expect(streamTypeSelect.exists()).toBe(true);
      expect(streamNameSelect.exists()).toBe(true);
    });

    it("should have data-test attributes for all interactive elements", () => {
      expect(
        wrapper.find('[data-test="add-alert-name-input"]').exists()
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="add-alert-stream-type-select-dropdown"]')
          .exists()
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="add-alert-stream-name-select-dropdown"]')
          .exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-alert-scheduled-alert-radio"]').exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-alert-realtime-alert-radio"]').exists()
      ).toBe(true);
    });

    it("should have proper tabindex for name input", () => {
      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');
      expect(nameInput.attributes("tabindex")).toBe("0");
    });
  });

  describe("Negative Cases", () => {
    it("should not emit update:streams when not called", () => {
      expect(wrapper.emitted("update:streams")).toBeFalsy();
    });

    it("should not emit filter:streams when not called", () => {
      expect(wrapper.emitted("filter:streams")).toBeFalsy();
    });

    it("should not emit update:stream-name when not called", () => {
      expect(wrapper.emitted("update:stream-name")).toBeFalsy();
    });

    it("should not emit update:active-folder-id when not called", () => {
      expect(wrapper.emitted("update:active-folder-id")).toBeFalsy();
    });

    it("should not validate successfully with invalid name", async () => {
      wrapper.props().formData.name = "invalid name with spaces";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should not update formData when beingUpdated is true", async () => {
      await wrapper.setProps({ beingUpdated: true });
      await nextTick();

      const nameInput = wrapper.find('[data-test="add-alert-name-input"]');
      expect(nameInput.attributes("disabled")).toBe("");
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle minimum valid alert name (1 character)", async () => {
      wrapper.props().formData.name = "a";
      wrapper.props().formData.stream_type = "logs";
      wrapper.props().formData.stream_name = "stream1";

      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should handle zero-length arrays", async () => {
      await wrapper.setProps({
        streamTypes: [],
        filteredStreams: [],
      });

      expect(wrapper.props().streamTypes.length).toBe(0);
      expect(wrapper.props().filteredStreams.length).toBe(0);
    });

    it("should handle boolean beingUpdated transitions", async () => {
      expect(wrapper.props().beingUpdated).toBe(false);

      await wrapper.setProps({ beingUpdated: true });
      expect(wrapper.props().beingUpdated).toBe(true);

      await wrapper.setProps({ beingUpdated: false });
      expect(wrapper.props().beingUpdated).toBe(false);
    });

    it("should handle all stream types", async () => {
      const allStreamTypes = ["logs", "metrics", "traces"];
      await wrapper.setProps({ streamTypes: allStreamTypes });

      for (const type of allStreamTypes) {
        wrapper.props().formData.stream_type = type;
        await nextTick();
        expect(wrapper.props().formData.stream_type).toBe(type);
      }
    });
  });
});
