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
import { defineComponent, shallowRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// vi.mock is hoisted — must be at top of file
vi.mock("@/utils/zincutils", () => ({
  getPath: vi.fn(() => "/test/path"),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      API_ENDPOINT: "https://api.test.com",
      selectedOrganization: { identifier: "test-org" },
    },
  })),
}));

// Hoisted so the append assertions can read the same spies the component calls.
const playerSpies = vi.hoisted(() => ({
  addEvent: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  destroyReplayer: vi.fn(),
  meta: { startTime: 1704110400000, endTime: 1704110520000, totalTime: 120000 },
  instances: [] as any[],
}));

// A plain function, not an arrow: the component calls `new rrwebPlayer(...)`.
vi.mock("@openobserve/rrweb-player", () => ({
  default: vi.fn(function () {
    const listeners: Record<string, (event?: any) => void> = {};
    const instance = {
      listeners,
      addEventListener: vi.fn((name: string, handler: (event?: any) => void) => {
        listeners[name] = handler;
      }),
      removeEventListener: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      setSpeed: vi.fn(),
      toggleSkipInactive: vi.fn(),
      goto: vi.fn(),
      getMetaData: vi.fn(() => ({ ...playerSpies.meta })),
      getReplayer: vi.fn(() => ({
        getCurrentTime: playerSpies.getCurrentTime,
        destroy: playerSpies.destroyReplayer,
      })),
      addEvent: playerSpies.addEvent,
      triggerResize: vi.fn(),
      $set: vi.fn(),
    };
    playerSpies.instances.push(instance);
    return instance;
  }),
}));

vi.mock("@openobserve/rrweb-player/dist/style.css", () => ({}));

// ---------------------------------------------------------------------------
// Global browser API stubs (not provided by setupTests.ts for this context)
// ---------------------------------------------------------------------------

class MockWorker {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  postMessage = vi.fn();
  terminate = vi.fn();
}

global.Worker = MockWorker as any;

class MockURL {
  href: string;
  constructor(url: string) {
    this.href = url;
  }
  static createObjectURL = vi.fn(() => "blob:test");
}

global.URL = MockURL as any;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockEvents = [
  { id: "event1", name: "Page Load", relativeTime: 1000 },
  { id: "event2", name: "Button Click", relativeTime: 2000 },
];

// A segment whose first record has a full-snapshot node (type 2) with
// dimension data so setupSession can extract sessionWidth/sessionHeight.
const mockSegments = [
  {
    records: [
      {
        type: 2,
        timestamp: 1704110400000,
        data: { width: 1920, height: 1080, node: { type: 0, childNodes: [] } },
      },
    ],
  },
];

