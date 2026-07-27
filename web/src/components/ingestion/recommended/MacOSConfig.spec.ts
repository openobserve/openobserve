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

// Mirrors LinuxConfig.spec.ts: content asserted on the pure builder, the
// component test only proves the slug resolves through the shared renderer.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import MacOSConfig from "./MacOSConfig.vue";
import macosCard from "@/components/ingestion/setupCard/content/macos";
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

describe("macosCard builder", () => {
  it("builds the macOS card metadata and step flow", () => {
    const card = macosCard(SUBS);
    expect(card.provider.name).toBe("macOS");
    expect(card.provider.metaBadges).toEqual(["Logs", "Metrics"]);
    expect(card.steps.map((s) => s.id)).toEqual(["install", "verify"]);
    // Host metrics fan out per metric, so detection is existence-based.
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
    });
  });

  it("is a single command with no environment toggle", () => {
    // Unlike Linux/Windows there is no mac/ec2 install script to switch to.
    const install = macosCard(SUBS).steps[0];
    expect(install.required).toBe(true);
    expect(install.variants).toBeUndefined();
    expect(install.code?.raw).toContain("/mac/install.sh");
  });

  it("uses curl, which macOS ships, rather than wget", () => {
    const install = macosCard(SUBS).steps[0];
    expect(install.code?.raw).toContain("curl -O");
    expect(install.code?.raw).not.toContain("wget");
  });

  it("substitutes url/org and masks the ingestion token", () => {
    const install = macosCard(SUBS).steps[0];
    expect(install.code?.raw).toContain(`${SUBS.url}/api/${SUBS.org}/`);
    expect(install.code?.raw).toContain(SUBS.token);
    expect(install.code?.raw).not.toContain("[BASIC_PASSCODE]");
    expect(install.code?.masked).not.toContain(SUBS.token);
  });

  it("offers the uninstall command", () => {
    const uninstall = macosCard(SUBS).extras?.uninstall;
    expect(uninstall?.code.raw).toContain("/mac/uninstall.sh");
    expect(uninstall?.code.lang).toBe("bash");
    // Takes no arguments, so there is no token to mask.
    expect(uninstall?.code.masked).toBeUndefined();
    expect(uninstall?.description).toContain("launchd");
  });

  it("covers the unified log bridge and drops the EC2-only row", () => {
    const rows = macosCard(SUBS).extras?.troubleshooting ?? [];
    const questions = rows.map((r) => r.q).join(" | ");
    expect(questions).toContain("no unified log entries");
    // There is no EC2 variant for macOS, so that symptom would be noise.
    expect(questions).not.toContain("instance id");
  });
});

describe("MacOSConfig.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the macos slug", () => {
    expect(getDataSourceCard("macos", SUBS)?.provider.name).toBe("macOS");
    wrapper = mount(MacOSConfig, { global: { plugins: [mockStore, mockI18n] } });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("macOS");
  });
});
