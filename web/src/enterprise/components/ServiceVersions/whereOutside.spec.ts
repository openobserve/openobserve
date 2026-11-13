// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import { gt } from "@/types/i18n";
import type { Scope } from "@/services/service_versions";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import CorrelationScopeChips from "@/plugins/correlation/CorrelationScopeChips.vue";
import { envSourceSentence, envWhereLine } from "@/components/shared/ChangeEnvPopover.vue";
import {
  isOutsideK8s,
  whereOutsideReason,
  whereSentence,
  whereText,
} from "@/utils/serviceVersionsCopy";

vi.mock("@/services/http", () => ({
  default: () => ({ get: vi.fn(async () => ({ data: {} })), put: vi.fn(), delete: vi.fn() }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org" },
      userInfo: { email: "admin@example.com" },
      timezone: "UTC",
      zoConfig: { features: {} },
    },
  }),
}));
vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: () => ({ open: vi.fn() }),
}));
vi.mock("@/utils/chartTheme", () => ({ chartColor: (token: string) => token }));

const tip = {
  OTooltip: {
    props: ["content"],
    template: "<div><slot /><slot name='content' /><span>{{ content }}</span></div>",
  },
};
// Contract: a scope that reports no env and has no K8s place keeps "default" in both stored fields.
const noEnvNoWhere: Scope = {
  service: "legacy-cron",
  scope_key: "legacy",
  where_key: "default",
  where: { kind: "default", k8s_cluster: "", k8s_namespace: "" },
  env: "default",
  env_source: "default",
  no_env: true,
  signals: ["traces"],
  newest_version: "0.4.0",
  active_versions: ["0.4.0"],
};
const k8sPlace = {
  where_key: "k8s:eu-a/shop",
  where: { kind: "k8s", k8s_cluster: "eu-a", k8s_namespace: "shop" },
};
let wrapper: VueWrapper | undefined;
const flat = (view: VueWrapper) => view.text().replace(/\s+/g, " ");

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  queryClient.clear();
});

describe("the shared where label", () => {
  it("reads Outside Kubernetes for a default where or a K8s place with no cluster or namespace", () => {
    expect(isOutsideK8s("default")).toBe(true);
    expect(isOutsideK8s("default", noEnvNoWhere.where)).toBe(true);
    expect(isOutsideK8s("k8s:/", { kind: "k8s", k8s_cluster: "", k8s_namespace: "" })).toBe(true);
    expect(isOutsideK8s("k8s:/web")).toBe(false);
    expect(isOutsideK8s("env:prod")).toBe(false);
    expect(isOutsideK8s("")).toBe(false);
    expect(whereText("default", null, gt)).toBe("Outside Kubernetes");
    expect(whereText(k8sPlace.where_key, k8sPlace.where, gt)).toBe("eu-a · shop");
    expect(whereOutsideReason(gt)).toBe(
      "Outside Kubernetes · all instances of this service together",
    );
  });

  it("words a where sentence without 'in Outside Kubernetes'", () => {
    const keys = {
      in: "serviceVersions.compare.pods.title",
      outside: "serviceVersions.compare.pods.titleOutside",
    } as const;
    expect(whereSentence(keys, "default", null, {}, gt)).toBe("Pods outside Kubernetes");
    expect(whereSentence(keys, "k8s:c1/web", null, {}, gt)).toBe("Pods in c1 · web");
  });
});

describe("no-env, no-where scope on every surface", () => {
  it("where chip: muted Outside Kubernetes with its reason, never default", () => {
    wrapper = mount(ServiceScopeChip, {
      props: { facet: "where", whereKey: "default", place: noEnvNoWhere.where },
      global: { stubs: tip },
    });
    const chip = wrapper.get('[data-test="svcver-where-none"]');
    expect(chip.text()).toContain("Outside Kubernetes");
    expect(flat(wrapper)).toContain("Outside Kubernetes · all instances of this service together");
    expect(wrapper.text()).not.toMatch(/default/i);
  });

  it("correlation header: env and where chips print no default", async () => {
    wrapper = mount(CorrelationScopeChips, {
      props: { scope: noEnvNoWhere },
      global: { stubs: { ...tip, VerdictChip: true } },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="svcver-correlation-where"]').text()).toContain(
      "Outside Kubernetes",
    );
    expect(wrapper.find('[data-test="svcver-env-none"]').exists()).toBe(true);
    const envAndWhere = [
      wrapper.get('[data-test="svcver-correlation-env-chip"]').text(),
      wrapper.get('[data-test="svcver-correlation-where"]').text(),
    ].join(" ");
    expect(envAndWhere).not.toMatch(/default/i);
  });
});

describe("env copy follows the where, not no_env", () => {
  it("a no-env scope with a real where never claims to run outside Kubernetes", () => {
    const inK8s: Scope = { ...noEnvNoWhere, ...k8sPlace };
    expect(envSourceSentence(inK8s, gt, "UTC")).toBe(
      "this service sends no deployment.environment",
    );
    expect(envWhereLine(inK8s, gt)).toBe("cluster eu-a · namespace shop");
    wrapper = mount(ServiceEnvChip, { props: { identity: inK8s }, global: { stubs: tip } });
    expect(wrapper.find('[data-test="svcver-env-none"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/outside Kubernetes/i);
    expect(wrapper.text()).not.toMatch(/default/i);
  });

  it("a stored literal default sent as an attribute still reads No env, not 'from your attribute (default)'", () => {
    const literal: Scope = {
      ...noEnvNoWhere,
      env_source: "attribute",
      env_source_value: "deployment.environment=default",
    };
    expect(envSourceSentence(literal, gt, "UTC")).toBe(
      "this service sends no deployment.environment and runs outside Kubernetes",
    );
  });
});
