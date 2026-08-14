// Copyright 2026 OpenObserve Inc.
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

// This component backs TWO routes (Recommended > Traces and Custom > Traces >
// OpenTelemetry), so the card it renders is shared by both.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import OpenTelemetry from "./OpenTelemetry.vue";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";

const mockConfig = { isCloud: "false" };
vi.mock("@/aws-exports", () => ({
  get default() {
    return mockConfig;
  },
}));

const mockEndpoint = ref({
  url: "https://test.openobserve.ai",
  host: "test.openobserve.ai",
  port: 443,
  protocol: "https",
  tls: true,
});

vi.mock("@/composables/useIngestion", () => ({
  default: vi.fn(() => ({ endpoint: mockEndpoint })),
}));

vi.mock("@/components/ingestion/setupCard/SetupCardRenderer.vue", () => ({
  default: {
    name: "SetupCardRenderer",
    props: ["content", "subs", "logoUrl", "logoUrlDark"],
    template: '<div data-test="rich-card-stub" />',
  },
}));

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org", name: "Test Organization" },
    userInfo: { email: "test@example.com" },
    organizationData: { organizationPasscode: "test-passcode" },
    theme: "light",
  },
});
const mockI18n = createI18n({ locale: "en", messages: { en: {} } });

const SUBS = {
  url: "https://test.openobserve.ai",
  org: "test-org",
  token: "dGVzdEB0b2tlbg==",
};

const buildCard = async () =>
  (await import("@/components/ingestion/setupCard/content/otlpTraces")).default(SUBS);

describe("otlpTracesCard builder", () => {
  beforeEach(() => {
    mockConfig.isCloud = "false";
  });

  it("builds the OTLP card metadata and step flow", async () => {
    const card = await buildCard();
    expect(card.provider.metaBadges).toEqual(["Traces"]);
    expect(card.steps.map((s) => s.id)).toEqual(["configure", "verify"]);
    expect(card.detect).toMatchObject({
      streamType: "traces",
      filter: "trace_id IS NOT NULL",
    });
  });

  it("offers HTTP, gRPC and SDK transports when self-hosted", async () => {
    expect((await buildCard()).steps[0].variants?.map((v) => v.id)).toEqual([
      "http",
      "grpc",
      "sdk",
    ]);
  });

  it("drops gRPC on cloud, which terminates HTTP only", async () => {
    mockConfig.isCloud = "true";
    vi.resetModules();
    expect((await buildCard()).steps[0].variants?.map((v) => v.id)).toEqual(["http", "sdk"]);
  });

  it("substitutes endpoint, org and token into every transport", async () => {
    for (const v of (await buildCard()).steps[0].variants!) {
      expect(v.code.raw).toContain(SUBS.org);
      expect(v.code.raw).toContain(SUBS.token);
      expect(v.code.raw).not.toContain("[BASIC_PASSCODE]");
      expect(v.code.masked).not.toContain(SUBS.token);
    }
  });

  it("keeps the stream name in lockstep between config and detection", async () => {
    const card = await buildCard();
    expect(card.streamInput?.default).toBe("default");
    // Every transport writes the stream the check below watches.
    for (const v of card.steps[0].variants!) {
      expect(v.code.raw).toContain("{stream}");
    }
  });

  it("derives the gRPC tls.insecure flag from the endpoint scheme", async () => {
    const grpc = (await buildCard()).steps[0].variants!.find((v) => v.id === "grpc")!;
    // HTTPS endpoint → insecure must be false, else the handshake fails.
    expect(grpc.code.raw).toContain("insecure: false");
    expect(grpc.code.raw).toContain("test.openobserve.ai:5081");
  });
});

describe("OpenTelemetry.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the otlpTraces slug", () => {
    expect(getDataSourceCard("otlpTraces", SUBS)?.provider.name).toContain("Traces");
    wrapper = mount(OpenTelemetry, {
      global: { plugins: [mockStore, mockI18n] },
    });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});
