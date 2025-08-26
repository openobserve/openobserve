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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick } from "vue";
import { createStore } from "vuex";
import OtelConfig from "@/components/ingestion/logs/OtelConfig.vue";

installQuasar();

// Mock utility functions
vi.mock("@/utils/zincutils", () => ({
  b64EncodeStandard: vi.fn((str: string) => btoa(str)),
  getEndPoint: vi.fn((url: string) => ({
    url: "http://localhost:5080",
    host: "localhost",
    port: "5080",
    protocol: "http",
    tls: "Off",
  })),
  getIngestionURL: vi.fn(() => "http://localhost:5080"),
}));

// Mock CopyContent component
vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div class='copy-content-mock'>{{ content }}</div>",
  },
}));

describe("OtelConfig", () => {
  let wrapper: any;
  const mockStore = createStore({
    state: {
      API_ENDPOINT: "http://localhost:5080",
      organizationData: {
        organizationPasscode: "test-passcode-123",
      },
      zoConfig: {
        ingestion_url: "",
      },
    },
  });

  const defaultProps = {
    currOrgIdentifier: "default-org",
    currUserEmail: "test@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state before each test
    mockStore.state.organizationData.organizationPasscode = "test-passcode-123";
    wrapper = mount(OtelConfig, {
      props: defaultProps,
      global: {
        plugins: [mockStore],
      },
    });
  });

  // Test 1: Component mounting and basic structure
  it("should mount successfully", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeTruthy();
  });

  // Test 2: Props validation and default values
  it("should accept currOrgIdentifier prop", () => {
    expect(wrapper.props("currOrgIdentifier")).toBe("default-org");
  });

  // Test 3: Props validation for currUserEmail
  it("should accept currUserEmail prop", () => {
    expect(wrapper.props("currUserEmail")).toBe("test@example.com");
  });

  // Test 4: Component structure - OTLP HTTP section
  it("should render OTLP HTTP section", () => {
    const httpTitle = wrapper.find(".text-subtitle1");
    expect(httpTitle.text()).toBe("OTLP HTTP");
  });

  // Test 5: Component structure - OTLP gRPC section
  it("should render OTLP gRPC section", () => {
    const sections = wrapper.findAll(".text-subtitle1");
    expect(sections).toHaveLength(2);
    expect(sections[1].text()).toBe("OTLP gRPC");
  });

  // Test 6: CopyContent components are present
  it("should render two CopyContent components", () => {
    const copyComponents = wrapper.findAllComponents({ name: "CopyContent" });
    expect(copyComponents).toHaveLength(2);
  });

  // Test 7: Endpoint initialization
  it("should initialize endpoint correctly", () => {
    const endpoint = wrapper.vm.endpoint;
    expect(endpoint.url).toBe("http://localhost:5080");
    expect(endpoint.host).toBe("localhost");
    expect(endpoint.port).toBe("5080");
    expect(endpoint.protocol).toBe("http");
    expect(endpoint.tls).toBe("Off");
  });

  // Test 8: Ingestion URL setup
  it("should set ingestion URL correctly", () => {
    expect(wrapper.vm.ingestionURL).toBe("http://localhost:5080");
  });

  // Test 9: Access key computation
  it("should compute access key correctly", () => {
    const expectedInput = "test@example.com:test-passcode-123";
    const expectedBase64 = btoa(expectedInput);
    expect(wrapper.vm.accessKey).toBe(expectedBase64);
  });

  // Test 10: OTLP gRPC config generation
  it("should generate correct OTLP gRPC config", () => {
    const expectedConfig = `exporters:
  otlp/openobserve:
      endpoint: localhost:5081
      headers:
        Authorization: "Basic ${btoa("test@example.com:test-passcode-123")}"
        organization: default-org
        stream-name: default
      tls:
        insecure: true`;
    
    expect(wrapper.vm.getOtelGrpcConfig).toBe(expectedConfig);
  });

  // Test 11: OTLP HTTP config generation
  it("should generate correct OTLP HTTP config", () => {
    const expectedConfig = `exporters:
  otlphttp/openobserve:
    endpoint: http://localhost:5080/api/default-org
    headers:
      Authorization: Basic ${btoa("test@example.com:test-passcode-123")}
      stream-name: default`;
    
    expect(wrapper.vm.getOtelHttpConfig).toBe(expectedConfig);
  });

  // Test 12: Props change - currOrgIdentifier
  it("should update configs when currOrgIdentifier prop changes", async () => {
    await wrapper.setProps({ currOrgIdentifier: "new-org" });
    await nextTick();

    expect(wrapper.vm.getOtelHttpConfig).toContain("http://localhost:5080/api/new-org");
    expect(wrapper.vm.getOtelGrpcConfig).toContain("organization: new-org");
  });

  // Test 13: Props change - currUserEmail
  it("should update access key when currUserEmail prop changes", async () => {
    await wrapper.setProps({ currUserEmail: "newuser@example.com" });
    await nextTick();

    const expectedBase64 = btoa("newuser@example.com:test-passcode-123");
    expect(wrapper.vm.accessKey).toBe(expectedBase64);
  });

  // Test 14: Store state change - organizationPasscode
  it("should update access key when organization passcode changes", async () => {
    // Directly modify the mock store state
    mockStore.state.organizationData.organizationPasscode = "new-passcode";
    await nextTick();

    const expectedBase64 = btoa("test@example.com:new-passcode");
    expect(wrapper.vm.accessKey).toBe(expectedBase64);
  });

  // Test 15: CopyContent props - HTTP config
  it("should pass HTTP config to first CopyContent component", () => {
    const copyComponents = wrapper.findAllComponents({ name: "CopyContent" });
    const httpCopyComponent = copyComponents[0];
    
    expect(httpCopyComponent.props("content")).toBe(wrapper.vm.getOtelHttpConfig);
  });

  // Test 16: CopyContent props - gRPC config
  it("should pass gRPC config to second CopyContent component", () => {
    const copyComponents = wrapper.findAllComponents({ name: "CopyContent" });
    const grpcCopyComponent = copyComponents[1];
    
    expect(grpcCopyComponent.props("content")).toBe(wrapper.vm.getOtelGrpcConfig);
  });

  // Test 17: Empty props handling
  it("should handle empty currOrgIdentifier prop", async () => {
    await wrapper.setProps({ currOrgIdentifier: "" });
    await nextTick();

    expect(wrapper.vm.getOtelHttpConfig).toContain("http://localhost:5080/api/");
    expect(wrapper.vm.getOtelGrpcConfig).toContain("organization: ");
  });

  // Test 18: Empty email handling
  it("should handle empty currUserEmail prop", async () => {
    await wrapper.setProps({ currUserEmail: "" });
    await nextTick();

    const expectedBase64 = btoa(":test-passcode-123");
    expect(wrapper.vm.accessKey).toBe(expectedBase64);
  });

  // Test 19: Component reactivity
  it("should be reactive to all computed properties", async () => {
    const initialHttpConfig = wrapper.vm.getOtelHttpConfig;
    const initialGrpcConfig = wrapper.vm.getOtelGrpcConfig;
    
    await wrapper.setProps({ 
      currOrgIdentifier: "updated-org",
      currUserEmail: "updated@example.com"
    });
    await nextTick();

    expect(wrapper.vm.getOtelHttpConfig).not.toBe(initialHttpConfig);
    expect(wrapper.vm.getOtelGrpcConfig).not.toBe(initialGrpcConfig);
  });

  // Test 20: Exposed properties accessibility
  it("should expose all required properties", () => {
    const exposedProps = ['endpoint', 'ingestionURL', 'accessKey', 'getOtelGrpcConfig', 'getOtelHttpConfig'];
    
    exposedProps.forEach(prop => {
      expect(wrapper.vm[prop]).toBeDefined();
    });
  });

  // Test 21: gRPC configuration structure validation
  it("should include all required gRPC configuration fields", () => {
    const config = wrapper.vm.getOtelGrpcConfig;
    
    expect(config).toContain("exporters:");
    expect(config).toContain("otlp/openobserve:");
    expect(config).toContain("endpoint:");
    expect(config).toContain("headers:");
    expect(config).toContain("Authorization:");
    expect(config).toContain("organization:");
    expect(config).toContain("stream-name:");
    expect(config).toContain("tls:");
    expect(config).toContain("insecure:");
  });

  // Test 22: HTTP configuration structure validation
  it("should include all required HTTP configuration fields", () => {
    const config = wrapper.vm.getOtelHttpConfig;
    
    expect(config).toContain("exporters:");
    expect(config).toContain("otlphttp/openobserve:");
    expect(config).toContain("endpoint:");
    expect(config).toContain("headers:");
    expect(config).toContain("Authorization:");
    expect(config).toContain("stream-name:");
  });

  // Test 23: Default stream name in configs
  it("should use 'default' as stream name in both configs", () => {
    expect(wrapper.vm.getOtelHttpConfig).toContain("stream-name: default");
    expect(wrapper.vm.getOtelGrpcConfig).toContain("stream-name: default");
  });

  // Test 24: gRPC port configuration
  it("should use port 5081 for gRPC endpoint", () => {
    expect(wrapper.vm.getOtelGrpcConfig).toContain("localhost:5081");
  });

  // Test 25: Authorization format differences
  it("should use different Authorization formats for HTTP and gRPC", () => {
    const httpConfig = wrapper.vm.getOtelHttpConfig;
    const grpcConfig = wrapper.vm.getOtelGrpcConfig;
    
    // HTTP uses format: Authorization: Basic <token>
    expect(httpConfig).toContain("Authorization: Basic");
    
    // gRPC uses format: Authorization: "Basic <token>"
    expect(grpcConfig).toContain('Authorization: "Basic');
  });

  // Test 26: TLS configuration only in gRPC
  it("should include TLS configuration only in gRPC config", () => {
    const httpConfig = wrapper.vm.getOtelHttpConfig;
    const grpcConfig = wrapper.vm.getOtelGrpcConfig;
    
    expect(grpcConfig).toContain("tls:");
    expect(grpcConfig).toContain("insecure: true");
    expect(httpConfig).not.toContain("tls:");
  });

  // Test 27: Component unmounting
  it("should unmount without errors", () => {
    expect(() => wrapper.unmount()).not.toThrow();
  });

  // Test 28: Computed properties return values
  it("should have computed properties that return values", () => {
    expect(wrapper.vm.accessKey).toBeDefined();
    expect(wrapper.vm.getOtelGrpcConfig).toBeDefined();
    expect(wrapper.vm.getOtelHttpConfig).toBeDefined();
    expect(typeof wrapper.vm.accessKey).toBe("string");
    expect(typeof wrapper.vm.getOtelGrpcConfig).toBe("string");
    expect(typeof wrapper.vm.getOtelHttpConfig).toBe("string");
  });

  // Test 29: Special characters in props
  it("should handle special characters in organization identifier", async () => {
    await wrapper.setProps({ currOrgIdentifier: "test-org-123_special" });
    await nextTick();

    expect(wrapper.vm.getOtelHttpConfig).toContain("test-org-123_special");
    expect(wrapper.vm.getOtelGrpcConfig).toContain("test-org-123_special");
  });

  // Test 30: Special characters in email
  it("should handle special characters in email", async () => {
    await wrapper.setProps({ currUserEmail: "test.user+tag@example.com" });
    await nextTick();

    const expectedBase64 = btoa("test.user+tag@example.com:test-passcode-123");
    expect(wrapper.vm.accessKey).toBe(expectedBase64);
  });
});