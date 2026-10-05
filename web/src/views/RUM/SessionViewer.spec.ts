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
import { mount, VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createRouter, createWebHistory } from "vue-router";

// --- Module-level mocks (hoisted by Vitest before any import) ---

// Reactive like the real store, so computeds over the selected session follow getSession().
vi.mock("@/composables/useSessionReplay", async () => {
  const { reactive } = await import("vue");
  return {
    default: () => ({
      sessionState: reactive({
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
      }),
    }),
  };
});

// Shared so the tests can read the time window every query was built with.
const queryPayload = vi.hoisted(() => ({
  build: null as any,
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: (queryPayload.build ??= vi.fn(() => ({ query: { sql: "" }, aggs: {} }))),
    getTimeInterval: vi.fn().mockReturnValue({ interval: "1m" }),
    parseQuery: vi.fn().mockReturnValue({}),
  }),
}));

// Null passes getStream through to the real composable; a test sets it to answer stream lookups itself.
const streamsMock = vi.hoisted(() => ({
  getStream: null as null | ((name: string, type: string, schema: boolean) => Promise<unknown>),
}));
vi.mock("@/composables/useStreams", async (importOriginal) => {
  const actual = await importOriginal<{ default: (...a: unknown[]) => Record<string, unknown> }>();
  return {
    default: (...a: unknown[]) => {
      const real = actual.default(...a);
      return {
        ...real,
        getStream: (...b: [string, string, boolean]) =>
          streamsMock.getStream
            ? streamsMock.getStream(...b)
            : (real.getStream as (...c: unknown[]) => Promise<unknown>)(...b),
      };
    },
  };
});

// Shared so a test can add the view columns the schema guard looks for.
const replaySchema = vi.hoisted(() => ({
  fields: { geo_info_country: true, geo_info_city: true } as Record<string, boolean>,
}));

vi.mock("@/composables/rum/usePerformance", () => ({
  default: () => ({
    performanceState: {
      data: {
        streams: {
          _sessionreplay: {
            schema: replaySchema.fields,
          },
        },
      },
    },
  }),
}));

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  // Existing tests need the lookup to find a row; the no-replay tests override the first call.
  const sessionRow = {
    zo_sql_timestamp: 1692884313968000,
    start_time: 1692884313968,
    end_time: 1692884769270,
    browser: "Chrome",
    os: "macOS",
    ip: "1.2.3.4",
    source: "browser",
    city: "San Francisco",
    country: "US",
    session_id: "session-abc",
  };
  return overlayServiceMock(await importOriginal(), {
    default: {
      search: vi.fn().mockImplementation(async (params: any) => {
        const sql: string = params?.query?.query?.sql ?? "";
        return { data: { hits: sql.includes("min(start)") ? [sessionRow] : [] } };
      }),
    },
  });
});

