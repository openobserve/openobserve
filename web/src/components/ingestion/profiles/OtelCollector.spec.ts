import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import OtelCollector from "./OtelCollector.vue";
import i18n from "@/locales";

vi.mock("../../../aws-exports", () => ({
  default: { API_ENDPOINT: "http://localhost:5080", isCloud: "false" },
}));

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

vi.mock("@/components/ingestion/CredentialCodeBlock.vue", () => ({
  default: {
    name: "CredentialCodeBlock",
    template: '<div :data-test="`copy-${slug}`">{{ content }}</div>',
    props: ["content", "slug"],
  },
}));

const mountPage = () =>
  mount(OtelCollector, {
    props: {
      currOrgIdentifier: "default",
      currUserEmail: "user@example.com",
    },
    global: {
      plugins: [i18n],
      provide: { store: createStore({ state: { zoConfig: {} } }) },
      stubs: {
        IngestionContent: { template: "<div><slot /></div>" },
      },
    },
  });

describe("profiles OtelCollector", () => {
  it("sets profiles_endpoint to the OpenObserve ingestion URL", () => {
    const content = mountPage().get('[data-test="copy-profiles-otel"]').text();
    expect(content).toContain("profiles_endpoint: http://localhost:5080/api/default/v1/profiles");
    expect(content).toMatch(/endpoint: http:\/\/localhost:5080\n/);
  });

  // The docs config runs on its own: a receiver, the exporter and a profiles pipeline.
  it("gives a complete HTTP config with a profiles pipeline", () => {
    const content = mountPage().get('[data-test="copy-profiles-otel"]').text();
    expect(content).toContain("receivers:\n  otlp:");
    expect(content).toContain("pipelines:\n    profiles:");
    expect(content).toContain("exporters: [otlp_http/openobserve]");
  });

  it("shows the start command with the profiles feature gate", () => {
    expect(mountPage().get('[data-test="copy-profiles-otel-start"]').text()).toContain(
      "--feature-gates=+service.profilesSupport",
    );
  });

  it("gives a self-hosted gRPC config on port 5081 with the organization header", () => {
    const content = mountPage().get('[data-test="copy-profiles-otel-grpc"]').text();
    expect(content).toContain("endpoint: localhost:5081");
    expect(content).toContain("organization: default");
    expect(content).toContain("exporters: [otlp_grpc/openobserve]");
  });
});
