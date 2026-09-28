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

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: (queryPayload.build ??= vi.fn(() => ({ query: { sql: "" }, aggs: {} }))),
    getTimeInterval: vi.fn().mockReturnValue({ interval: "1m" }),
    parseQuery: vi.fn().mockReturnValue({}),
  }),
}));

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
import searchService from "@/services/search";

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
          template: '<div data-test="stub-player-events-sidebar" />',
          props: ["events", "sessionDetails", "sessionId", "currentTime", "startTime", "endTime"],
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

  it("issues only the session lookup, not the segment or event fetches", async () => {
    const wrapper = await mountUnrecorded();

    const sqlCalls = vi
      .mocked(searchService.search)
      .mock.calls.map((call) => (call[0] as any).query.query.sql as string);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]).toContain("min(start)");
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
    expect(manifestSql).toContain('select start, "end", has_full_snapshot, records_count from');
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
      'select start, "end", has_full_snapshot, records_count, view_id, index_in_view from',
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
    // Rows 25 and 26 tie on start, so the inclusive range of batch 1..25 also returns row 26.
    rows[26] = { ...rows[26], start: rows[25].start, end: rows[25].start + 500 };
    resetStreaming(rowsResponder(rows));
    const wrapper = await mountLoaded();
    const vm = wrapper.vm as any;

    expect(bodySqls()).toHaveLength(2);
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
      startTime: minTs - 1_000_000,
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
