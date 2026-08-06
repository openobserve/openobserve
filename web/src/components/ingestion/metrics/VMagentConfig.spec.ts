import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import VMagentConfig from "./VMagentConfig.vue";

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn(() => ({
    url: "https://test.example.com:5080",
    host: "test.example.com",
    port: "5080",
    protocol: "https",
    tls: true,
  })),
  getIngestionURL: vi.fn(() => "https://test.example.com:5080"),
}));

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div class='copy-content'>{{ content }}</div>",
  },
}));

describe("VMagentConfig.vue", () => {
  let wrapper: any;
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    });

    wrapper = mount(VMagentConfig, {
      global: {
        plugins: [store],
      },
      props: {
        currOrgIdentifier: "test-org",
        currUserEmail: "test@example.com",
      },
    });
  });

  it("renders vmagent snippets", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain("Single remote write target");
    expect(wrapper.text()).toContain("Fan-out to multiple backends");
  });

  it("generates OpenObserve remote write endpoint", () => {
    expect(wrapper.vm.singleTargetContent).toContain(
      "https://test.example.com:5080/api/test-org/prometheus/api/v1/write",
    );
  });

  it("includes fanout example with two remoteWrite.url flags", () => {
    const lines = wrapper.vm.fanoutContent
      .split("\n")
      .filter((line: string) => line.includes("-remoteWrite.url="));
    expect(lines).toHaveLength(2);
  });
});
