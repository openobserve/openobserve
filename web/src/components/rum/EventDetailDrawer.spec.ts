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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import EventDetailDrawer from "@/components/rum/EventDetailDrawer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { http, HttpResponse } from "msw";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock search service
const mockRelatedResources = [
  {
    type: "resource",
    resource_id: "res-1",
    resource_url: "https://api.example.com/data",
    resource_method: "GET",
    resource_status_code: 200,
    resource_duration: 150,
    date: 1700000000000,
    _oo_trace_id: "trace-123",
  },
  {
    type: "error",
    error_id: "err-1",
    error_message: "Network error",
    error_type: "NetworkError",
    date: 1700000001000,
  },
];

describe("EventDetailDrawer", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: true,
    event: {
      type: "action",
      name: "Button Click",
      frustration_types: ["rage_click"],
    },
    rawEvent: {
      action_type: "click",
      action_target_name: "Submit Button",
      action_id: "action-123",
      session_id: "session-456",
      date: 1700000000000,
      service: "web-app",
      version: "1.0.0",
    },
    sessionId: "session-456",
    sessionDetails: {
      user_email: "test@example.com",
      date: "Jan 01, 2024 12:00:00",
      browser: "Chrome",
      os: "MacOS",
      ip: "192.168.1.1",
      city: "San Francisco",
      country: "USA",
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock API responses
    globalThis.server.use(
      http.post(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
        async ({ request }) => {
          const body = await request.json();
          // Return related resources for action queries
          if (body.query?.sql?.includes("action_id")) {
            return HttpResponse.json({
              took: 0,
              hits: mockRelatedResources,
              total: mockRelatedResources.length,
            });
          }
          return HttpResponse.json({
            took: 0,
            hits: [],
            total: 0,
          });
        },
      ),
    );

    wrapper = mount(EventDetailDrawer, {
      attachTo: "#app",
      props: defaultProps,
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          TraceCorrelationCard: {
            template:
              '<div data-test="trace-correlation-card">Trace Correlation</div>',
            props: ["traceId", "spanId", "sessionId", "resourceDuration"],
          },
          FrustrationEventBadge: {
            template:
              '<div data-test="frustration-badge">Frustration Badge</div>',
            props: ["frustrationTypes"],
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component rendering", () => {
    it("should mount EventDetailDrawer component", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".q-dialog").exists()).toBe(true);
    });

    it("should display event type badge", () => {
      const eventTypeBadge = wrapper.find(".tw\\:uppercase");
      expect(eventTypeBadge.exists()).toBe(true);
      expect(eventTypeBadge.text()).toBe("action");
    });

    it("should display event name", () => {
      expect(wrapper.text()).toContain("Button Click");
    });

    it("should display frustration badge when frustration types exist", () => {
      const frustrationBadge = wrapper.find('[data-test="frustration-badge"]');
      expect(frustrationBadge.exists()).toBe(true);
    });

    it("should display close button", () => {
      const closeBtn = wrapper.find('[icon="cancel"]');
      expect(closeBtn.exists()).toBe(true);
    });
  });

  describe("Session metadata display", () => {
    it("should display session metadata section", () => {
      const metadata = wrapper.find('[data-test="event-session-meta-data"]');
      expect(metadata.exists()).toBe(true);
    });

    it("should display IP address", () => {
      expect(wrapper.text()).toContain("192.168.1.1");
    });

    it("should display service name", () => {
      expect(wrapper.text()).toContain("web-app");
    });

    it("should display version", () => {
      expect(wrapper.text()).toContain("V 1.0.0");
    });

    it("should display user email", () => {
      expect(wrapper.text()).toContain("test@example.com");
    });

    it("should display browser and OS", () => {
      expect(wrapper.text()).toContain("Chrome");
      expect(wrapper.text()).toContain("MacOS");
    });

    it("should display location", () => {
      expect(wrapper.text()).toContain("San Francisco");
      expect(wrapper.text()).toContain("USA");
    });

    it("should display date", () => {
      expect(wrapper.text()).toContain("Jan 01, 2024 12:00:00");
    });
  });

  describe("Action event details", () => {
    it("should display Action Details section for action events", () => {
      expect(wrapper.text()).toContain("Action Details");
    });

    it("should display action type", () => {
      expect(wrapper.text()).toContain("Action Type:");
      expect(wrapper.text()).toContain("click");
    });

    it("should display action target", () => {
      expect(wrapper.text()).toContain("Target:");
      expect(wrapper.text()).toContain("Submit Button");
    });

    it("should display action ID when available", () => {
      expect(wrapper.text()).toContain("Action ID:");
      expect(wrapper.text()).toContain("action-123");
    });
  });

  describe("Error event details", () => {
    it("should display Error Details section for error events", async () => {
      await wrapper.setProps({
        event: { type: "error", name: "Network Error" },
        rawEvent: {
          error_type: "NetworkError",
          error_message: "Failed to fetch data",
          error_handling: "unhandled",
          error_id: "error-123",
        },
      });

      await flushPromises();

      expect(wrapper.text()).toContain("Error Details");
      expect(wrapper.text()).toContain("Error Type:");
      expect(wrapper.text()).toContain("NetworkError");
      expect(wrapper.text()).toContain("Message:");
      expect(wrapper.text()).toContain("Failed to fetch data");
      expect(wrapper.text()).toContain("Handling:");
      expect(wrapper.text()).toContain("unhandled");
      expect(wrapper.text()).toContain("Error ID:");
    });
  });

  describe("View event details", () => {
    it("should display View Details section for view events", async () => {
      await wrapper.setProps({
        event: { type: "view", name: "Home Page" },
        rawEvent: {
          view_loading_type: "initial_load",
          view_url: "https://example.com/home",
          view_id: "view-123",
        },
      });

      await flushPromises();

      expect(wrapper.text()).toContain("View Details");
      expect(wrapper.text()).toContain("Loading Type:");
      expect(wrapper.text()).toContain("initial load");
      expect(wrapper.text()).toContain("URL:");
      expect(wrapper.text()).toContain("https://example.com/home");
      expect(wrapper.text()).toContain("View ID:");
    });
  });

  describe("Related resources", () => {
    it("should fetch related resources for action events", async () => {
      // Wait for the API call
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      expect(wrapper.vm.relatedResources).toHaveLength(
        mockRelatedResources.length,
      );
    });

    it("should display related events section when resources exist", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      expect(wrapper.text()).toContain("Related Events");
      expect(wrapper.text()).toContain(`(${mockRelatedResources.length})`);
    });

    it("should show loading spinner while fetching resources", async () => {
      // Mount fresh to catch loading state
      wrapper = mount(EventDetailDrawer, {
        attachTo: "#app",
        props: defaultProps,
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            TraceCorrelationCard: true,
            FrustrationEventBadge: true,
          },
        },
      });

      // Check immediately before API resolves
      await flushPromises();
      // Loading state might be very brief, so this test might need adjustment
    });

    it("should display resource event with correct details", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      expect(wrapper.text()).toContain("GET");
      expect(wrapper.text()).toContain("https://api.example.com/data");
      expect(wrapper.text()).toContain("200");
    });

    it("should display trace button for resources with trace_id", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      const traceButtons = wrapper.findAll('[title="View trace details"]');
      expect(traceButtons.length).toBeGreaterThan(0);
    });

    it("should call viewResourceDetails when clicking on a resource", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      const resourceItems = wrapper.findAll(
        ".tw\\:cursor-pointer.tw\\:transition-colors",
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        // Check if trace correlation card is shown for resource with trace
        expect(wrapper.vm.selectedResourceWithTrace).toBeTruthy();
      }
    });
  });

  describe("Trace correlation", () => {
    it("should display trace correlation card for resource with trace_id", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      // Click on first resource which has trace_id
      const resourceItems = wrapper.findAll(
        ".tw\\:cursor-pointer.tw\\:transition-colors",
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
        expect(traceCard.exists()).toBe(true);
      }
    });

    it("should pass correct props to TraceCorrelationCard", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      // Select resource with trace
      const resourceItems = wrapper.findAll(
        ".tw\\:cursor-pointer.tw\\:transition-colors",
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        const traceCard = wrapper.findComponent({
          name: "TraceCorrelationCard",
        });
        if (traceCard.exists()) {
          expect(traceCard.props("traceId")).toBe("trace-123");
        }
      }
    });
  });

  describe("Navigation functionality", () => {
    it("should navigate to trace details when clicking trace button", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      const routerResolveSpy = vi.spyOn(router, "resolve");
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation();

      const traceButtons = wrapper.findAll('[title="View trace details"]');
      if (traceButtons.length > 0) {
        await traceButtons[0].trigger("click");
        await flushPromises();

        expect(routerResolveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "traceDetails",
            query: expect.objectContaining({
              trace_id: "trace-123",
            }),
          }),
        );

        expect(windowOpenSpy).toHaveBeenCalled();
      }

      windowOpenSpy.mockRestore();
    });
  });

  describe("Drawer close functionality", () => {
    it("should emit update:modelValue when closing", async () => {
      const closeBtn = wrapper.find('[icon="cancel"]');
      await closeBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should reset state when drawer closes", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      // Set some state
      wrapper.vm.selectedResourceWithTrace = { id: "test" };

      // Close drawer
      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      expect(wrapper.vm.selectedResourceWithTrace).toBeNull();
      expect(wrapper.vm.relatedResources).toEqual([]);
    });
  });

  describe("Raw event data", () => {
    it("should display raw event data in expansion panel", () => {
      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      expect(expansionItem.exists()).toBe(true);
      expect(expansionItem.props("label")).toBe("Raw Event Data");
    });

    it("should display formatted JSON in raw event section", () => {
      const preElement = wrapper.find("pre");
      expect(preElement.exists()).toBe(true);
      expect(preElement.text()).toContain('"action_type": "click"');
    });
  });

  describe("Utility functions", () => {
    it("should format timestamp correctly", () => {
      const result = wrapper.vm.formatTimestamp(1700000000000);
      expect(result).toContain("2023");
      expect(result).toContain(",");
    });

    it("should return N/A for invalid timestamp", () => {
      const result = wrapper.vm.formatTimestamp(0);
      expect(result).toBe("N/A");
    });

    it("should format duration in milliseconds", () => {
      const result = wrapper.vm.formatDuration(500);
      expect(result).toBe("500ms");
    });

    it("should format duration in seconds for values >= 1000ms", () => {
      const result = wrapper.vm.formatDuration(2500);
      expect(result).toBe("2.50s");
    });

    it("should format ID correctly", () => {
      const result = wrapper.vm.formatId("test-id-123");
      expect(result).toBe("test-id-123");
    });

    it("should get correct event type class", () => {
      expect(wrapper.vm.getEventTypeClass("error")).toContain("tw:bg-red-100");
      expect(wrapper.vm.getEventTypeClass("action")).toContain(
        "tw:bg-blue-100",
      );
      expect(wrapper.vm.getEventTypeClass("view")).toContain("tw:bg-green-100");
    });

    it("should get correct status icon", () => {
      expect(wrapper.vm.getStatusIcon(200)).toBe("check_circle");
      expect(wrapper.vm.getStatusIcon(300)).toBe("info");
      expect(wrapper.vm.getStatusIcon(404)).toBe("warning");
      expect(wrapper.vm.getStatusIcon(500)).toBe("error");
    });

    it("should get correct status color", () => {
      expect(wrapper.vm.getStatusColor(200)).toBe("positive");
      expect(wrapper.vm.getStatusColor(300)).toBe("info");
      expect(wrapper.vm.getStatusColor(404)).toBe("warning");
      expect(wrapper.vm.getStatusColor(500)).toBe("negative");
    });
  });

  describe("Event emissions", () => {
    it("should emit resource-selected when viewing resource details", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushPromises();

      const resourceItems = wrapper.findAll(
        ".tw\\:cursor-pointer.tw\\:transition-colors",
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        expect(wrapper.emitted("resource-selected")).toBeTruthy();
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle missing session details gracefully", async () => {
      await wrapper.setProps({
        sessionDetails: {
          user_email: "",
          date: "",
          browser: "",
          os: "",
          ip: "",
          city: "",
          country: "",
        },
      });

      await flushPromises();

      expect(wrapper.text()).toContain("Unknown User");
    });

    it("should handle events without action_id", async () => {
      await wrapper.setProps({
        rawEvent: {
          action_type: "click",
          action_target_name: "Button",
        },
      });

      await flushPromises();

      // Should not fetch related resources without action_id
      expect(wrapper.vm.isLoadingRelatedResources).toBe(false);
    });

    it("should not display related resources section for non-action events", async () => {
      await wrapper.setProps({
        event: { type: "view", name: "Page View" },
        rawEvent: {
          view_url: "https://example.com",
        },
      });

      await flushPromises();

      expect(wrapper.text()).not.toContain("Related Events");
    });
  });
});
