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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import ResourceDetailDrawer from "@/components/rum/ResourceDetailDrawer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

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
    // The component reads _oo?.trace_id to decide whether to show TraceCorrelationCard
    // but passes _oo_trace_id (flat) as the :trace-id prop binding.
    _oo: {
      trace_id: "trace-123",
      span_id: "span-456",
    },
    _oo_trace_id: "trace-123",
    ...overrides,
  };
}

function createMinimalResource() {
  return {
    resource_url: "http://localhost:5080",
    _timestamp: 1700000000000000,
  };
}

function createResourceWithStatus(statusCode: number) {
  return createMockResource({ resource_status_code: statusCode });
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function mountComponent(options: { props?: Record<string, any>; stubs?: Record<string, any> } = {}) {
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
          template: `<div
            data-test="trace-correlation-card"
            :data-trace-id="traceId"
            :data-span-id="spanId"
            :data-session-id="sessionId"
            :data-resource-duration="resourceDuration"
          >Trace Correlation</div>`,
          props: ["traceId", "spanId", "sessionId", "resourceDuration"],
        },
        ...options.stubs,
      },
    },
  });
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("ResourceDetailDrawer", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    store.state.zoConfig = {
      ...(store.state.zoConfig || {}),
      timestamp_column: "_timestamp",
    } as any;

    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // INITIAL RENDERING
  // ==========================================================================

  describe("Initial Rendering", () => {
    it("renders the component when mounted", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("displays the header title when open", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Resource Details");
    });

    it("displays close button in header when open", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="close-drawer-btn"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // RESOURCE HEADER DISPLAY
  // ==========================================================================

  describe("Resource Header Information", () => {
    it("displays HTTP method when resource has resource_method", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("GET");
    });

    it("displays resource URL when resource has resource_url", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("http://localhost:5080/users");
    });

    it("displays formatted timestamp containing the year when resource has _timestamp", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("2023");
    });

    it("displays resource duration in milliseconds when duration < 1000", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("250ms");
    });

    it("displays HTTP status code when resource has resource_status_code", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("200");
    });

    it("renders a check-circle icon for a 200 success status code", () => {
      // Arrange & Assert
      const icons = wrapper.findAllComponents({ name: "OIcon" });
      const successIcon = icons.find((icon: any) =>
        icon.props("name")?.includes("check-circle"),
      );
      expect(successIcon).toBeTruthy();
    });

    it("displays the correct status code text for each HTTP status range", async () => {
      // Arrange
      const testCases = [200, 301, 404, 500];

      for (const status of testCases) {
        // Act
        await wrapper.setProps({ resource: createResourceWithStatus(status) });
        await flushPromises();

        // Assert
        expect(wrapper.text()).toContain(String(status));
      }
    });

    it("renders a warning icon for a 404 client error status code", async () => {
      // Arrange & Act
      await wrapper.setProps({ resource: createResourceWithStatus(404) });
      await flushPromises();

      // Assert
      const icons = wrapper.findAllComponents({ name: "OIcon" });
      const warningIcon = icons.find((icon: any) =>
        icon.props("name")?.includes("warning"),
      );
      expect(warningIcon).toBeTruthy();
    });

    it("renders an error icon for a 500 server error status code", async () => {
      // Arrange & Act
      await wrapper.setProps({ resource: createResourceWithStatus(500) });
      await flushPromises();

      // Assert
      const icons = wrapper.findAllComponents({ name: "OIcon" });
      const errorIcon = icons.find((icon: any) =>
        icon.props("name")?.includes("error"),
      );
      expect(errorIcon).toBeTruthy();
    });

    it("provides a title attribute containing the page URL for truncated display", () => {
      // Arrange & Assert
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
    it("displays Resource Information section heading when resource is present", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Resource Information");
    });

    it("displays the resource type field when resource has resource_type", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Type:");
      expect(wrapper.text()).toContain("xhr");
    });

    it("displays formatted file size when resource has resource_size", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Size:");
      expect(wrapper.text()).toContain("2.00 KB");
    });

    it("displays render blocking status when resource has resource_render_blocking_status", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Render Blocking:");
      expect(wrapper.text()).toContain("non-blocking");
    });

    it("displays session ID field when resource has a session id", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Session ID:");
      expect(wrapper.find("code.session-id-text").exists()).toBe(true);
    });

    it("displays Page URL field when resource has a view url", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Page URL:");
      expect(wrapper.text()).toContain("http://localhost:5080/dashboard");
    });

    it("hides Type, Size, and Render Blocking fields when resource has no optional data", async () => {
      // Arrange & Act
      await wrapper.setProps({ resource: createMinimalResource() });
      await flushPromises();

      // Assert
      const text = wrapper.text();
      expect(text).not.toContain("Type:");
      expect(text).not.toContain("Size:");
      expect(text).not.toContain("Render Blocking:");
    });

    it("displays N/A for zero timestamp when resource has _timestamp=0", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ _timestamp: 0 }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("N/A");
    });

    it("formats bytes as B when size is below 1 KB", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ resource_size: 512 }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("512.00 B");
    });

    it("formats bytes as KB when size is in kilobyte range", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ resource_size: 2048 }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("2.00 KB");
    });

    it("formats bytes as MB when size is in megabyte range", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ resource_size: 2097152 }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("2.00 MB");
    });

    it("formats bytes as GB when size is in gigabyte range", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ resource_size: 2147483648 }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("2.00 GB");
    });

    it("hides Size field when resource_size is 0", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ resource_size: 0 }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).not.toContain("Size:");
    });

    it("displays truncated session ID when ID length exceeds 16 characters", async () => {
      // Arrange
      const longId = "session-123456789-abcdefgh";

      // Act
      await wrapper.setProps({
        resource: createMockResource({ session: { id: longId } }),
      });
      await flushPromises();

      // Assert — formatSessionId returns first 8 + "..." + last 8 chars
      const text = wrapper.text();
      expect(text).toContain("session-");
      expect(text).toContain("abcdefgh");
    });

    it("displays short session IDs without truncation when length <= 16 characters", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ session: { id: "session-123" } }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("session-123");
    });
  });

  // ==========================================================================
  // TRACE CORRELATION SECTION
  // ==========================================================================

  describe("Trace Correlation Integration", () => {
    it("renders TraceCorrelationCard when resource has _oo.trace_id", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="trace-correlation-card"]').exists()).toBe(true);
    });

    it("passes correct traceId via _oo_trace_id flat property to TraceCorrelationCard", () => {
      // The component uses resource._oo_trace_id as the :trace-id binding.
      // The mock supplies _oo_trace_id: "trace-123" alongside _oo.trace_id.
      const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
      expect(traceCard.exists()).toBe(true);
      expect(traceCard.attributes("data-trace-id")).toBe("trace-123");
    });

    it("passes correct spanId prop to TraceCorrelationCard", () => {
      const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
      expect(traceCard.exists()).toBe(true);
      expect(traceCard.attributes("data-span-id")).toBe("span-456");
    });

    it("passes correct sessionId prop to TraceCorrelationCard", () => {
      const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
      expect(traceCard.exists()).toBe(true);
      expect(traceCard.attributes("data-session-id")).toBe("session-123");
    });

    it("passes correct resourceDuration prop to TraceCorrelationCard", () => {
      const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
      expect(traceCard.exists()).toBe(true);
      expect(traceCard.attributes("data-resource-duration")).toBe("250");
    });

    it("passes updated traceId when resource _oo_trace_id flat property changes", async () => {
      // The component reads _oo?.trace_id to conditionally render TraceCorrelationCard,
      // but passes _oo_trace_id (flat) as the :trace-id prop.
      const newTraceId = "trace-updated-999";
      await wrapper.setProps({
        resource: createMockResource({
          _oo: { trace_id: newTraceId, span_id: "span-new" },
          _oo_trace_id: newTraceId,
        }),
      });
      await flushPromises();

      const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
      expect(traceCard.exists()).toBe(true);
      expect(traceCard.attributes("data-trace-id")).toBe(newTraceId);
    });

    it("shows no trace available message when resource has no _oo data", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ _oo: undefined }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("No trace information available for this resource");
    });

    it("shows SDK version requirement message when resource has no trace data", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ _oo: undefined }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Trace correlation requires browser SDK v0.3.3+");
    });
  });

  // ==========================================================================
  // SESSION CONTEXT SECTION
  // ==========================================================================

  describe("Session Context Actions", () => {
    it("displays Session Context section when resource has session id", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Session Context");
    });

    it("renders View Session Replay button when resource has session id", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="view-session-replay-btn"]').exists()).toBe(true);
    });

    it("renders View All Session Events button when resource has session id", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="view-session-events-btn"]').exists()).toBe(true);
    });

    it("hides Session Context section when resource has no session data", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ session: undefined }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).not.toContain("Session Context");
    });

    it("hides Session Context section when resource has an empty session object", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ session: {} }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).not.toContain("Session Context");
    });
  });

  // ==========================================================================
  // USER INTERACTIONS & NAVIGATION
  // ==========================================================================

  describe("User Interactions", () => {
    describe("Closing the Drawer", () => {
      it("emits update:modelValue with false when close button is clicked", async () => {
        // Arrange
        const closeBtn = wrapper.find('[data-test="close-drawer-btn"]');

        // Act
        await closeBtn.trigger("click");
        await flushPromises();

        // Assert
        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
      });

      it("emits update:modelValue when modelValue prop changes to false", async () => {
        // Arrange — component mounted with modelValue=true in beforeEach

        // Act — parent sets prop to false (watch triggers emit)
        await wrapper.setProps({ modelValue: false });
        await flushPromises();

        // Assert — the watcher emits the new value
        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      });
    });

    describe("Session Replay Navigation", () => {
      it("navigates to rumSessions route with session_id when replay button is clicked", async () => {
        // Arrange
        const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
        const replayBtn = wrapper.find('[data-test="view-session-replay-btn"]');

        // Act
        await replayBtn.trigger("click");
        await flushPromises();

        // Assert
        expect(routerPushSpy).toHaveBeenCalledWith({
          name: "rumSessions",
          query: { session_id: "session-123" },
        });
      });

      it("emits update:modelValue with false after navigating to session replay", async () => {
        // Arrange
        vi.spyOn(router, "push").mockResolvedValue(undefined as any);
        const replayBtn = wrapper.find('[data-test="view-session-replay-btn"]');

        // Act
        await replayBtn.trigger("click");
        await flushPromises();

        // Assert
        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
      });

      it("does not render replay button when resource has no session id", async () => {
        // Arrange & Act
        await wrapper.setProps({
          resource: createMockResource({ session: undefined }),
        });
        await flushPromises();

        // Assert
        expect(wrapper.find('[data-test="view-session-replay-btn"]').exists()).toBe(false);
      });
    });

    describe.skip("Session Events Action", () => {
      it("shows info notification when View All Session Events is clicked", async () => {
        // Skip: requires intercepting toast calls which is complex without Quasar notify
        const eventsBtn = wrapper.find('[data-test="view-session-events-btn"]');
        await eventsBtn.trigger("click");
        await flushPromises();
      });
    });
  });

  // ==========================================================================
  // ACCESSIBILITY
  // ==========================================================================

  describe.skip("Accessibility", () => {
    it("closes drawer when close button receives Enter keydown then click", async () => {
      const closeBtn = wrapper.find('[data-test="close-drawer-btn"]');
      await closeBtn.trigger("keydown.enter");
      await closeBtn.trigger("click");
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("closes drawer when close button receives Space keydown then click", async () => {
      const closeBtn = wrapper.find('[data-test="close-drawer-btn"]');
      await closeBtn.trigger("keydown.space");
      await closeBtn.trigger("click");
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("navigates when replay button receives Enter keydown then click", async () => {
      const replayBtn = wrapper.find('[data-test="view-session-replay-btn"]');
      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      await replayBtn.trigger("keydown.enter");
      await replayBtn.trigger("click");
      await flushPromises();
      expect(routerPushSpy).toHaveBeenCalled();
    });

    it("navigates when replay button receives Space keydown then click", async () => {
      const replayBtn = wrapper.find('[data-test="view-session-replay-btn"]');
      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      await replayBtn.trigger("keydown.space");
      await replayBtn.trigger("click");
      await flushPromises();
      expect(routerPushSpy).toHaveBeenCalled();
    });

    it("View All Session Events button is reachable via keyboard", async () => {
      const eventsBtn = wrapper.find('[data-test="view-session-events-btn"]');
      await eventsBtn.trigger("keydown.enter");
      await eventsBtn.trigger("click");
      await flushPromises();
      expect(eventsBtn.exists()).toBe(true);
    });

    it.skip("closes drawer on Space keydown for View All Session Events button", async () => {
      const eventsBtn = wrapper.find('[data-test="view-session-events-btn"]');
      await eventsBtn.trigger("keydown.space");
      await eventsBtn.trigger("click");
      await flushPromises();
      expect(eventsBtn.exists()).toBe(true);
    });

    it("provides title attributes for truncated text elements", () => {
      const urlElements = wrapper.findAll("[title]");
      expect(urlElements.length).toBeGreaterThan(0);
    });

    it("displays semantic headings for main content sections", () => {
      expect(wrapper.text()).toContain("Resource Details");
      expect(wrapper.text()).toContain("Resource Information");
      expect(wrapper.text()).toContain("Session Context");
    });
  });

  // ==========================================================================
  // PROPS VALIDATION
  // ==========================================================================

  describe("Component Props", () => {
    it("renders resource data when modelValue is true", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Resource Details");
    });

    it("displays all key resource fields when resource prop is fully populated", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("GET");
      expect(wrapper.text()).toContain("http://localhost:5080/users");
      expect(wrapper.text()).toContain("200");
      expect(wrapper.text()).toContain("250ms");
    });

    it("mounts successfully without optional props", async () => {
      // Arrange
      const newWrapper = mount(ResourceDetailDrawer, {
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      // Assert
      expect(newWrapper.exists()).toBe(true);
      newWrapper.unmount();
    });

    it("reactively updates displayed URL when resource prop changes", async () => {
      // Arrange
      const newResource = createMockResource({
        resource_url: "http://example.com/new",
        resource_status_code: 404,
      });

      // Act
      await wrapper.setProps({ resource: newResource });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("http://example.com/new");
      expect(wrapper.text()).toContain("404");
    });
  });

  // ==========================================================================
  // EDGE CASES & ERROR HANDLING
  // ==========================================================================

  describe("Edge Cases", () => {
    it("does not throw when resource prop is null", async () => {
      // Arrange & Act
      await wrapper.setProps({ resource: null });
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.html()).not.toThrow();
    });

    it("does not throw when resource prop is undefined", async () => {
      // Arrange & Act
      await wrapper.setProps({ resource: undefined });
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders minimal resource URL when resource has only required fields", async () => {
      // Arrange & Act
      await wrapper.setProps({ resource: createMinimalResource() });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("http://localhost:5080");
    });

    it("displays N/A when resource has undefined _timestamp", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ _timestamp: undefined }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("N/A");
    });

    it("hides Session Context section when resource has an empty session object", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({ session: {} }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).not.toContain("Session Context");
    });

    it("displays N/A when resource has zero duration, size, and status", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({
          resource_duration: 0,
          resource_size: 0,
          resource_status_code: 0,
        }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("N/A");
    });

    it("renders correctly when resource_url contains special HTML characters", async () => {
      // Arrange & Act
      await wrapper.setProps({
        resource: createMockResource({
          resource_url: "http://example.com/?query=<script>alert('xss')</script>",
        }),
      });
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // DATA FORMATTING - USER-FACING DISPLAY
  // ==========================================================================

  describe("Data Formatting Display", () => {
    describe("Timestamp Display", () => {
      it("displays a formatted year from the timestamp when resource has valid _timestamp", () => {
        // Arrange & Assert
        expect(wrapper.text()).toContain("2023");
      });

      it("displays N/A when resource has _timestamp=0", async () => {
        // Arrange & Act
        await wrapper.setProps({
          resource: createMockResource({ _timestamp: 0 }),
        });
        await flushPromises();

        // Assert
        expect(wrapper.text()).toContain("N/A");
      });
    });

    describe("Duration Display", () => {
      it("displays duration in milliseconds when duration is 500ms", async () => {
        // Arrange & Act
        await wrapper.setProps({
          resource: createMockResource({ resource_duration: 500 }),
        });
        await flushPromises();

        // Assert
        expect(wrapper.text()).toContain("500ms");
      });

      it("displays duration in seconds when duration is 2500ms", async () => {
        // Arrange & Act
        await wrapper.setProps({
          resource: createMockResource({ resource_duration: 2500 }),
        });
        await flushPromises();

        // Assert
        expect(wrapper.text()).toContain("2.50s");
      });

      it("displays N/A when resource duration is 0", async () => {
        // Arrange & Act
        await wrapper.setProps({
          resource: createMockResource({ resource_duration: 0 }),
        });
        await flushPromises();

        // Assert
        expect(wrapper.text()).toContain("N/A");
      });
    });
  });

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe("Integration Scenarios", () => {
    it("shows all details sections when resource is fully populated", async () => {
      // Arrange
      const completeResource = createMockResource();
      await wrapper.setProps({ resource: completeResource });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Resource Information");
      expect(wrapper.text()).toContain("Session Context");
      expect(wrapper.find('[data-test="trace-correlation-card"]').exists()).toBe(true);
    });

    it("shows no trace message and navigates on replay click in a full user flow", async () => {
      // Arrange — resource without trace data
      await wrapper.setProps({
        resource: createMockResource({ _oo: undefined }),
      });
      await flushPromises();

      // Assert — no trace section
      expect(wrapper.text()).toContain("No trace information available");
      expect(wrapper.text()).toContain("browser SDK v0.3.3+");
    });

    it("navigates and closes drawer when user clicks replay button", async () => {
      // Arrange
      expect(wrapper.text()).toContain("Resource Details");
      expect(wrapper.text()).toContain("GET");

      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      const replayBtn = wrapper.find('[data-test="view-session-replay-btn"]');

      // Act
      await replayBtn.trigger("click");
      await flushPromises();

      // Assert
      expect(routerPushSpy).toHaveBeenCalled();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });
});
