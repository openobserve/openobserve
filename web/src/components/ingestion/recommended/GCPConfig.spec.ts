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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import GCPConfig from "./GCPConfig.vue";
import gcpCard from "@/components/ingestion/setupCard/content/gcp";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";

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

describe("gcpCard builder", () => {
  it("builds the GCP card metadata and step flow", () => {
    const card = gcpCard(SUBS);
    expect(card.provider.name).toBe("Google Cloud");
    expect(card.provider.metaBadges).toEqual(["Logs"]);
    expect(card.steps.map((s) => s.id)).toEqual(["sink", "subscription", "verify"]);
  });

  it("builds the Pub/Sub push endpoint with org and key", () => {
    const sub = gcpCard(SUBS).steps.find((s) => s.id === "subscription")!;
    expect(sub.code!.raw).toBe(`${SUBS.url}/gcp/${SUBS.org}/{stream}/_sub?API-Key=${SUBS.token}`);
    // The key is masked on screen and only revealed/copied deliberately.
    expect(sub.code!.masked).not.toContain(SUBS.token);
  });

  it("keeps the stream name in lockstep between URL and detection", () => {
    const card = gcpCard(SUBS);
    // {stream} survives build-time substitution so the renderer fills it from
    // the stream-name field, which also drives what detection watches.
    expect(card.streamInput?.default).toBe("default");
    const sub = card.steps.find((s) => s.id === "subscription")!;
    expect(sub.code!.raw).toContain("{stream}");
    expect(card.detect.streamType).toBe("logs");
  });

  it("uses a filter that is valid SQL", () => {
    // useStreamDetect interpolates this into `WHERE (<filter>)`, so an empty
    // filter would be a syntax error and detection could never succeed.
    expect(gcpCard(SUBS).detect.filter.trim()).not.toBe("");
  });

  it("keeps BOTH doc links the old page linked, as real anchors", () => {
    // The pre-migration page listed two clickable links: Pub/Sub Logs and
    // Google Workspace. Google Workspace briefly regressed into unclickable
    // prose inside a collapsed accordion — it must stay a footer link.
    const card = gcpCard(SUBS);
    expect(card.docUrl).toContain("send-gcp-logs-to-openobserve");
    expect(card.docLinks).toEqual([
      {
        label: "Google Workspace",
        url: "https://short.openobserve.ai/security/google-workspace",
      },
    ]);
  });
});

describe("GCPConfig.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the gcp slug", () => {
    expect(getDataSourceCard("gcp", SUBS)?.provider.name).toBe("Google Cloud");
    wrapper = mount(GCPConfig, { global: { plugins: [mockStore, mockI18n] } });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("Google Cloud");
  });
});
