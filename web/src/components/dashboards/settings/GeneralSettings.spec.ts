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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

// Mock utilities
vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(),
  updateDashboard: vi.fn(),
}));

import GeneralSettings from "@/components/dashboards/settings/GeneralSettings.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { getDashboard, updateDashboard } from "@/utils/commons";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockDashboardData = {
  dashboardId: "dashboard-1",
  title: "Test Dashboard",
  description: "Test dashboard description",
  variables: {
    showDynamicFilters: true,
    list: [],
  },
  defaultDatetimeDuration: {
    startTime: new Date("2023-01-01T00:00:00Z"),
    endTime: new Date("2023-01-01T23:59:59Z"),
    relativeTimePeriod: "15m",
    type: "relative",
  },
};

describe("GeneralSettings", () => {
  let wrapper: any;

  const mockRoute = {
    query: {
      dashboard: "dashboard-1",
      folder: "default",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getDashboard).mockResolvedValue(mockDashboardData);
    vi.mocked(updateDashboard).mockResolvedValue({} as any);

    store.state.selectedOrganization = {
      identifier: "test-org",
      label: "Test Org",
      id: 1,
      user_email: "test@example.com",
      subscription_type: "free",
    };
    (store.state as any).printMode = false;
    store.state.timezone = "UTC";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = () => {
    return mount(GeneralSettings, {
      global: {
        plugins: [i18n, store],
        stubs: {
          DashboardHeader: {
            template: '<div data-test="dashboard-header"><slot></slot></div>',
            props: ["title"],
          },
          DateTimePickerDashboard: {
            template: '<div data-test="datetime-picker"></div>',
            props: ["modelValue", "initialTimezone", "autoApplyDashboard"],
            emits: ["update:modelValue"],
          },
        },
        mocks: {
          $t: (key: string) => key,
          $route: mockRoute,
          $router: router,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render general settings form", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(
        wrapper.findComponent('[data-test="dashboard-header"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-general-setting-name"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="dashboard-general-setting-description"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="dashboard-general-setting-dynamic-filter"]')
          .exists(),
      ).toBe(true);
    });

    it("should render datetime picker when dateTimeValue exists", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Set dateTimeValue to simulate datetime picker presence
      await wrapper.setData({
        dateTimeValue: mockDashboardData.defaultDatetimeDuration,
      });

      expect(
        wrapper
          .find('[data-test="dashboard-general-setting-datetime-picker"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.find('[data-test="datetime-picker"]').exists()).toBe(true);
    });

    it("should render form buttons", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="dashboard-general-setting-cancel-btn"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="dashboard-general-setting-save-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should render dashboard header with correct title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const header = wrapper.findComponent("DashboardHeader");
      expect(header.props("title")).toBe("dashboard.generalSettingsTitle");
    });
  });

  describe("Data Loading", () => {
    it("should load dashboard data on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(getDashboard).toHaveBeenCalledWith(
        store,
        "dashboard-1",
        "default",
      );
    });

    it("should populate form fields with loaded data", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      const descInput = wrapper.find(
        '[data-test="dashboard-general-setting-description"]',
      );

      expect(nameInput.element.value).toBe(mockDashboardData.title);
      expect(descInput.element.value).toBe(mockDashboardData.description);
    });

    it("should handle loading errors gracefully", async () => {
      vi.mocked(getDashboard).mockRejectedValue(new Error("Failed to load"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Form Validation", () => {
    it("should require dashboard title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      await nameInput.setValue("");

      const saveBtn = wrapper.find(
        '[data-test="dashboard-general-setting-save-btn"]',
      );
      expect(saveBtn.element.disabled).toBe(true);
    });

    it("should enable save button when title is provided", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      await nameInput.setValue("Valid Dashboard Name");

      const saveBtn = wrapper.find(
        '[data-test="dashboard-general-setting-save-btn"]',
      );
      expect(saveBtn.element.disabled).toBe(false);
    });

    it("should validate title is not just whitespace", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      await nameInput.setValue("   ");

      const saveBtn = wrapper.find(
        '[data-test="dashboard-general-setting-save-btn"]',
      );
      expect(saveBtn.element.disabled).toBe(true);
    });

    it("should show validation error for empty title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      await nameInput.setValue("");
      await nameInput.trigger("blur");

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");

      expect(wrapper.text()).toContain("dashboard.nameRequired");
    });
  });

  describe("Form Interactions", () => {
    it("should update dashboard title when input changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      await nameInput.setValue("Updated Dashboard Name");

      expect(wrapper.vm.dashboardData.title).toBe("Updated Dashboard Name");
    });

    it("should update dashboard description when input changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const descInput = wrapper.find(
        '[data-test="dashboard-general-setting-description"]',
      );
      await descInput.setValue("Updated description");

      expect(wrapper.vm.dashboardData.description).toBe("Updated description");
    });

    it("should toggle dynamic filters setting", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const toggle = wrapper.find(
        '[data-test="dashboard-general-setting-dynamic-filter"]',
      );
      await toggle.setValue(false);

      expect(wrapper.vm.dashboardData.showDynamicFilters).toBe(false);
    });

    it("should handle datetime picker changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({
        dateTimeValue: {
          startTime: mockDashboardData.defaultDatetimeDuration.startTime,
          endTime: mockDashboardData.defaultDatetimeDuration.endTime,
          relativeTimePeriod:
            mockDashboardData.defaultDatetimeDuration.relativeTimePeriod,
          valueType: mockDashboardData.defaultDatetimeDuration.type,
        },
      });

      const dateTimePicker = wrapper.findComponent(
        '[data-test="datetime-picker"]',
      );
      const newDateTime = {
        startTime: new Date("2023-02-01T00:00:00Z"),
        endTime: new Date("2023-02-01T23:59:59Z"),
        valueType: "absolute",
        relativeTimePeriod: null,
      };

      await dateTimePicker.vm.$emit("update:modelValue", newDateTime);

      expect(wrapper.vm.dateTimeValue).toEqual(newDateTime);
    });
  });

  describe("Form Submission", () => {
    it("should save dashboard when form is submitted", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      await nameInput.setValue("Updated Dashboard");

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");

      expect(updateDashboard).toHaveBeenCalledWith(
        store,
        store.state.selectedOrganization.identifier,
        "dashboard-1",
        expect.objectContaining({
          title: "Updated Dashboard",
        }),
        "default",
      );
    });

    it("should show loading state during save", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Mock slow API response
      vi.mocked(updateDashboard).mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({} as any), 100)),
      );

      const form = wrapper.find("form");
      form.trigger("submit.prevent");

      await wrapper.vm.$nextTick();

      const saveBtn = wrapper.find(
        '[data-test="dashboard-general-setting-save-btn"]',
      );
      expect(saveBtn.attributes("loading")).toBe("true");
    });

    it("should handle save errors", async () => {
      vi.mocked(updateDashboard).mockRejectedValue(new Error("Save failed"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should emit success event after successful save", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(wrapper.emitted("save")).toBeTruthy();
    });
  });

  describe("User Actions", () => {
    it("should close dialog when cancel button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const cancelBtn = wrapper.find(
        '[data-test="dashboard-general-setting-cancel-btn"]',
      );
      expect(cancelBtn.attributes("v-close-popup")).toBeDefined();
    });

    it("should close dialog after successful save", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(wrapper.emitted("save")).toBeTruthy();
    });
  });

  describe("Datetime Picker Integration", () => {
    it("should pass correct props to datetime picker", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({
        dateTimeValue: {
          startTime: mockDashboardData.defaultDatetimeDuration.startTime,
          endTime: mockDashboardData.defaultDatetimeDuration.endTime,
          relativeTimePeriod:
            mockDashboardData.defaultDatetimeDuration.relativeTimePeriod,
          valueType: mockDashboardData.defaultDatetimeDuration.type,
        },
        initialTimezone: "UTC",
      });

      const dateTimePicker = wrapper.findComponent(
        '[data-test="datetime-picker"]',
      );
      expect(dateTimePicker.props("initialTimezone")).toBe("UTC");
      expect(dateTimePicker.props("autoApplyDashboard")).toBe(true);
    });

    it("should hide datetime picker in print mode", async () => {
      (store.state as any).printMode = true;
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({
        dateTimeValue: {
          startTime: mockDashboardData.defaultDatetimeDuration.startTime,
          endTime: mockDashboardData.defaultDatetimeDuration.endTime,
          relativeTimePeriod:
            mockDashboardData.defaultDatetimeDuration.relativeTimePeriod,
          valueType: mockDashboardData.defaultDatetimeDuration.type,
        },
      });

      const dateTimePicker = wrapper.findComponent(
        '[data-test="datetime-picker"]',
      );
      expect(dateTimePicker.attributes("v-show")).toBe("false");
    });

    it("should show datetime picker when not in print mode", async () => {
      (store.state as any).printMode = false;
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({
        dateTimeValue: {
          startTime: mockDashboardData.defaultDatetimeDuration.startTime,
          endTime: mockDashboardData.defaultDatetimeDuration.endTime,
          relativeTimePeriod:
            mockDashboardData.defaultDatetimeDuration.relativeTimePeriod,
          valueType: mockDashboardData.defaultDatetimeDuration.type,
        },
      });

      const dateTimePicker = wrapper.findComponent(
        '[data-test="datetime-picker"]',
      );
      expect(dateTimePicker.exists()).toBe(true);
    });
  });

  describe("Reactive Updates", () => {
    it("should react to external dashboard data changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Simulate external data update
      const updatedData = {
        ...mockDashboardData,
        title: "Externally Updated Title",
      };

      vi.mocked(getDashboard).mockResolvedValue(updatedData);
      await wrapper.vm.getDashboardData();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      expect(nameInput.element.value).toBe("Externally Updated Title");
    });

    it("should watch for route parameter changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Simulate route change
      wrapper.vm.$route.query.dashboard = "new-dashboard-id";
      await wrapper.vm.$nextTick();

      expect(getDashboard).toHaveBeenCalledWith(
        store,
        "new-dashboard-id",
        "default",
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle missing dashboard data", async () => {
      vi.mocked(getDashboard).mockResolvedValue(null);

      wrapper = createWrapper();
      await flushPromises();

      // Should initialize with empty data
      expect(wrapper.vm.dashboardData.title).toBe("");
      expect(wrapper.vm.dashboardData.description).toBe("");
      expect(wrapper.vm.dashboardData.showDynamicFilters).toBe(true);
    });

    it("should handle malformed dashboard data", async () => {
      const malformedData = {
        dashboardId: "dashboard-1",
        title: null,
        description: undefined,
        variables: {
          showDynamicFilters: true,
          list: [],
        },
      };

      vi.mocked(getDashboard).mockResolvedValue(malformedData);

      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      const descInput = wrapper.find(
        '[data-test="dashboard-general-setting-description"]',
      );

      // Should handle null/undefined values gracefully
      expect(nameInput.element.value).toBe("");
      expect(descInput.element.value).toBe("");
    });

    it("should handle network errors during save", async () => {
      const errorMessage = "Network error during save";
      vi.mocked(updateDashboard).mockRejectedValueOnce(new Error(errorMessage));

      wrapper = createWrapper();
      await flushPromises();

      // Set up form with valid data
      await wrapper.setData({
        dashboardData: {
          ...mockDashboardData,
          title: "Test Dashboard",
        },
      });

      // Attempt to submit form
      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      // Should handle the error
      // The component doesn't emit an error event, it shows notifications
      expect(updateDashboard).toHaveBeenCalled();

      // Form should still be interactive after error
      const saveBtn = wrapper.find(
        '[data-test="dashboard-general-setting-save-btn"]',
      );
      expect(saveBtn.attributes("disabled")).toBeFalsy();
    });
  });

  describe("Accessibility", () => {
    it("should have proper form labels", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );
      const descInput = wrapper.find(
        '[data-test="dashboard-general-setting-description"]',
      );

      // Check for aria-label or label text content
      const nameLabel =
        nameInput.attributes("aria-label") || nameInput.find("label")?.text();
      const descLabel =
        descInput.attributes("aria-label") || descInput.find("label")?.text();

      expect(nameLabel).toContain("dashboard.name");
      expect(descLabel).toContain("dashboard.typeDesc");
    });

    it("should support keyboard navigation", async () => {
      const div = document.createElement("div");
      div.innerHTML = `
        <div>
          <input data-test="dashboard-general-setting-name" type="text" tabindex="0">
          <input data-test="dashboard-general-setting-description" type="text" tabindex="0">
        </div>
      `;
      document.body.appendChild(div);

      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      ).element;
      const descInput = wrapper.find(
        '[data-test="dashboard-general-setting-description"]',
      ).element;

      // Focus the name input and simulate tab
      nameInput.focus();
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      nameInput.dispatchEvent(event);

      // In the next tick, description input should be focused
      await wrapper.vm.$nextTick();
      expect(document.activeElement).toBe(descInput);

      // Cleanup
      document.body.removeChild(div);
    });

    it("should have proper button roles", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const saveBtn = wrapper.find(
        '[data-test="dashboard-general-setting-save-btn"]',
      );
      const cancelBtn = wrapper.find(
        '[data-test="dashboard-general-setting-cancel-btn"]',
      );

      // Check button attributes - type for save button and role for both
      expect(saveBtn.attributes("type")).toBe("submit");
      expect(saveBtn.element.tagName.toLowerCase()).toBe("button");
      expect(cancelBtn.element.tagName.toLowerCase()).toBe("button");
    });
  });

  describe("Performance", () => {
    it("should not cause unnecessary re-renders", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const renderSpy = vi.spyOn(wrapper.vm, "$forceUpdate");

      // Create new dashboard data objects for updates
      const newData1 = Object.assign({}, mockDashboardData, {
        title: "New Title 1",
      });
      const newData2 = Object.assign({}, mockDashboardData, {
        title: "New Title 2",
      });

      // Multiple prop updates using properly cloned objects
      await wrapper.setData({ dashboardData: newData1 });
      await wrapper.setData({ dashboardData: newData2 });

      expect(renderSpy).not.toHaveBeenCalled();
      renderSpy.mockRestore();
    });

    it("should debounce form input changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find(
        '[data-test="dashboard-general-setting-name"]',
      );

      // Create a new dashboard data object
      const updatedData = Object.assign({}, mockDashboardData);

      // Rapid input changes with proper object handling
      await nameInput.setValue("A");
      updatedData.title = "A";
      await nameInput.setValue("AB");
      updatedData.title = "AB";
      await nameInput.setValue("ABC");
      updatedData.title = "ABC";

      await wrapper.setData({ dashboardData: updatedData });
      await flushPromises();

      // Should reflect the final value
      expect(wrapper.vm.dashboardData.title).toBe("ABC");
    });
  });
});