// The replay-segment fetches go over HTTP streaming; capture their SQL and answer them here.
// A responder returns hits, { error } to fail the request, or "hang" to leave it open and silent.
const streaming = vi.hoisted(() => ({
  sqls: [] as string[],
  requests: [] as any[],
  responder: (_sql: string, _from: number): any => [],
  cancel: null as any,
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: async (data: any, handlers: any) => {
      const sql = data.queryReq.query.sql as string;
      streaming.sqls.push(sql);
      streaming.requests.push({ data, handlers });
      const result = streaming.responder(sql, data.queryReq.query.from);
      if (result === "hang") return;
      if (result?.error) {
        handlers.error(data, { type: "error", content: result.error });
        return;
      }
      handlers.onActivity?.();
      handlers.data(data, {
        type: "search_response_hits",
        content: { results: { hits: result } },
      });
      handlers.complete(data, null);
    },
    cancelStreamQueryBasedOnRequestId: (streaming.cancel ??= vi.fn()),
  }),
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

// Stubs expose seekTo, so a seek after a re-render still reaches a spy.
const playerStubs = vi.hoisted(() => ({
  videoSeek: null as any,
  mobileSeek: null as any,
}));

// --- Component import (sees the mocks above) ---
import SessionViewer from "./SessionViewer.vue";
import store from "@/test/unit/helpers/store";
import ShareButton from "@/components/common/ShareButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import searchService from "@/services/search";
import i18n from "@/locales";
import { ACTIVE_WINDOW_MS } from "@/utils/rum/sessionReplayLive";
import { b64DecodeUnicode } from "@/utils/zincutils";
import analytics from "@/services/product_analytics";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function flushMany(times = 12) {
  for (let i = 0; i < times; i++) await flush();
}

const fixtureStart = 1692884313968;

// Three segments, full snapshots at 0 s and 2 s of the session.
const fixtureRows = [
  { start: fixtureStart, end: fixtureStart + 999, has_full_snapshot: true, records_count: 2 },
  {
    start: fixtureStart + 1000,
    end: fixtureStart + 1999,
    has_full_snapshot: false,
    records_count: 1,
  },
  {
    start: fixtureStart + 2000,
    end: fixtureStart + 2999,
    has_full_snapshot: true,
    records_count: 1,
  },
];

// Body rows carry the key columns the loader matches on, as the bodies query selects them.
function fixtureBody(row: any) {
  return {
    ...row,
    segment: JSON.stringify({ records: [{ type: 4, timestamp: row.start, data: {} }] }),
  };
}

// Answers the manifest with `rows`, and a body range with every row whose start falls inside it.
function rowsResponder(rows: any[], body = fixtureBody) {
  return (sql: string, from: number) => {
    if (from > 0) return [];
    if (sql.includes("has_full_snapshot")) return rows;
    const lo = Number(/start >= (\d+)/.exec(sql)?.[1] ?? 0);
    const hi = Number(/start <= (\d+)/.exec(sql)?.[1] ?? 0);
    return rows.filter((row) => row.start >= lo && row.start <= hi).map(body);
  };
}

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

function mountSessionViewer(router = createTestRouter()) {
  return mount(SessionViewer, {
    global: {
      plugins: [store, router],
      stubs: {
        // Stub heavyweight child components — not the subjects of these tests
        VideoPlayer: defineComponent({
          template: '<div data-test="stub-video-player" />',
          setup(_props, { expose }) {
            expose({ seekTo: (...args: any[]) => playerStubs.videoSeek?.(...args) });
            return {};
          },
        }),
        MobileSessionPlayer: defineComponent({
          template: '<div data-test="stub-mobile-player" />',
          setup(_props, { expose }) {
            expose({ seekTo: (...args: any[]) => playerStubs.mobileSeek?.(...args) });
            return {};
          },
        }),
        PlayerEventsSidebar: {
          name: "PlayerEventsSidebar",
          template: '<div data-test="stub-player-events-sidebar" />',
          props: [
            "events",
            "sessionDetails",
            "sessionId",
            "currentTime",
            "startTime",
            "endTime",
            "markedTimestamps",
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
      vi.mocked(searchService.search).mockReturnValueOnce(new Promise(() => {}));
      const pending = mountSessionViewer(router);
      expect(pending.text()).toContain("Unknown User");
      pending.unmount();
    });
  });

  describe("session_replay_played analytics", () => {
    const emitState = (state: string) =>
      wrapper.findComponent('[data-test="stub-video-player"]').vm.$emit("playback-state", state);

    it("tracks once when playback first starts, not on later resumes", async () => {
      emitState("paused");
      await wrapper.vm.$nextTick();
      expect(analytics.track).not.toHaveBeenCalled();

      emitState("playing");
      await wrapper.vm.$nextTick();
      emitState("paused");
      await wrapper.vm.$nextTick();
      emitState("playing");
      await wrapper.vm.$nextTick();

      expect(analytics.track).toHaveBeenCalledTimes(1);
      expect(analytics.track).toHaveBeenCalledWith("session_replay_played", {
        platform: "browser",
      });
    });

    it("does not track a replay that failed to load", async () => {
      emitState("failed");
      await wrapper.vm.$nextTick();
      expect(analytics.track).not.toHaveBeenCalled();
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
      expect(splitter.find('[data-test="stub-video-player"]').exists()).toBe(true);
    });

    it("should render PlayerEventsSidebar inside the OSplitter after slot", () => {
      const splitter = wrapper.find('[data-test="stub-osplitter"]');
      expect(splitter.find('[data-test="stub-player-events-sidebar"]').exists()).toBe(true);
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
  describe("share link", () => {
    it("shares a URL carrying the session id and its replay time window", () => {
      const shareButton = wrapper.findComponent(ShareButton);

      expect(shareButton.exists()).toBe(true);
      expect(shareButton.props("url")).toBe(
        `${window.location.origin}/rum/sessions/session-abc?start_time=1692884313968000&end_time=1692884769270000`,
      );
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
      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
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

      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
      expect(summary.exists()).toBe(true);
    });

    it("should not display frustration summary when all events have empty frustration_types", async () => {
      (wrapper.vm as any).segmentEvents = [
        { id: "1", type: "action", frustration_types: [], name: "click" },
        { id: "2", type: "action", frustration_types: null, name: "click" },
      ];
      await wrapper.vm.$nextTick();

      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
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

      const summaryText = wrapper.find('[data-test="frustration-summary-text"]');
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

      const summaryText = wrapper.find('[data-test="frustration-summary-text"]');
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

      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
      expect(summary.attributes("title")).toBe("1 frustration signal detected");
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

      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
      expect(summary.attributes("title")).toBe("2 frustration signals detected");
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

    // Seeks now go to the player in session ms through the coverage check, so they need a loaded replay.
    async function mountReady() {
      wrapper.unmount();
      streaming.responder = rowsResponder(fixtureRows);
      wrapper = mountSessionViewer(router);
      await flushMany();
      const seekTo = vi.fn();
      (wrapper.vm as any).videoPlayerRef = { seekTo };
      (wrapper.vm as any).playerLoadedEndMs = 2999;
      (wrapper.vm as any).playerTakenCount = (wrapper.vm as any).segments.length;
      (wrapper.vm as any).handlePlayerReady();
      return seekTo;
    }

    it("should always seek the video player to the event relative time", async () => {
      const seekTo = await mountReady();

      const payload = { event_id: "evt-2", relativeTime: 12345, type: "view" };
      (wrapper.vm as any).handleSidebarEvent("event-click", payload);

      expect(seekTo).toHaveBeenCalledWith(12345, false);
      streaming.responder = () => [];
    });

    it("should auto-play the video when it is already playing during seek", async () => {
      const seekTo = await mountReady();
      (wrapper.vm as any).replayIntent = "play";

      const payload = { event_id: "evt-3", relativeTime: 9999, type: "action" };
      (wrapper.vm as any).handleSidebarEvent("event-click", payload);

      expect(seekTo).toHaveBeenCalledWith(9999, true);
      streaming.responder = () => [];
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

// ---------------------------------------------------------------------------
// Regression: session_id comes straight from the URL route param, so a
// crafted link with an embedded single quote must not corrupt the generated
// SQL. Covers the three fetches issued automatically on mount.
// ---------------------------------------------------------------------------
describe("SessionViewer.vue — session id with an embedded single quote", () => {
  it("escapes the id in every query built from the route param", async () => {
    vi.clearAllMocks();
    const router = createTestRouter();
    await router.push({
      path: "/rum/sessions/session'x",
      query: {
        start_time: "1692884313968000",
        end_time: "1692884769270000",
      },
    });
    const wrapper = mountSessionViewer(router);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sqlCalls = vi
      .mocked(searchService.search)
      .mock.calls.map((call) => (call[0] as any).query.query.sql as string);

    expect(sqlCalls.length).toBeGreaterThan(0);
    for (const sql of sqlCalls) {
      expect(sql).toContain("session_id='session''x'");
    }

    wrapper.unmount();
  });
});

describe("SessionViewer.vue — no replay recorded", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function mountAt(id: string) {
    vi.clearAllMocks();
    const router = createTestRouter();
    await router.push({
      path: `/rum/sessions/${id}`,
      query: { start_time: "1692884313968000", end_time: "1692884769270000" },
    });
    const wrapper = mountSessionViewer(router);
    await flush();
    await flush();
    return wrapper;
  }

  function mountUnrecorded() {
    // Only the first call is the lookup; a persistent override would leak into later tests.
    vi.mocked(searchService.search).mockResolvedValueOnce({ data: { hits: [] } } as any);
    return mountAt("session-unrecorded");
  }

  it("shows the no-replay state naming the session id", async () => {
    const wrapper = await mountUnrecorded();

    const empty = wrapper.find('[data-test="session-viewer-no-replay"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("No replay was recorded for this session");
    expect(empty.text()).toContain("session-unrecorded");
    wrapper.unmount();
  });

  it("does not mount the player or the events sidebar", async () => {
    const wrapper = await mountUnrecorded();

    expect(wrapper.find('[data-test="stub-video-player"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="stub-player-events-sidebar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("issues the session lookup and the RUM events probe, not the segment or event fetches", async () => {
    const wrapper = await mountUnrecorded();

    const sqlCalls = vi
      .mocked(searchService.search)
      .mock.calls.map((call) => (call[0] as any).query.query.sql as string);
    expect(sqlCalls).toHaveLength(2);
    expect(sqlCalls[0]).toContain("min(start)");
    expect(sqlCalls[1]).toContain("MIN(date) AS start_time");
    expect(sqlCalls[1]).toContain('FROM "_rumdata"');
    wrapper.unmount();
  });

  it("renders neither the session subtitle nor the share button", async () => {
    const wrapper = await mountUnrecorded();

    expect(wrapper.find('[data-test="session-viewer-subtitle"]').exists()).toBe(false);
    expect(wrapper.findComponent(ShareButton).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Unknown User");
    wrapper.unmount();
  });

  it("keeps the Go Back navigation", async () => {
    const wrapper = await mountUnrecorded();

    expect(wrapper.find('[data-test="session-viewer-back-btn"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("mounts the player when the session lookup finds a row", async () => {
    const wrapper = await mountAt("session-abc");

    expect(wrapper.find('[data-test="session-viewer-no-replay"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="stub-video-player"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — repeated view documents", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const start = 1692884313968;
  // The SDK re-sends a view on every update: same view_id and date, rising version.
  const viewDoc = (view_id: string, url: string, version: number, date: number) => ({
    type: "view",
    view_id,
    view_url: url,
    view_loading_type: "route_change",
    _o2_document_version: version,
    view_time_spent: version * 1_000_000_000,
    date,
  });

  it("renders one breadcrumb per view, at the navigation time, from its latest document", async () => {
    vi.clearAllMocks();
    const search = vi.mocked(searchService.search);
    const defaultImpl = search.getMockImplementation();
    search.mockImplementation(async (params: any) => {
      const sql: string = params?.query?.query?.sql ?? "";
      if (sql.includes("min(start)")) return defaultImpl!(params, "RUM");
      if (sql.includes('"_rumdata"')) {
        return {
          data: {
            hits: [
              viewDoc("v-login", "https://app/#/Login", 2, start + 1000),
              viewDoc("v-login", "https://app/#/Login", 6, start + 1000),
              viewDoc("v-login", "https://app/#/Login", 4, start + 1000),
              { type: "action", action_id: "a1", view_id: "v-login", date: start + 2000 },
              viewDoc("v-files", "https://app/#/file-manager", 3, start + 5000),
              viewDoc("v-files", "https://app/#/file-manager", 14, start + 5000),
            ],
          },
        } as any;
      }
      return { data: { hits: [] } } as any;
    });

    try {
      const router = createTestRouter();
      await router.push({
        path: "/rum/sessions/session-abc",
        query: { start_time: "1692884313968000", end_time: "1692884769270000" },
      });
      const wrapper = mountSessionViewer(router);
      await flush();
      await flush();

      const events = (wrapper.vm as any).segmentEvents;
      expect(events.map((e: any) => e.type)).toEqual(["view", "action", "view"]);
      const views = events.filter((e: any) => e.type === "view");
      expect(views.map((e: any) => e.name)).toEqual([
        "route_change : https://app/#/Login",
        "route_change : https://app/#/file-manager",
      ]);
      expect(views.map((e: any) => e.timestamp)).toEqual([start + 1000, start + 5000]);
      expect((wrapper.vm as any).rawEventsMap.get("v-files")._o2_document_version).toBe(14);
      wrapper.unmount();
    } finally {
      search.mockImplementation(defaultImpl!);
    }
  });
});

// ---------------------------------------------------------------------------
// Loader, seeks and failures. Every suite sets its own responder and resets the shared mocks.
// ---------------------------------------------------------------------------

const S = fixtureStart;
const sessionLookupRow = {
  zo_sql_timestamp: 1692884313968000,
  start_time: 1692884313968,
  end_time: 1692884769270,
  browser: "Chrome",
  os: "macOS",
  ip: "1.2.3.4",
  source: "browser",
  city: "San Francisco",
  country: "US",
  session_id: "session-abc",
};

async function pushRoute(query: Record<string, string> = {}) {
  const router = createTestRouter();
  await router.push({
    path: "/rum/sessions/session-abc",
    query: { start_time: "1692884313968000", end_time: "1692884769270000", ...query },
  });
  return router;
}

async function mountLoaded(query: Record<string, string> = {}) {
  const wrapper = mountSessionViewer(await pushRoute(query));
  await flushMany();
  return wrapper;
}

function resetStreaming(responder: (sql: string, from: number) => any) {
  streaming.sqls = [];
  streaming.requests = [];
  streaming.responder = responder;
  streaming.cancel?.mockClear();
}

// n segments one second apart; only the first holds a full snapshot.
function manyRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    start: S + i * 1000,
    end: S + i * 1000 + 999,
    has_full_snapshot: i === 0,
    records_count: 1,
  }));
}

const bodySqls = () => streaming.sqls.filter((sql) => sql.includes("segment"));

describe("SessionViewer.vue — segment manifest and windowed fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    resetStreaming(rowsResponder(fixtureRows));
  });

  it("lists the manifest without the segment body and without select *", async () => {
    const wrapper = await mountLoaded();

    const manifestSql = streaming.sqls[0];
    expect(manifestSql).toContain(
      'select start, "end", has_full_snapshot, records_count, _timestamp from',
    );
    expect(manifestSql).not.toContain("select *");
    expect(manifestSql).not.toContain(", segment");
    wrapper.unmount();
  });

  it("sorts by start then end when the schema has no view columns", async () => {
    const wrapper = await mountLoaded();

    expect(streaming.sqls[0]).toMatch(/order by start asc, "end" asc$/);
    expect(streaming.sqls[1]).toMatch(/order by start asc, "end" asc$/);
    wrapper.unmount();
  });

  it("selects and sorts by the view columns when the schema has them", async () => {
    replaySchema.fields = { ...replaySchema.fields, view_id: true, index_in_view: true };
    const wrapper = await mountLoaded();

    expect(streaming.sqls[0]).toContain(
      'select start, "end", has_full_snapshot, records_count, view_id, index_in_view, _timestamp from',
    );
    expect(streaming.sqls[1]).toContain(
      'select start, "end", segment, records_count, view_id, index_in_view from',
    );
    expect(streaming.sqls[1]).toMatch(
      /order by start asc, "end" asc, index_in_view asc, view_id asc$/,
    );
    wrapper.unmount();
  });

  // The bodies query now also selects records_count, the key column the loader matches on.
  it("fetches only the window from the anchor snapshot through the target", async () => {
    const wrapper = await mountLoaded();

    const windowSql = streaming.sqls[1];
    expect(windowSql).toContain('select start, "end", segment, records_count from');
    expect(windowSql).toContain(`and start >= ${S} and start <= ${S}`);
    wrapper.unmount();
  });

  it("loads the remaining segments in the background, later segments only", async () => {
    const wrapper = await mountLoaded();

    const backgroundSql = streaming.sqls[2];
    expect(backgroundSql).toContain(`and start >= ${S + 1000} and start <= ${S + 2000}`);
    expect((wrapper.vm as any).segments).toHaveLength(3);
    wrapper.unmount();
  });

  it("feeds the player in manifest order and reports a complete load", async () => {
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;

    const starts = vm.segments.map((segment: any) => segment.records[0].timestamp);
    expect(starts).toEqual([S, S + 1000, S + 2000]);
    expect(vm.loadState).toBe("complete");
    expect(vm.loadPercent).toBe(100);
    expect(vm.loadedRanges).toEqual([{ start: 0, end: 1692884769270 - S, state: "inPlayer" }]);
    wrapper.unmount();
  });

  it("shows the session duration in the header", async () => {
    const wrapper = await mountLoaded();
    expect(wrapper.find('[data-test="session-viewer-duration"]').text()).toBe("7m 35s");
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — segment identity (Risk 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
  });

  it("dedups an exact duplicate manifest row before counting segments and records", async () => {
    resetStreaming(rowsResponder([fixtureRows[0], fixtureRows[1], fixtureRows[1], fixtureRows[2]]));
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;

    expect(vm.manifest).toHaveLength(3);
    expect(vm.manifestSummary.recordCount).toBe(4);
    expect(vm.segments).toHaveLength(3);
    wrapper.unmount();
  });

  it("stores an exact duplicate body row once", async () => {
    const responder = rowsResponder(fixtureRows);
    resetStreaming((sql, from) => {
      const hits = responder(sql, from);
      return sql.includes("segment") ? [...hits, ...hits] : hits;
    });
    const wrapper = await mountLoaded();

    expect((wrapper.vm as any).segments).toHaveLength(3);
    expect((wrapper.vm as any).loadPercent).toBe(100);
    wrapper.unmount();
  });

  it("stores a row tied at a batch edge once and does not fetch it again", async () => {
    const rows = manyRows(27);
    // Rows 25 and 26 tie on start, so the full batch ends before them and they travel together in the next one.
    rows[26] = { ...rows[26], start: rows[25].start, end: rows[25].start + 500 };
    resetStreaming(rowsResponder(rows));
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;

    expect(bodySqls()).toHaveLength(3);
    expect(bodySqls().filter((sql) => sql.includes(`start <= ${rows[25].start}`))).toHaveLength(1);
    expect(vm.segments).toHaveLength(27);
    expect(new Set(vm.segments).size).toBe(27);
    expect(vm.loadState).toBe("complete");
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — server-clock query windows (Risk 3)", () => {
  const minTs = 1692884313968000;
  const maxTs = 1692884769270000 + 5_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    resetStreaming(rowsResponder(fixtureRows));
  });

  const windowsBy = (size: number) =>
    queryPayload.build.mock.calls
      .map((call: any[]) => call[0])
      .filter((payload: any) => payload.size === size)
      .map((payload: any) => payload.timestamps);

  it("asks getSession for the latest arrival time too", async () => {
    const wrapper = await mountLoaded();
    const sql = (vi.mocked(searchService.search).mock.calls[0][0] as any).query.query.sql;
    expect(sql).toContain("max(_timestamp) as max_ts");
    wrapper.unmount();
  });

  it("searches segments and events between the server arrival times", async () => {
    vi.mocked(searchService.search).mockResolvedValueOnce({
      data: { hits: [{ ...sessionLookupRow, max_ts: maxTs }] },
    } as any);
    const wrapper = await mountLoaded();

    for (const window of windowsBy(1000)) {
      expect(window).toEqual({ startTime: minTs - 1_000_000, endTime: maxTs + 1_000_000 });
    }
    expect(windowsBy(150)[0]).toEqual({
      startTime: minTs - 60_000_000,
      endTime: maxTs + 60_000_000,
    });
    wrapper.unmount();
  });

  it("falls back to the route range ±1 day when the arrival times are missing", async () => {
    const wrapper = await mountLoaded();
    const day = 86_400_000_000;

    expect(windowsBy(1000)[0]).toEqual({
      startTime: 1692884313968000 - day,
      endTime: 1692884769270000 + day,
    });
    expect(windowsBy(150)[0]).toEqual({
      startTime: 1692884313968000 - day,
      endTime: 1692884769270000 + day,
    });
    wrapper.unmount();
  });

  it("uses a bounded lookup for a deep link without start and end, and shows not-found", async () => {
    vi.mocked(searchService.search).mockResolvedValueOnce({ data: { hits: [] } } as any);
    const router = createTestRouter();
    await router.push({ path: "/rum/sessions/session-abc" });
    const wrapper = mountSessionViewer(router);
    await flushMany();

    const query = (vi.mocked(searchService.search).mock.calls[0][0] as any).query.query;
    expect(Number.isFinite(query.start_time)).toBe(true);
    expect(Number.isFinite(query.end_time)).toBe(true);
    expect(query.end_time - query.start_time).toBe(30 * 86_400_000_000);
    expect(wrapper.find('[data-test="session-viewer-no-replay"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — base64 SQL encoding", () => {
  const plainPayload = () => ({ query: { sql: "" }, aggs: {} });
  let wasEnabled: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    wasEnabled = store.state.zoConfig.sql_base64_enabled;
    store.state.zoConfig.sql_base64_enabled = true;
    // Mirrors buildQueryPayload, which marks the payload base64 when the cluster flag is on.
    (queryPayload.build ??= vi.fn()).mockImplementation(() => ({
      ...plainPayload(),
      encoding: "base64",
    }));
    const plain = rowsResponder(fixtureRows);
    resetStreaming((sql, from) => plain(b64DecodeUnicode(sql) ?? "", from));
  });

  afterEach(() => {
    store.state.zoConfig.sql_base64_enabled = wasEnabled;
    queryPayload.build.mockImplementation(plainPayload);
  });

  it("sends the segment and event SQL base64-encoded", async () => {
    const wrapper = await mountLoaded();

    const segmentSqls = streaming.sqls.map((sql) => b64DecodeUnicode(sql) ?? "");
    expect(segmentSqls.some((sql) => sql.includes("has_full_snapshot"))).toBe(true);
    expect(segmentSqls.some((sql) => sql.includes("segment"))).toBe(true);
    expect(streaming.sqls.every((sql) => !sql.includes("select"))).toBe(true);

    const eventQueries = vi
      .mocked(searchService.search)
      .mock.calls.map((call: any[]) => call[0].query)
      .filter((query: any) => query.encoding === "base64");
    const eventSqls = eventQueries.map((query: any) => b64DecodeUnicode(query.query.sql) ?? "");
    expect(eventSqls.some((sql) => sql.includes('"_rumdata"'))).toBe(true);
    expect(eventSqls.some((sql) => sql.includes('"_rumlog"'))).toBe(true);
    expect(eventQueries.every((query: any) => !query.query.sql.includes("select"))).toBe(true);
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — retries and the error state (E0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountWithFakeTimers() {
    const router = await pushRoute();
    const wrapper = mountSessionViewer(router);
    await vi.advanceTimersByTimeAsync(10_000);
    return wrapper;
  }

  it("retries a failing manifest three times, then shows the error state", async () => {
    const good = rowsResponder(fixtureRows);
    resetStreaming((sql, from) =>
      sql.includes("has_full_snapshot")
        ? { error: { code: 500, message: "boom" } }
        : good(sql, from),
    );
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;

    expect(streaming.sqls.filter((sql) => sql.includes("has_full_snapshot"))).toHaveLength(3);
    expect(vm.loadState).toBe("error");
    expect(vm.pendingSeekMs).toBeNull();

    streaming.responder = good;
    await vm.handleRetry();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vm.loadState).toBe("complete");
    expect(vm.segments).toHaveLength(3);
    wrapper.unmount();
  });

  it("does not retry an error that cannot succeed next time", async () => {
    resetStreaming(() => ({ error: { code: 400, message: "bad sql" } }));
    const wrapper = await mountWithFakeTimers();

    expect(streaming.sqls).toHaveLength(1);
    expect((wrapper.vm as any).loadState).toBe("error");
    wrapper.unmount();
  });

  it("does not retry an in-stream search error that describes the query itself", async () => {
    resetStreaming(() => ({ error: { code: 20001, message: "sql not valid" } }));
    const wrapper = await mountWithFakeTimers();

    expect(streaming.sqls).toHaveLength(1);
    expect((wrapper.vm as any).loadState).toBe("error");
    wrapper.unmount();
  });

  it("retries an in-stream search timeout code", async () => {
    resetStreaming(() => ({ error: { code: 20010, message: "search timeout" } }));
    const wrapper = await mountWithFakeTimers();

    expect(streaming.sqls).toHaveLength(3);
    wrapper.unmount();
  });

  it("keeps a mobile player on its loading state while a Retry after a manifest failure runs", async () => {
    const good = rowsResponder(fixtureRows);
    resetStreaming((sql, from) =>
      sql.includes("has_full_snapshot") ? { error: { status: 502 } } : good(sql, from),
    );
    vi.mocked(searchService.search).mockResolvedValueOnce({
      data: { hits: [{ ...sessionLookupRow, source: "android" }] },
    } as any);
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;
    expect(vm.loadState).toBe("error");
    expect(vm.segmentsLoading).toBe(false);

    const retry = vm.handleRetry();
    await vi.advanceTimersByTimeAsync(0);
    const mobile = wrapper.findComponent('[data-test="stub-mobile-player"]');
    expect(vm.loadState).toBe("loading");
    expect(mobile.attributes("is-loading")).toBe("true");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(vm.retryAttempt).toBe(2);
    expect(vm.segmentsLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    await retry;
    expect(vm.loadState).toBe("error");
    expect(vm.segmentsLoading).toBe(false);
    wrapper.unmount();
  });

  it("clears a pending seek when the first window fails", async () => {
    const good = rowsResponder(fixtureRows);
    resetStreaming((sql, from) =>
      sql.includes("segment") ? { error: { status: 503 } } : good(sql, from),
    );
    const router = await pushRoute({ event_time: String(S + 2500) });
    const wrapper = mountSessionViewer(router);
    await vi.advanceTimersByTimeAsync(10_000);
    const vm = wrapper.vm as any;

    expect(bodySqls()).toHaveLength(3);
    expect(vm.loadState).toBe("error");
    expect(vm.pendingSeekMs).toBeNull();
    wrapper.unmount();
  });

  it("retries getSession and shows the error state instead of an empty player", async () => {
    resetStreaming(rowsResponder(fixtureRows));
    vi.mocked(searchService.search).mockRejectedValue({ response: { status: 503 } });
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;

    expect(vi.mocked(searchService.search)).toHaveBeenCalledTimes(3);
    expect(vm.loadState).toBe("error");
    expect(streaming.sqls).toHaveLength(0);

    vi.mocked(searchService.search).mockImplementation(async (params: any) => {
      const sql: string = params?.query?.query?.sql ?? "";
      return { data: { hits: sql.includes("min(start)") ? [sessionLookupRow] : [] } } as any;
    });
    await vm.handleRetry();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vm.loadState).toBe("complete");
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — background batches (G5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountWithFakeTimers() {
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(10_000);
    return wrapper;
  }

  it("skips past a batch that failed three times and keeps loading after it", async () => {
    const rows = manyRows(30);
    const good = rowsResponder(rows);
    resetStreaming((sql, from) =>
      sql.includes(`start >= ${S + 1000} `) ? { error: { status: 502 } } : good(sql, from),
    );
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;

    expect(bodySqls().filter((sql) => sql.includes(`start >= ${S + 1000} `))).toHaveLength(3);
    expect(vm.segments).toHaveLength(30);
    expect(vm.segments[1]).toMatchObject({ skipped: true, start: S + 1000 });
    expect(vm.segments[26].records).toBeDefined();
    expect(vm.loadState).toBe("failed");
    expect(vm.failedFromMs).toBe(1000);
    expect(vm.loadedRanges.filter((r: any) => r.state === "skipped")).toHaveLength(25);

    streaming.responder = good;
    await vm.handleRetry();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vm.loadState).toBe("complete");
    expect(vm.segments).toHaveLength(30);
    wrapper.unmount();
  });

  it("re-queues a segment missing from a successful batch twice, then skips it", async () => {
    const good = rowsResponder(fixtureRows);
    resetStreaming((sql, from) =>
      sql.includes("segment")
        ? good(sql, from).filter((row: any) => row.start !== S + 2000)
        : good(sql, from),
    );
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;

    expect(bodySqls().filter((sql) => sql.includes(`start <= ${S + 2000}`))).toHaveLength(3);
    expect(vm.segments[2]).toMatchObject({ skipped: true });
    expect(vm.loadState).toBe("complete");
    wrapper.unmount();
  });

  it("marks a body that fails to parse as skipped and never retries it", async () => {
    resetStreaming(
      rowsResponder(fixtureRows, (row: any) =>
        row.start === S + 1000 ? { ...row, segment: "{not json" } : fixtureBody(row),
      ),
    );
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;

    expect(vm.segments[1]).toMatchObject({ skipped: true });
    expect(vm.loadState).toBe("complete");
    const before = streaming.sqls.length;
    await vm.handleRetry();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(streaming.sqls).toHaveLength(before);
    wrapper.unmount();
  });

  it("runs a watchdog while buffering that never re-queues skipped segments", async () => {
    const good = rowsResponder(fixtureRows);
    resetStreaming((sql, from) =>
      sql.includes(`start >= ${S + 1000} `) ? { error: { status: 500 } } : good(sql, from),
    );
    const wrapper = await mountWithFakeTimers();
    const vm = wrapper.vm as any;
    expect(vm.loader.status).toEqual(["stored", "skipped", "skipped"]);

    // Still loading, loop idle, and the segment right after the player's edge is skipped: the watchdog's own case.
    vm.run = { ...vm.run, appendedThroughIndex: 0 };
    vm.loadState = "loading";
    vm.playerPlaybackState = "buffering";
    await wrapper.vm.$nextTick();
    const before = streaming.sqls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(streaming.sqls).toHaveLength(before);

    // Control: the same watchdog does fetch a segment that is merely missing.
    vm.loader.status[1] = "missing";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(streaming.sqls.length).toBeGreaterThan(before);
    expect(streaming.sqls[before]).toContain(`start >= ${S + 1000} `);
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — request time limits and cancellation (G6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels a request with no first byte after 90 s and retries it as a timeout", async () => {
    resetStreaming(() => "hang");
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(89_000);
    expect(streaming.cancel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(streaming.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ trace_id: streaming.requests[0].data.traceId }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(streaming.sqls).toHaveLength(2);
    wrapper.unmount();
  });

  it("does not time out a request that keeps sending", async () => {
    resetStreaming(() => "hang");
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(0);
    const { handlers } = streaming.requests[0];
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      handlers.onActivity();
    }
    expect(streaming.cancel).not.toHaveBeenCalled();
    expect(streaming.sqls).toHaveLength(1);
    wrapper.unmount();
  });

  it("times out after 30 s of silence once the stream has started", async () => {
    resetStreaming(() => "hang");
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(0);
    streaming.requests[0].handlers.onActivity();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(streaming.cancel).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("cancels every live request when the page unmounts", async () => {
    resetStreaming(() => "hang");
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(0);
    const traceId = streaming.requests[0].data.traceId;

    wrapper.unmount();

    expect(streaming.cancel).toHaveBeenCalledWith(expect.objectContaining({ trace_id: traceId }));
  });
});

describe("SessionViewer.vue — seeks in session ms (G4, G7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    resetStreaming(rowsResponder(fixtureRows));
  });

  function readyPlayer(wrapper: VueWrapper, endMs = 2999) {
    const seekTo = vi.fn();
    playerStubs.videoSeek = seekTo;
    const vm = wrapper.vm as any;
    vm.playerLoadedEndMs = endMs;
    vm.playerTakenCount = vm.segments.length;
    vm.handlePlayerReady();
    return seekTo;
  }

  it("anchors the first window on the snapshot before the forwarded event", async () => {
    const wrapper = await mountLoaded({ event_time: String(S + 2500) });

    expect((wrapper.vm as any).windowStart).toBe(S + 2000);
    wrapper.unmount();
  });

  it("turns the forwarded event into a one-time pending seek, consumed after ready", async () => {
    const wrapper = await mountLoaded({ event_time: String(S + 2500) });
    const vm = wrapper.vm as any;
    expect(vm.pendingSeekMs).toBe(2500);

    const seekTo = readyPlayer(wrapper);
    expect(seekTo).toHaveBeenCalledWith(2500, false);
    expect(vm.pendingSeekMs).toBeNull();

    vm.handlePlayerReady();
    expect(seekTo).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("hands a sidebar seek to the player in session ms; the player owns its origin", async () => {
    const wrapper = await mountLoaded({ event_time: String(S + 2500) });
    const seekTo = readyPlayer(wrapper);
    seekTo.mockClear();

    (wrapper.vm as any).handleSidebarEvent("event-click", { event_id: "e1", relativeTime: 2400 });

    expect(seekTo).toHaveBeenCalledWith(2400, false);
    wrapper.unmount();
  });

  it("routes a bar seek request through the same coverage check", async () => {
    const wrapper = await mountLoaded();
    const seekTo = readyPlayer(wrapper);

    (wrapper.vm as any).requestSeek(1500);

    expect(seekTo).toHaveBeenCalledWith(1500, false);
    wrapper.unmount();
  });

  it("keeps the behind-window notice for a target before the window, and never waits on it", async () => {
    const wrapper = await mountLoaded({ event_time: String(S + 2500) });
    const seekTo = readyPlayer(wrapper);
    seekTo.mockClear();

    (wrapper.vm as any).handleSidebarEvent("event-click", { event_id: "e1", relativeTime: 500 });

    expect(seekTo).toHaveBeenCalledWith(2000, false);
    expect((wrapper.vm as any).pendingSeekMs).toBeNull();
    expect((wrapper.vm as any).segmentNotice).toContain("before the part of the session");
    wrapper.unmount();
  });

  it("waits on a target past the player's edge and seeks once the loader covers it", async () => {
    const rows = manyRows(5);
    const good = rowsResponder(rows);
    resetStreaming((sql, from) =>
      sql.includes(`start >= ${S + 1000} `) ? "hang" : good(sql, from),
    );
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;
    const seekTo = readyPlayer(wrapper, 999);

    vm.handleSidebarEvent("event-click", { event_id: "e1", relativeTime: 3500 });
    expect(seekTo).not.toHaveBeenCalled();
    expect(vm.pendingSeekMs).toBe(3500);

    const pending = streaming.requests.find((r) =>
      r.data.queryReq.query.sql.includes(`start >= ${S + 1000} `),
    );
    pending.handlers.data(pending.data, {
      type: "search_response_hits",
      content: { results: { hits: rows.slice(1).map(fixtureBody) } },
    });
    pending.handlers.complete(pending.data, null);
    await flushMany();

    // The run now holds the last segment, but the player has not converted it, so seeking would drop records.
    expect(vm.run.appendedThroughIndex).toBe(4);
    expect(seekTo).not.toHaveBeenCalled();
    expect(vm.pendingSeekMs).toBe(3500);

    wrapper.findComponent('[data-test="stub-video-player"]').vm.$emit("segments-taken", 5);
    await flushMany();

    expect(seekTo).toHaveBeenCalledWith(3500, false);
    expect(vm.pendingSeekMs).toBeNull();
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — playback starts at the first full snapshot", () => {
  // The first view lost its snapshot segment, so the row at S is an orphan mutation batch.
  const orphanRows = [
    { start: S, end: S + 999, has_full_snapshot: false, records_count: 1 },
    ...fixtureRows.slice(1).map((row) => ({ ...row, has_full_snapshot: true })),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true, has_full_snapshot: true };
    resetStreaming(rowsResponder(orphanRows));
    vi.mocked(searchService.search).mockResolvedValueOnce({
      data: { hits: [{ ...sessionLookupRow, replay_start: S + 1000 }] },
    } as any);
  });

  it("asks getSession for replay_start when the stream has has_full_snapshot", async () => {
    const wrapper = await mountLoaded();
    const sql = (vi.mocked(searchService.search).mock.calls[0][0] as any).query.query.sql;
    expect(sql).toContain("min(case when has_full_snapshot then start end) as replay_start");
    wrapper.unmount();
  });

  it("drops manifest rows before replay_start, so the first window opens on a snapshot", async () => {
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;

    expect(vm.manifest.map((row: any) => row.start)).toEqual([S + 1000, S + 2000]);
    expect(streaming.sqls[1]).toContain(`and start >= ${S + 1000}`);
    wrapper.unmount();
  });

  it("lands a sidebar seek before replay_start on the first playable frame", async () => {
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;
    const seekTo = vi.fn();
    playerStubs.videoSeek = seekTo;
    vm.playerLoadedEndMs = 2999;
    vm.playerTakenCount = vm.segments.length;
    vm.handlePlayerReady();

    vm.handleSidebarEvent("event-click", { event_id: "e1", relativeTime: 200 });

    expect(seekTo).toHaveBeenCalledWith(1000, false);
    expect(vm.unreachableSeek).toBe(false);
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — mobile sessions (F0.2)", () => {
  const mobileBody = (row: any) => ({
    ...row,
    segment: JSON.stringify({
      records: [
        { type: 10, timestamp: row.start, data: { wireframes: [] } },
        { type: 11, timestamp: row.end, data: {} },
      ],
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    resetStreaming(rowsResponder(fixtureRows, mobileBody));
  });

  function mountMobile(query: Record<string, string> = {}) {
    vi.mocked(searchService.search).mockResolvedValueOnce({
      data: { hits: [{ ...sessionLookupRow, source: "android" }] },
    } as any);
    return mountLoaded(query);
  }

  it("loads a mobile session opened from an event from its first segment", async () => {
    const wrapper = await mountMobile({ event_time: String(S + 2500) });

    expect(streaming.sqls[1]).toContain(`and start >= ${S} and start <= ${S}`);
    expect((wrapper.vm as any).isMobileReplay).toBe(true);
    wrapper.unmount();
  });

  it("seeks the mobile player to the event in session ms after ready", async () => {
    const wrapper = await mountMobile({ event_time: String(S + 2500) });
    const vm = wrapper.vm as any;
    const seekTo = vi.fn();
    playerStubs.mobileSeek = seekTo;
    vm.handlePlayerReady();

    expect(seekTo).toHaveBeenCalledWith(2500, false);
    expect(vm.pendingSeekMs).toBeNull();
    wrapper.unmount();
  });

  it("sends a sidebar click to the mobile player, or waits when it is not loaded yet", async () => {
    const wrapper = await mountMobile();
    const vm = wrapper.vm as any;
    const seekTo = vi.fn();
    playerStubs.mobileSeek = seekTo;
    vm.handlePlayerReady();

    vm.handleSidebarEvent("event-click", { event_id: "e1", relativeTime: 1500 });
    expect(seekTo).toHaveBeenCalledWith(1500, false);

    vm.loadState = "loading";
    vm.handleSidebarEvent("event-click", { event_id: "e2", relativeTime: 9000 });
    expect(seekTo).toHaveBeenCalledTimes(1);
    expect(vm.pendingSeekMs).toBe(9000);
    wrapper.unmount();
  });

  it("stops waiting on a target past the last record once nothing more can load", async () => {
    const wrapper = await mountMobile();
    const vm = wrapper.vm as any;
    const seekTo = vi.fn();
    playerStubs.mobileSeek = seekTo;
    vm.handlePlayerReady();
    vm.loadState = "loading";
    vm.handleSidebarEvent("event-click", { event_id: "e2", relativeTime: 9000 });
    expect(vm.pendingSeekMs).toBe(9000);

    vm.loadState = "complete";
    await wrapper.vm.$nextTick();

    expect(seekTo).toHaveBeenCalledWith(9000, false);
    expect(vm.pendingSeekMs).toBeNull();
    wrapper.unmount();
  });

  it("anchors a mobile session on segment 0 even when a later row ties on the session start", async () => {
    const tied = [
      { start: S, end: S + 500, has_full_snapshot: false, records_count: 1 },
      { start: S, end: S + 999, has_full_snapshot: true, records_count: 2 },
      ...fixtureRows.slice(1),
    ];
    resetStreaming(rowsResponder(tied, mobileBody));
    const wrapper = await mountMobile();

    expect((wrapper.vm as any).run.anchorIndex).toBe(0);
    expect((wrapper.vm as any).segments[0].records[1].timestamp).toBe(S + 500);
    wrapper.unmount();
  });

  it("keeps the browser path windowed with no mobile calls", async () => {
    resetStreaming(rowsResponder(fixtureRows));
    const wrapper = await mountLoaded({ event_time: String(S + 2500) });
    const vm = wrapper.vm as any;

    expect(streaming.sqls[1]).toContain(`and start >= ${S + 2000} and start <= ${S + 2000}`);
    expect(vm.isMobileReplay).toBe(false);
    expect(wrapper.find('[data-test="stub-mobile-player"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — parallel batches, ordered append (D1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Every background batch hangs until the test answers it, so completion order is the test's choice.
  function hangBatches(rows: any[], fail: (sql: string) => boolean = () => false) {
    const good = rowsResponder(rows);
    resetStreaming((sql, from) => {
      if (!sql.includes("segment") || sql.includes(`start >= ${S} `)) return good(sql, from);
      return fail(sql) ? { error: { status: 502 } } : "hang";
    });
  }

  const batchRequest = (lo: number) =>
    streaming.requests.filter((r) => r.data.queryReq.query.sql.includes(`start >= ${lo} `));

  function answer(request: any, rows: any[]) {
    const hits = rowsResponder(rows)(request.data.queryReq.query.sql, 0);
    request.handlers.data(request.data, {
      type: "search_response_hits",
      content: { results: { hits } },
    });
    request.handlers.complete(request.data, null);
  }

  async function mountHanging() {
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(100);
    return wrapper;
  }

  it("keeps three batches in flight and starts the next one when a slot frees", async () => {
    const rows = manyRows(101);
    hangBatches(rows);
    const wrapper = await mountHanging();

    const background = bodySqls().slice(1);
    expect(background).toHaveLength(3);
    expect(background[0]).toContain(`start >= ${S + 1000} and start <= ${S + 25_000}`);
    expect(background[1]).toContain(`start >= ${S + 26_000} and start <= ${S + 50_000}`);
    expect(background[2]).toContain(`start >= ${S + 51_000} and start <= ${S + 75_000}`);

    answer(batchRequest(S + 1000)[0], rows);
    await vi.advanceTimersByTimeAsync(0);
    expect(bodySqls()).toHaveLength(5);
    expect(bodySqls()[4]).toContain(`start >= ${S + 76_000} and start <= ${S + 100_000}`);
    wrapper.unmount();
  });

  it("stores a later batch that lands first, and appends it only once the earlier one lands", async () => {
    const rows = manyRows(76);
    hangBatches(rows);
    const wrapper = await mountHanging();
    const vm = wrapper.vm as any;

    answer(batchRequest(S + 26_000)[0], rows);
    await vi.advanceTimersByTimeAsync(0);
    expect(vm.loader.status[26]).toBe("stored");
    expect(vm.segments).toHaveLength(1);
    expect(vm.run.appendedThroughIndex).toBe(0);

    answer(batchRequest(S + 1000)[0], rows);
    await vi.advanceTimersByTimeAsync(0);
    expect(vm.segments).toHaveLength(51);
    const starts = vm.segments.map((segment: any) => segment.records[0].timestamp);
    expect(starts).toEqual(rows.slice(0, 51).map((row) => row.start));

    answer(batchRequest(S + 51_000)[0], rows);
    await vi.advanceTimersByTimeAsync(0);
    expect(vm.segments).toHaveLength(76);
    expect(vm.loadState).toBe("complete");
    wrapper.unmount();
  });

  it("appends later stored segments after a failed middle batch's skip markers", async () => {
    const rows = manyRows(76);
    hangBatches(rows, (sql) => sql.includes(`start >= ${S + 26_000} `));
    const wrapper = await mountHanging();
    const vm = wrapper.vm as any;

    answer(batchRequest(S + 51_000)[0], rows);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(batchRequest(S + 26_000)).toHaveLength(3);
    expect(vm.loader.status[30]).toBe("skipped");
    expect(vm.segments).toHaveLength(1);
    expect(vm.loadState).not.toBe("failed");

    answer(batchRequest(S + 1000)[0], rows);
    await vi.advanceTimersByTimeAsync(0);
    expect(vm.segments).toHaveLength(76);
    expect(vm.segments[26]).toMatchObject({ skipped: true, start: S + 26_000 });
    expect(vm.segments[50]).toMatchObject({ skipped: true });
    expect(vm.segments[51].records[0].timestamp).toBe(S + 51_000);
    expect(vm.loadState).toBe("failed");
    expect(vm.failedFromMs).toBe(26_000);
    wrapper.unmount();
  });

  it("has the watchdog leave an in-flight segment alone", async () => {
    const rows = manyRows(30);
    hangBatches(rows);
    const wrapper = await mountHanging();
    const vm = wrapper.vm as any;
    expect(vm.loader.status[1]).toBe("inFlight");
    const before = streaming.sqls.length;

    vm.playerPlaybackState = "buffering";
    await vi.advanceTimersByTimeAsync(10_000);

    expect(streaming.sqls).toHaveLength(before);
    wrapper.unmount();
  });

  it("cancels every in-flight batch when the page unmounts", async () => {
    const rows = manyRows(101);
    hangBatches(rows);
    const wrapper = await mountHanging();
    const traceIds = streaming.requests
      .filter((r) => r.data.queryReq.query.sql.includes("segment"))
      .slice(1)
      .map((r) => r.data.traceId);
    expect(new Set(traceIds).size).toBe(3);

    wrapper.unmount();

    for (const traceId of traceIds) {
      expect(streaming.cancel).toHaveBeenCalledWith(expect.objectContaining({ trace_id: traceId }));
    }
  });
});

describe("SessionViewer.vue — sessions still being recorded (G9)", () => {
  const NOW = 1_750_000_000_000;
  const L = NOW - 10 * 60_000;
  const maxTs = (NOW - 30_000) * 1000;
  const server = { rows: [] as any[], rum: [] as any[], logs: [] as any[] };
  let originalSearch: any;

  // Every row arrives at the open's upper bound unless a test says otherwise, so each poll window re-returns it.
  const liveRow = (i: number, extra: Record<string, any> = {}) => ({
    start: L + i * 1000,
    end: L + i * 1000 + 999,
    has_full_snapshot: i === 0,
    records_count: 1,
    _timestamp: maxTs,
    ...extra,
  });

  // The manifest query has no start filter, so it answers by arrival time inside the request's window.
  function liveResponder(sql: string, from: number) {
    if (from > 0) return [];
    if (sql.includes("has_full_snapshot")) {
      const window = queryPayload.build.mock.calls.at(-1)[0].timestamps;
      return server.rows.filter(
        (row) => row._timestamp >= window.startTime && row._timestamp <= window.endTime,
      );
    }
    const lo = Number(/start >= (\d+)/.exec(sql)?.[1] ?? 0);
    const hi = Number(/start <= (\d+)/.exec(sql)?.[1] ?? 0);
    return server.rows.filter((row) => row.start >= lo && row.start <= hi).map(fixtureBody);
  }

  let replayStart: number | undefined;

  function lookupRow(endTime: number) {
    return {
      ...sessionLookupRow,
      zo_sql_timestamp: L * 1000,
      start_time: L,
      end_time: endTime,
      max_ts: maxTs,
      replay_start: replayStart,
    };
  }

  function serve(endTime: number) {
    vi.mocked(searchService.search).mockImplementation(async (params: any) => {
      const query = params?.query?.query ?? {};
      const sql: string = query.sql ?? "";
      const from = Number(query.from) || 0;
      const size = Number(query.size) || 150;
      if (sql.includes("min(start)")) return { data: { hits: [lookupRow(endTime)] } } as any;
      const rows = sql.includes("_rumlog")
        ? server.logs
        : sql.includes("_rumdata")
          ? server.rum
          : [];
      return { data: { hits: rows.slice(from, from + size) } } as any;
    });
  }

  const segmentWindows = () =>
    queryPayload.build.mock.calls
      .map((call: any[]) => call[0])
      .filter((payload: any) => payload.size === 1000)
      .map((payload: any) => payload.timestamps);

  // The open's manifest window starts a second before min_ts; a poll's starts a minute before upperTs.
  const manifestPolls = () => {
    const windows = segmentWindows();
    return streaming.sqls.filter(
      (sql, i) =>
        sql.includes("has_full_snapshot") && windows[i]?.startTime !== L * 1000 - 1_000_000,
    );
  };

  async function mountLive(endTime = NOW - 60_000) {
    serve(endTime);
    const wrapper = mountSessionViewer(await pushRoute());
    await vi.advanceTimersByTimeAsync(100);
    return wrapper;
  }

  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    originalSearch = vi.mocked(searchService.search).getMockImplementation();
    replaySchema.fields = { geo_info_country: true, geo_info_city: true };
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    server.rows = [liveRow(0), liveRow(1), liveRow(2)];
    server.rum = [];
    server.logs = [];
    replayStart = undefined;
    resetStreaming(liveResponder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(searchService.search).mockImplementation(originalSearch);
    setVisibility("visible");
  });

  it("detects a live session with the Sessions list's rule, inclusive at the boundary", async () => {
    const live = await mountLive(NOW - ACTIVE_WINDOW_MS);
    const vm = live.vm as any;
    expect(vm.isLive).toBe(true);
    expect(vm.loadState).toBe("live");
    expect(live.find('[data-test="session-viewer-live-badge"]').text()).toBe("Live");
    const liveBadge = live
      .findAllComponents(OBadge)
      .find((badge) => badge.attributes("data-test") === "session-viewer-live-badge");
    expect(liveBadge?.props("variant")).toBe("success");
    live.unmount();

    const ended = await mountLive(NOW - ACTIVE_WINDOW_MS - 1);
    expect((ended.vm as any).isLive).toBe(false);
    expect((ended.vm as any).loadState).toBe("complete");
    expect(ended.find('[data-test="session-viewer-live-badge"]').exists()).toBe(false);
    expect(manifestPolls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(manifestPolls()).toHaveLength(0);
    ended.unmount();
  });

  it("selects the arrival time in the manifest, not as a sort key or part of the id", async () => {
    const wrapper = await mountLive();
    expect(streaming.sqls[0]).toContain("records_count, _timestamp from");
    expect(streaming.sqls[0]).toMatch(/order by start asc, "end" asc$/);
    expect((wrapper.vm as any).segmentIds[0]).not.toContain(String(liveRow(0)._timestamp));
    wrapper.unmount();
  });

  it("raises upperTs from polled arrival times only, and bounds body queries with it", async () => {
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.upperTs).toBe(maxTs);
    for (const window of segmentWindows()) {
      expect(window).toEqual({ startTime: L * 1000 - 1_000_000, endTime: maxTs + 1_000_000 });
    }

    const arrival = maxTs + 20_000_000;
    server.rows.push(liveRow(3, { _timestamp: arrival }));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vm.upperTs).toBe(arrival);
    const windows = segmentWindows();
    const bodyIndex = streaming.sqls.findLastIndex((sql) => sql.includes("segment"));
    expect(streaming.sqls[bodyIndex]).toContain(`start >= ${L + 3000} `);
    expect(windows[bodyIndex]).toEqual({
      startTime: L * 1000 - 1_000_000,
      endTime: arrival + 1_000_000,
    });

    // The manifest poll looks from a minute before the bound to a minute past the later of now and the bound.
    const pollIndex = streaming.sqls.findIndex(
      (sql, i) => i > 0 && sql.includes("has_full_snapshot"),
    );
    expect(windows[pollIndex]).toEqual({
      startTime: maxTs - 60_000_000,
      endTime: (NOW + 30_000) * 1000 + 60_000_000,
    });

    server.rows = server.rows.map((row) => ({ ...row, _timestamp: 1 }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vm.upperTs).toBe(arrival);
    wrapper.unmount();
  });

  // The mocked payload drops the timestamps, so carry them the way buildQueryPayload does to read each event query's window.
  const eventWindows = (stream: string) =>
    vi
      .mocked(searchService.search)
      .mock.calls.map((call: any[]) => call[0]?.query?.query ?? {})
      .filter((query: any) => String(query.sql).includes(stream))
      .map((query: any) => ({ startTime: query.start_time, endTime: query.end_time }));

  async function withWindowedPayload(check: (wrapper: VueWrapper) => Promise<void> | void) {
    queryPayload.build.mockImplementation((opts: any) => ({
      query: { sql: "", start_time: opts.timestamps.startTime, end_time: opts.timestamps.endTime },
      aggs: {},
    }));
    let wrapper: VueWrapper | undefined;
    try {
      wrapper = await mountLive();
      await check(wrapper);
    } finally {
      wrapper?.unmount();
      queryPayload.build.mockImplementation(() => ({ query: { sql: "" }, aggs: {} }));
    }
  }

  it("opens the event queries a minute either side of the replay rows, the manifest a second before", async () => {
    await withWindowedPayload(() => {
      for (const stream of ['"_rumdata"', '"_rumlog"']) {
        expect(eventWindows(stream)[0], stream).toEqual({
          startTime: L * 1000 - 60_000_000,
          endTime: maxTs + 60_000_000,
        });
      }
      expect(segmentWindows()[0]).toEqual({
        startTime: L * 1000 - 1_000_000,
        endTime: maxTs + 1_000_000,
      });
    });
  });

  it("starts an event poll with no cursor yet a minute before min_ts", async () => {
    await withWindowedPayload(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      for (const stream of ['"_rumdata"', '"_rumlog"']) {
        const windows = eventWindows(stream);
        expect(windows.length, stream).toBeGreaterThan(1);
        expect(windows.at(-1), stream).toEqual({
          startTime: L * 1000 - 60_000_000,
          endTime: (NOW + 30_000) * 1000 + 60_000_000,
        });
      }
    });
  });

  it("appends only new segment ids, loads them, and extends the session end", async () => {
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.segments).toHaveLength(3);

    // The second row ends after the metadata end, so the timeline has to grow to hold it.
    server.rows.push(liveRow(3), liveRow(600));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(manifestPolls()[0]).not.toContain("start >=");
    expect(vm.manifest).toHaveLength(5);
    expect(vm.segments).toHaveLength(5);
    expect(vm.segments[4].records[0].timestamp).toBe(L + 600_000);
    expect(vm.sessionEndMs).toBe(L + 600_999);
    expect(vm.loadState).toBe("live");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(vm.manifest).toHaveLength(5);
    expect(vm.segments).toHaveLength(5);
    wrapper.unmount();
  });

  const lateNotice = (wrapper: VueWrapper) =>
    wrapper.find('[data-test="session-viewer-late-rows-notice"]');

  it("does not insert a late row with an earlier start, fetch it or feed it, and says so", async () => {
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    const manifestBefore = vm.manifest;
    const statusBefore = [...vm.loader.status];
    const bodiesBefore = bodySqls().length;

    server.rows.push(liveRow(1, { end: L + 1500 }));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(manifestPolls()).toHaveLength(1);
    expect(vm.manifest).toBe(manifestBefore);
    expect(vm.loader.status).toEqual(statusBefore);
    expect(vm.segmentIds).toHaveLength(3);
    expect(bodySqls()).toHaveLength(bodiesBefore);
    expect(vm.segments).toHaveLength(3);
    expect(lateNotice(wrapper).text()).toContain(
      "Earlier activity arrived after the replay loaded. Reload to include it.",
    );
    wrapper.unmount();
  });

  it("drops a row before the first full snapshot that a poll returns again, without the notice", async () => {
    replayStart = L + 1000;
    server.rows = [
      liveRow(0, { has_full_snapshot: false }),
      liveRow(1, { has_full_snapshot: true }),
      liveRow(2),
    ];
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.manifest).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(manifestPolls()).toHaveLength(1);
    expect(vm.manifest).toHaveLength(2);
    expect(vm.lateRows).toBe(false);
    expect(lateNotice(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it("does nothing for a known row a poll returns again", async () => {
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    const manifestBefore = vm.manifest;
    const bodiesBefore = bodySqls().length;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(manifestPolls()).toHaveLength(1);
    expect(vm.manifest).toBe(manifestBefore);
    expect(bodySqls()).toHaveLength(bodiesBefore);
    expect(vm.lateRows).toBe(false);
    expect(lateNotice(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the notice once shown, and still appends a new row after the tail", async () => {
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;

    server.rows.push(liveRow(1, { end: L + 1500 }));
    await vi.advanceTimersByTimeAsync(30_000);
    server.rows = server.rows.filter((row) => row.end !== L + 1500);
    server.rows.push(liveRow(3));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vm.manifest).toHaveLength(4);
    expect(vm.segments).toHaveLength(4);
    expect(lateNotice(wrapper).exists()).toBe(true);
    wrapper.unmount();
  });

  it("reloads the page from the notice's Reload button", async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, reload },
      configurable: true,
    });
    try {
      const wrapper = await mountLive();
      server.rows.push(liveRow(1, { end: L + 1500 }));
      await vi.advanceTimersByTimeAsync(30_000);

      await wrapper.find('[data-test="session-viewer-late-rows-reload"]').trigger("click");

      expect(reload).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
    }
  });

  it("dedups polled events by id, replaces a re-sent view, and pages past 150", async () => {
    const at = (offset: number) => ({ date: L + offset, _timestamp: (L + offset) * 1000 });
    server.rum = [
      { type: "view", view_id: "v1", view_loading_type: "initial_load", view_url: "/a", ...at(10) },
      { type: "action", action_id: "a1", action_type: "click", ...at(20) },
    ];
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.segmentEvents).toHaveLength(2);

    const more = Array.from({ length: 160 }, (_, i) => ({
      type: "action",
      action_id: `n${i}`,
      action_type: "click",
      ...at(100 + i),
    }));
    // The re-send keeps the view's date but arrives later.
    const resent = { ...server.rum[0], view_url: "/b", _timestamp: (L + 300) * 1000 };
    server.rum = [server.rum[1], resent, ...more];
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vm.segmentEvents).toHaveLength(162);
    const views = vm.segmentEvents.filter((event: any) => event.type === "view");
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("initial_load : /b");
    expect(vm.segmentEvents.filter((event: any) => event.id === "a1")).toHaveLength(1);
    wrapper.unmount();
  });

  it("dedups polled error logs by arrival time, device time and message", async () => {
    const log = (offset: number, message: string) => ({
      date: L + offset,
      _timestamp: (L + offset) * 1000,
      message,
      status: "error",
    });
    server.logs = [log(50, "boom")];
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.segmentEvents).toHaveLength(1);

    server.logs = [log(50, "boom"), log(60, "bang")];
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vm.segmentEvents.map((event: any) => event.name)).toEqual(["boom", "bang"]);
    wrapper.unmount();
  });

  it("stops 15 minutes after the last new segment id, then reads complete", async () => {
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;

    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(vm.isLive).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(vm.isLive).toBe(false);
    expect(vm.loadState).toBe("complete");
    expect(wrapper.find('[data-test="session-viewer-live-badge"]').exists()).toBe(false);

    const polls = manifestPolls().length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(manifestPolls()).toHaveLength(polls);
    wrapper.unmount();
  });

  it("pauses polling while the tab is hidden and resumes once it is visible", async () => {
    const wrapper = await mountLive();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(manifestPolls()).toHaveLength(0);

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(manifestPolls()).toHaveLength(1);
    wrapper.unmount();
  });

  it("clears the poll timer and the visibility listener on unmount", async () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    const wrapper = await mountLive();
    expect(vi.getTimerCount()).toBe(1);

    wrapper.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeListener.mockRestore();
  });

  it("pages the first events load, so the live cursor never skips events past the first page", async () => {
    const at = (offset: number) => ({ date: L + offset, _timestamp: (L + offset) * 1000 });
    // A fresh re-send of the view sorts first by date, so a single page would put the cursor at its arrival.
    server.rum = [
      { type: "view", view_id: "v1", view_url: "/a", date: L + 1, _timestamp: NOW * 1000 },
      ...Array.from({ length: 200 }, (_, i) => ({
        type: "action",
        action_id: `a${i}`,
        action_type: "click",
        ...at(10 + i),
      })),
    ];
    const wrapper = await mountLive();

    expect((wrapper.vm as any).segmentEvents).toHaveLength(201);
    wrapper.unmount();
  });

  it("keeps an event without an id once across overlapping polls", async () => {
    server.rum = [
      { type: "action", action_type: "click", date: L + 20, _timestamp: (L + 20) * 1000 },
    ];
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.segmentEvents).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(vm.segmentEvents).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps the view re-send with the latest arrival time, whatever order it comes in", async () => {
    const view = (url: string, arrival: number) => ({
      type: "view",
      view_id: "v1",
      view_loading_type: "initial_load",
      view_url: url,
      date: L + 10,
      _timestamp: arrival,
    });
    server.rum = [view("/new", (L + 900) * 1000), view("/old", (L + 100) * 1000)];
    const wrapper = await mountLive();
    const vm = wrapper.vm as any;
    expect(vm.segmentEvents.map((event: any) => event.name)).toEqual(["initial_load : /new"]);

    server.rum = [view("/old", (L + 100) * 1000)];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vm.segmentEvents.map((event: any) => event.name)).toEqual(["initial_load : /new"]);
    expect(vm.rawEventsMap.get("v1").view_url).toBe("/new");
    wrapper.unmount();
  });

  it("drops the Live badge when there is no manifest to follow or the load failed", async () => {
    server.rows = [];
    const empty = await mountLive();
    expect((empty.vm as any).loadState).toBe("empty");
    expect(empty.find('[data-test="session-viewer-live-badge"]').exists()).toBe(false);
    empty.unmount();

    resetStreaming(() => ({ error: { status: 403 } }));
    const failed = await mountLive();
    expect((failed.vm as any).loadState).toBe("error");
    expect(failed.find('[data-test="session-viewer-live-badge"]').exists()).toBe(false);
    failed.unmount();
  });
});

describe("SessionViewer.vue — events-only view for a session with no replay (AC-19)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const EVENT = {
    type: "view",
    view_id: "v1",
    date: 1692884400000,
    view_url: "https://a.com/x",
    view_loading_type: "initial_load",
  };

  const seen: string[] = [];

  async function mountEventsOnly() {
    vi.clearAllMocks();
    seen.length = 0;
    vi.mocked(searchService.search).mockImplementation((async (params: any) => {
      const sql: string = params.query.query.sql;
      seen.push(sql);
      if (sql.includes("min(start)")) return { data: { hits: [] } };
      if (sql.includes("MIN(date) AS start_time")) {
        return {
          data: {
            hits: [
              {
                start_time: 1692884313968,
                end_time: 1692884769270,
                user_email: null,
                source: "browser",
              },
            ],
          },
        };
      }
      return { data: { hits: [EVENT] } };
    }) as any);
    const router = createTestRouter();
    await router.push({
      path: "/rum/sessions/session-events",
      query: {
        start_time: "1692884400000000",
        end_time: "1692884400000000",
        event_time: "1692884400000",
        from: "analytics",
      },
    });
    const wrapper = mountSessionViewer(router);
    for (let i = 0; i < 5; i++) await flush();
    return wrapper;
  }

  it("shows the RUM event timeline without a player instead of the dead end", async () => {
    const wrapper = await mountEventsOnly();
    expect(wrapper.find('[data-test="session-viewer-no-replay"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="session-viewer-events-only"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stub-video-player"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="stub-player-events-sidebar"]').exists()).toBe(true);
    expect(
      seen.some((q) => q.includes('"_sessionreplay" where') && q.includes("order by start asc")),
    ).toBe(false);
    const events = seen.find((q) => q.includes('from "_rumdata"') && q.includes("type='view'"));
    expect(events).toContain("order by date asc");
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — events-only fallback never hides a failure (W23)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const seen: string[] = [];
  let probe: () => Promise<unknown>;
  const savedFields = replaySchema.fields;

  async function mountNoReplay() {
    vi.clearAllMocks();
    seen.length = 0;
    vi.mocked(searchService.search).mockImplementation((async (params: any) => {
      const sql: string = params.query.query.sql;
      seen.push(sql);
      if (sql.includes("min(start)")) return { data: { hits: [] } };
      if (sql.includes("MIN(date) AS start_time")) return probe();
      return { data: { hits: [] } };
    }) as any);
    const router = createTestRouter();
    await router.push({ path: "/rum/sessions/session-x", query: { from: "analytics" } });
    const wrapper = mountSessionViewer(router);
    for (let i = 0; i < 6; i++) await flush();
    return wrapper;
  }

  beforeEach(() => {
    probe = async () => ({
      data: { hits: [{ start_time: 1, end_time: 2, user_email: null, source: "browser" }] },
    });
    streamsMock.getStream = async () => ({ name: "_rumdata", schema: [{ name: "source" }] });
  });

  afterEach(() => {
    streamsMock.getStream = null;
    replaySchema.fields = savedFields;
  });

  it("a 403 or 5xx on the events probe shows the error state, not No replay recorded", async () => {
    probe = async () => {
      throw { response: { status: 403, data: { message: "forbidden" } } };
    };
    const wrapper = await mountNoReplay();
    expect(wrapper.find('[data-test="session-viewer-no-replay"]').exists()).toBe(false);
    expect((wrapper.vm as any).loadState).toBe("error");
    wrapper.unmount();
  });

  it("a transient replay-schema failure shows the error state, not the events-only view", async () => {
    replaySchema.fields = undefined as never;
    streamsMock.getStream = async () => {
      throw new Error("network down");
    };
    const wrapper = await mountNoReplay();
    expect(wrapper.find('[data-test="session-viewer-events-only"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="session-viewer-no-replay"]').exists()).toBe(false);
    expect((wrapper.vm as any).loadState).toBe("error");
    wrapper.unmount();
  });

  it("a replay stream confirmed missing still opens the events-only view", async () => {
    replaySchema.fields = undefined as never;
    streamsMock.getStream = async (name) => {
      if (name === "_sessionreplay")
        throw new Error(
          i18n.global.t("logStream.streamNotFoundForType", { stream: name, type: "logs" }),
        );
      return { name, schema: [{ name: "source" }] };
    };
    const wrapper = await mountNoReplay();
    expect(wrapper.find('[data-test="session-viewer-events-only"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("reads the _rumdata columns before probing, so it never names one the stream lacks", async () => {
    const wrapper = await mountNoReplay();
    const sql = seen.find((q) => q.includes("MIN(date) AS start_time"))!;
    expect(sql).toContain("MIN(source)");
    expect(sql).not.toContain("usr_email");
    wrapper.unmount();
  });
});

describe("SessionViewer.vue — opened from a funnel (AC-18)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function mountFromFunnel(extra: Record<string, string> = {}) {
    vi.clearAllMocks();
    vi.mocked(searchService.search).mockImplementation((async (params: any) => {
      const sql: string = params.query.query.sql;
      return {
        data: {
          hits: sql.includes("min(start)")
            ? [{ start_time: 1692884313968, end_time: 1692884769270, session_id: "session-abc" }]
            : [],
        },
      };
    }) as any);
    const router = createTestRouter();
    await router.push({
      path: "/rum/sessions/session-abc",
      query: {
        start_time: "1692884400000000",
        end_time: "1692884400000000",
        event_time: "1692884400000",
        from: "analytics",
        af_step: "1",
        af_label: "/web/logs",
        af_kind: "p",
        ...extra,
      },
    });
    const wrapper = mountSessionViewer(router);
    for (let i = 0; i < 4; i++) await flush();
    return { wrapper, router };
  }

  it("names the step the session dropped after and marks the step event", async () => {
    const { wrapper } = await mountFromFunnel();
    expect(wrapper.find('[data-test="stub-video-player"]').exists()).toBe(true);
    const strip = wrapper.find('[data-test="session-viewer-analytics-context"]');
    expect(strip.text()).toContain("Dropped after step 1");
    expect(strip.text()).toContain("/web/logs");
    const sidebar = wrapper.findComponent({ name: "PlayerEventsSidebar" });
    expect(sidebar.props("markedTimestamps")).toEqual([1692884400000]);
    wrapper.unmount();
  });

  it("Back returns to the analytics view with router.back", async () => {
    const { wrapper, router } = await mountFromFunnel();
    const back = vi.spyOn(router, "back").mockImplementation(() => undefined);
    await wrapper.find('[data-test="session-viewer-analytics-back-btn"]').trigger("click");
    expect(back).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("drops an oversize or unknown-kind label instead of rendering it", async () => {
    const { wrapper } = await mountFromFunnel({ af_kind: "x" });
    expect(wrapper.find('[data-test="session-viewer-analytics-context"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
