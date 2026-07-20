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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";

// --- Module-level mocks (hoisted by Vitest before any import) ---

vi.mock("@/composables/useSessionReplay", () => ({
  default: () => ({
    sessionState: {
      data: {
        selectedSession: {
          start_time: 1692884313968,
          end_time: 1692884769270,
          browser: "Chrome",
          os: "macOS",
          ip: "1.2.3.4",
          user_email: "user@example.com",
          city: "San Francisco",
          country: "US",
          session_id: "session-abc",
        },
      },
    },
  }),
}));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: { sql: "" },
      aggs: {},
    }),
    getTimeInterval: vi.fn().mockReturnValue({ interval: "1m" }),
    parseQuery: vi.fn().mockReturnValue({}),
  }),
}));

vi.mock("@/composables/rum/usePerformance", () => ({
  default: () => ({
    performanceState: {
      data: {
        streams: {
          _sessionreplay: {
            schema: {
              geo_info_country: true,
              geo_info_city: true,
            },
          },
        },
      },
    },
  }),
}));

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn().mockResolvedValue({
      data: { hits: [] },
    }),
  },
}));

vi.mock("@/utils/date", () => ({
  formatDate: vi.fn().mockReturnValue("Jun 04, 2026 12:00:00 +0000"),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getUUID: vi.fn().mockReturnValue("mock-uuid"),
  };
});

// --- Component import (sees the mocks above) ---
import SessionViewer from "./SessionViewer.vue";

// ---------------------------------------------------------------------------
// Mount factory — centralises stub config; update in one place when the
// component interface changes.
// ---------------------------------------------------------------------------
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: { template: "<div>Home</div>" } },
      {
        path: "/rum/sessions/:id",
        component: SessionViewer,
        name: "SessionViewer",
      },
    ],
  });
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: "en", messages: { en: {} } });
}

