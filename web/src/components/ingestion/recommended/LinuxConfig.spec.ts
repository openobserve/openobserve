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

// Mirrors the Databases leaf specs: content asserted on the pure builder, the
// component test only proves the slug resolves through the shared renderer.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import LinuxConfig from "./LinuxConfig.vue";
import linuxCard from "@/components/ingestion/setupCard/content/linux";
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

describe("linuxCard builder", () => {
  it("builds the Linux card metadata and step flow", () => {
    const card = linuxCard(SUBS);
    expect(card.provider.name).toBe("Linux");
    expect(card.provider.metaBadges).toEqual(["Logs", "Metrics"]);
    expect(card.steps.map((s) => s.id)).toEqual(["install", "verify"]);
    // Host metrics fan out per metric, so detection is existence-based.
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
    });
  });

  it("offers generic and EC2 environments as one toggle", () => {
    // Replaces two hand-built clickable <div> cards plus a conditional callout.
    const install = linuxCard(SUBS).steps[0];
    expect(install.required).toBe(true);
    expect(install.variants?.map((v) => v.id)).toEqual(["generic", "ec2"]);
    expect(install.variants!.every((v) => !!v.icon)).toBe(true);
  });

  it("points each variant at its matching install script", () => {
    const [generic, ec2] = linuxCard(SUBS).steps[0].variants!;
    expect(generic.code.raw).toContain("/linux/install.sh");
    expect(generic.code.raw).not.toContain("/ec2/");
    expect(ec2.code.raw).toContain("/linux/ec2/install.sh");
  });

  it("carries the IAM prerequisite only on the EC2 variant", () => {
    // Previously an amber callout rendered above the command for everyone.
    const [generic, ec2] = linuxCard(SUBS).steps[0].variants!;
    expect(ec2.note).toContain("ec2:DescribeTags");
    expect(generic.note).not.toContain("ec2:DescribeTags");
  });

  it("offers the uninstall command", () => {
    const uninstall = linuxCard(SUBS).extras?.uninstall;
    expect(uninstall?.code.raw).toContain("/linux/uninstall.sh");
    expect(uninstall?.code.lang).toBe("bash");
    // One uninstall script serves both the generic and EC2 installs.
    expect(uninstall?.code.raw).not.toContain("/ec2/");
  });

  it("substitutes url/org and masks the ingestion token", () => {
    const generic = linuxCard(SUBS).steps[0].variants![0];
    expect(generic.code.raw).toContain(`${SUBS.url}/api/${SUBS.org}/`);
    expect(generic.code.raw).toContain(SUBS.token);
    // The old page rendered a literal [BASIC_PASSCODE] placeholder instead.
    expect(generic.code.raw).not.toContain("[BASIC_PASSCODE]");
    expect(generic.code.masked).not.toContain(SUBS.token);
  });
});

describe("LinuxConfig.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the linux slug", () => {
    expect(getDataSourceCard("linux", SUBS)?.provider.name).toBe("Linux");
    wrapper = mount(LinuxConfig, { global: { plugins: [mockStore, mockI18n] } });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("Linux");
  });
});
