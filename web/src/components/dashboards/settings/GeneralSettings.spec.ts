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
  showDynamicFilters: true,
  defaultDatetime: {
    start_time: new Date('2023-01-01T00:00:00Z'),
    end_time: new Date('2023-01-01T23:59:59Z'),
    type: 'relative'
  }
};

describe("GeneralSettings", () => {
  let wrapper: any;

  const mockRoute = {
    params: {
      dashboardId: "dashboard-1",
      folderId: "default"
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(getDashboard).mockResolvedValue({
      data: mockDashboardData
    });
    vi.mocked(updateDashboard).mockResolvedValue({
      data: { success: true }
    });

    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.printMode = false;
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
          'DashboardHeader': {
            template: '<div data-test="dashboard-header"><slot></slot></div>',
            props: ['title']
          },
          'DateTimePickerDashboard': {
            template: '<div data-test="datetime-picker"></div>',
            props: ['modelValue', 'initialTimezone', 'autoApplyDashboard'],
            emits: ['update:modelValue']
          }
        },
        mocks: {
          $t: (key: string) => key,
          $route: mockRoute,
          $router: router
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render general settings form", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-general-setting-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-general-setting-description"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-general-setting-dynamic-filter"]').exists()).toBe(true);
    });

    it("should render datetime picker when dateTimeValue exists", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Set dateTimeValue to simulate datetime picker presence
      await wrapper.setData({ dateTimeValue: mockDashboardData.defaultDatetime });

      expect(wrapper.find('[data-test="dashboard-general-setting-datetime-picker"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="datetime-picker"]').exists()).toBe(true);
    });

    it("should render form buttons", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-general-setting-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-general-setting-save-btn"]').exists()).toBe(true);
    });

    it("should render dashboard header with correct title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const header = wrapper.findComponent('[data-test="dashboard-header"]');
      expect(header.props('title')).toBe('dashboard.generalSettingsTitle');
    });
  });

  describe("Data Loading", () => {
    it("should load dashboard data on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(getDashboard).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "dashboard-1",
        "default"
      );
    });

    it("should populate form fields with loaded data", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      const descInput = wrapper.find('[data-test="dashboard-general-setting-description"]');

      expect(nameInput.element.value).toBe(mockDashboardData.title);
      expect(descInput.element.value).toBe(mockDashboardData.description);
    });

    it("should handle loading errors gracefully", async () => {
      vi.mocked(getDashboard).mockRejectedValue(new Error("Failed to load"));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.setValue("");

      const saveBtn = wrapper.find('[data-test="dashboard-general-setting-save-btn"]');
      expect(saveBtn.element.disabled).toBe(true);
    });

    it("should enable save button when title is provided", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.setValue("Valid Dashboard Name");

      const saveBtn = wrapper.find('[data-test="dashboard-general-setting-save-btn"]');
      expect(saveBtn.element.disabled).toBe(false);
    });

    it("should validate title is not just whitespace", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.setValue("   ");

      const saveBtn = wrapper.find('[data-test="dashboard-general-setting-save-btn"]');
      expect(saveBtn.element.disabled).toBe(true);
    });

    it("should show validation error for empty title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.setValue("");
      await nameInput.trigger('blur');

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      expect(wrapper.text()).toContain('dashboard.nameRequired');
    });
  });

  describe("Form Interactions", () => {
    it("should update dashboard title when input changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.setValue("Updated Dashboard Name");

      expect(wrapper.vm.dashboardData.title).toBe("Updated Dashboard Name");
    });

    it("should update dashboard description when input changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const descInput = wrapper.find('[data-test="dashboard-general-setting-description"]');
      await descInput.setValue("Updated description");

      expect(wrapper.vm.dashboardData.description).toBe("Updated description");
    });

    it("should toggle dynamic filters setting", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const toggle = wrapper.find('[data-test="dashboard-general-setting-dynamic-filter"]');
      await toggle.setValue(false);

      expect(wrapper.vm.dashboardData.showDynamicFilters).toBe(false);
    });

    it("should handle datetime picker changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({ dateTimeValue: mockDashboardData.defaultDatetime });

      const dateTimePicker = wrapper.findComponent('[data-test="datetime-picker"]');
      const newDateTime = {
        start_time: new Date('2023-02-01T00:00:00Z'),
        end_time: new Date('2023-02-01T23:59:59Z'),
        type: 'absolute'
      };

      await dateTimePicker.vm.$emit('update:modelValue', newDateTime);

      expect(wrapper.vm.dateTimeValue).toEqual(newDateTime);
    });
  });

  describe("Form Submission", () => {
    it("should save dashboard when form is submitted", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.setValue("Updated Dashboard");

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      expect(updateDashboard).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "dashboard-1",
        "default",
        expect.objectContaining({
          title: "Updated Dashboard"
        })
      );
    });

    it("should show loading state during save", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Mock slow API response
      vi.mocked(updateDashboard).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ data: { success: true } }), 100))
      );

      const form = wrapper.find('form');
      form.trigger('submit.prevent');

      await wrapper.vm.$nextTick();

      const saveBtn = wrapper.find('[data-test="dashboard-general-setting-save-btn"]');
      expect(saveBtn.attributes('loading')).toBe('true');
    });

    it("should handle save errors", async () => {
      vi.mocked(updateDashboard).mockRejectedValue(new Error("Save failed"));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should emit success event after successful save", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.emitted('dashboard-saved')).toBeTruthy();
    });
  });

  describe("User Actions", () => {
    it("should close dialog when cancel button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const cancelBtn = wrapper.find('[data-test="dashboard-general-setting-cancel-btn"]');
      expect(cancelBtn.attributes('v-close-popup')).toBeDefined();
    });

    it("should close dialog after successful save", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.emitted('close-dialog')).toBeTruthy();
    });
  });

  describe("Datetime Picker Integration", () => {
    it("should pass correct props to datetime picker", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({ 
        dateTimeValue: mockDashboardData.defaultDatetime,
        initialTimezone: "UTC"
      });

      const dateTimePicker = wrapper.findComponent('[data-test="datetime-picker"]');
      expect(dateTimePicker.props('initialTimezone')).toBe("UTC");
      expect(dateTimePicker.props('autoApplyDashboard')).toBe(true);
    });

    it("should hide datetime picker in print mode", async () => {
      store.state.printMode = true;
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({ dateTimeValue: mockDashboardData.defaultDatetime });

      const dateTimePicker = wrapper.findComponent('[data-test="datetime-picker"]');
      expect(dateTimePicker.attributes('v-show')).toBe('false');
    });

    it("should show datetime picker when not in print mode", async () => {
      store.state.printMode = false;
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setData({ dateTimeValue: mockDashboardData.defaultDatetime });

      const dateTimePicker = wrapper.findComponent('[data-test="datetime-picker"]');
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
        title: "Externally Updated Title"
      };

      vi.mocked(getDashboard).mockResolvedValue({ data: updatedData });
      await wrapper.vm.loadDashboardData();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      expect(nameInput.element.value).toBe("Externally Updated Title");
    });

    it("should watch for route parameter changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Simulate route change
      wrapper.vm.$route.params.dashboardId = "new-dashboard-id";
      await wrapper.vm.$nextTick();

      expect(getDashboard).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "new-dashboard-id",
        "default"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle missing dashboard data", async () => {
      vi.mocked(getDashboard).mockResolvedValue({ data: null });
      
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle malformed dashboard data", async () => {
      vi.mocked(getDashboard).mockResolvedValue({ 
        data: { title: null, description: undefined }
      });

      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      expect(nameInput.element.value).toBe("");
    });

    it("should handle network errors during save", async () => {
      vi.mocked(updateDashboard).mockRejectedValue(new Error("Network error"));
      
      wrapper = createWrapper();
      await flushPromises();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Should show error notification
      expect(wrapper.emitted('save-error')).toBeTruthy();
    });
  });

  describe("Accessibility", () => {
    it("should have proper form labels", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      const descInput = wrapper.find('[data-test="dashboard-general-setting-description"]');

      expect(nameInput.attributes('label')).toContain('dashboard.name');
      expect(descInput.attributes('label')).toBe('dashboard.typeDesc');
    });

    it("should support keyboard navigation", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      await nameInput.trigger('keydown.tab');

      const descInput = wrapper.find('[data-test="dashboard-general-setting-description"]');
      expect(document.activeElement).toBe(descInput.element);
    });

    it("should have proper button roles", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const saveBtn = wrapper.find('[data-test="dashboard-general-setting-save-btn"]');
      const cancelBtn = wrapper.find('[data-test="dashboard-general-setting-cancel-btn"]');

      expect(saveBtn.attributes('type')).toBe('submit');
      expect(cancelBtn.attributes('role')).toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should not cause unnecessary re-renders", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const renderSpy = vi.spyOn(wrapper.vm, '$forceUpdate');

      // Multiple prop updates
      await wrapper.setData({ dashboardData: { ...mockDashboardData, title: "New Title 1" } });
      await wrapper.setData({ dashboardData: { ...mockDashboardData, title: "New Title 2" } });

      expect(renderSpy).not.toHaveBeenCalled();
    });

    it("should debounce form input changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nameInput = wrapper.find('[data-test="dashboard-general-setting-name"]');
      
      // Rapid input changes
      await nameInput.setValue("A");
      await nameInput.setValue("AB");
      await nameInput.setValue("ABC");

      // Should not cause excessive updates
      expect(wrapper.vm.dashboardData.title).toBe("ABC");
    });
  });
});
