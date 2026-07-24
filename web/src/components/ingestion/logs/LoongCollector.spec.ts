import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import LoongCollector from "./LoongCollector.vue";

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn(() => ({
    url: "https://test.example.com:5080",
    host: "test.example.com",
    port: "5080",
    protocol: "https",
    tls: true,
  })),
  getIngestionURL: vi.fn(() => "https://test.example.com:5080"),
  getImageURL: vi.fn(() => "mock-image-url"),
}));

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div class='copy-content'>{{ content }}</div>",
  },
}));

describe("LoongCollector.vue", () => {
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

    wrapper = mount(LoongCollector, {
      global: {
        plugins: [store],
      },
      props: {
        currOrgIdentifier: "test-org",
        currUserEmail: "test@example.com",
      },
    });
  });

  it("renders LoongCollector docs text", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain("LoongCollector configuration");
  });

  it("generates OpenObserve logs ingestion RemoteURL", () => {
    expect(wrapper.vm.content).toContain(
      "RemoteURL: https://test.example.com:5080/api/test-org/default/_json",
    );
  });

  it("uses flusher_http style output", () => {
    expect(wrapper.vm.content).toContain("Type: flusher_http");
    expect(wrapper.vm.content).toContain("Method: POST");
    expect(wrapper.vm.content).toContain("Authorization: Basic [BASIC_PASSCODE]");
  });
});
