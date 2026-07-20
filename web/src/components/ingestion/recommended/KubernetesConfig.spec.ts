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

// Mirrors the Databases leaf specs (see databases/Postgres.spec.ts): the card
// content is asserted on the pure builder, and the component test only proves
// the slug resolves through the shared renderer.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import KubernetesConfig from "./KubernetesConfig.vue";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";

// `isCloud` gates the in-cluster variants, so it must be mutable per-test.
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

// Imported lazily inside tests so the mocked aws-exports value is picked up.
const buildCard = async () =>
  (await import("@/components/ingestion/setupCard/content/kubernetes")).default(
    SUBS,
  );

describe("kubernetesCard builder", () => {
  beforeEach(() => {
    mockConfig.isCloud = "false";
  });

  it("builds the Kubernetes card metadata and step flow", async () => {
    const card = await buildCard();
    expect(card.provider.name).toBe("Kubernetes");
    expect(card.provider.metaBadges).toEqual([
      "Logs",
      "Metrics",
      "Events",
      "Traces",
    ]);
    expect(card.steps.map((s) => s.id)).toEqual([
      "install",
      "instrument",
      "verify",
    ]);
    expect(card.detect).toMatchObject({
      streamType: "logs",
      streamName: "default",
    });
  });

  it("takes the cluster name as a live input feeding the install command", async () => {
    const install = (await buildCard()).steps.find((s) => s.id === "install")!;
    expect(install.required).toBe(true);
    expect(install.inputs?.map((i) => i.id)).toEqual(["cluster"]);
    expect(install.inputs![0].default).toBe("cluster1");
    // The {cluster} placeholder must survive build-time substitution so the
    // renderer can fill it as the user types.
    for (const v of install.variants!) {
      expect(v.code.raw).toContain("{cluster}");
    }
  });

  it("substitutes the org and token, and masks the token", async () => {
    const install = (await buildCard()).steps.find((s) => s.id === "install")!;
    const external = install.variants!.find((v) => v.id === "external")!;
    expect(external.code.raw).toContain(`--org-id=${SUBS.org}`);
    expect(external.code.raw).toContain(`--access-key=${SUBS.token}`);
    expect(external.code.raw).toContain(`--o2-url=${SUBS.url}`);
    expect(external.code.masked).not.toContain(SUBS.token);
  });

  it("marks the quick install as the recommended path", async () => {
    const install = (await buildCard()).steps[0];
    expect(install.title).toBe("Quick Install (Recommended)");
    expect(install.required).toBe(true);
  });

  it("points from the install step to the advanced section", async () => {
    // The accordion sits below the verify step, so without this pointer a user
    // who wants Helm has to scroll past two steps that don't apply to them.
    const card = await buildCard();
    const install = card.steps[0];
    const label = card.extras!.advanced!.label;
    for (const v of install.variants!) {
      // A jump link, not prose — it opens the accordion and scrolls to it.
      expect(v.note).toContain(`[${label}](#advanced)`);
    }
    expect(label).toBe("Advanced Installation (Manual Steps)");
  });

  it("keeps the quick install to the two endpoint choices", async () => {
    // The one-line installer is the recommended path — Helm must NOT dilute
    // this toggle (it lives in the collapsed advanced section instead).
    const install = (await buildCard()).steps[0];
    expect(install.variants?.map((v) => v.id)).toEqual(["external", "internal"]);
    for (const v of install.variants!) {
      expect(v.code.raw).toContain("install.sh");
      expect(v.code.raw).not.toContain("helm");
    }
  });

  it("drops the endpoint toggle entirely on cloud", async () => {
    // Cloud has no in-cluster router, so there is nothing to choose between.
    mockConfig.isCloud = "true";
    vi.resetModules();
    const install = (await buildCard()).steps[0];
    expect(install.variants).toBeUndefined();
    expect(install.code?.raw).toContain("--o2-url=");
    // With no variants to carry it, the installer note (and the jump link to
    // the advanced section) moves onto the step itself.
    expect(install.note).toContain(
      "[Advanced Installation (Manual Steps)](#advanced)",
    );
  });

  it("points the internal variant at the cluster-local router", async () => {
    const internal = (await buildCard()).steps[0].variants!.find(
      (v) => v.id === "internal",
    )!;
    expect(internal.code.raw).toContain(
      "--internal-endpoint=http://o2-openobserve-router.openobserve.svc.cluster.local:5080",
    );
    expect(internal.code.raw).not.toContain("--o2-url");
  });

  it("keeps the manual helm sequence as one collapsed advanced block", async () => {
    const advanced = (await buildCard()).extras!.advanced!;
    expect(advanced.label).toContain("Advanced Installation");
    const code = advanced.code.raw;
    // Previously six separate copy boxes plus a "wait 2 minutes" instruction.
    expect(code).toContain("cert-manager.yaml");
    expect(code).toContain("kubectl wait --for=condition=Available");
    expect(code).toContain("prometheus-operator");
    expect(code).toContain("opentelemetry-operator.yaml");
    expect(code).toContain("helm repo add openobserve");
    expect(code).toContain("upgrade --install o2c");
    expect(code).toContain(`endpoint=${SUBS.url}/api/${SUBS.org}`);
    // Shares the step's live {cluster} input and masks the token.
    expect(code).toContain("{cluster}");
    expect(advanced.code.masked).not.toContain(SUBS.token);
  });

  it("exposes auto-instrumentation as an optional per-language step", async () => {
    const step = (await buildCard()).steps.find((s) => s.id === "instrument")!;
    // Not required — the chip renders "Optional" off the absent `required`.
    expect(step.required).toBeUndefined();
    expect(step.variants?.map((v) => v.id)).toEqual([
      "java",
      "dotnet",
      "nodejs",
      "python",
      "go",
    ]);
    expect(step.variants!.every((v) => !!v.icon)).toBe(true);

    const java = step.variants!.find((v) => v.id === "java")!;
    expect(java.code.raw).toContain(
      'instrumentation.opentelemetry.io/inject-java="openobserve-collector/openobserve-java"',
    );
    // Injection only happens at pod creation, so a restart is part of the step.
    expect(java.code.raw).toContain("kubectl rollout restart");

    // Go's eBPF instrumentation additionally needs the in-container binary path.
    const go = step.variants!.find((v) => v.id === "go")!;
    expect(go.code.raw).toContain(
      "instrumentation.opentelemetry.io/otel-go-auto-target-exe",
    );
  });

  it("anchors detection on the verify step with a valid SQL filter", async () => {
    const card = await buildCard();
    const verify = card.steps.find((s) => s.id === "verify")!;
    expect(verify.completeOn).toBe("detect");
    expect(verify.detectionAnchor).toBe(true);
    // useStreamDetect interpolates this into `WHERE (<filter>)`, so an empty
    // filter would produce invalid SQL and never connect.
    expect(card.detect.filter.trim()).not.toBe("");
  });

  it("keeps the example and operator references as real anchors", async () => {
    // Both were <a> tags on the pre-migration page; they must not degrade into
    // unclickable text inside the troubleshooting accordion.
    const card = await buildCard();
    const urls = (card.docLinks ?? []).map((l) => l.url);
    expect(urls).toContain("https://github.com/openobserve/hotcommerce");
    expect(urls).toContain(
      "https://github.com/open-telemetry/opentelemetry-operator",
    );
  });

  it("carries troubleshooting guidance without markdown link syntax", async () => {
    const ts = (await buildCard()).extras!.troubleshooting!;
    expect(ts.length).toBeGreaterThan(0);
    // inlineMd only renders **bold** and `code`; links would show as raw text.
    for (const row of ts) {
      expect(row.a).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
    }
  });
});

describe("KubernetesConfig.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the kubernetes slug", () => {
    expect(getDataSourceCard("kubernetes", SUBS)?.provider.name).toBe(
      "Kubernetes",
    );
    wrapper = mount(KubernetesConfig, {
      global: { plugins: [mockStore, mockI18n] },
    });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("Kubernetes");
  });
});
