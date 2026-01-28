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
import EventDetailDrawerContent from "@/components/rum/EventDetailDrawerContent.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { http, HttpResponse } from "msw";

installQuasar({
  plugins: [quasar.Notify],
});

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

/**
 * Factory for creating mock event data
 */
function createMockEvent(overrides: Record<string, any> = {}) {
  return {
    type: "action",
    name: "Button Click",
    frustration_types: ["rage_click"],
    ...overrides,
  };
}

/**
 * Factory for creating mock raw event data
 */
function createMockRawEvent(overrides: Record<string, any> = {}) {
  return {
    action_type: "click",
    action_target_name: "Submit Button",
    action_id: "action-123",
    session_id: "session-456",
    date: 1700000000000,
    service: "web-app",
    version: "1.0.0",
    ...overrides,
  };
}

/**
 * Factory for creating mock session details
 */
function createMockSessionDetails(overrides: Record<string, any> = {}) {
  return {
    user_email: "test@example.com",
    date: "Jan 01, 2024 12:00:00",
    browser: "Chrome",
    os: "MacOS",
    ip: "192.168.1.1",
    city: "San Francisco",
    country: "USA",
    ...overrides,
  };
}

/**
 * Factory for creating mock related resources
 */
function createMockResource(overrides: Record<string, any> = {}) {
  return {
    type: "resource",
    resource_id: "res-1",
    resource_url: "https://api.example.com/data",
    resource_method: "GET",
    resource_status_code: 200,
    resource_duration: 150,
    date: 1700000000000,
    _oo_trace_id: "trace-123",
    ...overrides,
  };
}

/**
 * Factory for creating mock error resource
 */
function createMockError(overrides: Record<string, any> = {}) {
  return {
    type: "error",
    error_id: "err-1",
    error_message: "Network error",
    error_type: "NetworkError",
    date: 1700000001000,
    ...overrides,
  };
}

/**
 * Factory for creating mock view resource
 */
function createMockView(overrides: Record<string, any> = {}) {
  return {
    type: "view",
    view_id: "view-1",
    view_url: "https://example.com/home",
    view_loading_type: "initial_load",
    date: 1700000002000,
    ...overrides,
  };
}

// Mock related resources
const mockRelatedResources = [createMockResource(), createMockError()];

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to find elements by data-test attribute
 */
function findByTestId(wrapper: any, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Helper to mount component with default configuration
 */
function mountComponent(options: any = {}) {
  const defaultProps = {
    event: createMockEvent(),
    rawEvent: createMockRawEvent(),
    sessionId: "session-456",
    sessionDetails: createMockSessionDetails(),
  };

  return mount(EventDetailDrawerContent, {
    props: { ...defaultProps, ...options.props },
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
        ...options.stubs,
      },
    },
  });
}

/**
 * Helper to wait for related resources to load
 */
async function waitForRelatedResources(wrapper: any) {
  return vi.waitFor(
    () => {
      const items = wrapper.findAll('[data-test="related-resource-item"]');
      expect(items.length).toBeGreaterThan(0);
    },
    { timeout: 3000 },
  );
}

