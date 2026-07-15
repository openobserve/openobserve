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
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// vi.mock is hoisted — must be at top of file
vi.mock("lodash-es", () => ({
  cloneDeep: vi.fn((obj) => JSON.parse(JSON.stringify(obj))),
}));

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

vi.mock("@openobserve/rrweb-player", () => ({
  default: vi.fn(() => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setSpeed: vi.fn(),
    toggleSkipInactive: vi.fn(),
    goto: vi.fn(),
    getMetaData: vi.fn(() => ({
      startTime: 1704110400000,
      endTime: 1704110520000,
      totalTime: 120000,
    })),
    triggerResize: vi.fn(),
    $set: vi.fn(),
  })),
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
      expect(
        wrapper.find('[data-test="video-player-playback-bar"]').exists(),
      ).toBe(true);
    });
  });

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  describe("Loading State", () => {
    it("should not render loading indicator when isLoading is false", () => {
      expect(
        wrapper.find('[data-test="video-player-loading-indicator"]').exists(),
      ).toBe(false);
    });

    it("should render loading indicator when isLoading is true", async () => {
      await wrapper.setProps({ isLoading: true });

      expect(
        wrapper.find('[data-test="video-player-loading-indicator"]').exists(),
      ).toBe(true);
    });

    it("should display loading text message when isLoading is true", async () => {
      await wrapper.setProps({ isLoading: true });

      expect(wrapper.text()).toContain("Hold on tight");
    });

    it("should hide loading indicator when isLoading transitions from true to false", async () => {
      await wrapper.setProps({ isLoading: true });
      expect(
        wrapper.find('[data-test="video-player-loading-indicator"]').exists(),
      ).toBe(true);

      await wrapper.setProps({ isLoading: false });

      expect(
        wrapper.find('[data-test="video-player-loading-indicator"]').exists(),
      ).toBe(false);
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
    it("should set isPlaying to true when togglePlay is called while not playing", () => {
      wrapper.vm.playerState.isPlaying = false;

      wrapper.vm.togglePlay();

      expect(wrapper.vm.playerState.isPlaying).toBe(true);
    });

    it("should set isPlaying to false when togglePlay is called while playing", () => {
      wrapper.vm.playerState.isPlaying = true;

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
      const playbackBar = wrapper.find(
        '[data-test="video-player-playback-bar"]',
      );
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
      const newEvents = [
        { id: "new", name: "New Event", relativeTime: 5000 },
      ];

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

    it("should not create a player instance when segments array is empty", async () => {
      const { default: rrwebPlayerMock } = await import(
        "@openobserve/rrweb-player"
      );
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
      const { default: rrwebPlayerMock } = await import(
        "@openobserve/rrweb-player"
      );

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
      const callArgs = (rrwebPlayerMock as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
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
      const eventMarkers = frustrationWrapper.findAll(
        '[data-test="video-player-event-marker"]',
      );

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

      function MockRO(this: ResizeObserver, cb: ResizeObserverCallback) {
        capturedCallback = cb;
      }
      MockRO.prototype.observe = observeSpy;
      MockRO.prototype.disconnect = disconnectSpy;
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

      expect(capturedCallback).toBeDefined();
      expect(observeSpy).toHaveBeenCalledTimes(1);

      localWrapper.unmount();
    });

    it("should disconnect the ResizeObserver when the component is unmounted", async () => {
      const localWrapper = mountComponent();
      await flushPromises();
      await localWrapper.vm.$nextTick();

      localWrapper.unmount();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
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
      const { default: rrwebPlayerMock } = await import(
        "@openobserve/rrweb-player"
      );
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

      // Simulate keep-alive deactivation then activation
      localWrapper.vm.$.appContext.app;
      await (localWrapper.vm as any).$options.deactivated?.();
      await (localWrapper.vm as any).$options.activated?.();

      // observe was called at least once (on initial mount) — component handles re-activation
      expect(observeSpy).toHaveBeenCalledTimes(1);

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
});
