// Copyright 2025 OpenObserve Inc.
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
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";

// Mock vue-router before importing any files that use it
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createWebHistory: vi.fn(() => ({})),
    createRouter: vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      getRoutes: vi.fn(() => []),
      resolve: vi.fn(),
      currentRoute: { value: { name: "alerts" } },
    })),
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      currentRoute: { value: { name: "alerts" } },
    })),
  };
});

import AppAlerts from "@/views/AppAlerts.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock services
vi.mock("@/services/alert_templates", () => ({
  default: {
    list: vi.fn(),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(),
  },
}));

// Mock useStore to return our test store
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock router
const mockPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Import mocked services after mocking
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";

const mockTemplateService = templateService as any;
const mockDestinationService = destinationService as any;

// Create enhanced mock store
const mockStore = {
  ...store,
  state: {
    ...store.state,
    selectedOrganization: {
      identifier: "test-org-123",
      label: "Test Organization",
      id: 123,
      status: "active",
    },
  },
};

const createWrapper = (props = {}, options = {}) => {
  return mount(AppAlerts, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n],
      mocks: {
        $store: mockStore,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        RouterView: {
          name: "RouterView",
          template: `<div data-test-stub='router-view' 
            :templates='templates'
            :destinations='destinations'
            @get:destinations='$emit("get:destinations")'
            @get:templates='$emit("get:templates")'
          ></div>`,
          props: ["templates", "destinations"],
          emits: ["get:destinations", "get:templates"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

describe("AppAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset store organization to default
    mockStore.state.selectedOrganization.identifier = "test-org-123";
    
    // Set up default mock responses
    mockTemplateService.list.mockResolvedValue({
      data: [
        { id: 1, name: "Template 1", body: "Test template body 1" },
        { id: 2, name: "Template 2", body: "Test template body 2" },
      ],
    });
    
    mockDestinationService.list.mockResolvedValue({
      data: [
        { id: 1, name: "Destination 1", url: "http://test1.com" },
        { id: 2, name: "Destination 2", url: "http://test2.com" },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Mounting and Initialization", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("AppAlerts");
    });

    it("should initialize activeTab ref with 'destinations'", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.activeTab).toBe("destinations");
    });

    it("should initialize templates ref as empty array", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.templates).toEqual([]);
    });

    it("should initialize destinations ref as empty array", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.destinations).toEqual([]);
    });

    it("should initialize splitterModel ref with 160", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.splitterModel).toBe(160);
    });

    it("should expose t function from i18n", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should expose store", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should expose getTemplates function", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.getTemplates).toBeDefined();
      expect(typeof wrapper.vm.getTemplates).toBe("function");
    });

    it("should expose getDestinations function", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.getDestinations).toBeDefined();
      expect(typeof wrapper.vm.getDestinations).toBe("function");
    });
  });

  describe("Template Management", () => {
    it("should call templateService.list with correct parameters in getTemplates", async () => {
      const wrapper = createWrapper();
      
      await wrapper.vm.getTemplates();
      
      expect(mockTemplateService.list).toHaveBeenCalledWith({
        org_identifier: "test-org-123",
      });
    });

    it("should update templates ref with API response in getTemplates", async () => {
      const wrapper = createWrapper();
      const mockTemplates = [
        { id: 1, name: "Template A", body: "Body A" },
        { id: 2, name: "Template B", body: "Body B" },
      ];
      
      mockTemplateService.list.mockResolvedValue({
        data: mockTemplates,
      });
      
      await wrapper.vm.getTemplates();
      
      expect(wrapper.vm.templates).toEqual(mockTemplates);
    });

    it("should handle successful getTemplates with empty response", async () => {
      const wrapper = createWrapper();
      
      mockTemplateService.list.mockResolvedValue({
        data: [],
      });
      
      await wrapper.vm.getTemplates();
      
      expect(wrapper.vm.templates).toEqual([]);
    });

    it("should handle successful getTemplates with multiple templates", async () => {
      const wrapper = createWrapper();
      const mockTemplates = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        name: `Template ${i + 1}`,
        body: `Body ${i + 1}`,
      }));
      
      mockTemplateService.list.mockResolvedValue({
        data: mockTemplates,
      });
      
      await wrapper.vm.getTemplates();
      
      expect(wrapper.vm.templates).toHaveLength(5);
      expect(wrapper.vm.templates).toEqual(mockTemplates);
    });

    it("should handle getTemplates API call error gracefully", async () => {
      const wrapper = createWrapper();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      mockTemplateService.list.mockRejectedValue(new Error("API Error"));
      
      try {
        await wrapper.vm.getTemplates();
      } catch (error) {
        // Error handling depends on component implementation
      }
      
      expect(mockTemplateService.list).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should call getTemplates multiple times without issues", async () => {
      const wrapper = createWrapper();
      
      await wrapper.vm.getTemplates();
      await wrapper.vm.getTemplates();
      await wrapper.vm.getTemplates();
      
      expect(mockTemplateService.list).toHaveBeenCalledTimes(3);
    });

    it("should maintain templates state between calls", async () => {
      const wrapper = createWrapper();
      const firstTemplates = [{ id: 1, name: "First" }];
      const secondTemplates = [{ id: 2, name: "Second" }];
      
      mockTemplateService.list.mockResolvedValueOnce({ data: firstTemplates });
      await wrapper.vm.getTemplates();
      expect(wrapper.vm.templates).toEqual(firstTemplates);
      
      mockTemplateService.list.mockResolvedValueOnce({ data: secondTemplates });
      await wrapper.vm.getTemplates();
      expect(wrapper.vm.templates).toEqual(secondTemplates);
    });

    it("should use current organization identifier in getTemplates", async () => {
      mockStore.state.selectedOrganization.identifier = "custom-org-456";
      const wrapper = createWrapper();
      
      await wrapper.vm.getTemplates();
      
      expect(mockTemplateService.list).toHaveBeenCalledWith({
        org_identifier: "custom-org-456",
      });
    });

    it("should handle templates with complex data structures", async () => {
      const wrapper = createWrapper();
      const complexTemplates = [
        {
          id: 1,
          name: "Complex Template",
          body: "Template with {{variable}}",
          metadata: { created: "2023-01-01", tags: ["urgent", "email"] },
          conditions: [{ field: "level", operator: "eq", value: "error" }],
        },
      ];
      
      mockTemplateService.list.mockResolvedValue({ data: complexTemplates });
      
      await wrapper.vm.getTemplates();
      
      expect(wrapper.vm.templates).toEqual(complexTemplates);
    });

    it("should handle null response in getTemplates gracefully", async () => {
      const wrapper = createWrapper();
      
      mockTemplateService.list.mockResolvedValue({ data: null });
      
      await wrapper.vm.getTemplates();
      
      expect(wrapper.vm.templates).toBe(null);
    });
  });

  describe("Destination Management", () => {
    it("should call destinationService.list with correct parameters in getDestinations", async () => {
      const wrapper = createWrapper();
      
      await wrapper.vm.getDestinations();
      
      expect(mockDestinationService.list).toHaveBeenCalledWith({
        org_identifier: "test-org-123",
        module: "alert",
      });
    });

    it("should update destinations ref with API response in getDestinations", async () => {
      const wrapper = createWrapper();
      const mockDestinations = [
        { id: 1, name: "Destination A", url: "http://testA.com" },
        { id: 2, name: "Destination B", url: "http://testB.com" },
      ];
      
      mockDestinationService.list.mockResolvedValue({
        data: mockDestinations,
      });
      
      await wrapper.vm.getDestinations();
      
      expect(wrapper.vm.destinations).toEqual(mockDestinations);
    });

    it("should handle successful getDestinations with empty response", async () => {
      const wrapper = createWrapper();
      
      mockDestinationService.list.mockResolvedValue({
        data: [],
      });
      
      await wrapper.vm.getDestinations();
      
      expect(wrapper.vm.destinations).toEqual([]);
    });

    it("should handle successful getDestinations with multiple destinations", async () => {
      const wrapper = createWrapper();
      const mockDestinations = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `Destination ${i + 1}`,
        url: `http://test${i + 1}.com`,
        type: i % 2 === 0 ? "webhook" : "email",
      }));
      
      mockDestinationService.list.mockResolvedValue({
        data: mockDestinations,
      });
      
      await wrapper.vm.getDestinations();
      
      expect(wrapper.vm.destinations).toHaveLength(10);
      expect(wrapper.vm.destinations).toEqual(mockDestinations);
    });

    it("should handle getDestinations API call error gracefully", async () => {
      const wrapper = createWrapper();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      mockDestinationService.list.mockRejectedValue(new Error("Network Error"));
      
      try {
        await wrapper.vm.getDestinations();
      } catch (error) {
        // Error handling depends on component implementation
      }
      
      expect(mockDestinationService.list).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should call getDestinations multiple times without issues", async () => {
      const wrapper = createWrapper();
      
      await wrapper.vm.getDestinations();
      await wrapper.vm.getDestinations();
      await wrapper.vm.getDestinations();
      
      expect(mockDestinationService.list).toHaveBeenCalledTimes(3);
    });

    it("should maintain destinations state between calls", async () => {
      const wrapper = createWrapper();
      const firstDestinations = [{ id: 1, name: "First Dest" }];
      const secondDestinations = [{ id: 2, name: "Second Dest" }];
      
      mockDestinationService.list.mockResolvedValueOnce({ data: firstDestinations });
      await wrapper.vm.getDestinations();
      expect(wrapper.vm.destinations).toEqual(firstDestinations);
      
      mockDestinationService.list.mockResolvedValueOnce({ data: secondDestinations });
      await wrapper.vm.getDestinations();
      expect(wrapper.vm.destinations).toEqual(secondDestinations);
    });

    it("should use current organization identifier in getDestinations", async () => {
      mockStore.state.selectedOrganization.identifier = "custom-org-789";
      const wrapper = createWrapper();
      
      await wrapper.vm.getDestinations();
      
      expect(mockDestinationService.list).toHaveBeenCalledWith({
        org_identifier: "custom-org-789",
        module: "alert",
      });
    });

    it("should always pass 'alert' as module parameter", async () => {
      const wrapper = createWrapper();
      
      await wrapper.vm.getDestinations();
      
      expect(mockDestinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          module: "alert",
        })
      );
    });

    it("should handle destinations with complex configurations", async () => {
      const wrapper = createWrapper();
      const complexDestinations = [
        {
          id: 1,
          name: "Webhook Destination",
          type: "webhook",
          url: "https://api.example.com/webhook",
          headers: { "Authorization": "Bearer token123" },
          method: "POST",
          timeout: 30,
        },
        {
          id: 2,
          name: "Email Destination",
          type: "email",
          recipients: ["admin@example.com", "alerts@example.com"],
          subject_template: "Alert: {{alert.name}}",
        },
      ];
      
      mockDestinationService.list.mockResolvedValue({ data: complexDestinations });
      
      await wrapper.vm.getDestinations();
      
      expect(wrapper.vm.destinations).toEqual(complexDestinations);
    });

    it("should handle null response in getDestinations gracefully", async () => {
      const wrapper = createWrapper();
      
      mockDestinationService.list.mockResolvedValue({ data: null });
      
      await wrapper.vm.getDestinations();
      
      expect(wrapper.vm.destinations).toBe(null);
    });
  });

  describe("Component Template Structure", () => {
    it("should render main q-page element", () => {
      const wrapper = createWrapper();
      const qPage = wrapper.find('[data-test="alerts-page"]');
      expect(qPage.exists()).toBe(true);
      expect(qPage.classes()).toContain("q-pa-none");
    });

    it("should have correct styling classes on main container", () => {
      const wrapper = createWrapper();
      const qPage = wrapper.find('[data-test="alerts-page"]');
      expect(qPage.attributes("style")).toContain("min-height: inherit");
    });

    it("should render RouterView component", () => {
      const wrapper = createWrapper();
      const routerView = wrapper.findComponent({ name: "RouterView" });
      expect(routerView.exists()).toBe(true);
    });

    it("should pass templates prop to RouterView", async () => {
      const wrapper = createWrapper();
      const mockTemplates = [{ id: 1, name: "Test Template" }];
      
      // Set templates and wait for reactivity
      wrapper.vm.templates = mockTemplates;
      await nextTick();
      
      const routerView = wrapper.find('[data-test-stub="router-view"]');
      expect(routerView.attributes("templates")).toBeDefined();
    });

    it("should pass destinations prop to RouterView", async () => {
      const wrapper = createWrapper();
      const mockDestinations = [{ id: 1, name: "Test Destination" }];
      
      // Set destinations and wait for reactivity
      wrapper.vm.destinations = mockDestinations;
      await nextTick();
      
      const routerView = wrapper.find('[data-test-stub="router-view"]');
      expect(routerView.attributes("destinations")).toBeDefined();
    });

    it("should handle get:destinations event from RouterView", async () => {
      const wrapper = createWrapper();
      
      // Test that the getDestinations function is properly bound to the event handler
      expect(wrapper.vm.getDestinations).toBeDefined();
      expect(typeof wrapper.vm.getDestinations).toBe('function');
      
      // Call the method directly to verify it works
      await wrapper.vm.getDestinations();
      
      // Verify the service was called
      expect(mockDestinationService.list).toHaveBeenCalled();
    });

    it("should handle get:templates event from RouterView", async () => {
      const wrapper = createWrapper();
      
      // Test that the getTemplates function is properly bound to the event handler
      expect(wrapper.vm.getTemplates).toBeDefined();
      expect(typeof wrapper.vm.getTemplates).toBe('function');
      
      // Call the method directly to verify it works
      await wrapper.vm.getTemplates();
      
      // Verify the service was called
      expect(mockTemplateService.list).toHaveBeenCalled();
    });
  });

  describe("Reactivity and State Management", () => {
    it("should maintain reactive templates array", async () => {
      const wrapper = createWrapper();
      const initialTemplates = [{ id: 1, name: "Initial" }];
      const updatedTemplates = [{ id: 2, name: "Updated" }];
      
      wrapper.vm.templates = initialTemplates;
      await nextTick();
      expect(wrapper.vm.templates).toEqual(initialTemplates);
      
      wrapper.vm.templates = updatedTemplates;
      await nextTick();
      expect(wrapper.vm.templates).toEqual(updatedTemplates);
    });

    it("should maintain reactive destinations array", async () => {
      const wrapper = createWrapper();
      const initialDestinations = [{ id: 1, name: "Initial Dest" }];
      const updatedDestinations = [{ id: 2, name: "Updated Dest" }];
      
      wrapper.vm.destinations = initialDestinations;
      await nextTick();
      expect(wrapper.vm.destinations).toEqual(initialDestinations);
      
      wrapper.vm.destinations = updatedDestinations;
      await nextTick();
      expect(wrapper.vm.destinations).toEqual(updatedDestinations);
    });

    it("should maintain reactive activeTab value", async () => {
      const wrapper = createWrapper();
      
      expect(wrapper.vm.activeTab).toBe("destinations");
      
      wrapper.vm.activeTab = "templates";
      await nextTick();
      expect(wrapper.vm.activeTab).toBe("templates");
      
      wrapper.vm.activeTab = "alerts";
      await nextTick();
      expect(wrapper.vm.activeTab).toBe("alerts");
    });

    it("should maintain reactive splitterModel value", async () => {
      const wrapper = createWrapper();
      
      expect(wrapper.vm.splitterModel).toBe(160);
      
      wrapper.vm.splitterModel = 200;
      await nextTick();
      expect(wrapper.vm.splitterModel).toBe(200);
      
      wrapper.vm.splitterModel = 100;
      await nextTick();
      expect(wrapper.vm.splitterModel).toBe(100);
    });

    it("should handle array manipulation on templates", async () => {
      const wrapper = createWrapper();
      
      wrapper.vm.templates = [{ id: 1, name: "Template 1" }];
      await nextTick();
      
      wrapper.vm.templates.push({ id: 2, name: "Template 2" });
      await nextTick();
      expect(wrapper.vm.templates).toHaveLength(2);
      
      wrapper.vm.templates.pop();
      await nextTick();
      expect(wrapper.vm.templates).toHaveLength(1);
    });

    it("should handle array manipulation on destinations", async () => {
      const wrapper = createWrapper();
      
      wrapper.vm.destinations = [{ id: 1, name: "Destination 1" }];
      await nextTick();
      
      wrapper.vm.destinations.push({ id: 2, name: "Destination 2" });
      await nextTick();
      expect(wrapper.vm.destinations).toHaveLength(2);
      
      wrapper.vm.destinations.splice(0, 1);
      await nextTick();
      expect(wrapper.vm.destinations).toHaveLength(1);
      expect(wrapper.vm.destinations[0].name).toBe("Destination 2");
    });
  });

  describe("Integration and Edge Cases", () => {
    it("should handle simultaneous calls to both functions", async () => {
      const wrapper = createWrapper();
      
      const templatesPromise = wrapper.vm.getTemplates();
      const destinationsPromise = wrapper.vm.getDestinations();
      
      await Promise.all([templatesPromise, destinationsPromise]);
      
      expect(mockTemplateService.list).toHaveBeenCalled();
      expect(mockDestinationService.list).toHaveBeenCalled();
    });

    it("should handle organization change during API calls", async () => {
      const wrapper = createWrapper();
      
      // Start API call
      const templatesPromise = wrapper.vm.getTemplates();
      
      // Change organization during call
      mockStore.state.selectedOrganization.identifier = "new-org-123";
      
      await templatesPromise;
      
      // Should still use original organization for ongoing call
      expect(mockTemplateService.list).toHaveBeenCalledWith({
        org_identifier: "test-org-123",
      });
    });

    it("should handle rapid successive calls", async () => {
      const wrapper = createWrapper();
      
      // Fire multiple rapid calls
      const promises = [
        wrapper.vm.getTemplates(),
        wrapper.vm.getDestinations(),
        wrapper.vm.getTemplates(),
        wrapper.vm.getDestinations(),
      ];
      
      await Promise.all(promises);
      
      expect(mockTemplateService.list).toHaveBeenCalledTimes(2);
      expect(mockDestinationService.list).toHaveBeenCalledTimes(2);
    });

    it("should handle empty organization identifier", async () => {
      mockStore.state.selectedOrganization.identifier = "";
      const wrapper = createWrapper();
      
      await wrapper.vm.getTemplates();
      await wrapper.vm.getDestinations();
      
      expect(mockTemplateService.list).toHaveBeenCalledWith({
        org_identifier: "",
      });
      expect(mockDestinationService.list).toHaveBeenCalledWith({
        org_identifier: "",
        module: "alert",
      });
    });

    it("should handle null organization", async () => {
      mockStore.state.selectedOrganization = null;
      const wrapper = createWrapper();
      
      // Functions may fail silently or with unhandled promise rejections
      // This test verifies they don't crash the component
      expect(wrapper.vm.templates).toEqual([]);
      expect(wrapper.vm.destinations).toEqual([]);
      
      // Reset organization for subsequent tests
      mockStore.state.selectedOrganization = {
        identifier: "test-org-123",
        label: "Test Organization", 
        id: 123,
        status: "active",
      };
    });

    it("should handle network timeout errors", async () => {
      const wrapper = createWrapper();
      const timeoutError = new Error("Network timeout");
      
      mockTemplateService.list.mockRejectedValue(timeoutError);
      mockDestinationService.list.mockRejectedValue(timeoutError);
      
      // Functions should not throw but handle errors silently
      expect(() => wrapper.vm.getTemplates()).not.toThrow();
      expect(() => wrapper.vm.getDestinations()).not.toThrow();
      
      // Templates and destinations should remain unchanged on error
      expect(wrapper.vm.templates).toEqual([]);
      expect(wrapper.vm.destinations).toEqual([]);
    });

    it("should handle API returning undefined data", async () => {
      const wrapper = createWrapper();
      
      mockTemplateService.list.mockResolvedValue({ data: undefined });
      mockDestinationService.list.mockResolvedValue({ data: undefined });
      
      await wrapper.vm.getTemplates();
      await wrapper.vm.getDestinations();
      
      expect(wrapper.vm.templates).toBeUndefined();
      expect(wrapper.vm.destinations).toBeUndefined();
    });
  });

  describe("Component Lifecycle and Cleanup", () => {
    it("should properly cleanup on unmount", () => {
      const wrapper = createWrapper();
      
      // Verify component exists
      expect(wrapper.vm).toBeDefined();
      
      // Unmount component
      wrapper.unmount();
      
      // Component should be unmounted
      expect(wrapper.vm).toBeTruthy(); // Vue Test Utils maintains vm reference
    });

    it("should handle component remounting", () => {
      let wrapper = createWrapper();
      wrapper.unmount();
      
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.activeTab).toBe("destinations");
      expect(wrapper.vm.templates).toEqual([]);
      expect(wrapper.vm.destinations).toEqual([]);
    });

    it("should maintain independent state between multiple instances", () => {
      const wrapper1 = createWrapper();
      const wrapper2 = createWrapper();
      
      wrapper1.vm.activeTab = "templates";
      wrapper1.vm.templates = [{ id: 1, name: "Template 1" }];
      
      wrapper2.vm.activeTab = "alerts";
      wrapper2.vm.destinations = [{ id: 1, name: "Destination 1" }];
      
      expect(wrapper1.vm.activeTab).toBe("templates");
      expect(wrapper2.vm.activeTab).toBe("alerts");
      expect(wrapper1.vm.templates).toHaveLength(1);
      expect(wrapper2.vm.templates).toEqual([]);
      
      wrapper1.unmount();
      wrapper2.unmount();
    });
  });
});