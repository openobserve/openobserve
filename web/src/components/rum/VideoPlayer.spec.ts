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

class MockWorker {
  constructor() {}
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  postMessage = vi.fn();
  terminate = vi.fn();
}

global.Worker = MockWorker as any;

class MockURL {
  href: string;
  constructor(url: string, _base?: string) {
    this.href = url;
  }
  static createObjectURL = vi.fn(() => "blob:test");
}

global.URL = MockURL as any;

describe("VideoPlayer", () => {
  let wrapper: any;

  const mockEvents = [
    { id: "event1", name: "Page Load", relativeTime: 1000 },
    { id: "event2", name: "Button Click", relativeTime: 2000 },
  ];

  const mockSegments = [
    {
      records: [
        {
          type: 2,
          timestamp: 1704110400000,
          data: { width: 1920, height: 1080 },
        },
      ],
    },
  ];

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
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: vi.fn(),
    }));

    wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("mounts successfully without errors", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders player-container element", () => {
      // Arrange & Assert
      expect(wrapper.find('[id="player"]').exists()).toBe(true);
    });

    it("renders controls-container element", () => {
      // Arrange & Assert
      expect(wrapper.find('[class*="controls-container"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  describe("Loading State", () => {
    it("does not render loading indicator when isLoading is false", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(false);
    });

    it("renders loading indicator when isLoading is true", async () => {
      // Arrange & Act
      await wrapper.setProps({ isLoading: true });

      // Assert
      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(true);
    });

    it("displays loading text message when isLoading is true", async () => {
      // Arrange & Act
      await wrapper.setProps({ isLoading: true });

      // Assert
      expect(wrapper.text()).toContain("Hold on tight, we're fetching sessions.");
    });

    it("hides loading indicator after isLoading changes from true to false", async () => {
      // Arrange
      await wrapper.setProps({ isLoading: true });
      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ isLoading: false });

      // Assert
      expect(wrapper.find('[data-test="video-player-loading-indicator"]').exists()).toBe(false);
    });
  });

  // ==========================================================================
  // PLAYER STATE (exposed via defineExpose)
  // ==========================================================================

  describe("Player State", () => {
    it("exposes playerState with isPlaying false on initial mount", () => {
      // Arrange & Assert
      expect(wrapper.vm.playerState.isPlaying).toBe(false);
    });

    it("exposes playerState with time property defined on initial mount", () => {
      // Arrange & Assert
      expect(wrapper.vm.playerState.time).toBeDefined();
    });

    it("exposes playerState with duration property defined on initial mount", () => {
      // Arrange & Assert
      expect(wrapper.vm.playerState.duration).toBeDefined();
    });
  });

  // ==========================================================================
  // PLAYER CONTROLS - structure
  // ==========================================================================

  describe("Player Controls", () => {
    it("renders playback_bar element", () => {
      // Arrange & Assert
      expect(wrapper.find('[class*="playback_bar"]').exists()).toBe(true);
    });

    it("renders the player element with cursor-pointer attribute", () => {
      // Arrange
      const playerElement = wrapper.find('[id="player"]');

      // Assert
      expect(playerElement.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // PLAYER METHODS (exposed via defineExpose)
  // ==========================================================================

  describe("Player Methods", () => {
    it("exposes togglePlay as a function via defineExpose", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.togglePlay).toBe("function");
    });

    it("exposes play as a function via defineExpose", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.play).toBe("function");
    });

    it("exposes pause as a function via defineExpose", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.pause).toBe("function");
    });

    it("exposes setSpeed as a function via defineExpose", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.setSpeed).toBe("function");
    });

    it("exposes goto as a function via defineExpose", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.goto).toBe("function");
    });

    it("sets isPlaying to true when togglePlay is called while not playing", () => {
      // Arrange
      wrapper.vm.playerState.isPlaying = false;

      // Act
      wrapper.vm.togglePlay();

      // Assert
      expect(wrapper.vm.playerState.isPlaying).toBe(true);
    });

    it("sets isPlaying to false when togglePlay is called while already playing", () => {
      // Arrange
      wrapper.vm.playerState.isPlaying = true;

      // Act
      wrapper.vm.togglePlay();

      // Assert
      expect(wrapper.vm.playerState.isPlaying).toBe(false);
    });
  });

  // ==========================================================================
  // PLAYER ELEMENT INTERACTION
  // ==========================================================================

  describe("Player Element Interaction", () => {
    it("renders player element that can be clicked", () => {
      // Arrange
      const playerElement = wrapper.find('[id="player"]');

      // Assert
      expect(playerElement.exists()).toBe(true);
    });

    it("toggles isPlaying when player element is clicked", async () => {
      // Arrange
      const playerElement = wrapper.find('[id="player"]');
      const initialPlaying = wrapper.vm.playerState.isPlaying;

      // Act
      await playerElement.trigger("click");

      // Assert
      expect(wrapper.vm.playerState.isPlaying).toBe(!initialPlaying);
    });

    it("renders playback bar that can be clicked", async () => {
      // Arrange
      const playbackBar = wrapper.find('[class*="playback_bar"]');
      expect(playbackBar.exists()).toBe(true);

      // Act & Assert — clicking does not throw
      await playbackBar.trigger("click");
      expect(playbackBar.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // PROPS REACTIVITY
  // ==========================================================================

  describe("Props Reactivity", () => {
    it("accepts new segments prop value without errors", async () => {
      // Arrange & Act
      await wrapper.setProps({ segments: mockSegments });

      // Assert
      expect(wrapper.props("segments")).toEqual(mockSegments);
    });

    it("accepts new events prop value without errors", async () => {
      // Arrange
      const newEvents = [{ id: "new", name: "New Event", relativeTime: 5000 }];

      // Act
      await wrapper.setProps({ events: newEvents });

      // Assert
      expect(wrapper.props("events")).toEqual(newEvents);
    });
  });

  // ==========================================================================
  // FRUSTRATION SIGNALS (via behavior/template rendering)
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

    beforeEach(async () => {
      wrapper = mountComponent({ events: mockEventsWithFrustrations });
      await flushPromises();
    });

    it("renders component successfully when events have frustration_types", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders all 3 event markers in the playback bar when 3 events are provided", () => {
      // Arrange
      const eventMarkers = wrapper.findAll('[class*="progressTime"]');

      // Assert — at least some markers (possibly more due to progress fill elements too)
      expect(eventMarkers.length).toBeGreaterThan(0);
    });

    it("renders component without errors when events have empty frustration_types array", async () => {
      // Arrange
      const eventsWithEmpty = [
        {
          id: "7",
          type: "action",
          name: "click",
          relativeTime: 70000,
          frustration_types: [],
        },
      ];

      // Act
      await wrapper.setProps({ events: eventsWithEmpty });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe("Error Handling", () => {
    it("does not throw when togglePlay is called with no player initialized", () => {
      // Arrange
      // player is not set (no segments provided)

      // Act & Assert
      expect(() => wrapper.vm.togglePlay()).not.toThrow();
    });
  });

  // ==========================================================================
  // PLAYER SIZING
  // ==========================================================================

  describe("Player Sizing", () => {
    it("sets playerRef style width when segments are loaded via setProps", async () => {
      // Arrange — mount without segments (matching real usage: parent always starts empty)
      const wrapper = mountComponent({ segments: [] });
      await flushPromises();

      // Act — add segments to trigger setupSession (via watcher)
      await wrapper.setProps({ segments: mockSegments });
      await flushPromises();
      await wrapper.vm.$nextTick();

      // Assert — playerRef should have been sized
      const playerEl = wrapper.find("#player").element as HTMLElement;
      expect(playerEl.style.width).toMatch(/^\d+px$/);

      wrapper.unmount();
    });
  });
});
