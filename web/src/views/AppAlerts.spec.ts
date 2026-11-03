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

import { destinationKeys } from "@/services/alert_destination.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

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

// Mock services
vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
    },
  });
});

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

    it("should use current organization identifier in getTemplates", async () => {
      mockStore.state.selectedOrganization.identifier = "custom-org-456";
      const wrapper = createWrapper();

      await wrapper.vm.getTemplates();

      expect(mockTemplateService.list).toHaveBeenCalledWith({
        org_identifier: "custom-org-456",
      });
    });
  });

  describe("Destination Management", () => {
    it("should call destinationService.list with correct parameters in getDestinations", async () => {
      const wrapper = createWrapper();

      await wrapper.vm.getDestinations();

      expect(mockDestinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "test-org-123", module: "alert" }),
      );
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

    it("should serve repeated getDestinations calls from one request", async () => {
      const wrapper = createWrapper();

      await wrapper.vm.getDestinations();
      await wrapper.vm.getDestinations();
      await wrapper.vm.getDestinations();

      expect(mockDestinationService.list).toHaveBeenCalledTimes(1);
    });

    it("should maintain destinations state between calls", async () => {
      const wrapper = createWrapper();
      const firstDestinations = [{ id: 1, name: "First Dest" }];
      const secondDestinations = [{ id: 2, name: "Second Dest" }];

      mockDestinationService.list.mockResolvedValueOnce({ data: firstDestinations });
      await wrapper.vm.getDestinations();
      expect(wrapper.vm.destinations).toEqual(firstDestinations);

      // Cached until something invalidates it — mirrors a destination edit.
      await queryClient.invalidateQueries({ queryKey: destinationKeys.all("test-org-123") });
      mockDestinationService.list.mockResolvedValueOnce({ data: secondDestinations });
      await wrapper.vm.getDestinations();
      expect(wrapper.vm.destinations).toEqual(secondDestinations);
    });

    it("should use current organization identifier in getDestinations", async () => {
      mockStore.state.selectedOrganization.identifier = "custom-org-789";
      const wrapper = createWrapper();

      await wrapper.vm.getDestinations();

      expect(mockDestinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "custom-org-789", module: "alert" }),
      );
    });

    it("should handle null response in getDestinations gracefully", async () => {
      const wrapper = createWrapper();

      mockDestinationService.list.mockResolvedValue({ data: null });

      await wrapper.vm.getDestinations();

      expect(wrapper.vm.destinations).toEqual([]);
    });
  });

  describe("Component Template Structure", () => {
    it("should render main page element", () => {
      const wrapper = createWrapper();
      const qPage = wrapper.find('[data-test="alerts-page"]');
      expect(qPage.exists()).toBe(true);
      expect(qPage.classes()).toContain("p-0");
    });
  });

  describe("Integration and Edge Cases", () => {
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
      // Concurrent destination reads collapse into one in-flight request.
      expect(mockDestinationService.list).toHaveBeenCalledTimes(1);
    });

    it("should handle API returning undefined data", async () => {
      const wrapper = createWrapper();

      mockTemplateService.list.mockResolvedValue({ data: undefined });
      mockDestinationService.list.mockResolvedValue({ data: undefined });

      await wrapper.vm.getTemplates();
      await wrapper.vm.getDestinations();

      expect(wrapper.vm.templates).toBeUndefined();
      // Normalised to an empty list so every consumer can map it unconditionally.
      expect(wrapper.vm.destinations).toEqual([]);
    });
  });
});
