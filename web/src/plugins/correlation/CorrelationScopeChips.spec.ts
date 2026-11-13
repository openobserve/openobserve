// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import Chips from "./CorrelationScopeChips.vue";
import type { Scope, VerdictSummary } from "@/services/service_versions";

vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("vuex", () => ({ useStore: () => ({ state: { selectedOrganization: {} } }) }));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: () => ({ open: vi.fn() }),
}));

const scope = (patch: Partial<Scope> = {}): Scope => ({
  service: "orders-api",
  scope_key: "orders",
  where_key: "k8s:shop/web",
  where: { kind: "k8s", k8s_cluster: "shop", k8s_namespace: "web" },
  env: "prod",
  env_source: "attribute",
  signals: ["traces"],
  newest_version: "2.0",
  active_versions: ["2.0"],
  ...patch,
});
const verdict = (patch: Partial<VerdictSummary> = {}) =>
  ({
    version: "1.0",
    version_key: "k1",
    verdict: "ok",
    baseline: { version: "2.0", rule: "previous" },
    deploy: { kind: "rollback", at: 1, from_version: "2.0" },
    ...patch,
  }) as VerdictSummary;
const render = (value: Scope) =>
  mount(Chips, {
    props: { scope: value },
    global: {
      plugins: [i18n],
      stubs: { ServiceEnvChip: true, VerdictChip: true, OButton: true, OIcon: true },
    },
  });

describe("the correlation header scope chips", () => {
  it("labels a rollback's verdict with the same header suffix as the compare drawer", () => {
    const chips = render(scope({ newest_verdict: verdict(), current_version: "1.0" }));
    expect(chips.get('[data-test="svcver-correlation-rollout-verdict"]').text()).toContain(
      "Deploy verdict 2.0 → 1.0 · rollback",
    );
  });

  it("adds no suffix to a plain deploy", () => {
    const chips = render(
      scope({
        newest_verdict: verdict({
          version: "2.0",
          baseline: { version: "1.0", rule: "previous" },
          deploy: { kind: "deploy", at: 1, from_version: "1.0" },
        }),
      }),
    );
    const text = chips.get('[data-test="svcver-correlation-rollout-verdict"]').text();
    expect(text).toContain("Deploy verdict 1.0 → 2.0");
    expect(text).not.toContain("·");
  });

  it("shows the version serving now, not the newest one seen", () => {
    const chips = render(scope({ current_version: "1.0", active_versions: ["1.0"] }));
    expect(chips.get('[data-test="svcver-correlation-version"]').text()).toContain("1.0");
    expect(chips.get('[data-test="svcver-correlation-version"]').text()).not.toContain("2.0");
  });

  it("gives the where chip no pod tooltip when its own place picked the scope", () => {
    const chips = render(scope());
    expect(chips.find('[data-test="svcver-correlation-where-by-pod"]').exists()).toBe(false);
  });

  it("names only the pod when the picked where has no cluster to quote, and skips an absent log cluster", () => {
    const chips = mount(Chips, {
      props: {
        scope: scope({
          where_key: "env:prod",
          where: { kind: "env", k8s_cluster: "", k8s_namespace: "" },
        }),
        byPod: { pod: "web-1" },
      },
      global: {
        plugins: [i18n],
        stubs: {
          ServiceEnvChip: true,
          VerdictChip: true,
          OButton: true,
          OIcon: true,
          OTooltip: { template: "<div><slot /><slot name='content' /></div>" },
        },
      },
    });
    const tip = chips.get('[data-test="svcver-correlation-where-by-pod"]').text();
    expect(tip).toContain("picked from this log's pod");
    expect(tip).not.toContain("sent its spans");
    expect(tip).not.toContain("own cluster");
  });
});
