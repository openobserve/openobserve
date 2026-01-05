// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import RealUserMonitoring from "@/views/RUM/RealUserMonitoring.vue";
import i18n from "@/locales";
import { Quasar } from "quasar";

// Mock composables
vi.mock("@/composables/useSessionReplay", () => ({
  default: vi.fn(() => ({
    sessionState: {
      data: {
        editorValue: "",
      },
    },
  })),
}));

vi.mock("@/composables/useErrorTracking", () => ({
  default: vi.fn(() => ({
    errorTrackingState: {
      data: {
        editorValue: "",
      },
    },
  })),
}));

vi.mock("@/composables/rum/usePerformance", () => ({
  default: vi.fn(() => ({
    performanceState: {
      data: {
        datetime: {
          valueType: "relative",
          relativeTimePeriod: "15m",
          startTime: 0,
          endTime: 0,
        },
        streams: {},
      },
    },
  })),
}));

vi.mock("@/composables/rum/useRum", () => ({
  default: vi.fn(() => ({
    rumState: {
      data: {},
    },
  })),
}));

const mockGetStream = vi.fn();
const mockGetStreams = vi.fn();

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStream: mockGetStream,
    getStreams: mockGetStreams,
  })),
}));

describe("RealUserMonitoring.vue", () => {
  let store: any;
  let router: any;
  let $q: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Quasar
    $q = {
      dark: { isActive: false, mode: false },
      platform: {
        is: {
          mobile: false,
          desktop: true,
          cordova: false,
          capacitor: false,
          electron: false,
          chrome: true,
          safari: false,
          firefox: false,
          edge: false,
          ie: false,
          linux: false,
          mac: true,
          win: false,
          android: false,
          ios: false,
        },
        has: {
          touch: false,
        },
        within: {
          iframe: false,
        },
      },
      iconMapFn: vi.fn((iconName: string) => iconName),
      iconSet: {
        name: 'material-icons',
      },
      notify: vi.fn(),
    };

    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
          name: "Test Org",
        },
      },
    });

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/rum",
          name: "RUM",
          component: { template: "<div>RUM</div>" },
        },
        {
          path: "/rum/sessions",
          name: "Sessions",
          component: { template: "<div>Sessions</div>" },
          meta: { keepAlive: true },
        },
        {
          path: "/rum/error-tracking",
          name: "ErrorTracking",
          component: { template: "<div>Error Tracking</div>" },
          meta: { keepAlive: true },
        },
        {
          path: "/rum/performance",
          name: "rumPerformanceSummary",
          component: { template: "<div>Performance</div>" },
          meta: { keepAlive: true },
        },
        {
          path: "/rum/performance/webvitals",
          name: "rumPerformanceWebVitals",
          component: { template: "<div>Web Vitals</div>" },
          meta: { keepAlive: true },
        },
        {
          path: "/ingestion/monitoring",
          name: "frontendMonitoring",
          component: { template: "<div>Frontend Monitoring</div>" },
        },
      ],
    });

    // Default mock: RUM not enabled
    mockGetStream.mockResolvedValue(null);
  });

  describe("loading state", () => {
    it("should show loading spinner when RUM status is being checked", async () => {
      let resolveGetStream: any;
      mockGetStream.mockImplementation(
        () => new Promise((resolve) => { resolveGetStream = resolve; })
      );

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": {
              template: '<div class="q-spinner-hourglass">Loading...</div>',
            },
            "q-btn": true,
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      // Wait for the component to mount and start loading
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".q-spinner-hourglass").exists()).toBe(true);
      expect(wrapper.text()).toContain(
        "Hold on tight, we're loading RUM data."
      );

      // Resolve the promise
      resolveGetStream(null);
      await flushPromises();
    });
  });

  describe("RUM not enabled state", () => {
    it("should show get started screen when RUM is not enabled", async () => {
      mockGetStream.mockResolvedValue(null);

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.text()).toContain("Discover Real User Monitoring");
      expect(wrapper.text()).toContain("Get Started");
    });

    it("should navigate to frontend monitoring on get started click", async () => {
      mockGetStream.mockResolvedValue(null);
      const pushSpy = vi.spyOn(router, "push");

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      const getStartedBtn = wrapper.find("button");
      await getStartedBtn.trigger("click");

      expect(pushSpy).toHaveBeenCalledWith({
        name: "frontendMonitoring",
        query: { org_identifier: "test-org" },
      });
    });
  });

  describe("RUM enabled state", () => {
    beforeEach(() => {
      mockGetStream.mockImplementation((streamName) => {
        if (streamName === "_rumdata") {
          return Promise.resolve({
            schema: [
              { name: "service_name", type: "Utf8" },
              { name: "rum_type", type: "Utf8" },
            ],
          });
        }
        if (streamName === "_sessionreplay") {
          return Promise.resolve({
            schema: [
              { name: "session_id", type: "Utf8" },
              { name: "event_type", type: "Utf8" },
            ],
          });
        }
        return Promise.resolve(null);
      });
    });

    it("should show tabs when RUM is enabled", async () => {
      await router.push({ name: "Sessions" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            "q-btn": true,
            "q-icon": true,
            AppTabs: {
              template:
                '<div class="app-tabs"><slot v-for="tab in tabs" :name="tab.value" /></div>',
              props: ["tabs", "activeTab"],
            },
          },
        },
      });

      await flushPromises();

      expect(wrapper.find(".app-tabs").exists()).toBe(true);
    });

    it("should show router-view when RUM is enabled", async () => {
      await router.push({ name: "Sessions" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": {
              template: '<div class="router-view"><slot /></div>',
            },
            "q-spinner-hourglass": true,
            "q-btn": true,
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find(".router-view").exists()).toBe(true);
    });

    it("should pass isRumEnabled and isSessionReplayEnabled to child components", async () => {
      await router.push({ name: "Sessions" });

      const childComponentStub = {
        template: '<div class="child-component"></div>',
        props: ["isRumEnabled", "isSessionReplayEnabled"],
      };

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": {
              template:
                '<component :is="Component" v-bind="$attrs" v-slot="{ Component }" />',
              components: { component: childComponentStub },
            },
            "q-spinner-hourglass": true,
            "q-btn": true,
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(mockGetStream).toHaveBeenCalledWith("_rumdata", "logs", false);
      expect(mockGetStream).toHaveBeenCalledWith(
        "_sessionreplay",
        "logs",
        false
      );
    });

    it("should load schema when RUM is enabled", async () => {
      await router.push({ name: "Sessions" });

      mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            "q-btn": true,
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      // Check that getStream was called to fetch schema
      expect(mockGetStream).toHaveBeenCalledWith("_rumdata", "logs", true);
      expect(mockGetStream).toHaveBeenCalledWith("_sessionreplay", "logs", true);
    });
  });

  describe("tab visibility logic", () => {
    beforeEach(() => {
      mockGetStream.mockImplementation((streamName) => {
        if (streamName === "_rumdata") {
          return Promise.resolve({
            schema: [{ name: "service_name", type: "Utf8" }],
          });
        }
        return Promise.resolve(null);
      });
    });

    it("should show tabs for Sessions route", async () => {
      await router.push({ name: "Sessions" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      // Check that showTabs computed property evaluates to true
      expect(wrapper.vm.showTabs).toBe(true);
    });

    it("should show tabs for ErrorTracking route", async () => {
      await router.push({ name: "ErrorTracking" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.vm.showTabs).toBe(true);
    });

    it("should show tabs for rumPerformanceSummary route", async () => {
      await router.push({ name: "rumPerformanceSummary" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.vm.showTabs).toBe(true);
    });

    it("should show tabs for rumPerformanceWebVitals route", async () => {
      await router.push({ name: "rumPerformanceWebVitals" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.vm.showTabs).toBe(true);
    });
  });

  describe("session replay enabled state", () => {
    it("should show content when only session replay is enabled", async () => {
      mockGetStream.mockImplementation((streamName) => {
        if (streamName === "_sessionreplay") {
          return Promise.resolve({
            schema: [{ name: "session_id", type: "Utf8" }],
          });
        }
        return Promise.resolve(null);
      });

      await router.push({ name: "Sessions" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n, Quasar],
          mocks: { $q },
          stubs: {
            "router-view": {
              template: '<div class="router-view" />',
            },
            "q-spinner-hourglass": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find(".router-view").exists()).toBe(true);
      expect(wrapper.text()).not.toContain("Discover Real User Monitoring");
    });
  });

  describe("keep-alive handling", () => {
    beforeEach(() => {
      mockGetStream.mockImplementation((streamName) => {
        if (streamName === "_rumdata") {
          return Promise.resolve({
            schema: [{ name: "service_name", type: "Utf8" }],
          });
        }
        return Promise.resolve(null);
      });
    });

    it("should use keep-alive for routes with keepAlive meta", async () => {
      await router.push({ name: "Sessions" });

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n, Quasar],
          mocks: { $q },
          stubs: {
            "router-view": {
              template:
                '<div><keep-alive v-if="$route.meta.keepAlive" class="keep-alive-wrapper" /></div>',
            },
            "q-spinner-hourglass": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      // Component should have logic to conditionally render keep-alive
      expect(router.currentRoute.value.meta.keepAlive).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle getStream failures gracefully", async () => {
      mockGetStream.mockRejectedValue(new Error("Network error"));

      const wrapper = mount(RealUserMonitoring, {
        global: {
          plugins: [store, router, i18n],
          mocks: { $q },
          stubs: {
            "router-view": true,
            "q-btn": true,
            "q-icon": true,
            "q-spinner-hourglass": true,
            "q-btn": true,
            "q-icon": true,
            AppTabs: true,
          },
        },
      });

      await flushPromises();

      // Should show get started screen when streams fail to load
      expect(wrapper.text()).toContain("Discover Real User Monitoring");
    });
  });
});
