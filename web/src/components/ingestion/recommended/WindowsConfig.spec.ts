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
import WindowsConfig from "./WindowsConfig.vue";
import windowsCard from "@/components/ingestion/setupCard/content/windows";
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

describe("windowsCard builder", () => {
  it("builds the Windows card metadata and step flow", () => {
    const card = windowsCard(SUBS);
    expect(card.provider.name).toBe("Windows");
    expect(card.provider.metaBadges).toEqual(["Logs", "Metrics"]);
    expect(card.steps.map((s) => s.id)).toEqual(["install", "verify"]);
  });

  it("uses PowerShell, not bash", () => {
    const install = windowsCard(SUBS).steps[0];
    expect(install.chip?.label).toBe("PowerShell");
    for (const v of install.variants!) {
      expect(v.code.lang).toBe("powershell");
      expect(v.code.raw).toContain("Invoke-WebRequest");
      expect(v.code.raw).toContain("-AUTH_KEY");
    }
  });

  it("points each variant at its matching install script", () => {
    const [generic, ec2] = windowsCard(SUBS).steps[0].variants!;
    expect(generic.code.raw).toContain("/windows/install.ps1");
    expect(generic.code.raw).not.toContain("/ec2/");
    expect(ec2.code.raw).toContain("/windows/ec2/install.ps1");
    expect(ec2.note).toContain("ec2:DescribeTags");
    expect(generic.note).not.toContain("ec2:DescribeTags");
  });

  it("substitutes url/org and masks the ingestion token", () => {
    const generic = windowsCard(SUBS).steps[0].variants![0];
    expect(generic.code.raw).toContain(`${SUBS.url}/api/${SUBS.org}/`);
    expect(generic.code.raw).not.toContain("[BASIC_PASSCODE]");
    expect(generic.code.masked).not.toContain(SUBS.token);
  });

  it("adds the execution-policy guidance Linux does not need", () => {
    const questions = windowsCard(SUBS).extras!.troubleshooting!.map((r) => r.q);
    expect(questions[0]).toContain("fails to run");
    // Shares the rest of its troubleshooting with the Linux card.
    const linuxQs = linuxCard(SUBS).extras!.troubleshooting!.map((r) => r.q);
    expect(questions).toEqual(expect.arrayContaining(linuxQs));
  });
});

describe("WindowsConfig.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the windows slug", () => {
    expect(getDataSourceCard("windows", SUBS)?.provider.name).toBe("Windows");
    wrapper = mount(WindowsConfig, {
      global: { plugins: [mockStore, mockI18n] },
    });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("Windows");
  });
});