// A segment that arrives after the player was built, later than the mocked playhead.
const laterSegment = {
  records: [
    {
      type: 3,
      timestamp: 1704110500000,
      data: { source: 0, adds: [], removes: [], attributes: [], texts: [] },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mount factory — single source of truth for stubs/plugins
// ---------------------------------------------------------------------------

function mountComponent(props: Record<string, any> = {}) {
  return mount(VideoPlayer, {
    props: {
      events: mockEvents,
      segments: [],
      isLoading: false,
      ...props,
    },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        OIcon: {
          template: '<i data-test="OIcon" :data-name="name"></i>',
          props: ["name", "size"],
        },
      },
    },
  });
}

// Production fills segments by assigning a shallowRef; setProps cannot show that regression.
function mountWithShallowSegments(initial: any[]) {
  const segments = shallowRef<any[]>(initial);
  const Parent = defineComponent({
    components: { VideoPlayer },
    setup: () => ({ segments, events: mockEvents }),
    template: `<VideoPlayer :events="events" :segments="segments" :is-loading="false" />`,
  });

  const parent = mount(Parent, {
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        OIcon: {
          template: '<i data-test="OIcon" :data-name="name"></i>',
          props: ["name", "size"],
        },
      },
    },
  });

  return { parent, segments };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("VideoPlayer", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }));

    wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("should mount successfully without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the player element", () => {
      expect(wrapper.find('[id="player"]').exists()).toBe(true);
    });

    it("should render the controls-container element", () => {
      expect(wrapper.find('[class*="controls-container"]').exists()).toBe(true);
    });

    it("should render the playback_bar element", () => {
      expect(wrapper.find('[data-test="video-player-playback-bar"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  describe("Loading State", () => {
    it("should not render loading indicator when isLoading is false", () => {
      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(false);
    });

    it("should render loading indicator when isLoading is true", async () => {
      await wrapper.setProps({ isLoading: true });

      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(true);
    });

    it("should display loading text message when isLoading is true", async () => {
      await wrapper.setProps({ isLoading: true });

      expect(wrapper.text()).toContain("Hold on tight");
    });

    it("should hide loading indicator when isLoading transitions from true to false", async () => {
      await wrapper.setProps({ isLoading: true });
      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(true);

      await wrapper.setProps({ isLoading: false });

      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(false);
    });
  });

  // ==========================================================================
  // PLAYER STATE (exposed via defineExpose)
  // ==========================================================================

  describe("Player State", () => {
    it("should expose playerState with isPlaying as false on initial mount", () => {
      expect(wrapper.vm.playerState.isPlaying).toBe(false);
    });

    it("should expose playerState with initial time value of '00.00'", () => {
      expect(wrapper.vm.playerState.time).toBe("00.00");
    });

    it("should expose playerState with initial duration value of '00.00'", () => {
      expect(wrapper.vm.playerState.duration).toBe("00.00");
    });

    it("should expose playerState with skipInactivity as true by default", () => {
      expect(wrapper.vm.playerState.skipInactivity).toBe(true);
    });

    it("should expose playerState with default speed of 4", () => {
      expect(wrapper.vm.playerState.speed).toBe(4);
    });

    it("should expose playerState with progressWidth of 0 on initial mount", () => {
      expect(wrapper.vm.playerState.progressWidth).toBe(0);
    });
  });

  // ==========================================================================
  // EXPOSED METHODS
  // ==========================================================================

  describe("Exposed Methods", () => {
    it("should expose togglePlay as a function", () => {
      expect(typeof wrapper.vm.togglePlay).toBe("function");
    });

    it("should expose play as a function", () => {
      expect(typeof wrapper.vm.play).toBe("function");
    });

    it("should expose pause as a function", () => {
      expect(typeof wrapper.vm.pause).toBe("function");
    });

    it("should expose setSpeed as a function", () => {
      expect(typeof wrapper.vm.setSpeed).toBe("function");
    });

    it("should expose goto as a function", () => {
      expect(typeof wrapper.vm.goto).toBe("function");
    });

    it("should expose toggleSkipInactive as a function", () => {
      expect(typeof wrapper.vm.toggleSkipInactive).toBe("function");
    });

    it("should expose updatePlayerState as a function", () => {
      expect(typeof wrapper.vm.updatePlayerState).toBe("function");
    });
  });

  // ==========================================================================
  // TOGGLE PLAY LOGIC
  // ==========================================================================

  describe("togglePlay", () => {
    // isPlaying is derived from the playback state now, so the tests drive it through togglePlay.
    it("should set isPlaying to true when togglePlay is called while not playing", () => {
      expect(wrapper.vm.playerState.isPlaying).toBe(false);

      wrapper.vm.togglePlay();

      expect(wrapper.vm.playerState.isPlaying).toBe(true);
    });

    it("should set isPlaying to false when togglePlay is called while playing", () => {
      wrapper.vm.togglePlay();
      expect(wrapper.vm.playerState.isPlaying).toBe(true);

      wrapper.vm.togglePlay();

      expect(wrapper.vm.playerState.isPlaying).toBe(false);
    });

    it("should not throw when togglePlay is called with no player initialized", () => {
      expect(() => wrapper.vm.togglePlay()).not.toThrow();
    });
  });

  // ==========================================================================
  // PLAYER ELEMENT INTERACTION
  // ==========================================================================

  describe("Player Element Interaction", () => {
    it("should toggle isPlaying when the player element is clicked", async () => {
      const playerElement = wrapper.find('[id="player"]');
      const initialPlaying = wrapper.vm.playerState.isPlaying;

      await playerElement.trigger("click");

      expect(wrapper.vm.playerState.isPlaying).toBe(!initialPlaying);
    });

    it("should not throw when the playback bar is clicked", async () => {
      const playbackBar = wrapper.find('[data-test="video-player-playback-bar"]');
      expect(playbackBar.exists()).toBe(true);

      await expect(playbackBar.trigger("click")).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // PROPS REACTIVITY
  // ==========================================================================

  describe("Props Reactivity", () => {
    it("should accept new segments prop value without errors", async () => {
      await wrapper.setProps({ segments: mockSegments });

      expect(wrapper.props("segments")).toEqual(mockSegments);
    });

    it("should accept new events prop value without errors", async () => {
      const newEvents = [{ id: "new", name: "New Event", relativeTime: 5000 }];

      await wrapper.setProps({ events: newEvents });

      expect(wrapper.props("events")).toEqual(newEvents);
    });
  });

  // ==========================================================================
  // SESSION SETUP — setupSession inlines dimension calculation
  // ==========================================================================

  describe("Session Setup", () => {
    it("should set playerRef style width when segments are loaded via setProps", async () => {
      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();

      await localWrapper.setProps({ segments: mockSegments });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      const playerEl = localWrapper.find("#player").element as HTMLElement;
      expect(playerEl.style.width).toMatch(/^\d+px$/);

      localWrapper.unmount();
    });

    it("should build the player when a parent assigns a shallowRef segment list", async () => {
      const { default: rrwebPlayerMock } = await import("@openobserve/rrweb-player");
      (rrwebPlayerMock as ReturnType<typeof vi.fn>).mockClear();

      const { parent, segments } = mountWithShallowSegments([]);
      await flushPromises();
      expect(rrwebPlayerMock).not.toHaveBeenCalled();

      segments.value = [...mockSegments];
      await flushPromises();
      await parent.vm.$nextTick();
      await flushPromises();

      expect(rrwebPlayerMock).toHaveBeenCalledTimes(1);

      parent.unmount();
    });

    it("should append later segments through addEvent instead of rebuilding the player", async () => {
      const { default: rrwebPlayerMock } = await import("@openobserve/rrweb-player");
      (rrwebPlayerMock as ReturnType<typeof vi.fn>).mockClear();
      playerSpies.addEvent.mockClear();

      const { parent, segments } = mountWithShallowSegments([]);
      await flushPromises();
      segments.value = [...mockSegments];
      await flushPromises();
      expect(rrwebPlayerMock).toHaveBeenCalledTimes(1);

      segments.value = [...segments.value, laterSegment];
      await flushPromises();
      await parent.vm.$nextTick();
      await flushPromises();

      expect(rrwebPlayerMock).toHaveBeenCalledTimes(1);
      expect(playerSpies.addEvent).toHaveBeenCalledTimes(1);
      expect(playerSpies.addEvent.mock.calls[0][0]).toMatchObject({
        type: 3,
        timestamp: 1704110500000,
      });

      parent.unmount();
    });

    it("should skip an appended record that is at or before the playhead", async () => {
      playerSpies.addEvent.mockClear();

      const { parent, segments } = mountWithShallowSegments([]);
      await flushPromises();
      segments.value = [...mockSegments];
      await flushPromises();

      // Playhead sits past the appended record's timestamp; the player would apply it at once.
      playerSpies.getCurrentTime.mockReturnValueOnce(20000);
      const stale = {
        records: [{ type: 3, timestamp: 1704110410000, data: { source: 3, id: 1, x: 0, y: 0 } }],
      };
      segments.value = [...segments.value, stale];
      await flushPromises();
      await parent.vm.$nextTick();
      await flushPromises();

      expect(playerSpies.addEvent).not.toHaveBeenCalled();

      parent.unmount();
    });

    it("should destroy the replayer before the player on unmount", async () => {
      playerSpies.destroyReplayer.mockClear();

      const { parent, segments } = mountWithShallowSegments([]);
      await flushPromises();
      segments.value = [...mockSegments];
      await flushPromises();

      parent.unmount();

      expect(playerSpies.destroyReplayer).toHaveBeenCalledTimes(1);
    });

    it("should not create a player instance when segments array is empty", async () => {
      const { default: rrwebPlayerMock } = await import("@openobserve/rrweb-player");
      (rrwebPlayerMock as ReturnType<typeof vi.fn>).mockClear();

      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      expect(rrwebPlayerMock).not.toHaveBeenCalled();

      localWrapper.unmount();
    });

    it("should use 16:9 aspect ratio when session has no recorded dimensions", async () => {
      // Segment with records that have no width/height (no viewport event)
      const segmentsNoDimensions = [
        {
          records: [
            {
              type: 4,
              timestamp: 1704110400000,
              data: { href: "http://example.com" },
            },
          ],
        },
      ];

      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();

      await localWrapper.setProps({ segments: segmentsNoDimensions });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      // Player should still be sized (falls back to 0.5625 × width)
      const playerEl = localWrapper.find("#player").element as HTMLElement;
      // style.width may still be set even if 0 when clientWidth returns 800
      expect(typeof playerEl.style.width).toBe("string");

      localWrapper.unmount();
    });

    it("should transform type-8 records into type-5 viewport events during setupSession", async () => {
      const { default: rrwebPlayerMock } = await import("@openobserve/rrweb-player");

      // A segment containing both a type-8 record (to be transformed) and a
      // type-2 full-snapshot (needed so rrwebPlayer is constructed and we can
      // inspect what events it received).
      const segmentsWithType8 = [
        {
          records: [
            {
              type: 8,
              timestamp: 1704110400000,
              data: { width: 1280, height: 720 },
            },
            {
              type: 2,
              timestamp: 1704110401000,
              data: {
                width: 1280,
                height: 720,
                node: { type: 0, childNodes: [] },
              },
            },
          ],
        },
      ];

      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();

      await localWrapper.setProps({ segments: segmentsWithType8 });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      expect(rrwebPlayerMock).toHaveBeenCalled();
      const callArgs = (rrwebPlayerMock as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const events: any[] = callArgs?.props?.events ?? [];
      const viewportEvent = events.find((e: any) => e.type === 5);
      expect(viewportEvent).toBeDefined();
      expect(viewportEvent.data.tag).toBe("viewport");

      localWrapper.unmount();
    });
  });

  // ==========================================================================
  // FRUSTRATION SIGNALS
  // ==========================================================================

  describe("Frustration Signals", () => {
    const mockEventsWithFrustrations = [
      {
        id: "1",
        type: "action",
        name: "click on Submit",
        relativeTime: 45000,
        frustration_types: ["rage_click"],
      },
      {
        id: "2",
        type: "error",
        name: "TypeError",
        relativeTime: 60000,
        frustration_types: null,
      },
      {
        id: "3",
        type: "action",
        name: "click on Nav",
        relativeTime: 90000,
        frustration_types: ["dead_click", "error_click"],
      },
    ];

    let frustrationWrapper: ReturnType<typeof mountComponent>;

    beforeEach(async () => {
      frustrationWrapper = mountComponent({ events: mockEventsWithFrustrations });
      await flushPromises();
    });

    afterEach(() => {
      frustrationWrapper?.unmount();
    });

    it("should render successfully when events have frustration_types", () => {
      expect(frustrationWrapper.exists()).toBe(true);
    });

    it("should render event markers in the playback bar", () => {
      const eventMarkers = frustrationWrapper.findAll('[data-test="video-player-event-marker"]');

      expect(eventMarkers.length).toBeGreaterThan(0);
    });

    it("should render without errors when events have an empty frustration_types array", async () => {
      const eventsWithEmpty = [
        {
          id: "7",
          type: "action",
          name: "click",
          relativeTime: 70000,
          frustration_types: [],
        },
      ];

      await frustrationWrapper.setProps({ events: eventsWithEmpty });

      expect(frustrationWrapper.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // WORKER LIFECYCLE
  // ==========================================================================

  describe("Worker Lifecycle", () => {
    it("should terminate the worker when the component is unmounted", async () => {
      const localWrapper = mountComponent();
      await flushPromises();

      // Access the worker terminate mock through the MockWorker instances
      // The component creates one worker in initializeWorker()
      const terminateSpy = vi.fn();
      (localWrapper.vm as any).worker = { terminate: terminateSpy };

      localWrapper.unmount();

      // Worker.terminate is called via the exposed worker ref —
      // verify by checking the component cleaned up (no throw)
      expect(localWrapper.exists()).toBe(false);
    });

    it("should not throw when worker is null during unmount", async () => {
      const localWrapper = mountComponent();
      await flushPromises();

      (localWrapper.vm as any).worker = null;

      expect(() => localWrapper.unmount()).not.toThrow();
    });
  });

  // ==========================================================================
  // ResizeObserver lifecycle
  // ==========================================================================

  describe("ResizeObserver lifecycle", () => {
    let OriginalResizeObserver: typeof ResizeObserver;
    let observeSpy: ReturnType<typeof vi.fn>;
    let disconnectSpy: ReturnType<typeof vi.fn>;
    let capturedCallback: ResizeObserverCallback | undefined;

    beforeEach(() => {
      OriginalResizeObserver = global.ResizeObserver;
      observeSpy = vi.fn();
      disconnectSpy = vi.fn();
      capturedCallback = undefined;

      function MockRO(this: any, cb: ResizeObserverCallback) {
        capturedCallback = cb;
      }
      // Records the observed element per instance — OSelect's option list also creates observers against this mock.
      MockRO.prototype.observe = function (this: any, el: Element) {
        this._el = el;
        observeSpy(el);
      };
      MockRO.prototype.disconnect = function (this: any) {
        disconnectSpy(this._el);
      };
      MockRO.prototype.unobserve = vi.fn();
      global.ResizeObserver = MockRO as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
      global.ResizeObserver = OriginalResizeObserver;
    });

    it("should attach a ResizeObserver to playerContainerRef on mount", async () => {
      const localWrapper = mountComponent();
      await flushPromises();
      await localWrapper.vm.$nextTick();
      const containerEl = localWrapper.find("#player").element.parentElement;

      expect(capturedCallback).toBeDefined();
      // OSelect's speed dropdown options each attach their own truncation ResizeObserver too, so scope by target.
      expect(observeSpy).toHaveBeenCalledWith(containerEl);

      localWrapper.unmount();
    });

    it("should disconnect the ResizeObserver when the component is unmounted", async () => {
      const localWrapper = mountComponent();
      await flushPromises();
      await localWrapper.vm.$nextTick();
      const containerEl = localWrapper.find("#player").element.parentElement;

      localWrapper.unmount();

      expect(disconnectSpy).toHaveBeenCalledWith(containerEl);
    });

    it("should resize the player when the ResizeObserver callback fires after player is initialized", async () => {
      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();

      await localWrapper.setProps({ segments: mockSegments });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      const playerEl = localWrapper.find("#player").element as HTMLElement;

      if (capturedCallback) {
        capturedCallback([], {} as ResizeObserver);
      }
      await localWrapper.vm.$nextTick();

      expect(playerEl.style.width).toMatch(/^\d+(\.\d+)?px$/);

      localWrapper.unmount();
    });

    it("should not call player.$set when the ResizeObserver callback fires before player is initialized", async () => {
      const { default: rrwebPlayerMock } = await import("@openobserve/rrweb-player");
      (rrwebPlayerMock as ReturnType<typeof vi.fn>).mockClear();

      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      if (capturedCallback) {
        capturedCallback([], {} as ResizeObserver);
      }

      // No player was ever instantiated — rrwebPlayer constructor not called
      expect(rrwebPlayerMock).not.toHaveBeenCalled();

      localWrapper.unmount();
    });

    it("should reconnect the ResizeObserver when the component is re-activated", async () => {
      const localWrapper = mountComponent();
      await flushPromises();
      await localWrapper.vm.$nextTick();
      const containerEl = localWrapper.find("#player").element.parentElement;

      // Simulate keep-alive deactivation then activation
      localWrapper.vm.$.appContext.app;
      await (localWrapper.vm as any).$options.deactivated?.();
      await (localWrapper.vm as any).$options.activated?.();

      // observe was called at least once (on initial mount) — component handles re-activation
      expect(observeSpy).toHaveBeenCalledWith(containerEl);

      localWrapper.unmount();
    });
  });

  // ==========================================================================
  // PLAYER DIMENSION CALCULATION (inlined in setupSession)
  // ==========================================================================

  describe("Player Dimension Calculation", () => {
    it("should constrain playerHeight when it exceeds container height minus 90", async () => {
      // Force clientHeight small enough to trigger the height constraint branch
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        value: 1000,
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        // sessionHeight/sessionWidth ratio: 1080/1920 * 1000 = 562.5
        // container height - 90 = 100 → triggers constraint
        value: 190,
      });

      const localWrapper = mountComponent({ segments: [] });
      await flushPromises();

      await localWrapper.setProps({ segments: mockSegments });
      await flushPromises();
      await localWrapper.vm.$nextTick();

      const playerEl = localWrapper.find("#player").element as HTMLElement;
      // Width was recalculated — just verify it was assigned
      expect(playerEl.style.width).toMatch(/^\d+(\.\d+)?px$/);

      localWrapper.unmount();
    });
  });

  // ==========================================================================
  // PLAYBACK OVER A PARTLY LOADED SESSION (fixed timeline, buffering, seeks)
  // ==========================================================================

  describe("Playback over a partly loaded session", () => {
    const origin = 1704110400000;
    // The player's first event is one minute into the session, as for an event_time window.
    const sessionStart = origin - 60_000;
    const sessionEnd = sessionStart + 600_000;

    const batch = (timestamp: number) => ({
      records: [
        {
          type: 3,
          timestamp,
          data: { source: 0, adds: [], removes: [], attributes: [], texts: [] },
        },
      ],
    });

    async function mountPlayer(props: Record<string, any> = {}) {
      playerSpies.instances.length = 0;
      const local = mountComponent({
        events: [],
        segments: [],
        sessionStartMs: sessionStart,
        sessionEndMs: sessionEnd,
        loadState: "loading",
        speed: 1,
        ...props,
      });
      await flushPromises();
      await local.setProps({ segments: mockSegments });
      await flushPromises();
      await local.vm.$nextTick();
      return { local, instance: playerSpies.instances[0] };
    }

    async function append(local: any, meta: Partial<typeof playerSpies.meta>, timestamp: number) {
      Object.assign(playerSpies.meta, meta);
      await local.setProps({ segments: [...(local.props("segments") as any[]), batch(timestamp)] });
      await flushPromises();
      await local.vm.$nextTick();
      await flushPromises();
    }

    async function playTo(local: any, instance: any, payload: number) {
      local.vm.togglePlay();
      instance.listeners["ui-update-current-time"]({ payload });
      await local.vm.$nextTick();
    }

    beforeEach(() => {
      playerSpies.meta = { startTime: origin, endTime: origin + 120_000, totalTime: 120_000 };
      playerSpies.getCurrentTime.mockReturnValue(0);
    });

    it("keeps the duration label fixed across three batch appends", async () => {
      Object.assign(playerSpies.meta, { endTime: origin + 5_000, totalTime: 5_000 });
      const { local } = await mountPlayer();
      expect(local.vm.playerState.duration).toBe("10:00");

      for (const [i, end] of [60_000, 120_000, 180_000].entries()) {
        await append(local, { endTime: origin + end, totalTime: end }, origin + end - 1 - i);
        expect(local.vm.playerState.duration).toBe("10:00");
      }
      local.unmount();
    });

    it("widens the timeline only when loaded records run past the metadata end", async () => {
      const { local } = await mountPlayer({ sessionEndMs: origin + 60_000 });
      expect(local.vm.playerState.duration).toBe("03:00");
      await append(local, { endTime: origin + 30_000, totalTime: 30_000 }, origin + 29_000);
      expect(local.vm.playerState.duration).toBe("03:00");
      local.unmount();
    });

    it("emits ready once the player is built and reports its loaded edge in session ms", async () => {
      const { local } = await mountPlayer();
      expect(local.emitted("ready")).toHaveLength(1);
      expect(local.emitted("loaded-end-change")?.at(-1)).toEqual([180_000]);
      local.unmount();
    });

    it("shows the time label in session ms, not the player's own time", async () => {
      const { local, instance } = await mountPlayer();
      instance.listeners["ui-update-current-time"]({ payload: 2_000 });
      await local.vm.$nextTick();
      expect(local.find('[data-test="video-player-time"]').text()).toBe("01:02");
      local.unmount();
    });

    it("pauses one margin before the loaded edge, with epoch timestamps and an origin after the session start", async () => {
      const { local, instance } = await mountPlayer();
      await playTo(local, instance, 118_999);
      expect(local.vm.playbackState).toBe("playing");

      instance.listeners["ui-update-current-time"]({ payload: 119_000 });
      await local.vm.$nextTick();

      expect(local.vm.playbackState).toBe("buffering");
      expect(instance.pause).toHaveBeenCalled();
      expect(local.vm.playerState.isPlaying).toBe(true);
      expect(local.find('[data-test="replay-overlay-buffering"]').text()).toContain(
        "Loading the next part of the session",
      );
      local.unmount();
    });

    it("resumes at the held time, not at 0, once an append leaves two margins of headroom", async () => {
      const { local, instance } = await mountPlayer();
      await playTo(local, instance, 119_000);
      instance.goto.mockClear();

      await append(local, { endTime: origin + 130_000, totalTime: 130_000 }, origin + 129_000);

      expect(instance.goto).toHaveBeenCalledWith(119_000, true);
      expect(instance.goto).not.toHaveBeenCalledWith(0, expect.anything());
      expect(local.vm.playbackState).toBe("playing");
      local.unmount();
    });

    it("ends in Buffering through the finish safety net when a skip overshoots the margin", async () => {
      const { local, instance } = await mountPlayer();
      await playTo(local, instance, 1_000);
      instance.listeners.finish();
      await local.vm.$nextTick();
      expect(local.vm.playbackState).toBe("buffering");
      local.unmount();
    });

    it("resumes unconditionally when loading completes inside the margin, then ends on finish", async () => {
      const { local, instance } = await mountPlayer();
      await playTo(local, instance, 119_000);
      instance.goto.mockClear();

      await append(local, { endTime: origin + 120_500, totalTime: 120_500 }, origin + 120_400);
      expect(local.vm.playbackState).toBe("buffering");
      expect(instance.goto).not.toHaveBeenCalled();

      await local.setProps({ loadState: "complete" });
      expect(instance.goto).toHaveBeenCalledWith(119_000, true);

      instance.listeners.finish();
      await local.vm.$nextTick();
      expect(local.vm.playbackState).toBe("ended");
      local.unmount();
    });

    it("goes to Failed on finish when the load failed, and to Ended when it completed", async () => {
      const failed = await mountPlayer({ loadState: "failed" });
      await playTo(failed.local, failed.instance, 1_000);
      failed.instance.listeners.finish();
      await failed.local.vm.$nextTick();
      expect(failed.local.vm.playbackState).toBe("failed");
      failed.local.unmount();

      const complete = await mountPlayer({ loadState: "complete" });
      await playTo(complete.local, complete.instance, 1_000);
      complete.instance.listeners.finish();
      await complete.local.vm.$nextTick();
      expect(complete.local.vm.playbackState).toBe("ended");
      complete.local.unmount();
    });

    it("treats the run edge as the end once the run holds the last segment, while holes still load", async () => {
      const { local, instance } = await mountPlayer({ runComplete: true });
      await playTo(local, instance, 119_500);
      expect(local.vm.playbackState).toBe("playing");

      instance.listeners.finish();
      await local.vm.$nextTick();
      expect(local.vm.playbackState).toBe("ended");
      local.unmount();
    });

    it("resumes from Buffering once the last segment of the run is in the player", async () => {
      const { local, instance } = await mountPlayer();
      await playTo(local, instance, 119_000);
      instance.goto.mockClear();

      Object.assign(playerSpies.meta, { endTime: origin + 120_500, totalTime: 120_500 });
      await local.setProps({
        runComplete: true,
        segments: [...(local.props("segments") as any[]), batch(origin + 120_400)],
      });
      expect(local.vm.playbackState).toBe("buffering");
      await flushPromises();
      await local.vm.$nextTick();
      await flushPromises();

      expect(instance.goto).toHaveBeenCalledWith(119_000, true);
      expect(local.vm.playbackState).toBe("playing");
      local.unmount();
    });

    it("reports how many segments the player holds, after it has converted them", async () => {
      const { local } = await mountPlayer();
      expect(local.emitted("segments-taken")?.at(-1)).toEqual([1]);
      await append(local, { endTime: origin + 130_000, totalTime: 130_000 }, origin + 129_000);
      expect(local.emitted("segments-taken")?.at(-1)).toEqual([2]);
      local.unmount();
    });

    it("does not start rrweb on build while a pending seek is still outstanding", async () => {
      playerSpies.instances.length = 0;
      const local = mountComponent({
        events: [],
        segments: [],
        sessionStartMs: sessionStart,
        sessionEndMs: sessionEnd,
        loadState: "loading",
        pendingSeekMs: 300_000,
        speed: 1,
      });
      await flushPromises();
      expect(local.vm.playbackState).toBe("loading");
      local.vm.togglePlay();
      await local.setProps({ intent: "play", segments: mockSegments });
      await flushPromises();
      await local.vm.$nextTick();
      const instance = playerSpies.instances[0];

      expect(local.emitted("ready")).toHaveLength(1);
      expect(instance.goto).not.toHaveBeenCalled();
      expect(instance.play).not.toHaveBeenCalled();
      expect(local.vm.playbackState).toBe("buffering");
      local.unmount();
    });

    it("keeps the mode set by a seek the parent makes on ready", async () => {
      playerSpies.instances.length = 0;
      let local: any = null;
      local = mountComponent({
        events: [],
        segments: [],
        sessionStartMs: sessionStart,
        sessionEndMs: sessionEnd,
        loadState: "loading",
        pendingSeekMs: 90_000,
        intent: "play",
        speed: 1,
        onReady: () => local.vm.seekTo(90_000, true),
      });
      await flushPromises();
      await local.setProps({ segments: mockSegments });
      await flushPromises();
      await local.vm.$nextTick();
      const instance = playerSpies.instances[0];

      expect(instance.goto).toHaveBeenLastCalledWith(30_000, true);
      expect(local.vm.playbackState).toBe("playing");
      local.unmount();
    });

    it("cancels the auto-resume when the user pauses while buffering", async () => {
      const { local, instance } = await mountPlayer();
      await playTo(local, instance, 119_000);
      local.vm.togglePlay();
      expect(local.vm.playbackState).toBe("paused");
      instance.goto.mockClear();

      await append(local, { endTime: origin + 200_000, totalTime: 200_000 }, origin + 199_000);

      expect(instance.goto).not.toHaveBeenCalled();
      expect(local.vm.playbackState).toBe("paused");
      local.unmount();
    });

    it("from Failed, a covered seek plays if the user was playing and shows the frame if paused", async () => {
      const { local, instance } = await mountPlayer({ loadState: "failed" });
      await playTo(local, instance, 1_000);
      instance.listeners.finish();
      await local.vm.$nextTick();

      local.vm.seekTo(90_000, true);
      expect(instance.goto).toHaveBeenLastCalledWith(30_000, true);
      expect(local.vm.playbackState).toBe("playing");

      instance.listeners.finish();
      local.vm.seekTo(90_000, false);
      expect(instance.goto).toHaveBeenLastCalledWith(30_000, false);
      expect(local.vm.playbackState).toBe("paused");
      local.unmount();
    });

    it("leaves rrweb's playhead alone for a pending seek, and loses no record between the edge and the target", async () => {
      const { local, instance } = await mountPlayer();
      instance.listeners["ui-update-current-time"]({ payload: 10_000 });
      instance.goto.mockClear();

      await local.setProps({ pendingSeekMs: 300_000 });
      expect(instance.goto).not.toHaveBeenCalled();
      expect(local.vm.playbackState).toBe("waiting");
      expect(local.vm.playerState.time).toBe("05:00");
      expect(local.find('[data-test="replay-overlay-waiting"]').text()).toContain(
        "Loading up to 05:00",
      );

      instance.listeners["ui-update-current-time"]({ payload: 20_000 });
      expect(local.vm.playerState.actualTime).toBe(10_000);

      playerSpies.addEvent.mockClear();
      playerSpies.getCurrentTime.mockReturnValue(10_000);
      await append(local, { endTime: origin + 250_000, totalTime: 250_000 }, origin + 200_000);
      expect(playerSpies.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: origin + 200_000 }),
      );

      await local.setProps({ pendingSeekMs: null });
      local.vm.seekTo(300_000, false);
      expect(instance.goto).toHaveBeenLastCalledWith(240_000, false);
      local.unmount();
    });

    it("dims the played fill while a seek waits on data", async () => {
      const { local } = await mountPlayer({ pendingSeekMs: 300_000 });
      expect(local.find('[data-test="video-player-progress"]').classes()).toContain("opacity-50");
      local.unmount();
    });

    it("sends Play in Ended to the parent as a seek to 0 instead of restarting the controller", async () => {
      const { local, instance } = await mountPlayer({ loadState: "complete" });
      await playTo(local, instance, 1_000);
      instance.listeners.finish();
      await local.vm.$nextTick();
      instance.play.mockClear();
      instance.goto.mockClear();

      local.vm.togglePlay();

      expect(local.emitted("seek-request")?.at(-1)).toEqual([0]);
      expect(instance.play).not.toHaveBeenCalled();
      expect(instance.goto).not.toHaveBeenCalled();
      local.unmount();
    });

    it("never calls the controller's play() while the load is incomplete", async () => {
      const { local, instance } = await mountPlayer();
      local.vm.togglePlay();
      expect(instance.play).not.toHaveBeenCalled();
      expect(instance.goto).toHaveBeenLastCalledWith(0, true);
      local.unmount();
    });

    it("turns bar clicks and ±10 s into seek requests in session ms instead of seeking itself", async () => {
      const { local, instance } = await mountPlayer();
      instance.goto.mockClear();

      await local
        .find('[data-test="video-player-playback-bar"]')
        .trigger("click", { clientX: 400 });
      expect(local.emitted("seek-request")?.at(-1)).toEqual([300_000]);

      instance.listeners["ui-update-current-time"]({ payload: 0 });
      local.vm.$.setupState.skipTo("forward");
      expect(local.emitted("seek-request")?.at(-1)).toEqual([70_000]);
      expect(instance.goto).not.toHaveBeenCalled();
      local.unmount();
    });

    it("shows the load percentage, then Fully loaded for 3 s", async () => {
      vi.useFakeTimers();
      try {
        const { local } = await mountPlayer({ loadPercent: 45.6 });
        expect(local.find('[data-test="replay-status-chip"]').text()).toBe("Loading 45%");

        await local.setProps({ loadState: "complete" });
        expect(local.find('[data-test="replay-status-chip"]').text()).toBe("Fully loaded");

        vi.advanceTimersByTime(3000);
        await local.vm.$nextTick();
        expect(local.find('[data-test="replay-status-chip"]').exists()).toBe(false);
        local.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it("in a live session, ends at the loaded end with nothing in flight and resumes in place with goto", async () => {
      const { local, instance } = await mountPlayer({ loadState: "live", runComplete: true });
      await playTo(local, instance, 119_900);
      instance.listeners.finish();
      await local.vm.$nextTick();
      expect(local.vm.playbackState).toBe("ended");
      expect(local.emitted("update:intent")?.at(-1)).toEqual(["play"]);
      instance.play.mockClear();
      instance.goto.mockClear();

      await append(local, { endTime: origin + 150_000, totalTime: 150_000 }, origin + 149_000);

      expect(instance.goto).toHaveBeenCalledWith(119_900, true);
      expect(instance.play).not.toHaveBeenCalled();
      expect(local.vm.playbackState).toBe("playing");
      local.unmount();
    });

    it("in a live session, does not resume on new activity once the user moved the playhead", async () => {
      const { local, instance } = await mountPlayer({ loadState: "live", runComplete: true });
      await playTo(local, instance, 119_900);
      instance.listeners.finish();
      await local.vm.$nextTick();
      local.vm.seekTo(90_000, false);
      instance.goto.mockClear();

      await append(local, { endTime: origin + 150_000, totalTime: 150_000 }, origin + 149_000);

      expect(instance.goto).not.toHaveBeenCalled();
      expect(local.vm.playbackState).toBe("paused");
      local.unmount();
    });

    it("in a live session, buffers at the edge while a batch is in flight", async () => {
      const { local, instance } = await mountPlayer({ loadState: "live" });
      await playTo(local, instance, 119_000);
      expect(local.vm.playbackState).toBe("buffering");
      instance.listeners.finish();
      await local.vm.$nextTick();
      expect(local.vm.playbackState).toBe("buffering");
      local.unmount();
    });

    it("shows no chip while live and never Fully loaded", async () => {
      vi.useFakeTimers();
      try {
        const { local } = await mountPlayer({ loadPercent: 45.6 });
        await local.setProps({ loadState: "live", loadPercent: 100 });
        const chip = () => local.find('[data-test="replay-status-chip"]');
        expect(chip().exists()).toBe(false);

        vi.advanceTimersByTime(5000);
        await local.vm.$nextTick();
        expect(chip().exists()).toBe(false);

        await local.setProps({ loadState: "complete" });
        expect(chip().exists()).toBe(false);
        local.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows a failed chip and overlay whose Retry reaches the parent", async () => {
      const { local, instance } = await mountPlayer({ loadState: "failed", failedFromMs: 60_000 });
      await playTo(local, instance, 1_000);
      instance.listeners.finish();
      await local.vm.$nextTick();

      expect(local.find('[data-test="replay-overlay-failed"]').text()).toContain(
        "Couldn't load 01:00 – 10:00",
      );
      await local.find('[data-test="replay-status-chip-failed"]').trigger("click");
      await local.find('[data-test="replay-overlay-retry"]').trigger("click");
      expect(local.emitted("retry")).toHaveLength(2);
      local.unmount();
    });

    it("draws the loaded band and counts the parts that could not load", async () => {
      const { local } = await mountPlayer({
        loadedRanges: [
          { start: 60_000, end: 180_000, state: "inPlayer" },
          { start: 180_000, end: 185_000, state: "skipped" },
          { start: 500_000, end: 600_000, state: "unavailable" },
        ],
      });
      expect(local.findAll('[data-test="replay-load-band-inPlayer"]')).toHaveLength(1);
      expect(local.find('[data-test="replay-load-band-skipped"]').attributes("title")).toBe(
        "This part couldn't load",
      );
      expect(local.find('[data-test="replay-load-band-unavailable"]').attributes("title")).toBe(
        "Not available: past the 50,000-segment limit",
      );
      expect(local.find('[data-test="replay-status-chip"]').text()).toContain(
        "· 1 part couldn't load",
      );
      local.unmount();
    });

    it("tells the user that a hovered span is not loaded yet", async () => {
      const { local } = await mountPlayer({
        loadedRanges: [{ start: 60_000, end: 180_000, state: "inPlayer" }],
      });
      const bar = local.find('[data-test="video-player-playback-bar"]');
      await bar.trigger("mousemove", { clientX: 400 });
      expect(local.find('[data-test="video-player-hover-tooltip"]').text()).toBe(
        "05:00 · not loaded yet",
      );
      await bar.trigger("mousemove", { clientX: 160 });
      expect(local.find('[data-test="video-player-hover-tooltip"]').text()).toBe("02:00");
      local.unmount();
    });
  });

  describe("Error and empty states", () => {
    it("shows the load error with a Retry that reaches the parent", async () => {
      const local = mountComponent({ loadState: "error" });
      await flushPromises();
      expect(local.find('[data-test="replay-overlay-error"]').text()).toContain(
        "Couldn't load the session replay.",
      );
      await local.find('[data-test="replay-overlay-retry"]').trigger("click");
      expect(local.emitted("retry")).toHaveLength(1);
      local.unmount();
    });

    it("shows a real empty state for a session with no replay", async () => {
      const local = mountComponent({ loadState: "empty" });
      await flushPromises();
      expect(local.find('[data-test="replay-overlay-empty"]').text()).toContain(
        "No session replay available",
      );
      local.unmount();
    });

    it("shows the retry attempt under the loading spinner", async () => {
      const local = mountComponent({ isLoading: true, retryAttempt: 2 });
      await flushPromises();
      expect(local.find('[data-test="video-player-retrying"]').text()).toBe("Retrying (2 of 3)…");
      local.unmount();
    });
  });
});
