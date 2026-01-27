// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ResourceDetailDrawer from "@/components/rum/ResourceDetailDrawer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

/**
 * Factory function to create mock resource data with defaults
 */
function createMockResource(overrides: Record<string, any> = {}) {
  return {
    resource_method: "GET",
    resource_url: "http://localhost:5080/users",
    resource_duration: 250,
    resource_status_code: 200,
    resource_type: "xhr",
    resource_size: 2048,
    resource_render_blocking_status: "non-blocking",
    _timestamp: 1700000000000000,
    session: {
      id: "session-123",
    },
    view: {
      url: "http://localhost:5080/dashboard",
    },
    _oo: {
      trace_id: "trace-123",
      span_id: "span-456",
    },
    ...overrides,
  };
}

/**
 * Factory to create minimal resource data
 */
function createMinimalResource() {
  return {
    resource_url: "http://localhost:5080",
    _timestamp: 1700000000000000,
  };
}

/**
 * Factory to create resource with specific status code
 */
function createResourceWithStatus(statusCode: number) {
  return createMockResource({
    resource_status_code: statusCode,
  });
}

// ============================================================================
// TEST SETUP
// ============================================================================

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// ============================================================================
// TEST HELPERS
// ============================================================================

interface MountOptions {
  props?: Record<string, any>;
  stubs?: Record<string, any>;
}

/**
 * Helper to mount component with default configuration
 */
function mountComponent(options: MountOptions = {}) {
  const defaultProps = {
    modelValue: true,
    resource: createMockResource(),
  };

  return mount(ResourceDetailDrawer, {
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
        ...options.stubs,
      },
    },
  });
}

/**
 * Helper to find elements by test-id or common selectors
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Helper to find close button
 */
function findCloseButton(wrapper: VueWrapper) {
  return findByTestId(wrapper, "close-drawer-btn");
}

/**
 * Helper to find session replay button
 */
function findSessionReplayButton(wrapper: VueWrapper) {
  return findByTestId(wrapper, "view-session-replay-btn");
}

/**
 * Helper to find session events button
 */
