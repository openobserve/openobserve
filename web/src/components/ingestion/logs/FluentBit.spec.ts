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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import FluentBit from "@/components/ingestion/logs/FluentBit.vue";

// Mock dependencies
vi.mock("../../../aws-exports", () => ({
  default: {
    isCloud: "false"
  }
}));

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn(),
  getImageURL: vi.fn(),
  getIngestionURL: vi.fn(),
}));

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div>{{ content }}</div>"
  }
}));

installQuasar();

describe("FluentBit Component", () => {
  let wrapper: any;
  let store: any;
  let mockGetEndPoint: any;
  let mockGetImageURL: any;
  let mockGetIngestionURL: any;

  beforeEach(async () => {
    // Import mocked functions
    const { getEndPoint, getImageURL, getIngestionURL } = await import("../../../utils/zincutils");
    mockGetEndPoint = vi.mocked(getEndPoint);
    mockGetImageURL = vi.mocked(getImageURL);
    mockGetIngestionURL = vi.mocked(getIngestionURL);

    // Setup mock returns
    mockGetIngestionURL.mockReturnValue("http://localhost:5080");
    mockGetEndPoint.mockReturnValue({
      url: "http://localhost:5080",
      host: "localhost",
      port: "5080",
      protocol: "http:",
      tls: "off"
    });
    mockGetImageURL.mockReturnValue("/test-image.png");

    store = createStore({
      state: {
        organizationPasscode: 11,
        API_ENDPOINT: "http://localhost:5080",
        selectedOrganization: {
          identifier: "test_org",
          name: "Test Organization"
        },
        zoConfig: {
          timestamp_column: "_timestamp"
        }
      },
      getters: {},
      mutations: {},
      actions: {}
    });

    wrapper = mount(FluentBit, {
      props: {
        currOrgIdentifier: "test_org",
        currUserEmail: "test@example.com",
      },
      global: {
        plugins: [store],
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // Test 1: Component mounting and initialization
  it("should mount FluentBit component successfully", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeDefined();
  });

  // Test 2: Component name
  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("fluentbit-mechanism");
  });

  // Test 3: Props validation
  it("should accept currOrgIdentifier prop", () => {
    expect(wrapper.props("currOrgIdentifier")).toBe("test_org");
  });

  // Test 4: Props validation for currUserEmail
  it("should accept currUserEmail prop", () => {
    expect(wrapper.props("currUserEmail")).toBe("test@example.com");
  });

  // Test 5: Store access
  it("should have access to store", () => {
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state).toBeDefined();
  });

  // Test 6: Config access
  it("should have access to config", () => {
    expect(wrapper.vm.config).toBeDefined();
  });

  // Test 7: Endpoint initialization
  it("should initialize endpoint with correct structure", () => {
    expect(wrapper.vm.endpoint).toBeDefined();
    expect(wrapper.vm.endpoint.url).toBeDefined();
    expect(wrapper.vm.endpoint.host).toBeDefined();
    expect(wrapper.vm.endpoint.port).toBeDefined();
    expect(wrapper.vm.endpoint.protocol).toBeDefined();
    expect(wrapper.vm.endpoint.tls).toBeDefined();
  });

  // Test 8: getIngestionURL call
  it("should call getIngestionURL during setup", () => {
    expect(mockGetIngestionURL).toHaveBeenCalled();
  });

  // Test 9: getEndPoint call
  it("should call getEndPoint with ingestion URL", () => {
    expect(mockGetEndPoint).toHaveBeenCalledWith("http://localhost:5080");
  });

  // Test 10: Endpoint values from getEndPoint
  it("should set endpoint values from getEndPoint result", () => {
    expect(wrapper.vm.endpoint.host).toBe("localhost");
    expect(wrapper.vm.endpoint.port).toBe("5080");
    expect(wrapper.vm.endpoint.tls).toBe("off");
    expect(wrapper.vm.endpoint.url).toBe("http://localhost:5080");
    expect(wrapper.vm.endpoint.protocol).toBe("http:");
  });

  // Test 11: Content generation
  it("should generate FluentBit configuration content", () => {
    expect(wrapper.vm.content).toBeDefined();
    expect(typeof wrapper.vm.content).toBe("string");
  });

  // Test 12: Content contains OUTPUT section
  it("should include [OUTPUT] section in content", () => {
    expect(wrapper.vm.content).toContain("[OUTPUT]");
  });

  // Test 13: Content contains Name http
  it("should include Name http in content", () => {
    expect(wrapper.vm.content).toContain("Name http");
  });

  // Test 14: Content contains Match *
  it("should include Match * in content", () => {
    expect(wrapper.vm.content).toContain("Match *");
  });

  // Test 15: Content contains correct URI
  it("should include correct URI with organization identifier", () => {
    expect(wrapper.vm.content).toContain("URI /api/test_org/default/_json");
  });

  // Test 16: Content contains correct Host
  it("should include correct Host from endpoint", () => {
    expect(wrapper.vm.content).toContain("Host localhost");
  });

  // Test 17: Content contains correct Port
  it("should include correct Port from endpoint", () => {
    expect(wrapper.vm.content).toContain("Port 5080");
  });

  // Test 18: Content contains correct TLS setting
  it("should include correct TLS setting from endpoint", () => {
    expect(wrapper.vm.content).toContain("tls off");
  });

  // Test 19: Content contains Format json
  it("should include Format json in content", () => {
    expect(wrapper.vm.content).toContain("Format json");
  });

  // Test 20: Content contains Json_date_key
  it("should include Json_date_key with timestamp column", () => {
    expect(wrapper.vm.content).toContain("Json_date_key    _timestamp");
  });

  // Test 21: Content contains Json_date_format
  it("should include Json_date_format iso8601", () => {
    expect(wrapper.vm.content).toContain("Json_date_format iso8601");
  });

  // Test 22: Content contains HTTP_User placeholder
  it("should include HTTP_User placeholder", () => {
    expect(wrapper.vm.content).toContain("HTTP_User [EMAIL]");
  });

  // Test 23: Content contains HTTP_Passwd placeholder
  it("should include HTTP_Passwd placeholder", () => {
    expect(wrapper.vm.content).toContain("HTTP_Passwd [PASSCODE]");
  });

  // Test 24: Content contains compress gzip
  it("should include compress gzip in content", () => {
    expect(wrapper.vm.content).toContain("compress gzip");
  });

  // Test 25: getImageURL exposure
  it("should expose getImageURL function", () => {
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(typeof wrapper.vm.getImageURL).toBe("function");
  });

  // Test 26: getImageURL function call
  it("should be able to call getImageURL function", () => {
    wrapper.vm.getImageURL("test.png");
    expect(mockGetImageURL).toHaveBeenCalledWith("test.png");
  });

  // Test 27: Store organization identifier usage
  it("should use store selectedOrganization identifier in content", () => {
    expect(wrapper.vm.content).toContain(store.state.selectedOrganization.identifier);
  });

  // Test 28: Store timestamp column usage
  it("should use store zoConfig timestamp column in content", () => {
    expect(wrapper.vm.content).toContain(store.state.zoConfig.timestamp_column);
  });

  // Test 29: Component with different organization
  it("should generate correct content with different organization", async () => {
    const customStore = createStore({
      state: {
        selectedOrganization: {
          identifier: "custom_org"
        },
        zoConfig: {
          timestamp_column: "@timestamp"
        }
      }
    });

    const customWrapper = mount(FluentBit, {
      props: {
        currOrgIdentifier: "custom_org",
        currUserEmail: "custom@example.com",
      },
      global: {
        plugins: [customStore],
      },
    });

    await flushPromises();

    expect(customWrapper.vm.content).toContain("URI /api/custom_org/default/_json");
    expect(customWrapper.vm.content).toContain("Json_date_key    @timestamp");
    
    customWrapper.unmount();
  });

  // Test 30: Component with HTTPS endpoint
  it("should handle HTTPS endpoint correctly", async () => {
    mockGetEndPoint.mockReturnValue({
      url: "https://example.com:443",
      host: "example.com",
      port: "443",
      protocol: "https:",
      tls: "on"
    });

    const httpsWrapper = mount(FluentBit, {
      props: {
        currOrgIdentifier: "https_org",
        currUserEmail: "https@example.com",
      },
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    expect(httpsWrapper.vm.endpoint.host).toBe("example.com");
    expect(httpsWrapper.vm.endpoint.port).toBe("443");
    expect(httpsWrapper.vm.endpoint.tls).toBe("on");
    expect(httpsWrapper.vm.content).toContain("Host example.com");
    expect(httpsWrapper.vm.content).toContain("Port 443");
    expect(httpsWrapper.vm.content).toContain("tls on");
    
    httpsWrapper.unmount();
  });

  // Test 31: Endpoint ref reactivity
  it("should have reactive endpoint ref", () => {
    const initialHost = wrapper.vm.endpoint.host;
    expect(initialHost).toBe("localhost");
    
    // Modify endpoint
    wrapper.vm.endpoint.host = "newhost.com";
    expect(wrapper.vm.endpoint.host).toBe("newhost.com");
  });

  // Test 32: Content template interpolation
  it("should correctly interpolate template variables in content", () => {
    const content = wrapper.vm.content;
    
    // Verify all template variables are replaced
    expect(content).not.toContain("${store.state.selectedOrganization.identifier}");
    expect(content).not.toContain("${endpoint.value.host}");
    expect(content).not.toContain("${endpoint.value.port}");
    expect(content).not.toContain("${endpoint.value.tls}");
    expect(content).not.toContain("${store.state.zoConfig.timestamp_column}");
  });

  // Test 33: Component props types
  it("should have correct prop types", () => {
    const component = wrapper.vm.$options;
    expect(component.props.currOrgIdentifier.type).toBe(String);
    expect(component.props.currUserEmail.type).toBe(String);
  });

  // Test 34: Component setup function return values
  it("should return all required values from setup function", () => {
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.endpoint).toBeDefined();
    expect(wrapper.vm.content).toBeDefined();
    expect(wrapper.vm.getImageURL).toBeDefined();
  });

  // Test 35: Error handling for missing store data
  it("should handle missing store organization gracefully", async () => {
    const emptyStore = createStore({
      state: {
        selectedOrganization: {
          identifier: ""
        },
        zoConfig: {
          timestamp_column: "_timestamp"
        }
      }
    });

    const emptyWrapper = mount(FluentBit, {
      props: {
        currOrgIdentifier: "test_org",
        currUserEmail: "test@example.com",
      },
      global: {
        plugins: [emptyStore],
      },
    });

    await flushPromises();
    
    expect(emptyWrapper.vm.content).toContain("URI /api//default/_json");
    
    emptyWrapper.unmount();
  });

  // Test 36: CopyContent component integration
  it("should include CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: "CopyContent" });
    expect(copyContent.exists()).toBe(true);
  });

  // Test 37: CopyContent receives correct content prop
  it("should pass content to CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: "CopyContent" });
    expect(copyContent.props("content")).toBe(wrapper.vm.content);
  });
});
