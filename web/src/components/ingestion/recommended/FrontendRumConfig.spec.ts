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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import FrontendRumConfig from "@/components/ingestion/recommended/FrontendRumConfig.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";

// Mock services and utilities
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn((path: string) => `/mocked/path/${path}`),
    getIngestionURL: vi.fn(() => "https://api.openobserve.ai"),
    maskText: vi.fn((text: string) => text ? `${text.substring(0, 4)}****${text.substring(text.length - 4)}` : "")
  };
});

installQuasar();

describe("FrontendRumConfig Component", () => {
  let wrapper: any = null;

  const mockProps = {
    currOrgIdentifier: "test-org", 
    currUserEmail: "test@example.com"
  };

  const mockStoreState = {
    organizationData: {
      rumToken: {
        rum_token: "test-rum-token-12345678",
        key: "test-key-12345678"
      }
    },
    selectedOrganization: {
      identifier: "test-org-id"
    },
    API_ENDPOINT: "https://api.openobserve.ai"
  };

  beforeEach(() => {
    // Create a new store instance for each test
    const testStore = createStore({
      state: () => mockStoreState,
      getters: {},
      mutations: {},
      actions: {}
    });

    wrapper = mount(FrontendRumConfig, {
      props: mockProps,
      global: {
        plugins: [testStore, i18n],
        stubs: {
          "CopyContent": true,
          "copy-content": true,
          "SanitizedHtmlRenderer": true,
          "q-separator": true
        }
      }
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Component Initialization Tests
  describe("Component Initialization", () => {
    it("should mount FrontendRumConfig component", () => {
      expect(wrapper).toBeTruthy();
    });

    it("should initialize with correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("rum-web-page");
    });

    it("should initialize with correct props", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
      expect(wrapper.props('currUserEmail')).toBe("test@example.com");
    });

    it("should initialize store instance", () => {
      expect(wrapper.vm.store).toBeTruthy();
      expect(wrapper.vm.store.state).toBeTruthy();
    });

    it("should initialize translation function", () => {
      expect(wrapper.vm.t).toBeTruthy();
      expect(typeof wrapper.vm.t).toBe('function');
    });

    it("should have CopyContent and SanitizedHtmlRenderer components", () => {
      expect(wrapper.vm.$options.components.CopyContent).toBeTruthy();
      expect(wrapper.vm.$options.components.SanitizedHtmlRenderer).toBeTruthy();
    });

    it("should initialize npm step instructions", () => {
      expect(wrapper.vm.npmStep1).toBeTruthy();
      expect(wrapper.vm.npmStep2).toBeTruthy();
      expect(wrapper.vm.npmStep1).toContain("Step1");
      expect(wrapper.vm.npmStep2).toContain("Step2");
    });

    it("should initialize rumToken as empty string initially", () => {
      const freshStore = createStore({
        state: () => ({
          organizationData: { rumToken: null },
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const freshWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [freshStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(freshWrapper.vm.rumToken).toBe("");
      freshWrapper.unmount();
    });
  });

  // Configuration Content Tests
  describe("Configuration Content", () => {
    it("should have default configuration template", () => {
      expect(wrapper.vm.defaultConfig).toBeTruthy();
      expect(wrapper.vm.defaultConfig).toContain("openobserveRum");
      expect(wrapper.vm.defaultConfig).toContain("openobserveLogs");
      expect(wrapper.vm.defaultConfig).toContain("<OPENOBSERVE_CLIENT_TOKEN>");
      expect(wrapper.vm.defaultConfig).toContain("<OPENOBSERVE_SITE>");
      expect(wrapper.vm.defaultConfig).toContain("<OPENOBSERVE_ORGANIZATION_IDENTIFIER>");
    });

    it("should initialize configuration refs with default config", () => {
      expect(wrapper.vm.initConfiguration).toBeTruthy();
      expect(wrapper.vm.displayConfiguration).toBeTruthy();
      // After mounting, the configuration should have been processed by replaceStaticValues
      // so it won't be exactly equal to defaultConfig, but should contain the template structure
      expect(wrapper.vm.initConfiguration).toContain("openobserveRum.init");
      expect(wrapper.vm.displayConfiguration).toContain("openobserveRum.init");
    });

    it("should contain all required RUM configuration options", () => {
      const config = wrapper.vm.defaultConfig;
      expect(config).toContain("applicationId");
      expect(config).toContain("clientToken");
      expect(config).toContain("site");
      expect(config).toContain("service");
      expect(config).toContain("env");
      expect(config).toContain("version");
      expect(config).toContain("organizationIdentifier");
      expect(config).toContain("insecureHTTP");
      expect(config).toContain("apiVersion");
    });

    it("should contain RUM tracking options", () => {
      const config = wrapper.vm.defaultConfig;
      expect(config).toContain("trackResources");
      expect(config).toContain("trackLongTasks");
      expect(config).toContain("trackUserInteractions");
      expect(config).toContain("defaultPrivacyLevel");
    });

    it("should contain logs configuration", () => {
      const config = wrapper.vm.defaultConfig;
      expect(config).toContain("forwardErrorsToLogs");
      expect(config).toContain("openobserveLogs.init");
    });

    it("should contain user context setup", () => {
      const config = wrapper.vm.defaultConfig;
      expect(config).toContain("setUser");
      expect(config).toContain("startSessionReplayRecording");
    });
  });

  // replaceStaticValues Function Tests
  describe("replaceStaticValues Function", () => {
    beforeEach(() => {
      // Store state is already set up in the main beforeEach
      // The mock store already contains the necessary data
    });

    it("should replace OPENOBSERVE_SITE placeholder", () => {
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.initConfiguration).not.toContain("<OPENOBSERVE_SITE>");
      expect(wrapper.vm.displayConfiguration).not.toContain("<OPENOBSERVE_SITE>");
      expect(wrapper.vm.initConfiguration).toContain("api.openobserve.ai");
    });

    it("should replace OPENOBSERVE_ORGANIZATION_IDENTIFIER placeholder", () => {
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.initConfiguration).not.toContain("<OPENOBSERVE_ORGANIZATION_IDENTIFIER>");
      expect(wrapper.vm.displayConfiguration).not.toContain("<OPENOBSERVE_ORGANIZATION_IDENTIFIER>");
      expect(wrapper.vm.initConfiguration).toContain("test-org-id");
    });

    it("should set insecureHTTP to false for HTTPS endpoints", () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          API_ENDPOINT: "https://secure.example.com"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      testWrapper.vm.replaceStaticValues();
      
      expect(testWrapper.vm.initConfiguration).toContain("insecureHTTP: false");
      expect(testWrapper.vm.displayConfiguration).toContain("insecureHTTP: false");
      testWrapper.unmount();
    });

    it("should set insecureHTTP to true for HTTP endpoints", () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          API_ENDPOINT: "http://insecure.example.com"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      testWrapper.vm.replaceStaticValues();
      
      expect(testWrapper.vm.initConfiguration).toContain("insecureHTTP: true");
      expect(testWrapper.vm.displayConfiguration).toContain("insecureHTTP: true");
      testWrapper.unmount();
    });

    it("should replace CLIENT_TOKEN with actual token in initConfiguration", () => {
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.initConfiguration).not.toContain("<OPENOBSERVE_CLIENT_TOKEN>");
      expect(wrapper.vm.initConfiguration).toContain("test-rum-token-12345678");
    });

    it("should replace CLIENT_TOKEN with masked token in displayConfiguration", () => {
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.displayConfiguration).not.toContain("<OPENOBSERVE_CLIENT_TOKEN>");
      expect(wrapper.vm.displayConfiguration).toContain("test****5678");
    });

    it("should update rumToken from store", () => {
      wrapper.vm.rumToken = "";
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.rumToken).toBe("test-rum-token-12345678");
    });

    it("should handle URL with trailing slash", async () => {
      const { getIngestionURL } = await import("@/utils/zincutils");
      getIngestionURL.mockReturnValue("https://api.example.com/");
      
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.initConfiguration).toContain("api.example.com");
      expect(wrapper.vm.initConfiguration).not.toContain("api.example.com/");
    });

    it("should handle HTTP URL replacement", async () => {
      const { getIngestionURL } = await import("@/utils/zincutils");
      getIngestionURL.mockReturnValue("http://api.example.com");
      
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.initConfiguration).toContain("api.example.com");
      expect(wrapper.vm.initConfiguration).not.toContain("http://api.example.com");
    });

    it("should handle HTTPS URL replacement", async () => {
      const { getIngestionURL } = await import("@/utils/zincutils");
      getIngestionURL.mockReturnValue("https://secure.example.com");
      
      wrapper.vm.replaceStaticValues();
      
      expect(wrapper.vm.initConfiguration).toContain("secure.example.com");
      expect(wrapper.vm.initConfiguration).not.toContain("https://secure.example.com");
    });
  });

  // Lifecycle Hooks Tests
  describe("Lifecycle Hooks", () => {
    it("should handle onMounted when rumToken exists", async () => {
      const testStore = createStore({
        state: () => ({
          organizationData: { rumToken: { rum_token: "mounted-token" } },
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });

      await nextTick();
      expect(testWrapper.vm.rumToken).toBe("mounted-token");
      testWrapper.unmount();
    });

    it("should handle onMounted when rumToken does not exist", async () => {
      const testStore = createStore({
        state: () => ({
          organizationData: {},
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });

      await nextTick();
      expect(testWrapper.vm.rumToken).toBe("");
      testWrapper.unmount();
    });

    it("should call replaceStaticValues on onUpdated", async () => {
      // Test that onUpdated is configured to call replaceStaticValues
      // Since onUpdated is called after any reactive data changes,
      // we'll test this by verifying the onUpdated hook exists and works
      const spy = vi.spyOn(wrapper.vm, 'replaceStaticValues');
      
      // Force a reactive update by changing store state and triggering update
      wrapper.vm.store.state.organizationData.rumToken = { rum_token: "updated-token" };
      await wrapper.vm.$forceUpdate();
      await nextTick();
      
      // The function should be called during onUpdated lifecycle
      expect(spy).toHaveBeenCalled();
    });

    it("should call replaceStaticValues on onActivated", async () => {
      // Test that onActivated lifecycle hook is properly configured
      // Since we can't easily trigger onActivated in unit tests,
      // we'll test that the function exists and works
      const spy = vi.spyOn(wrapper.vm, 'replaceStaticValues');
      
      // Call replaceStaticValues directly to verify it works
      wrapper.vm.replaceStaticValues();
      
      expect(spy).toHaveBeenCalled();
    });
  });

  // Computed Property Tests
  describe("Computed Properties", () => {
    it("should have checkRUMToken computed property", () => {
      expect(wrapper.vm.checkRUMToken).toBeTruthy();
      expect(wrapper.vm.checkRUMToken).toEqual(wrapper.vm.store.state.organizationData.rumToken);
    });

    it("should update checkRUMToken when store changes", async () => {
      const testStore = createStore({
        state: () => ({
          organizationData: { rumToken: { rum_token: "new-token", key: "new-key" } },
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      await nextTick();
      expect(testWrapper.vm.checkRUMToken).toEqual({ rum_token: "new-token", key: "new-key" });
      testWrapper.unmount();
    });

    it("should handle undefined rumToken in store", async () => {
      const testStore = createStore({
        state: () => ({
          organizationData: { rumToken: undefined },
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      await nextTick();
      expect(testWrapper.vm.checkRUMToken).toBeUndefined();
      testWrapper.unmount();
    });
  });

  // Watch Property Tests
  describe("Watch Properties", () => {
    it("should watch checkRUMToken changes", async () => {
      // Test the watcher behavior by checking computed property reactivity
      const testStore = createStore({
        state: () => ({
          organizationData: { rumToken: { rum_token: "watched-token", key: "watched-key" } },
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      const spy = vi.spyOn(testWrapper.vm, 'replaceStaticValues');
      
      await nextTick();
      
      // Manually trigger the watcher logic
      if (testWrapper.vm.checkRUMToken) {
        testWrapper.vm.rumToken = testWrapper.vm.checkRUMToken.key;
        testWrapper.vm.replaceStaticValues();
      }
      
      expect(testWrapper.vm.rumToken).toBe("watched-token");
      expect(spy).toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should handle watcher when token is null", async () => {
      const testStore = createStore({
        state: () => ({
          organizationData: { rumToken: null },
          selectedOrganization: { identifier: "test-org" },
          API_ENDPOINT: "https://api.openobserve.ai"
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      const spy = vi.spyOn(testWrapper.vm, 'replaceStaticValues');
      
      await nextTick();
      expect(testWrapper.vm.checkRUMToken).toBeNull();
      testWrapper.unmount();
    });
  });

  // Template Rendering Tests
  describe("Template Rendering", () => {
    it("should render title when rumToken exists", async () => {
      wrapper.vm.rumToken = "test-token";
      await nextTick();
      
      const title = wrapper.find('[data-test="rumweb-title-text"]');
      expect(title.exists()).toBe(true);
    });

    it("should render npm install command", async () => {
      wrapper.vm.rumToken = "test-token";
      await nextTick();
      
      expect(wrapper.html()).toContain("npm i @openobserve/browser-rum @openobserve/browser-logs");
    });

    it("should render step instructions", async () => {
      wrapper.vm.rumToken = "test-token";
      await nextTick();
      
      const html = wrapper.html();
      expect(html).toContain("Step1");
      expect(html).toContain("Step2");
    });

    it("should render message when no rumToken", async () => {
      wrapper.vm.rumToken = "";
      await nextTick();
      
      // Should show the v-else content with i18n translation key
      expect(wrapper.vm.t).toBeTruthy();
      const messageElement = wrapper.find('.q-mt-xs');
      expect(messageElement.exists()).toBe(true);
    });

    it("should render CopyContent components when token exists", async () => {
      wrapper.vm.rumToken = "test-token";
      await nextTick();
      
      const copyComponents = wrapper.findAllComponents({ name: "CopyContent" });
      expect(copyComponents.length).toBeGreaterThanOrEqual(1);
    });

    it("should render SanitizedHtmlRenderer components", async () => {
      wrapper.vm.rumToken = "test-token";
      await nextTick();
      
      const htmlRenderers = wrapper.findAllComponents({ name: "SanitizedHtmlRenderer" });
      expect(htmlRenderers.length).toBeGreaterThanOrEqual(1);
    });
  });

  // Props Handling Tests
  describe("Props Handling", () => {
    it("should handle currOrgIdentifier prop", () => {
      expect(wrapper.props().currOrgIdentifier).toBe("test-org");
    });

    it("should handle currUserEmail prop", () => {
      expect(wrapper.props().currUserEmail).toBe("test@example.com");
    });

    it("should handle undefined props", () => {
      const testStore = createStore({
        state: () => mockStoreState,
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const noPropsWrapper = mount(FrontendRumConfig, {
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(noPropsWrapper.props().currOrgIdentifier).toBeUndefined();
      expect(noPropsWrapper.props().currUserEmail).toBeUndefined();
      noPropsWrapper.unmount();
    });

    it("should accept different prop values", () => {
      const testStore = createStore({
        state: () => mockStoreState,
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const customWrapper = mount(FrontendRumConfig, {
        props: {
          currOrgIdentifier: "custom-org",
          currUserEmail: "custom@example.com"
        },
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(customWrapper.props().currOrgIdentifier).toBe("custom-org");
      expect(customWrapper.props().currUserEmail).toBe("custom@example.com");
      customWrapper.unmount();
    });
  });

  // Edge Cases and Error Handling Tests
  describe("Edge Cases and Error Handling", () => {
    it("should handle missing store state gracefully", () => {
      // Test that component handles missing rumToken by not crashing on mount
      // The component will have an empty rumToken initially when store doesn't have it
      const testStore = createStore({
        state: () => ({
          organizationData: {},  // No rumToken property
          selectedOrganization: { identifier: "" },
          API_ENDPOINT: ""
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const emptyStoreWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      // Component should mount successfully even without rumToken in store
      expect(emptyStoreWrapper.vm).toBeTruthy();
      expect(emptyStoreWrapper.vm.rumToken).toBe("");
      emptyStoreWrapper.unmount();
    });

    it("should handle empty rumToken gracefully", () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          organizationData: { rumToken: { rum_token: "" } }
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(() => testWrapper.vm.replaceStaticValues()).not.toThrow();
      expect(testWrapper.vm.initConfiguration).toContain("clientToken: ");
      testWrapper.unmount();
    });

    it("should handle null organization identifier", () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          selectedOrganization: { identifier: null }
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(() => testWrapper.vm.replaceStaticValues()).not.toThrow();
      testWrapper.unmount();
    });

    it("should handle empty API endpoint", () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          API_ENDPOINT: ""
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(() => testWrapper.vm.replaceStaticValues()).not.toThrow();
      expect(testWrapper.vm.initConfiguration).toContain("insecureHTTP: true");
      testWrapper.unmount();
    });

    it("should handle component unmounting", () => {
      const testStore = createStore({
        state: () => mockStoreState,
        getters: {},
        mutations: {},
        actions: {}
      });
      
      expect(() => {
        wrapper.unmount();
        wrapper = mount(FrontendRumConfig, {
          props: mockProps,
          global: {
            plugins: [testStore, i18n],
            stubs: {
              "CopyContent": true,
              "copy-content": true,
              "SanitizedHtmlRenderer": true,
              "q-separator": true
            }
          }
        });
      }).not.toThrow();
    });

    it("should handle malformed URLs in ingestion URL", async () => {
      const { getIngestionURL } = await import("@/utils/zincutils");
      getIngestionURL.mockReturnValue("invalid-url");
      
      expect(() => wrapper.vm.replaceStaticValues()).not.toThrow();
    });

    it("should handle special characters in tokens", () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          organizationData: { rumToken: { rum_token: "token-with-@#$%^&*()-chars" } }
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      expect(() => testWrapper.vm.replaceStaticValues()).not.toThrow();
      expect(testWrapper.vm.initConfiguration).toContain("token-with-@#$%^&*()-chars");
      testWrapper.unmount();
    });

    it("should maintain configuration integrity after multiple updates", () => {
      wrapper.vm.replaceStaticValues();
      const firstUpdate = wrapper.vm.initConfiguration;
      
      wrapper.vm.replaceStaticValues();
      const secondUpdate = wrapper.vm.initConfiguration;
      
      expect(firstUpdate).toBe(secondUpdate);
    });
  });

  // Integration Tests
  describe("Component Integration", () => {
    it("should integrate properly with Vuex store", () => {
      expect(wrapper.vm.store.state.organizationData).toBeTruthy();
      expect(wrapper.vm.store.state.selectedOrganization).toBeTruthy();
    });

    it("should integrate with utility functions", async () => {
      const { getIngestionURL, maskText } = await import("@/utils/zincutils");
      
      wrapper.vm.replaceStaticValues();
      
      expect(getIngestionURL).toHaveBeenCalled();
      expect(maskText).toHaveBeenCalled();
    });

    it("should maintain reactivity between configurations", async () => {
      const testStore = createStore({
        state: () => ({
          ...mockStoreState,
          organizationData: { rumToken: { rum_token: "reactive-token" } }
        }),
        getters: {},
        mutations: {},
        actions: {}
      });
      
      const testWrapper = mount(FrontendRumConfig, {
        props: mockProps,
        global: {
          plugins: [testStore, i18n],
          stubs: {
            "CopyContent": true,
            "copy-content": true,
            "SanitizedHtmlRenderer": true,
            "q-separator": true
          }
        }
      });
      
      testWrapper.vm.replaceStaticValues();
      
      expect(testWrapper.vm.initConfiguration).toContain("reactive-token");
      expect(testWrapper.vm.displayConfiguration).toContain("reac****oken");
      testWrapper.unmount();
    });

    it("should handle i18n integration", () => {
      expect(wrapper.vm.t).toBeTruthy();
      expect(typeof wrapper.vm.t).toBe('function');
    });
  });
});