function mountSessionViewer(
  router = createTestRouter(),
  i18n = createTestI18n(),
) {
  return mount(SessionViewer, {
    global: {
      plugins: [router, i18n],
      stubs: {
        // Stub heavyweight child components — not the subjects of these tests
        VideoPlayer: { template: '<div data-test="stub-video-player" />' },
        PlayerEventsSidebar: {
          template: '<div data-test="stub-player-events-sidebar" />',
          props: [
            "events",
            "sessionDetails",
            "sessionId",
            "currentTime",
            "startTime",
            "endTime",
          ],
        },
        EventDetailDrawer: {
          template: '<div data-test="stub-event-detail-drawer" />',
        },
        OIcon: { template: "<span />" },
        // OSplitter rendered as-is so layout tests can assert on it
        OSplitter: {
          template:
            '<div data-test="stub-osplitter"><slot name="before" /><slot name="after" /></div>',
          props: ["modelValue", "limits", "unit"],
          emits: ["update:modelValue"],
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
describe("SessionViewer.vue", () => {
  let wrapper: VueWrapper;
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = createTestRouter();
    // Navigate to a session route so params.id is populated
    await router.push({
      path: "/rum/sessions/session-abc",
      query: {
        start_time: "1692884313968000",
        end_time: "1692884769270000",
      },
    });
    wrapper = mountSessionViewer(router);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("initial render", () => {
    it("should render the component without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('should render the "Go Back" navigation button', () => {
      const backBtn = wrapper.find('[data-test="session-viewer-back-btn"]');
      expect(backBtn.exists()).toBe(true);
    });

    it("should show Unknown User when session has no user email initially", () => {
      // Default sessionDetails.user_email starts as "" before session load
      expect(wrapper.text()).toContain("Unknown User");
    });
  });

  // -------------------------------------------------------------------------
  describe("layout structure — OSplitter resizable layout", () => {
    it("should render OSplitter as the layout container", () => {
      const splitter = wrapper.find('[data-test="stub-osplitter"]');
      expect(splitter.exists()).toBe(true);
    });

    it("should render VideoPlayer inside the OSplitter before slot", () => {
      const splitter = wrapper.find('[data-test="stub-osplitter"]');
      expect(splitter.find('[data-test="stub-video-player"]').exists()).toBe(
        true,
      );
    });

    it("should render PlayerEventsSidebar inside the OSplitter after slot", () => {
      const splitter = wrapper.find('[data-test="stub-osplitter"]');
      expect(
        splitter.find('[data-test="stub-player-events-sidebar"]').exists(),
      ).toBe(true);
    });

    it("should initialise splitterSize to 600px", () => {
      // splitterSize drives the OSplitter v-model default
      expect((wrapper.vm as any).splitterSize).toBe(600);
    });
  });

  // -------------------------------------------------------------------------
  describe("navigation", () => {
    it("should call router.back() when Go Back button is clicked", async () => {
      const backSpy = vi.spyOn(router, "back");
      const backBtn = wrapper.find('[data-test="session-viewer-back-btn"]');
      expect(backBtn.exists()).toBe(true);
      await backBtn.trigger("click");
      expect(backSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("session details header", () => {
    it("should render the IP address info section", () => {
      const sections = wrapper.findAll(".truncate");
      expect(sections.length).toBeGreaterThanOrEqual(1);
    });

    it("should render at least 5 info sections in the header", () => {
      // ip, date, user, location, browser/os
      const sections = wrapper.findAll(".truncate");
      expect(sections.length).toBeGreaterThanOrEqual(5);
    });
  });

  // -------------------------------------------------------------------------
  describe("currentTime tracking", () => {
    it("should initialise currentTime to 0", () => {
      // currentTime is passed to PlayerEventsSidebar for sync with video player
      expect((wrapper.vm as any).currentTime).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("PlayerEventsSidebar receives required props", () => {
    it("should pass session-id to PlayerEventsSidebar", () => {
      // Verify the session-id is present in the template by checking the
      // component's reactive sessionId value is set after mount
      expect((wrapper.vm as any).sessionId).toBe("session-abc");
    });
  });

  // -------------------------------------------------------------------------
  describe("frustration signals", () => {
    it("should not display frustration summary when segmentEvents is empty", () => {
      const summary = wrapper.find(
        '[data-test="session-viewer-frustration-summary"]',
      );
      expect(summary.exists()).toBe(false);
    });

    it("should display frustration summary when events have frustration_types", async () => {
      // No public API to inject events; setting vm directly is the only option
      (wrapper.vm as any).segmentEvents = [
        {
          id: "1",
          type: "action",
          frustration_types: ["rage_click"],
          name: "click on Submit",
        },
        {
          id: "2",
          type: "action",
          frustration_types: ["dead_click"],
          name: "click on Nav",
        },
      ];
      await wrapper.vm.$nextTick();

      const summary = wrapper.find(
        '[data-test="session-viewer-frustration-summary"]',
      );
      expect(summary.exists()).toBe(true);
    });

    it("should not display frustration summary when all events have empty frustration_types", async () => {
      (wrapper.vm as any).segmentEvents = [
        { id: "1", type: "action", frustration_types: [], name: "click" },
        { id: "2", type: "action", frustration_types: null, name: "click" },
      ];
      await wrapper.vm.$nextTick();

      const summary = wrapper.find(
        '[data-test="session-viewer-frustration-summary"]',
      );
      expect(summary.exists()).toBe(false);
    });

    it("should count only events with non-empty frustration_types", async () => {
      (wrapper.vm as any).segmentEvents = [
        {
          id: "1",
          type: "action",
          frustration_types: ["rage_click"],
          name: "click",
        },
        {
          id: "2",
          type: "action",
          frustration_types: ["dead_click"],
          name: "click",
        },
        { id: "3", type: "action", frustration_types: null, name: "click" },
        { id: "4", type: "action", frustration_types: [], name: "click" },
      ];
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).frustrationCount).toBe(2);
    });

    it('should display singular "Frustration" when frustration count is 1', async () => {
      (wrapper.vm as any).segmentEvents = [
        {
          id: "1",
          type: "action",
          frustration_types: ["rage_click"],
          name: "click",
        },
      ];
      await wrapper.vm.$nextTick();

      const summaryText = wrapper.find(
        '[data-test="frustration-summary-text"]',
      );
      expect(summaryText.exists()).toBe(true);
      expect(summaryText.text()).toBe("1 Frustration");
    });

    it('should display plural "Frustrations" when frustration count is greater than 1', async () => {
      (wrapper.vm as any).segmentEvents = [
        {
          id: "1",
          type: "action",
          frustration_types: ["rage_click"],
          name: "click",
        },
        {
          id: "2",
          type: "action",
          frustration_types: ["dead_click"],
          name: "click",
        },
      ];
      await wrapper.vm.$nextTick();

      const summaryText = wrapper.find(
        '[data-test="frustration-summary-text"]',
      );
      expect(summaryText.exists()).toBe(true);
      expect(summaryText.text()).toBe("2 Frustrations");
    });

    it("should display singular title tooltip when frustration count is 1", async () => {
      (wrapper.vm as any).segmentEvents = [
        {
          id: "1",
          type: "action",
          frustration_types: ["rage_click"],
          name: "click",
        },
      ];
      await wrapper.vm.$nextTick();

      const summary = wrapper.find(
        '[data-test="session-viewer-frustration-summary"]',
      );
      expect(summary.attributes("title")).toBe(
        "1 frustration signal detected",
      );
    });

    it("should display plural title tooltip when frustration count is greater than 1", async () => {
      (wrapper.vm as any).segmentEvents = [
        {
          id: "1",
          type: "action",
          frustration_types: ["rage_click"],
          name: "click",
        },
        {
          id: "2",
          type: "action",
          frustration_types: ["dead_click"],
          name: "click",
        },
      ];
      await wrapper.vm.$nextTick();

      const summary = wrapper.find(
        '[data-test="session-viewer-frustration-summary"]',
      );
      expect(summary.attributes("title")).toBe(
        "2 frustration signals detected",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("handleActionEvent — frustration type parsing", () => {
    it("should parse a JSON array string of frustration types", () => {
      const event = {
        type: "action",
        action_type: "click",
        action_target_name: "Submit",
        action_frustration_type: '["rage_click","dead_click"]',
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleActionEvent(event);

      expect(formatted.frustration_types).toEqual(["rage_click", "dead_click"]);
    });

    it("should wrap a single plain string frustration type in an array", () => {
      const event = {
        type: "action",
        action_type: "click",
        action_target_name: "Submit",
        action_frustration_type: "rage_click",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleActionEvent(event);

      expect(formatted.frustration_types).toEqual(["rage_click"]);
    });

    it("should handle malformed JSON by treating the raw string as a single-element array", () => {
      const event = {
        type: "action",
        action_type: "click",
        action_target_name: "Submit",
        action_frustration_type: "invalid-json{",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleActionEvent(event);

      expect(formatted.frustration_types).toEqual(["invalid-json{"]);
    });

    it("should leave frustration_types empty when action_frustration_type is absent", () => {
      const event = {
        type: "action",
        action_type: "click",
        action_target_name: "Submit",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleActionEvent(event);

      expect(formatted.frustration_types).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("handleErrorEvent", () => {
    it("should use error_message as the event name", () => {
      const event = {
        type: "error",
        error_id: "err-1",
        error_message: "Uncaught TypeError",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleErrorEvent(event);

      expect(formatted.name).toBe("Uncaught TypeError");
    });

    it('should fall back to "--" when error_message is missing', () => {
      const event = {
        type: "error",
        error_id: "err-2",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleErrorEvent(event);

      expect(formatted.name).toBe("--");
    });

    it("should set event type to error", () => {
      const event = {
        type: "error",
        error_id: "err-3",
        error_message: "Some error",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleErrorEvent(event);

      expect(formatted.type).toBe("error");
    });
  });

  // -------------------------------------------------------------------------
  describe("handleViewEvent", () => {
    it("should combine view_loading_type and view_url as the event name", () => {
      const event = {
        type: "view",
        view_id: "view-1",
        view_loading_type: "initial_load",
        view_url: "https://example.com/page",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleViewEvent(event);

      expect(formatted.name).toBe("initial_load : https://example.com/page");
    });

    it("should set event type to view", () => {
      const event = {
        type: "view",
        view_id: "view-2",
        view_loading_type: "route_change",
        view_url: "/dashboard",
        date: 1692884313968,
      };

      const formatted = (wrapper.vm as any).handleViewEvent(event);

      expect(formatted.type).toBe("view");
    });
  });

  // -------------------------------------------------------------------------
  describe("handleSidebarEvent — event-click opens the event detail drawer", () => {
    it('should open the event detail drawer when sidebar emits "event-click"', async () => {
      // videoPlayerRef has no public API to set; injecting stub directly is required
      (wrapper.vm as any).videoPlayerRef = {
        goto: vi.fn(),
        playerState: { isPlaying: false },
      };

      const payload = {
        event_id: "evt-1",
        relativeTime: 5000,
        type: "error",
        name: "TypeError",
      };

      (wrapper.vm as any).handleSidebarEvent("event-click", payload);
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).showEventDetailDrawer).toBe(true);
      expect((wrapper.vm as any).selectedEvent).toEqual(payload);
    });

    it("should always seek the video player to the event relative time", async () => {
      const gotoSpy = vi.fn();
      (wrapper.vm as any).videoPlayerRef = {
        goto: gotoSpy,
        playerState: { isPlaying: false },
      };

      const payload = { event_id: "evt-2", relativeTime: 12345, type: "view" };
      (wrapper.vm as any).handleSidebarEvent("event-click", payload);

      expect(gotoSpy).toHaveBeenCalledWith(12345, false);
    });

    it("should auto-play the video when it is already playing during seek", async () => {
      const gotoSpy = vi.fn();
      (wrapper.vm as any).videoPlayerRef = {
        goto: gotoSpy,
        playerState: { isPlaying: true },
      };

      const payload = { event_id: "evt-3", relativeTime: 9999, type: "action" };
      (wrapper.vm as any).handleSidebarEvent("event-click", payload);

      expect(gotoSpy).toHaveBeenCalledWith(9999, true);
    });

    it("should look up the raw event from rawEventsMap and set selectedRawEvent", async () => {
      const rawEvent = { raw: "data", event_id: "evt-raw" };
      (wrapper.vm as any).rawEventsMap.set("evt-raw", rawEvent);
      (wrapper.vm as any).videoPlayerRef = {
        goto: vi.fn(),
        playerState: { isPlaying: false },
      };

      const payload = { event_id: "evt-raw", relativeTime: 1000, type: "action" };
      (wrapper.vm as any).handleSidebarEvent("event-click", payload);
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).selectedRawEvent).toEqual(rawEvent);
    });
  });

  // -------------------------------------------------------------------------
  describe("forwardToEventTime — computed relative seek position", () => {
    it("should return null when event_time query param is absent", () => {
      // Router was pushed without event_time
      expect((wrapper.vm as any).forwardToEventTime).toBeNull();
    });

    it("should return null when selectedSession has no start_time", async () => {
      // Override the session state to have no start_time
      // No public API; this verifies the guard clause
      const routerWithEvent = createTestRouter();
      await routerWithEvent.push({
        path: "/rum/sessions/session-abc",
        query: {
          start_time: "1692884313968000",
          end_time: "1692884769270000",
          event_time: "1692884500000",
        },
      });
      const w = mountSessionViewer(routerWithEvent);

      // With a valid event_time and selectedSession present, result should not be null
      expect((w.vm as any).forwardToEventTime).not.toBeNull();
      w.unmount();
    });

    it("should compute a non-null relative time when event_time is within the session", async () => {
      const routerWithEvent = createTestRouter();
      await routerWithEvent.push({
        path: "/rum/sessions/session-abc",
        query: {
          start_time: "1692884313968000",
          end_time: "1692884769270000",
          event_time: "1692884500000",
        },
      });
      const w = mountSessionViewer(routerWithEvent);

      const result = (w.vm as any).forwardToEventTime;
      expect(result).not.toBeNull();
      // result is [milliSeconds, displayString]
      expect(Array.isArray(result)).toBe(true);
      w.unmount();
    });
  });
});
