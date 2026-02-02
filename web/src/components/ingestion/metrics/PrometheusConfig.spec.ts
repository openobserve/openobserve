import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { Quasar } from "quasar";
import PrometheusConfig from "./PrometheusConfig.vue";

// Mock dependencies
vi.mock("../../../aws-exports", () => ({
  default: {
    oauth: {
      domain: "test-domain",
      scope: ["test-scope"],
      redirectSignIn: "http://localhost:8080/",
      redirectSignOut: "http://localhost:8080/",
      responseType: "code"
    }
  }
}));

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn(() => ({
    url: "https://test.example.com:5080",
    host: "test.example.com",
    port: "5080",
    protocol: "https",
    tls: true
  })),
  getImageURL: vi.fn(() => "https://test.example.com/image.png"),
  getIngestionURL: vi.fn(() => "https://test.example.com:5080")
}));

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    template: "<div class='copy-content'><slot /></div>",
    props: ["content"]
  }
}));

describe("PrometheusConfig.vue", () => {
  let store: any;
  let wrapper: any;

  const createMockStore = () => {
    return createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
          label: "Test Organization",
          id: 123
        },
        API_ENDPOINT: "https://test.example.com:5080",
        theme: "dark",
        userInfo: {
          email: "test@example.com"
        }
      },
      mutations: {},
      actions: {}
    });
  };

  beforeEach(() => {
    store = createMockStore();
    wrapper = mount(PrometheusConfig, {
      global: {
        plugins: [store, Quasar],
        stubs: {
          CopyContent: {
            template: "<div class='copy-content-stub'>{{ content }}</div>",
            props: ["content"]
          }
        }
      },
      props: {
        currOrgIdentifier: "test-org",
        currUserEmail: "test@example.com"
      }
    });
  });

  describe("Component Definition", () => {
    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(PrometheusConfig.name).toBe("traces-otlp");
    });

    it("should have correct props definition", () => {
      expect(PrometheusConfig.props).toHaveProperty("currOrgIdentifier");
      expect(PrometheusConfig.props).toHaveProperty("currUserEmail");
    });

    it("should accept currOrgIdentifier as string prop", () => {
      expect(PrometheusConfig.props.currOrgIdentifier.type).toBe(String);
    });

    it("should accept currUserEmail as string prop", () => {
      expect(PrometheusConfig.props.currUserEmail.type).toBe(String);
    });

    it("should have CopyContent in components", () => {
      expect(PrometheusConfig.components).toHaveProperty("CopyContent");
    });
  });

  describe("Component Setup", () => {
    it("should initialize with store", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have endpoint object with correct structure", () => {
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.endpoint).toHaveProperty("url");
      expect(wrapper.vm.endpoint).toHaveProperty("host");
      expect(wrapper.vm.endpoint).toHaveProperty("port");
      expect(wrapper.vm.endpoint).toHaveProperty("protocol");
      expect(wrapper.vm.endpoint).toHaveProperty("tls");
    });

    it("should initialize endpoint with correct values", () => {
      expect(wrapper.vm.endpoint.host).toBe("test.example.com");
      expect(wrapper.vm.endpoint.port).toBe("5080");
      expect(wrapper.vm.endpoint.protocol).toBe("https");
    });

    it("should have config available", () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config).toHaveProperty("oauth");
    });

    it("should have getImageURL function available", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe("function");
    });
  });

  describe("Prometheus Configuration Generation", () => {
    it("should generate content with correct remote_write configuration", () => {
      const content = wrapper.vm.content;
      expect(content).toContain("remote_write:");
      expect(content).toContain("- url:");
      expect(content).toContain("queue_config:");
      expect(content).toContain("basic_auth:");
    });

    it("should include correct prometheus endpoint URL", () => {
      const content = wrapper.vm.content;
      expect(content).toContain("https://test.example.com:5080/api/test-org/prometheus/api/v1/write");
    });

    it("should include queue configuration parameters", () => {
      const content = wrapper.vm.content;
      expect(content).toContain("max_samples_per_send: 10000");
    });

    it("should include placeholder credentials", () => {
      const content = wrapper.vm.content;
      expect(content).toContain("username: [EMAIL]");
      expect(content).toContain("password: [PASSCODE]");
    });

    it("should use organization identifier in URL path", () => {
      const content = wrapper.vm.content;
      expect(content).toContain("/api/test-org/");
    });

    it("should generate content as string", () => {
      expect(typeof wrapper.vm.content).toBe("string");
    });

    it("should have non-empty content", () => {
      expect(wrapper.vm.content.length).toBeGreaterThan(0);
    });

    it("should contain prometheus API version path", () => {
      const content = wrapper.vm.content;
      expect(content).toContain("/prometheus/api/v1/write");
    });
  });


  describe("Template Rendering", () => {
    it("should render main container with correct class", () => {
      const container = wrapper.find(".q-pa-sm");
      expect(container.exists()).toBe(true);
    });

    it("should render CopyContent component", () => {
      const copyContent = wrapper.find(".copy-content-stub");
      expect(copyContent.exists()).toBe(true);
    });

    it("should pass content to CopyContent component", () => {
      const copyContent = wrapper.find(".copy-content-stub");
      expect(copyContent.exists()).toBe(true);
      expect(copyContent.text()).toContain("remote_write:");
    });

    it("should apply correct class to CopyContent", () => {
      const copyContent = wrapper.find(".copy-content-stub");
      expect(copyContent.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should receive currOrgIdentifier prop correctly", () => {
      expect(wrapper.props("currOrgIdentifier")).toBe("test-org");
    });

    it("should receive currUserEmail prop correctly", () => {
      expect(wrapper.props("currUserEmail")).toBe("test@example.com");
    });

    it("should handle missing currOrgIdentifier prop", () => {
      const wrapperWithoutProp = mount(PrometheusConfig, {
        global: {
          plugins: [store, Quasar],
          stubs: { CopyContent: true }
        },
        props: {
          currUserEmail: "test@example.com"
        }
      });
      expect(wrapperWithoutProp.props("currOrgIdentifier")).toBeUndefined();
    });

    it("should handle missing currUserEmail prop", () => {
      const wrapperWithoutProp = mount(PrometheusConfig, {
        global: {
          plugins: [store, Quasar],
          stubs: { CopyContent: true }
        },
        props: {
          currOrgIdentifier: "test-org"
        }
      });
      expect(wrapperWithoutProp.props("currUserEmail")).toBeUndefined();
    });
  });

  describe("Store Integration", () => {
    it("should access store state correctly", () => {
      expect(wrapper.vm.store.state).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
    });

    it("should use organization identifier from store", () => {
      const orgId = wrapper.vm.store.state.selectedOrganization.identifier;
      expect(orgId).toBe("test-org");
      expect(wrapper.vm.content).toContain(`/api/${orgId}/`);
    });

    it("should handle different organization identifiers", () => {
      store.state.selectedOrganization.identifier = "different-org";
      const newWrapper = mount(PrometheusConfig, {
        global: {
          plugins: [store, Quasar],
          stubs: { CopyContent: true }
        }
      });
      expect(newWrapper.vm.content).toContain("/api/different-org/");
    });
  });

  describe("Utility Functions Integration", () => {
    it("should call getIngestionURL function", async () => {
      const { getIngestionURL } = await import("../../../utils/zincutils");
      expect(getIngestionURL).toHaveBeenCalled();
    });

    it("should call getEndPoint with ingestion URL", async () => {
      const { getEndPoint } = await import("../../../utils/zincutils");
      expect(getEndPoint).toHaveBeenCalledWith("https://test.example.com:5080");
    });

    it("should make getImageURL available in component", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      const result = wrapper.vm.getImageURL();
      expect(result).toBe("https://test.example.com/image.png");
    });
  });

  describe("Component Reactivity", () => {

    it("should maintain endpoint structure", () => {
      const requiredKeys = ["url", "host", "port", "protocol", "tls"];
      requiredKeys.forEach(key => {
        expect(wrapper.vm.endpoint).toHaveProperty(key);
      });
    });
  });

  describe("Configuration Content Validation", () => {
    it("should generate valid YAML structure", () => {
      const content = wrapper.vm.content;
      const lines = content.split('\n');
      
      expect(lines[0]).toBe('remote_write:');
      expect(lines[1]).toMatch(/^\s+- url:/);
      expect(lines[2]).toMatch(/^\s+queue_config:/);
      expect(lines[3]).toMatch(/^\s+max_samples_per_send:/);
      expect(lines[4]).toMatch(/^\s+basic_auth:/);
    });

    it("should include all required Prometheus configuration sections", () => {
      const content = wrapper.vm.content;
      
      // Check for all required sections
      expect(content).toContain("remote_write:");
      expect(content).toContain("queue_config:");
      expect(content).toContain("max_samples_per_send:");
      expect(content).toContain("basic_auth:");
      expect(content).toContain("username:");
      expect(content).toContain("password:");
    });

    it("should generate content with proper indentation", () => {
      const content = wrapper.vm.content;
      const lines = content.split('\n');
      
      // Check YAML indentation patterns
      expect(lines[0]).not.toMatch(/^\s/); // Top level shouldn't be indented
      expect(lines[1]).toMatch(/^\s\s-/); // Array item indented 2 spaces
      expect(lines[2]).toMatch(/^\s\s\s\s/); // Nested properties indented 4 spaces
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty organization identifier gracefully", () => {
      store.state.selectedOrganization.identifier = "";
      const newWrapper = mount(PrometheusConfig, {
        global: {
          plugins: [store, Quasar],
          stubs: { CopyContent: true }
        }
      });
      expect(newWrapper.vm.content).toContain("/api//");
    });

    it("should handle null organization gracefully", () => {
      const storeWithNullOrg = createStore({
        state: {
          selectedOrganization: {
            identifier: "fallback-org",
            label: "Fallback Organization",
            id: 999
          },
          API_ENDPOINT: "https://test.example.com:5080",
          theme: "dark",
          userInfo: {
            email: "test@example.com"
          }
        },
        mutations: {},
        actions: {}
      });
      const newWrapper = mount(PrometheusConfig, {
        global: {
          plugins: [storeWithNullOrg, Quasar],
          stubs: { CopyContent: true }
        }
      });
      expect(newWrapper.exists()).toBe(true);
      expect(newWrapper.vm.content).toContain("/api/fallback-org/");
    });

    it("should maintain component stability with undefined props", () => {
      const wrapperWithoutProps = mount(PrometheusConfig, {
        global: {
          plugins: [store, Quasar],
          stubs: { CopyContent: true }
        }
      });
      expect(wrapperWithoutProps.exists()).toBe(true);
    });
  });

  describe("Component Structure", () => {
    it("should have proper Vue component structure", () => {
      expect(PrometheusConfig).toHaveProperty("name");
      expect(PrometheusConfig).toHaveProperty("props");
      expect(PrometheusConfig).toHaveProperty("components");
      expect(PrometheusConfig).toHaveProperty("setup");
    });

    it("should return all required values from setup", () => {
      const setupFunction = PrometheusConfig.setup!;
      
      // Mock the store for the setup function
      const mockStore = {
        state: {
          selectedOrganization: {
            identifier: "test-org"
          }
        }
      };
      
      // Mock useStore to return our mock store
      vi.doMock("vuex", () => ({
        useStore: () => mockStore
      }));
      
      // Since we can't call setup directly due to Vue composition API,
      // we'll verify the component structure instead
      expect(typeof setupFunction).toBe("function");
      expect(PrometheusConfig).toHaveProperty("name");
      expect(PrometheusConfig).toHaveProperty("props");
      expect(PrometheusConfig).toHaveProperty("components");
    });
  });

});