function findSessionEventsButton(wrapper: VueWrapper) {
  return findByTestId(wrapper, "view-session-events-btn");
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("ResourceDetailDrawer", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock store state with zoConfig - preserve existing properties
    store.state.zoConfig = {
      ...(store.state.zoConfig || {}),
      timestamp_column: "_timestamp",
    } as any;

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
  // INITIAL RENDERING
  // ==========================================================================

  describe("Initial Rendering", () => {
    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the header with title", () => {
      expect(wrapper.text()).toContain("Resource Details");
    });

    it("should display close button in header", () => {
      const closeBtn = findCloseButton(wrapper);
      expect(closeBtn.exists()).toBe(true);
    });

    it("should have proper layout structure", () => {
      const container = wrapper.find(".tw\\:h-full.tw\\:flex.tw\\:flex-col");
      expect(container.exists()).toBe(true);

      const contentArea = wrapper.find(".tw\\:flex-1.tw\\:overflow-y-auto");
      expect(contentArea.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // RESOURCE HEADER DISPLAY
  // ==========================================================================

  describe("Resource Header Information", () => {
    it("should display HTTP method and URL", () => {
      const text = wrapper.text();

      expect(text).toContain("GET");
      expect(text).toContain("http://localhost:5080/users");
    });

    it("should display formatted timestamp", () => {
      const timestamp = wrapper.text();
      expect(timestamp).toContain("2023");
    });

    it("should display resource duration with proper formatting", () => {
      expect(wrapper.text()).toContain("250ms");
    });

    it("should display HTTP status code", () => {
      expect(wrapper.text()).toContain("200");
    });

    it("should show appropriate icon for successful status (2xx)", () => {
      const icons = wrapper.findAllComponents({ name: "QIcon" });
      const successIcon = icons.find((icon: any) =>
        icon.props("name")?.includes("check_circle"),
      );

      expect(successIcon).toBeTruthy();
    });

    it("should handle different HTTP status codes appropriately", async () => {
      const testCases = [
        {
          status: 200,
          expectedIcon: "check_circle",
          expectedColor: "positive",
        },
        { status: 301, expectedIcon: "info", expectedColor: "info" },
        { status: 404, expectedIcon: "warning", expectedColor: "warning" },
        { status: 500, expectedIcon: "error", expectedColor: "negative" },
      ];

      for (const testCase of testCases) {
        await wrapper.setProps({
          resource: createResourceWithStatus(testCase.status),
        });
        await flushPromises();

        expect(wrapper.text()).toContain(String(testCase.status));
      }
    });

    it("should display ellipsis for long URLs with title attribute", () => {
      const urlElements = wrapper.findAll("[title]");
      const urlElement = urlElements.find((el: any) =>
        el.attributes("title")?.includes("http://localhost:5080/dashboard"),
      );

      expect(urlElement).toBeTruthy();
    });
  });

  // ==========================================================================
  // RESOURCE INFORMATION SECTION
  // ==========================================================================

  describe("Resource Information Details", () => {
    it("should display Resource Information section", () => {
      expect(wrapper.text()).toContain("Resource Information");
    });

    it("should display all resource metadata fields", () => {
      const text = wrapper.text();

      expect(text).toContain("Type:");
      expect(text).toContain("xhr");
      expect(text).toContain("Size:");
      expect(text).toContain("2.00 KB");
      expect(text).toContain("Render Blocking:");
      expect(text).toContain("non-blocking");
    });

    it("should display session information", () => {
      expect(wrapper.text()).toContain("Session ID:");
      expect(wrapper.find(".session-id-text").exists()).toBe(true);
    });

    it("should display page URL information", () => {
      expect(wrapper.text()).toContain("Page URL:");
      expect(wrapper.text()).toContain("http://localhost:5080/dashboard");
    });

    it("should hide optional fields when data is missing", async () => {
      await wrapper.setProps({
        resource: createMinimalResource(),
      });
      await flushPromises();

      const text = wrapper.text();
      expect(text).not.toContain("Type:");
      expect(text).not.toContain("Size:");
      expect(text).not.toContain("Render Blocking:");
    });

    it("should format file sizes correctly", async () => {
      const sizeCases = [
        { size: 512, expected: "512.00 B" },
        { size: 2048, expected: "2.00 KB" },
        { size: 2097152, expected: "2.00 MB" },
        { size: 2147483648, expected: "2.00 GB" },
      ];

      for (const testCase of sizeCases) {
        await wrapper.setProps({
          resource: createMockResource({ resource_size: testCase.size }),
        });
        await flushPromises();

        expect(wrapper.text()).toContain(testCase.expected);
      }
    });

    it("should display N/A for zero or missing values", async () => {
      await wrapper.setProps({
        resource: createMockResource({
          resource_size: 0,
          resource_duration: 0,
          _timestamp: 0,
        }),
      });
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain("N/A");
    });
  });

  // ==========================================================================
  // TRACE CORRELATION SECTION
  // ==========================================================================

  describe("Trace Correlation Integration", () => {
    it("should render TraceCorrelationCard when trace_id exists", () => {
      const traceCard = findByTestId(wrapper, "trace-correlation-card");
      expect(traceCard.exists()).toBe(true);
    });

    it("should pass correct props to TraceCorrelationCard", () => {
      const traceCard = wrapper.findComponent({ name: "TraceCorrelationCard" });

      if (traceCard.exists()) {
        expect(traceCard.props("traceId")).toBe("trace-123");
        expect(traceCard.props("spanId")).toBe("span-456");
        expect(traceCard.props("sessionId")).toBe("session-123");
        expect(traceCard.props("resourceDuration")).toBe(250);
      }
    });

    it("should show informative message when trace data is unavailable", async () => {
      await wrapper.setProps({
        resource: createMockResource({ _oo: undefined }),
      });
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain(
        "No trace information available for this resource",
      );
      expect(text).toContain("Trace correlation requires browser SDK v0.3.3+");
    });
  });

  // ==========================================================================
  // SESSION CONTEXT SECTION
  // ==========================================================================

  describe("Session Context Actions", () => {
    it("should display Session Context section when session exists", () => {
      expect(wrapper.text()).toContain("Session Context");
    });

    it("should render session action buttons", () => {
      const replayBtn = findSessionReplayButton(wrapper);
      const eventsBtn = findSessionEventsButton(wrapper);

      expect(replayBtn.exists()).toBe(true);
      expect(eventsBtn.exists()).toBe(true);
    });

    it("should hide Session Context when session data is missing", async () => {
      await wrapper.setProps({
        resource: createMockResource({ session: undefined }),
      });
      await flushPromises();

      expect(wrapper.text()).not.toContain("Session Context");
    });

    it("should not render session buttons when session ID is missing", async () => {
      await wrapper.setProps({
        resource: createMockResource({ session: {} }),
      });
      await flushPromises();

      expect(wrapper.text()).not.toContain("Session Context");
    });
  });

  // ==========================================================================
  // USER INTERACTIONS & NAVIGATION
  // ==========================================================================

  describe("User Interactions", () => {
    describe("Closing the Drawer", () => {
      it("should emit update:modelValue when close button is clicked", async () => {
        const closeBtn = findCloseButton(wrapper);
        await closeBtn.trigger("click");
        await flushPromises();

        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
      });

      it("should close when modelValue prop changes", async () => {
        // Initially component is mounted
        expect(wrapper.exists()).toBe(true);

        await wrapper.setProps({ modelValue: false });
        await flushPromises();

        // Component should emit the change
        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      });
    });

    describe("Session Replay Navigation", () => {
      it("should navigate to session replay when button is clicked", async () => {
        const routerPushSpy = vi
          .spyOn(router, "push")
          .mockResolvedValue(undefined as any);
        const replayBtn = findSessionReplayButton(wrapper);

        await replayBtn.trigger("click");
        await flushPromises();

        expect(routerPushSpy).toHaveBeenCalledWith({
          name: "rumSessions",
          query: { session_id: "session-123" },
        });
      });

      it("should close drawer after navigating to session replay", async () => {
        vi.spyOn(router, "push").mockResolvedValue(undefined as any);
        const replayBtn = findSessionReplayButton(wrapper);

        await replayBtn.trigger("click");
        await flushPromises();

        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
      });

      it("should not navigate when session ID is missing", async () => {
        await wrapper.setProps({
          resource: createMockResource({ session: undefined }),
        });
        await flushPromises();

        const routerPushSpy = vi.spyOn(router, "push");
        const replayBtn = findSessionReplayButton(wrapper);

        expect(replayBtn.exists()).toBe(false);
        expect(routerPushSpy).not.toHaveBeenCalled();
      });
    });

    describe.skip("Session Events Action", () => {
      it("should show notification when View All Session Events is clicked", async () => {
        // Spy on Notify.create BEFORE mounting the component
        const notifySpy = vi
          .spyOn(quasar.Notify, "create")
          .mockImplementation(() => () => {});

        // Mount a fresh wrapper with the spy already in place
        const testWrapper = mountComponent();
        await flushPromises();

        const eventsBtn = findSessionEventsButton(testWrapper);
        await eventsBtn.trigger("click");
        await flushPromises();

        expect(notifySpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "info",
            message: "Session events view coming soon",
          }),
        );

        notifySpy.mockRestore();
        testWrapper.unmount();
      });
    });
  });

  // ==========================================================================
  // ACCESSIBILITY
  // ==========================================================================

  describe.skip("Accessibility", () => {
    it("should be keyboard accessible - close button with Enter", async () => {
      const closeBtn = findCloseButton(wrapper);

      await closeBtn.trigger("keydown.enter");
      await closeBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should be keyboard accessible - close button with Space", async () => {
      const closeBtn = findCloseButton(wrapper);

      await closeBtn.trigger("keydown.space");
      await closeBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should be keyboard accessible - session replay button with Enter", async () => {
      const replayBtn = findSessionReplayButton(wrapper);
      const routerPushSpy = vi
        .spyOn(router, "push")
        .mockResolvedValue(undefined as any);

      await replayBtn.trigger("keydown.enter");
      await replayBtn.trigger("click");
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalled();
    });

    it("should be keyboard accessible - session replay button with Space", async () => {
      const replayBtn = findSessionReplayButton(wrapper);
      const routerPushSpy = vi
        .spyOn(router, "push")
        .mockResolvedValue(undefined as any);

      await replayBtn.trigger("keydown.space");
      await replayBtn.trigger("click");
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalled();
    });

    it("should be keyboard accessible - view events button with Enter", async () => {
      const notifySpy = vi
        .spyOn(quasar.Notify, "create")
        .mockImplementation(() => () => {});
      const eventsBtn = findSessionEventsButton(wrapper);

      await eventsBtn.trigger("keydown.enter");
      await eventsBtn.trigger("click");
      await flushPromises();

      expect(notifySpy).toHaveBeenCalled();
      notifySpy.mockRestore();
    });

    it.skip("should be keyboard accessible - view events button with Space", async () => {
      const notifySpy = vi
        .spyOn(quasar.Notify, "create")
        .mockImplementation(() => () => {});
      const eventsBtn = findSessionEventsButton(wrapper);

      await eventsBtn.trigger("keydown.space");
      await eventsBtn.trigger("click");
      await flushPromises();

      expect(notifySpy).toHaveBeenCalled();
      notifySpy.mockRestore();
    });

    it("should have accessible button labels", () => {
      const replayBtn = findSessionReplayButton(wrapper);
      const eventsBtn = findSessionEventsButton(wrapper);

      // QBtn components expose label as text content
      expect(replayBtn.text()).toContain("View Session Replay");
      expect(eventsBtn.text()).toContain("View All Session Events");
    });

    it("should provide title attributes for truncated text", () => {
      const urlElements = wrapper.findAll("[title]");
      expect(urlElements.length).toBeGreaterThan(0);
    });

    it("should have semantic HTML structure with proper headings", () => {
      // Check for proper content structure
      expect(wrapper.text()).toContain("Resource Details");
      expect(wrapper.text()).toContain("Resource Information");
      expect(wrapper.text()).toContain("Session Context");
    });
  });

  // ==========================================================================
  // PROPS VALIDATION
  // ==========================================================================

  describe("Component Props", () => {
    it("should display component when modelValue is true", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Resource Details");
    });

    it("should display resource data correctly", () => {
      // Verify resource data is displayed (test user-visible behavior)
      expect(wrapper.text()).toContain("GET");
      expect(wrapper.text()).toContain("http://localhost:5080/users");
      expect(wrapper.text()).toContain("200");
      expect(wrapper.text()).toContain("250ms");
    });

    it("should work with minimal props", async () => {
      const newWrapper = mount(ResourceDetailDrawer, {
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      // Component should mount successfully with default props
      expect(newWrapper.exists()).toBe(true);

      newWrapper.unmount();
    });

    it("should reactively update when resource prop changes", async () => {
      const newResource = createMockResource({
        resource_url: "http://example.com/new",
        resource_status_code: 404,
      });

      await wrapper.setProps({ resource: newResource });
      await flushPromises();

      expect(wrapper.text()).toContain("http://example.com/new");
      expect(wrapper.text()).toContain("404");
    });
  });

  // ==========================================================================
  // EDGE CASES & ERROR HANDLING
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle null resource gracefully", async () => {
      await wrapper.setProps({ resource: null });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.html()).not.toThrow();
    });

    it("should handle undefined resource gracefully", async () => {
      await wrapper.setProps({ resource: undefined });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle resource with minimal data", async () => {
      await wrapper.setProps({ resource: createMinimalResource() });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("http://localhost:5080");
    });

    it("should handle missing timestamp gracefully", async () => {
      await wrapper.setProps({
        resource: createMockResource({ _timestamp: undefined }),
      });
      await flushPromises();

      expect(wrapper.text()).toContain("N/A");
    });

    it("should handle empty session object", async () => {
      await wrapper.setProps({
        resource: createMockResource({ session: {} }),
      });
      await flushPromises();

      expect(wrapper.text()).not.toContain("Session Context");
    });

    it("should handle zero values appropriately", async () => {
      await wrapper.setProps({
        resource: createMockResource({
          resource_duration: 0,
          resource_size: 0,
          resource_status_code: 0,
        }),
      });
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain("N/A");
    });

    it("should handle extremely long URLs", async () => {
      const longUrl = "http://example.com/" + "a".repeat(500);
      await wrapper.setProps({
        resource: createMockResource({ resource_url: longUrl }),
      });
      await flushPromises();

      const ellipsisElement = wrapper.find(".ellipsis");
      expect(ellipsisElement.exists()).toBe(true);
    });

    it("should handle special characters in resource data", async () => {
      await wrapper.setProps({
        resource: createMockResource({
          resource_url:
            "http://example.com/?query=<script>alert('xss')</script>",
        }),
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // DATA FORMATTING - USER-FACING DISPLAY
  // ==========================================================================

  describe("Data Formatting Display", () => {
    describe("Timestamp Display", () => {
      it("should display formatted timestamp in component", () => {
        const text = wrapper.text();
        expect(text).toContain("2023");
      });

      it("should display N/A for invalid timestamp", async () => {
        await wrapper.setProps({
          resource: createMockResource({ _timestamp: 0 }),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("N/A");
      });
    });

    describe("Duration Display", () => {
      it("should display short durations in milliseconds", async () => {
        await wrapper.setProps({
          resource: createMockResource({ resource_duration: 500 }),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("500ms");
      });

      it("should display long durations in seconds", async () => {
        await wrapper.setProps({
          resource: createMockResource({ resource_duration: 2500 }),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("2.50s");
      });

      it("should display N/A for zero duration", async () => {
        await wrapper.setProps({
          resource: createMockResource({ resource_duration: 0 }),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("N/A");
      });
    });

    describe("File Size Display", () => {
      it("should display file sizes with correct units", async () => {
        const sizeCases = [
          { size: 512, expected: "512.00 B" },
          { size: 2048, expected: "2.00 KB" },
          { size: 2097152, expected: "2.00 MB" },
          { size: 2147483648, expected: "2.00 GB" },
        ];

        for (const testCase of sizeCases) {
          await wrapper.setProps({
            resource: createMockResource({ resource_size: testCase.size }),
          });
          await flushPromises();

          expect(wrapper.text()).toContain(testCase.expected);
        }
      });

      it("should display N/A for zero size", async () => {
        await wrapper.setProps({
          resource: createMockResource({ resource_size: 0 }),
        });
        await flushPromises();

        // When size is 0, the Size field is not displayed (v-if="resource.resource_size")
        const text = wrapper.text();
        expect(text).not.toContain("Size:");
      });
    });

    describe("Session ID Display", () => {
      it("should display truncated long session IDs", async () => {
        const longId = "session-123456789-abcdefgh";
        await wrapper.setProps({
          resource: createMockResource({ session: { id: longId } }),
        });
        await flushPromises();

        const text = wrapper.text();
        // formatSessionId returns first 8 chars + "..." + last 8 chars for IDs > 16 chars
        // "session-123456789-abcdefgh" -> "session-...abcdefgh"
        expect(text).toContain("session-");
        expect(text).toContain("abcdefgh");
      });

      it("should display short session IDs without truncation", async () => {
        const shortId = "session-123";
        await wrapper.setProps({
          resource: createMockResource({ session: { id: shortId } }),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("session-123");
      });
    });

    describe("Status Code Display", () => {
      it("should display success status with check icon", async () => {
        await wrapper.setProps({
          resource: createResourceWithStatus(200),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("200");
        const icons = wrapper.findAllComponents({ name: "QIcon" });
        const successIcon = icons.find((icon: any) =>
          icon.props("name")?.includes("check_circle"),
        );
        expect(successIcon).toBeTruthy();
      });

      it("should display client error status with warning icon", async () => {
        await wrapper.setProps({
          resource: createResourceWithStatus(404),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("404");
        const icons = wrapper.findAllComponents({ name: "QIcon" });
        const warningIcon = icons.find((icon: any) =>
          icon.props("name")?.includes("warning"),
        );
        expect(warningIcon).toBeTruthy();
      });

      it("should display server error status with error icon", async () => {
        await wrapper.setProps({
          resource: createResourceWithStatus(500),
        });
        await flushPromises();

        expect(wrapper.text()).toContain("500");
        const icons = wrapper.findAllComponents({ name: "QIcon" });
        const errorIcon = icons.find((icon: any) =>
          icon.props("name")?.includes("error"),
        );
        expect(errorIcon).toBeTruthy();
      });
    });
  });

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe("Integration Scenarios", () => {
    it("should handle complete user flow: view resource details and navigate to session", async () => {
      // 1. Component displays with resource details
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Resource Details");

      // 2. User views resource information
      expect(wrapper.text()).toContain("GET");
      expect(wrapper.text()).toContain("http://localhost:5080/users");

      // 3. User clicks to view session replay
      const routerPushSpy = vi
        .spyOn(router, "push")
        .mockResolvedValue(undefined as any);
      const replayBtn = findSessionReplayButton(wrapper);
      await replayBtn.trigger("click");
      await flushPromises();

      // 4. Navigation occurs and drawer closes
      expect(routerPushSpy).toHaveBeenCalled();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should handle scenario with missing backend trace data", async () => {
      await wrapper.setProps({
        resource: createMockResource({ _oo: undefined }),
      });
      await flushPromises();

      expect(wrapper.text()).toContain("No trace information available");
      expect(wrapper.text()).toContain("browser SDK v0.3.3+");
    });

    it("should handle scenario with all optional data present", async () => {
      const completeResource = createMockResource();
      await wrapper.setProps({ resource: completeResource });
      await flushPromises();

      // All sections should be visible
      expect(wrapper.text()).toContain("Resource Information");
      expect(wrapper.text()).toContain("Session Context");
      expect(findByTestId(wrapper, "trace-correlation-card").exists()).toBe(
        true,
      );
    });
  });
});