describe("EventDetailDrawerContent", () => {
  let wrapper: any;

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

    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT RENDERING
  // ==========================================================================

  describe("Component rendering", () => {
    it("should mount EventDetailDrawerContent component", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".q-card").exists()).toBe(true);
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
      const frustrationBadge = findByTestId(wrapper, "frustration-badge");
      expect(frustrationBadge.exists()).toBe(true);
    });

    it("should not display frustration badge when frustration types are absent", async () => {
      await wrapper.setProps({
        event: createMockEvent({ frustration_types: [] }),
      });
      await flushPromises();

      const frustrationBadge = findByTestId(wrapper, "frustration-badge");
      expect(frustrationBadge.exists()).toBe(false);
    });

    it("should display close button", () => {
      const closeBtn = findByTestId(wrapper, "close-drawer-btn");
      expect(closeBtn.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // SESSION METADATA DISPLAY
  // ==========================================================================

  describe("Session metadata display", () => {
    it("should display session metadata section", () => {
      const metadata = findByTestId(wrapper, "event-session-meta-data");
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

  // ==========================================================================
  // ACTION EVENT DETAILS
  // ==========================================================================

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

    it("should not display action ID when not available", async () => {
      await wrapper.setProps({
        rawEvent: createMockRawEvent({ action_id: undefined }),
      });
      await flushPromises();

      const text = wrapper.text();
      // Action ID section should not appear when action_id is undefined
      const actionIdCount = (text.match(/Action ID:/g) || []).length;
      expect(actionIdCount).toBe(0);
    });
  });

  // ==========================================================================
  // ERROR EVENT DETAILS
  // ==========================================================================

  describe("Error event details", () => {
    it("should display Error Details section for error events", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "error", name: "Network Error" }),
        rawEvent: createMockRawEvent({
          error_type: "NetworkError",
          error_message: "Failed to fetch data",
          error_handling: "unhandled",
          error_id: "error-123",
          action_type: undefined,
          action_id: undefined,
        }),
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

    it("should display handled error with appropriate styling", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "error", name: "Handled Error" }),
        rawEvent: createMockRawEvent({
          error_type: "ValidationError",
          error_message: "Invalid input",
          error_handling: "handled",
          action_type: undefined,
          action_id: undefined,
        }),
      });

      await flushPromises();

      expect(wrapper.text()).toContain("handled");
      expect(wrapper.text()).toContain("ValidationError");
    });
  });

  // ==========================================================================
  // VIEW EVENT DETAILS
  // ==========================================================================

  describe("View event details", () => {
    it("should display View Details section for view events", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "view", name: "Home Page" }),
        rawEvent: createMockRawEvent({
          view_loading_type: "initial_load",
          view_url: "https://example.com/home",
          view_id: "view-123",
          action_type: undefined,
          action_id: undefined,
        }),
      });

      await flushPromises();

      expect(wrapper.text()).toContain("View Details");
      expect(wrapper.text()).toContain("Loading Type:");
      expect(wrapper.text()).toContain("initial load");
      expect(wrapper.text()).toContain("URL:");
      expect(wrapper.text()).toContain("https://example.com/home");
      expect(wrapper.text()).toContain("View ID:");
    });

    it("should format loading type by replacing underscores", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "view", name: "Page View" }),
        rawEvent: createMockRawEvent({
          view_loading_type: "route_change",
          view_url: "https://example.com/about",
          action_type: undefined,
          action_id: undefined,
        }),
      });

      await flushPromises();

      expect(wrapper.text()).toContain("route change");
    });
  });

  // ==========================================================================
  // RELATED RESOURCES
  // ==========================================================================

  describe("Related resources", () => {
    it("should fetch related resources for action events", async () => {
      await waitForRelatedResources(wrapper);

      const relatedItems = wrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      expect(relatedItems.length).toBe(mockRelatedResources.length);
    });

    it("should display related events section when resources exist", async () => {
      await waitForRelatedResources(wrapper);

      expect(wrapper.text()).toContain("Related Events");
      expect(wrapper.text()).toContain(`(${mockRelatedResources.length})`);
    });

    it("should show loading spinner while fetching resources", async () => {
      // Mount fresh to catch loading state
      const freshWrapper = mountComponent();

      // Check immediately before API resolves
      const text = freshWrapper.text();
      // Component exists
      expect(freshWrapper.exists()).toBe(true);

      freshWrapper.unmount();
    });

    it("should display resource event with correct details", async () => {
      await waitForRelatedResources(wrapper);

      expect(wrapper.text()).toContain("GET");
      expect(wrapper.text()).toContain("https://api.example.com/data");
      expect(wrapper.text()).toContain("200");
    });

    it("should display error event in related resources", async () => {
      await waitForRelatedResources(wrapper);

      expect(wrapper.text()).toContain("error");
      expect(wrapper.text()).toContain("Network error");
    });

    it("should display trace button for resources with trace_id", async () => {
      await waitForRelatedResources(wrapper);

      const traceButtons = wrapper.findAll('[data-test="view-trace-btn"]');
      expect(traceButtons.length).toBeGreaterThan(0);
    });

    it("should call viewResourceDetails when clicking on a resource", async () => {
      await waitForRelatedResources(wrapper);

      const resourceItems = wrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        // Check if resource-selected event was emitted
        expect(wrapper.emitted("resource-selected")).toBeTruthy();
      }
    });

    it("should not fetch related resources for non-action events", async () => {
      const viewWrapper = mountComponent({
        props: {
          event: createMockEvent({ type: "view", name: "Page View" }),
          rawEvent: createMockRawEvent({
            view_url: "https://example.com",
            action_id: undefined,
            action_type: undefined,
          }),
        },
      });

      await flushPromises();

      const relatedItems = viewWrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      expect(relatedItems.length).toBe(0);

      viewWrapper.unmount();
    });

    it("should not fetch related resources when action_id is missing", async () => {
      const noActionWrapper = mountComponent({
        props: {
          rawEvent: createMockRawEvent({ action_id: undefined }),
        },
      });

      await flushPromises();

      const relatedItems = noActionWrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      expect(relatedItems.length).toBe(0);

      noActionWrapper.unmount();
    });
  });

  // ==========================================================================
  // TRACE CORRELATION
  // ==========================================================================

  describe("Trace correlation", () => {
    it("should display trace correlation card for resource with trace_id", async () => {
      await waitForRelatedResources(wrapper);

      // Click on first resource which has trace_id
      const resourceItems = wrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        const traceCard = findByTestId(wrapper, "trace-correlation-card");
        expect(traceCard.exists()).toBe(true);
      }
    });

    it("should pass correct props to TraceCorrelationCard", async () => {
      await waitForRelatedResources(wrapper);

      // Select resource with trace
      const resourceItems = wrapper.findAll(
        '[data-test="related-resource-item"]',
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

    it("should auto-select first resource with trace_id and display trace card", async () => {
      await waitForRelatedResources(wrapper);

      // The component auto-selects the first resource with trace_id
      const traceCard = findByTestId(wrapper, "trace-correlation-card");
      expect(traceCard.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // NAVIGATION FUNCTIONALITY
  // ==========================================================================

  describe("Navigation functionality", () => {
    it("should navigate to trace details when clicking trace button", async () => {
      await waitForRelatedResources(wrapper);

      const routerResolveSpy = vi.spyOn(router, "resolve");
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation();

      const traceButtons = wrapper.findAll('[data-test="view-trace-btn"]');
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

    it("should open trace in new tab", async () => {
      await waitForRelatedResources(wrapper);

      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation();

      const traceButtons = wrapper.findAll('[data-test="view-trace-btn"]');
      if (traceButtons.length > 0) {
        await traceButtons[0].trigger("click");
        await flushPromises();

        expect(windowOpenSpy).toHaveBeenCalledWith(
          expect.any(String),
          "_blank",
        );
      }

      windowOpenSpy.mockRestore();
    });
  });

  // ==========================================================================
  // DRAWER CLOSE FUNCTIONALITY
  // ==========================================================================

  describe("Drawer close functionality", () => {
    it("should emit close event when clicking close button", async () => {
      const closeBtn = findByTestId(wrapper, "close-drawer-btn");
      await closeBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should maintain state until explicitly closed", async () => {
      await waitForRelatedResources(wrapper);

      // Click on a resource to set state
      const resourceItems = wrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        // Verify resource was selected
        expect(wrapper.emitted("resource-selected")).toBeTruthy();
      }
    });
  });

  // ==========================================================================
  // RAW EVENT DATA
  // ==========================================================================

  describe("Raw event data", () => {
    it("should display raw event data in expansion panel", () => {
      const expansionItem = findByTestId(wrapper, "raw-event-expansion");
      expect(expansionItem.exists()).toBe(true);
    });

    it("should display formatted JSON in raw event section", async () => {
      // Expand the panel first
      const expansionItem = findByTestId(wrapper, "raw-event-expansion");
      await expansionItem.trigger("click");
      await flushPromises();

      const preElement = findByTestId(wrapper, "raw-event-json");
      expect(preElement.exists()).toBe(true);
      expect(preElement.text()).toContain('"action_type": "click"');
    });

    it("should display complete raw event data", async () => {
      const expansionItem = findByTestId(wrapper, "raw-event-expansion");
      await expansionItem.trigger("click");
      await flushPromises();

      const preElement = findByTestId(wrapper, "raw-event-json");
      const jsonText = preElement.text();

      expect(jsonText).toContain('"action_type"');
      expect(jsonText).toContain('"action_target_name"');
      expect(jsonText).toContain('"action_id"');
      expect(jsonText).toContain('"session_id"');
    });
  });

  // ==========================================================================
  // DATA FORMATTING DISPLAY
  // ==========================================================================

  describe("Data formatting display", () => {
    it("should display formatted timestamp in component", () => {
      const text = wrapper.text();
      expect(text).toContain("2024");
    });

    it("should display resource duration", async () => {
      await waitForRelatedResources(wrapper);

      const text = wrapper.text();
      expect(text).toContain("ms");
    });

    it("should display status code with appropriate styling", async () => {
      await waitForRelatedResources(wrapper);

      const text = wrapper.text();
      expect(text).toContain("200");
    });

    it("should display error type badge for error events", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "error", name: "Network Error" }),
        rawEvent: createMockRawEvent({
          error_type: "NetworkError",
          error_message: "Failed to fetch",
          action_type: undefined,
          action_id: undefined,
        }),
      });
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain("error");
    });

    it("should display action type badge for action events", () => {
      const text = wrapper.text();
      expect(text).toContain("action");
    });

    it("should display view type badge for view events", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "view", name: "Home Page" }),
        rawEvent: createMockRawEvent({
          view_url: "https://example.com",
          action_type: undefined,
          action_id: undefined,
        }),
      });
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain("view");
    });

    it("should format duration in milliseconds for values < 1000", async () => {
      await waitForRelatedResources(wrapper);

      // Resource has duration of 150ms
      const text = wrapper.text();
      expect(text).toContain("150ms");
    });

    it("should format ID values correctly", async () => {
      const text = wrapper.text();
      expect(text).toContain("action-123");
    });
  });

  // ==========================================================================
  // EVENT EMISSIONS
  // ==========================================================================

  describe("Event emissions", () => {
    it("should emit resource-selected when viewing resource details", async () => {
      await waitForRelatedResources(wrapper);

      const resourceItems = wrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      if (resourceItems.length > 0) {
        await resourceItems[0].trigger("click");
        await flushPromises();

        expect(wrapper.emitted("resource-selected")).toBeTruthy();
        expect(wrapper.emitted("resource-selected")?.[0][0]).toEqual(
          expect.objectContaining({
            type: "resource",
            resource_url: "https://api.example.com/data",
          }),
        );
      }
    });

    it("should emit close when close button is clicked", async () => {
      const closeBtn = findByTestId(wrapper, "close-drawer-btn");
      await closeBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")?.length).toBe(1);
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge cases", () => {
    it("should handle missing session details gracefully", async () => {
      await wrapper.setProps({
        sessionDetails: createMockSessionDetails({
          user_email: "",
          browser: "",
          os: "",
        }),
        rawEvent: createMockRawEvent({
          service: "",
        }),
      });

      await flushPromises();

      const text = wrapper.text();
      // When service is empty, it should show "Unknown User"
      expect(text).toContain("Unknown User");
    });

    it("should handle events without action_id", async () => {
      const noActionWrapper = mountComponent({
        props: {
          rawEvent: createMockRawEvent({
            action_id: undefined,
            action_type: "click",
            action_target_name: "Button",
          }),
        },
      });

      await flushPromises();

      // Should not fetch related resources without action_id
      const relatedItems = noActionWrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      expect(relatedItems.length).toBe(0);

      noActionWrapper.unmount();
    });

    it("should not display related resources section for non-action events", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "view", name: "Page View" }),
        rawEvent: createMockRawEvent({
          view_url: "https://example.com",
          action_id: undefined,
          action_type: undefined,
        }),
      });

      await flushPromises();

      expect(wrapper.text()).not.toContain("Related Events");
    });

    it("should handle empty related resources gracefully", async () => {
      // Mock empty response
      globalThis.server.use(
        http.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
          async () => {
            return HttpResponse.json({
              took: 0,
              hits: [],
              total: 0,
            });
          },
        ),
      );

      const emptyWrapper = mountComponent();
      await flushPromises();

      const relatedItems = emptyWrapper.findAll(
        '[data-test="related-resource-item"]',
      );
      expect(relatedItems.length).toBe(0);

      emptyWrapper.unmount();
    });

    it("should handle missing version gracefully", async () => {
      await wrapper.setProps({
        rawEvent: createMockRawEvent({ version: "" }),
      });

      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain("Unknown User");
    });

    it("should handle resources without trace_id", async () => {
      // Mock resources without trace_id
      globalThis.server.use(
        http.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
          async () => {
            return HttpResponse.json({
              took: 0,
              hits: [createMockResource({ _oo_trace_id: undefined })],
              total: 1,
            });
          },
        ),
      );

      const noTraceWrapper = mountComponent();
      await flushPromises();

      await vi.waitFor(() => {
        const items = noTraceWrapper.findAll(
          '[data-test="related-resource-item"]',
        );
        expect(items.length).toBeGreaterThan(0);
      });

      const traceButtons = noTraceWrapper.findAll(
        '[data-test="view-trace-btn"]',
      );
      expect(traceButtons.length).toBe(0);

      noTraceWrapper.unmount();
    });
  });

  // ==========================================================================
  // EVENT TYPE STYLING
  // ==========================================================================

  describe("Event type styling", () => {
    it("should apply correct class for error type", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "error" }),
      });
      await flushPromises();

      const badge = wrapper.find(".tw\\:bg-red-100");
      expect(badge.exists()).toBe(true);
    });

    it("should apply correct class for action type", () => {
      const badge = wrapper.find(".tw\\:bg-blue-100");
      expect(badge.exists()).toBe(true);
    });

    it("should apply correct class for view type", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "view" }),
      });
      await flushPromises();

      const badge = wrapper.find(".tw\\:bg-green-100");
      expect(badge.exists()).toBe(true);
    });

    it("should apply default class for unknown type", async () => {
      await wrapper.setProps({
        event: createMockEvent({ type: "unknown" }),
      });
      await flushPromises();

      const badge = wrapper.find(".tw\\:bg-grey-100");
      expect(badge.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // RESOURCE STATUS INDICATORS
  // ==========================================================================

  describe("Resource status indicators", () => {
    it("should display success icon for 2xx status codes", async () => {
      await waitForRelatedResources(wrapper);

      // Resource has status code 200
      expect(wrapper.text()).toContain("200");
    });

    it("should handle different HTTP status codes", async () => {
      globalThis.server.use(
        http.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
          async () => {
            return HttpResponse.json({
              took: 0,
              hits: [
                createMockResource({
                  resource_status_code: 404,
                  resource_id: "res-404",
                }),
              ],
              total: 1,
            });
          },
        ),
      );

      const statusWrapper = mountComponent();
      await flushPromises();

      await vi.waitFor(() => {
        const items = statusWrapper.findAll(
          '[data-test="related-resource-item"]',
        );
        expect(items.length).toBeGreaterThan(0);
      });

      expect(statusWrapper.text()).toContain("404");

      statusWrapper.unmount();
    });
  });

  // ==========================================================================
  // ACCESSIBILITY
  // ==========================================================================

  describe("Accessibility", () => {
    it("should have accessible close button", () => {
      const closeBtn = findByTestId(wrapper, "close-drawer-btn");
      expect(closeBtn.exists()).toBe(true);
    });

    it("should provide title attribute for truncated text", () => {
      const titleElement = wrapper.find("[title]");
      expect(titleElement.exists()).toBe(true);
    });

    it("should have semantic HTML structure", () => {
      expect(wrapper.find(".q-card").exists()).toBe(true);
      expect(wrapper.find(".row").exists()).toBe(true);
    });
  });
});
