import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import NightingaleConfig from "./NightingaleConfig.vue";

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

describe("NightingaleConfig.vue", () => {
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

    wrapper = mount(NightingaleConfig, {
      global: {
        plugins: [store],
      },
      props: {
        currOrgIdentifier: "test-org",
        currUserEmail: "test@example.com",
      },
    });
  });

  it("renders Nightingale snippet", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain("Nightingale");
  });

  it("generates OpenObserve remote write endpoint", () => {
    expect(wrapper.vm.content).toContain(
      "https://test.example.com:5080/api/test-org/prometheus/api/v1/write",
    );
  });

  // Nightingale is configured in TOML via a `[[Pushgw.Writers]]` block — not the
  // Prometheus YAML (`remote_write:` / `basic_auth:`) the other metrics snippets use.
  it("contains the Pushgw writer and basic auth credentials", () => {
    expect(wrapper.vm.content).toContain("[[Pushgw.Writers]]");
    expect(wrapper.vm.content).toContain("BasicAuthUser =");
    expect(wrapper.vm.content).toContain("BasicAuthPass =");
  });
});
