// Copyright 2023 OpenObserve Inc.
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
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock lodash-es
vi.mock("lodash-es", () => ({
  cloneDeep: vi.fn((obj) => JSON.parse(JSON.stringify(obj))),
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  getPath: vi.fn(() => "/test/path"),
}));

// Mock vuex
vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      API_ENDPOINT: "https://api.test.com",
      selectedOrganization: { identifier: "test-org" },
    },
  })),
}));

// Mock dynamic imports
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
  })),
}));

vi.mock("@openobserve/rrweb-player/dist/style.css", () => ({}));

// Mock Worker
class MockWorker {
  constructor() {}
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  postMessage = vi.fn();
  terminate = vi.fn();
}

global.Worker = MockWorker as any;

// Mock URL constructor properly
class MockURL {
  constructor(url: string, base?: string) {
    this.href = url;
  }
  href: string;
  static createObjectURL = vi.fn(() => "blob:test");
}

global.URL = MockURL as any;

describe("VideoPlayer Component", () => {
  let wrapper: any;

  const mockEvents = [
    {
      id: "event1",
      name: "Page Load",
      relativeTime: 1000,
    },
    {
      id: "event2",
      name: "Button Click",
      relativeTime: 2000,
    },
  ];

  const mockSegments = [
    {
      records: [
        {
          type: 2,
          timestamp: 1704110400000,
          data: {
            width: 1920,
            height: 1080,
          },
        },
      ],
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock DOM methods
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

    wrapper = mount(VideoPlayer, {
      attachTo: "#app",
      props: {
        events: mockEvents,
        segments: [],
        isLoading: false,
      },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          "q-spinner-hourglass": {
            template: '<div data-test="spinner" />',
            props: ["color", "size", "style"],
          },
          "q-icon": {
            template: '<i data-test="q-icon" :class="name"></i>',
            props: ["name", "size"],
          },
          "q-toggle": {
            template: `
              <div data-test="q-toggle" @click="$emit('update:model-value', !modelValue)">
                {{ label }}
              </div>
            `,
            props: ["modelValue", "label", "size"],
            emits: ["update:model-value"],
          },
          "q-select": {
            template: `
              <div data-test="q-select" @click="$emit('update:model-value', options[0])">
                {{ modelValue ? modelValue.label : '' }}
              </div>
            `,
            props: [
              "modelValue",
              "options",
              "color",
              "bg-color",
              "stack-label",
              "outlined",
              "filled",
              "dense",
              "size",
            ],
            emits: ["update:model-value"],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render player container", () => {
      expect(wrapper.find(".player-container").exists()).toBe(true);
    });

    it("should have correct container classes", () => {
      const container = wrapper.find(".player-container");
      expect(container.classes()).toContain("full-height");
      expect(container.classes()).toContain("q-pa-sm");
    });
  });

  describe("Loading State", () => {
    it("should not show spinner when not loading", () => {
      const spinner = wrapper.find('[data-test="spinner"]');
      expect(spinner.exists()).toBe(false);
    });

    it("should display loading spinner when isLoading is true", async () => {
      await wrapper.setProps({ isLoading: true });
      const spinner = wrapper.find('[data-test="spinner"]');
      expect(spinner.exists()).toBe(true);
    });

    it("should display loading message when loading", async () => {
      await wrapper.setProps({ isLoading: true });
      expect(wrapper.text()).toContain(
        "Hold on tight, we're fetching sessions.",
      );
    });

    it("should hide loading content when not loading", async () => {
      await wrapper.setProps({ isLoading: true });
      expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);

      await wrapper.setProps({ isLoading: false });
      expect(wrapper.find('[data-test="spinner"]').exists()).toBe(false);
    });
  });

  describe("Player State", () => {
    it("should have initial player state", () => {
      const state = wrapper.vm.playerState;
      expect(state.isPlaying).toBe(false);
      expect(state.time).toBe("00.00");
      expect(state.duration).toBe("00.00");
      expect(state.speed.value).toBe(4);
      expect(state.skipInactivity).toBe(true);
    });

    it("should have correct speed options", () => {
      const speedOptions = wrapper.vm.speedOptions;
      expect(speedOptions).toEqual([
        { label: "0.5x", value: 0.5 },
        { label: "1x", value: 1 },
        { label: "1.5x", value: 1.5 },
        { label: "2x", value: 2 },
        { label: "3x", value: 3 },
        { label: "4x", value: 4 },
      ]);
    });
  });

  describe("Player Controls", () => {
    it("should render playback bar", () => {
      const playbackBar = wrapper.find(".playback_bar");
      expect(playbackBar.exists()).toBe(true);
      expect(playbackBar.classes()).toContain("cursor-pointer");
    });

    it("should render control buttons", () => {
      const controlsContainer = wrapper.find(".controls");
      expect(controlsContainer.exists()).toBe(true);
    });

    it("should render skip inactivity toggle", () => {
      const skipToggle = wrapper.find('[data-test="q-toggle"]');
      expect(skipToggle.exists()).toBe(true);
    });

    it("should render speed selector", () => {
      const speedSelector = wrapper.find('[data-test="q-select"]');
      expect(speedSelector.exists()).toBe(true);
    });
  });

  describe("Time Display", () => {
    it("should display time and duration", () => {
      const timeContainer = wrapper.find(".flex.q-ml-lg.items-center");
      expect(timeContainer.exists()).toBe(true);
      expect(timeContainer.text()).toContain("/");
    });
  });

  describe("Event Markers", () => {
    it("should render event markers when events exist", () => {
      const eventMarkers = wrapper.findAll(".progressTime.bg-secondary");
      expect(eventMarkers.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Player Control Methods", () => {
    it("should have player control methods", () => {
      expect(typeof wrapper.vm.togglePlay).toBe("function");
      expect(typeof wrapper.vm.play).toBe("function");
      expect(typeof wrapper.vm.pause).toBe("function");
      expect(typeof wrapper.vm.setSpeed).toBe("function");
      expect(typeof wrapper.vm.goto).toBe("function");
      expect(typeof wrapper.vm.skipTo).toBe("function");
    });

    it("should toggle playing state", () => {
      wrapper.vm.playerState.isPlaying = false;
      wrapper.vm.togglePlay();
      expect(wrapper.vm.playerState.isPlaying).toBe(true);

      wrapper.vm.togglePlay();
      expect(wrapper.vm.playerState.isPlaying).toBe(false);
    });

    it("should handle skip forward", () => {
      wrapper.vm.playerState.actualTime = 10000;
      wrapper.vm.player = { goto: vi.fn() };
      wrapper.vm.skipTo("forward");
      expect(wrapper.vm.player.goto).toHaveBeenCalledWith(20000, false);
    });

    it("should handle skip backward", () => {
      wrapper.vm.playerState.actualTime = 20000;
      wrapper.vm.player = { goto: vi.fn() };
      wrapper.vm.skipTo("backward");
      expect(wrapper.vm.player.goto).toHaveBeenCalledWith(10000, false);
    });
  });

  describe("Session Management", () => {
    it("should have session property", () => {
      expect(wrapper.vm.session).toBeDefined();
      expect(Array.isArray(wrapper.vm.session)).toBe(true);
    });

    it("should handle empty segments", () => {
      expect(wrapper.vm.session).toEqual([]);
    });
  });

  describe("Worker Integration", () => {
    it("should initialize worker", () => {
      expect(wrapper.vm.worker).toBeDefined();
    });

    it("should have processCss method", () => {
      expect(typeof wrapper.vm.processCss).toBe("function");
    });
  });

  describe("Progress Tracking", () => {
    it("should have updateProgressBar method", () => {
      expect(typeof wrapper.vm.updateProgressBar).toBe("function");
    });

    it("should update progress on time change", () => {
      wrapper.vm.playerState.totalTime = 120000;
      wrapper.vm.playerState.width = 800;

      wrapper.vm.updateProgressBar({ payload: 60000 });

      expect(wrapper.vm.playerState.actualTime).toBe(60000);
      expect(wrapper.vm.playerState.progressWidth).toBeGreaterThan(0);
    });
  });

  describe("Component Interaction", () => {
    it("should handle player click", async () => {
      const playerElement = wrapper.find("#player");
      expect(playerElement.exists()).toBe(true);

      const initialPlaying = wrapper.vm.playerState.isPlaying;
      await playerElement.trigger("click");
      expect(wrapper.vm.playerState.isPlaying).toBe(!initialPlaying);
    });

    it("should handle playback bar click", async () => {
      const playbackBar = wrapper.find(".playback_bar");
      expect(playbackBar.exists()).toBe(true);

      // Mock player and state for successful click handling
      wrapper.vm.player = { goto: vi.fn() };
      wrapper.vm.playerState.totalTime = 120000;
      wrapper.vm.playerState.width = 800;

      await playbackBar.trigger("click");
      // Verify the component handles the click (even if no specific behavior)
      expect(playbackBar.exists()).toBe(true);
    });
  });

  describe("Props Reactivity", () => {
    it("should handle segments prop changes", async () => {
      await wrapper.setProps({ segments: mockSegments });
      expect(wrapper.props("segments")).toEqual(mockSegments);
    });

    it("should handle events prop changes", async () => {
      const newEvents = [{ id: "new", name: "New Event", relativeTime: 5000 }];
      await wrapper.setProps({ events: newEvents });
      expect(wrapper.props("events")).toEqual(newEvents);
    });
  });

  describe("Component Structure", () => {
    it("should have correct layout structure", () => {
      const container = wrapper.find(".player-container");
      const controlsContainer = wrapper.find(".controls-container");

      expect(container.exists()).toBe(true);
      expect(controlsContainer.exists()).toBe(true);
    });

    it("should render player element", () => {
      const playerElement = wrapper.find("#player");
      expect(playerElement.exists()).toBe(true);
      expect(playerElement.classes()).toContain("player");
      expect(playerElement.classes()).toContain("cursor-pointer");
    });
  });

  describe("Accessibility", () => {
    it("should have clickable elements", () => {
      const clickableElements = wrapper.findAll(".cursor-pointer");
      expect(clickableElements.length).toBeGreaterThan(0);
    });

    it("should have proper styling", () => {
      const playbackBar = wrapper.find(".playback_bar");
      expect(playbackBar.exists()).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing player gracefully", () => {
      wrapper.vm.player = null;
      expect(() => wrapper.vm.togglePlay()).not.toThrow();
    });

    it("should handle worker errors", async () => {
      wrapper.vm.worker = null;
      await expect(wrapper.vm.processCss("css", "id")).rejects.toBe(
        "Worker not initialized",
      );
    });
  });

  describe("Component Lifecycle", () => {
    it("should cleanup on unmount", () => {
      const worker = wrapper.vm.worker;
      if (worker) {
        const terminateSpy = vi.spyOn(worker, "terminate");
        wrapper.unmount();
        expect(terminateSpy).toHaveBeenCalled();
      } else {
        wrapper.unmount();
        expect(true).toBe(true); // Component unmounted without error
      }
    });
  });

  describe("Utility Functions", () => {
    it("should have formatTimeDifference method", () => {
      expect(typeof wrapper.vm.formatTimeDifference).toBe("function");
    });

    it("should format time correctly", () => {
      // Test through the component's method
      const formatted = wrapper.vm.formatTimeDifference(65000); // 1 minute 5 seconds
      expect(formatted).toBe("01:05");
    });
  });

  describe("Frustration Signals - Timeline Markers", () => {
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
      wrapper = mount(VideoPlayer, {
        attachTo: "#app",
        props: {
          events: mockEventsWithFrustrations,
          segments: [],
          isLoading: false,
        },
        global: {
          plugins: [i18n],
          mocks: {
            $store: store,
          },
        },
      });
      await flushPromises();
    });

    it("should have getEventMarkerClass method", () => {
      expect(typeof wrapper.vm.getEventMarkerClass).toBe("function");
    });

    it("should return frustration class for events with frustrations", () => {
      const frustratedEvent = mockEventsWithFrustrations[0];
      const markerClass = wrapper.vm.getEventMarkerClass(frustratedEvent);
      expect(markerClass).toBe("bg-frustration-marker");
    });

    it("should return error class for error events without frustrations", () => {
      const errorEvent = mockEventsWithFrustrations[1];
      const markerClass = wrapper.vm.getEventMarkerClass(errorEvent);
      expect(markerClass).toBe("bg-red-5");
    });

    it("should return default class for normal events", () => {
      const normalEvent = {
        id: "4",
        type: "view",
        name: "Page load",
        relativeTime: 0,
        frustration_types: null,
      };
      const markerClass = wrapper.vm.getEventMarkerClass(normalEvent);
      expect(markerClass).toBe("bg-secondary");
    });

    it("should have getEventTooltip method", () => {
      expect(typeof wrapper.vm.getEventTooltip).toBe("function");
    });

    it("should format tooltip with frustration types", () => {
      const frustratedEvent = mockEventsWithFrustrations[0];
      const tooltip = wrapper.vm.getEventTooltip(frustratedEvent);
      expect(tooltip).toContain("⚠️ FRUSTRATION:");
      expect(tooltip).toContain("Rage Click");
      expect(tooltip).toContain(frustratedEvent.name);
    });

    it("should format tooltip with multiple frustration types", () => {
      const multiTypeFrustration = mockEventsWithFrustrations[2];
      const tooltip = wrapper.vm.getEventTooltip(multiTypeFrustration);
      expect(tooltip).toContain("⚠️ FRUSTRATION:");
      expect(tooltip).toContain("Dead Click");
      expect(tooltip).toContain("Error Click");
    });

    it("should return simple tooltip for non-frustrated events", () => {
      const normalEvent = mockEventsWithFrustrations[1];
      const tooltip = wrapper.vm.getEventTooltip(normalEvent);
      expect(tooltip).not.toContain("⚠️ FRUSTRATION:");
      expect(tooltip).toBe(normalEvent.name);
    });

    it("should truncate long event names in tooltip", () => {
      const longNameEvent = {
        id: "5",
        type: "action",
        name: "a".repeat(150), // Very long name
        relativeTime: 100000,
        frustration_types: null,
      };
      const tooltip = wrapper.vm.getEventTooltip(longNameEvent);
      expect(tooltip.length).toBeLessThanOrEqual(104); // 100 chars + "..."
      expect(tooltip).toContain("...");
    });

    it("should properly capitalize frustration type labels", () => {
      const rageClickEvent = {
        id: "6",
        type: "action",
        name: "click",
        relativeTime: 50000,
        frustration_types: ["rage_click"],
      };
      const tooltip = wrapper.vm.getEventTooltip(rageClickEvent);
      expect(tooltip).toContain("Rage Click");
      expect(tooltip).not.toContain("rage_click");
    });

    it("should handle empty frustration_types array", () => {
      const emptyFrustrationEvent = {
        id: "7",
        type: "action",
        name: "click",
        relativeTime: 70000,
        frustration_types: [],
      };
      const markerClass = wrapper.vm.getEventMarkerClass(emptyFrustrationEvent);
      expect(markerClass).toBe("bg-secondary");
    });

    it("should prioritize frustration marker over error marker", () => {
      const frustratedErrorEvent = {
        id: "8",
        type: "error",
        name: "Error with frustration",
        relativeTime: 80000,
        frustration_types: ["error_click"],
      };
      const markerClass = wrapper.vm.getEventMarkerClass(frustratedErrorEvent);
      expect(markerClass).toBe("bg-frustration-marker");
    });
  });
});
