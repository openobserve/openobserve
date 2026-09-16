import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OtelCollector from "./OtelCollector.vue";
import i18n from "@/locales";

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn(() => ({
    url: "http://localhost:5080",
    host: "localhost",
    port: "5080",
    protocol: "http",
    tls: false,
  })),
  getIngestionURL: vi.fn(() => "http://localhost:5080"),
}));

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    template: '<div data-test="copy-content">{{ content }}</div>',
    props: ["content"],
  },
}));

describe("profiles OtelCollector", () => {
  it("sets profiles_endpoint to the OpenObserve ingestion URL", () => {
    const wrapper = mount(OtelCollector, {
      props: {
        currOrgIdentifier: "default",
        currUserEmail: "user@example.com",
      },
      global: {
        plugins: [i18n],
        stubs: {
          IngestionContent: { template: "<div><slot /></div>" },
        },
      },
    });

    const content = wrapper.get('[data-test="copy-content"]').text();
    expect(content).toContain("profiles_endpoint: http://localhost:5080/api/default/v1/profiles");
    expect(content).toMatch(/endpoint: http:\/\/localhost:5080\n/);
  });
});
