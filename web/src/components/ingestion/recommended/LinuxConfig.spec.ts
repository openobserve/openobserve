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
import { gt } from "@/types/i18n";

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
    const card = linuxCard(SUBS, gt);
    expect(card.provider.name).toBe("Linux");
    expect(card.provider.metaBadges).toEqual(["Logs", "Metrics", "Traces"]);
    expect(card.steps.map((s) => s.id)).toEqual(["install", "verify", "dashboard"]);
    // Host metrics fan out per metric, so detection is existence-based.
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
    });
  });

  // The exact pre-traces command: the default variant must not drift from it.
  const BASE_INSTALL = `curl -O https://raw.githubusercontent.com/openobserve/agents/main/linux/install.sh \\
  && chmod +x install.sh \\
  && sudo ./install.sh ${SUBS.url}/api/${SUBS.org}/ ${SUBS.token}`;

  const installVariants = () => linuxCard(SUBS, gt).steps[0].variants!;

  it("toggles the install command between logs & metrics and logs, metrics & traces", () => {
    // The standard script also collects EC2 instance metadata — no AWS EC2 variant.
    const install = linuxCard(SUBS, gt).steps[0];
    expect(install.required).toBe(true);
    expect(install.variants?.map((v) => v.id)).toEqual(["logs-metrics", "traces"]);
    for (const v of install.variants!) expect(v.code.raw).not.toContain("/ec2/");
  });

  it("keeps the default logs & metrics command unchanged", () => {
    const [base] = installVariants();
    expect(base.code.raw).toBe(BASE_INSTALL);
    expect(base.code.raw).not.toContain("--trace");
  });

  it("appends the tracing flags to the traces variant", () => {
    const traces = installVariants()[1];
    expect(traces.code.raw).toBe(`${BASE_INSTALL}{flags}`);
    expect(linuxCard(SUBS, gt).steps[0].inputs).toBeUndefined();
    expect(installVariants()[0].inputs).toBeUndefined();
    expect(traces.inputs?.map((i) => [i.flag, i.default])).toEqual([
      ["--trace-ports", "8080"],
      ["--trace-exe", ""],
      ["--trace-cmd", ""],
      ["--service-name", ""],
    ]);
    expect(traces.requireOneOf?.ids).toEqual(["ports", "exe", "cmd"]);
  });

  it("shows the tracing note on the traces variant only", () => {
    const [base, traces] = installVariants();
    expect(base.note).toBeUndefined();
    expect(traces.note).toMatch(/^Traces are captured with eBPF/);
    expect(traces.note).toContain("BTF");
    // Recovery points at the plain command: --service-name alone would be rejected.
    expect(traces.note).toContain("re-run the **Logs & metrics** command");
  });

  it("links the eBPF tracing guide and tells the verify step when traces arrive", () => {
    const card = linuxCard(SUBS, gt);
    expect(card.docLinks?.map((l) => l.url)).toEqual([
      "https://github.com/openobserve/agents/blob/main/obi.md",
    ]);
    expect(card.steps[1].note).toContain("traced app handles a request");
    // Detection stays on host metrics, tracing or not.
    expect(card.detect?.streamName).toBe("system_");
  });

  it("offers the uninstall command", () => {
    const uninstall = linuxCard(SUBS, gt).extras?.uninstall;
    expect(uninstall?.code.raw).toContain("/linux/uninstall.sh");
    expect(uninstall?.code.lang).toBe("bash");
    expect(uninstall?.code.raw).not.toContain("/ec2/");
  });

  it.each(["logs-metrics", "traces"])(
    "substitutes url/org and masks the ingestion token (%s)",
    (id) => {
      const code = installVariants().find((v) => v.id === id)!.code;
      expect(code.raw).toContain(`${SUBS.url}/api/${SUBS.org}/`);
      expect(code.raw).toContain(SUBS.token);
      // The old page rendered a literal [BASIC_PASSCODE] placeholder instead.
      expect(code.raw).not.toContain("[BASIC_PASSCODE]");
      expect(code.masked).not.toContain(SUBS.token);
    },
  );
});

describe("LinuxConfig.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the linux slug", () => {
    expect(getDataSourceCard("linux", SUBS, gt)?.provider.name).toBe("Linux");
    wrapper = mount(LinuxConfig, { global: { plugins: [mockStore, mockI18n] } });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("Linux");
  });
});
