// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import Controls from "./CatalogVersionControls.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import type { IdentityEnv, Scope, ServicesResponse } from "@/services/service_versions";
import { NO_ENV, inEnv, scopesInEnv } from "@/services/service_versions.envs";
import {
  catalogEnvCounts,
  catalogMatches,
  catalogPlace,
  chipEnv,
} from "@/plugins/traces/servicesCatalogVersions";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/services/http", () => ({ default: () => transport }));
const storeState = vi.hoisted(() => ({
  selectedOrganization: { identifier: "org" },
  userInfo: { email: "admin@example.com" },
  timezone: "UTC",
  zoConfig: { features: {} as Record<string, string> },
}));
vi.mock("vuex", () => ({ useStore: () => ({ state: storeState }) }));

const tip = { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } };
const select = {
  OSelect: { props: ["disabled"], template: "<div><slot name='trigger' /><slot /></div>" },
  OSelectItem: { props: ["value", "label"], template: "<div><slot>{{ label }}</slot></div>" },
};
const base: Scope = {
  service: "cart",
  scope_key: "cart",
  where_key: "k8s:eu-a/shop",
  where: { kind: "k8s", k8s_cluster: "eu-a", k8s_namespace: "shop" },
  env: "prod",
  env_source: "attribute",
  no_env: false,
  signals: ["traces"],
  active_versions: [],
};
// Contract: a scope with no reported env keeps its stored text and carries no_env, its where a bare default.
const noEnvScope: Scope = {
  ...base,
  service: "legacy-cron",
  scope_key: "legacy",
  where_key: "default",
  where: { kind: "default", k8s_cluster: "", k8s_namespace: "" },
  env: "default",
  env_source: "default",
  no_env: true,
};
const inferredScope: Scope = {
  ...base,
  service: "search-api",
  scope_key: "search",
  env: "staging",
  env_source: "cluster",
  env_source_value: "stg-us1",
  env_is_inferred: true,
};
const data = (services: Scope[]): ServicesResponse => ({
  services,
  envs: [
    { env: "prod", where_keys: ["k8s:eu-a/shop"], no_env: false },
    { env: "staging", where_keys: ["k8s:eu-a/shop"], no_env: false },
    ...(services.some((scope) => scope.no_env)
      ? [{ env: "", where_keys: ["default"], no_env: true }]
      : []),
  ],
  verdict_status: "ok",
});
const envItem = (patch: Partial<IdentityEnv>): IdentityEnv => ({
  env: "prod",
  services: 3,
  wheres: 2,
  sources: ["attribute"],
  no_env: false,
  inferred: false,
  ...patch,
});
let wrapper: VueWrapper | undefined;
function serve(envs: IdentityEnv[]) {
  transport.get.mockImplementation(async (url: string) =>
    url.endsWith("/service_identity/envs") ? { data: { envs, can_edit: true } } : { data: {} },
  );
}
async function controls(services: Scope[], env = "") {
  wrapper = mount(Controls, {
    props: {
      data: data(services),
      state: "ready",
      env,
      verdict: "",
      envCounts: catalogEnvCounts(services.map((versionScope) => ({ versionScope }))),
      envTotal: services.length,
    },
    global: { stubs: { ...select, ...tip } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  queryClient.clear();
  document.body.innerHTML = "";
});

describe("Env filter counts, inferred and No env", () => {
  it("counts the stream's services, not the org's, marks an only-inferred env and lists No env last", async () => {
    serve([
      envItem({ env: "prod", services: 3 }),
      envItem({ env: "staging", services: 1, sources: ["cluster"], inferred: true }),
      envItem({ env: "", services: 2, sources: ["default"], no_env: true }),
    ]);
    const view = await controls([base, inferredScope, noEnvScope]);
    expect(view.get('[data-test="svcver-env-option-all-count"]').text()).toBe("3");
    expect(view.get('[data-test="svcver-env-option-prod-count"]').text()).toBe("1");
    expect(view.find('[data-test="svcver-env-option-prod-inferred"]').exists()).toBe(false);
    expect(view.get('[data-test="svcver-env-option-staging"]').text()).toContain(
      "staging · inferred",
    );
    const none = view.get('[data-test="svcver-env-option-none"]');
    expect(none.text()).toBe("No env1");
    const options = view
      .findAll('[data-test^="svcver-env-option-"]')
      .map((node) => node.attributes("data-test"))
      .filter((id) => !id?.endsWith("-count"));
    expect(options.at(-1)).toBe("svcver-env-option-none");
    expect(view.find('[data-test="svcver-env-option-"]').exists()).toBe(false);
  });

  it("leaves out No env and envs with no service in the stream", async () => {
    serve([envItem({ env: "prod", services: 1 })]);
    const view = await controls([base]);
    expect(view.find('[data-test="svcver-env-option-none"]').exists()).toBe(false);
    expect(view.find('[data-test="svcver-env-option-staging"]').exists()).toBe(false);
  });

  it("keeps the menu when the env read fails", async () => {
    transport.get.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    const view = await controls([base, noEnvScope]);
    expect(view.find('[data-test="svcver-env-option-prod"]').exists()).toBe(true);
    expect(view.get('[data-test="svcver-env-option-none"]').text()).toBe("No env1");
  });

  it("names the pick once after the Env label, No env included, never its key or segment", async () => {
    serve([]);
    let view = await controls([base, noEnvScope], NO_ENV);
    expect(view.get('[data-test="svcver-env-filter-value"]').text()).toBe("No env");
    expect(view.find('[data-test="svcver-env-chip"]').exists()).toBe(false);
    expect(view.text()).not.toContain("default");
    view.unmount();
    view = await controls([base, inferredScope], "staging");
    expect(view.get('[data-test="svcver-env-filter-value"]').text()).toBe("staging");
    expect(view.find('[data-test="svcver-env-inferred"]').exists()).toBe(false);
  });
});

describe("No env matching", () => {
  it("matches exactly the no-env scopes, and a real env named default never matches one", () => {
    const realDefault: Scope = { ...base, scope_key: "real", env: "default", no_env: false };
    expect(scopesInEnv([base, noEnvScope, realDefault], NO_ENV)).toEqual([noEnvScope]);
    expect(scopesInEnv([base, noEnvScope, realDefault], "default")).toEqual([realDefault]);
    expect(inEnv(noEnvScope, "default")).toBe(false);
    const row = (scope: Scope) => ({ versionScope: scope });
    expect(catalogMatches(row(noEnvScope), NO_ENV, "", "ready", false)).toBe(true);
    expect(catalogMatches(row(base), NO_ENV, "", "ready", false)).toBe(false);
    expect(chipEnv(noEnvScope, NO_ENV)).toBe("default");
  });

  it("gives a default where no place to print", () => {
    expect(catalogPlace("default", noEnvScope)).toEqual({
      cluster: "",
      namespace: "",
      flat: true,
      none: true,
    });
    expect(catalogPlace("env:prod").none).toBeUndefined();
  });
});

describe("No env chip", () => {
  it("reads No env in the neutral muted variant, never default, and offers to set one", () => {
    wrapper = mount(ServiceEnvChip, {
      props: { identity: noEnvScope, service: "legacy-cron" },
      global: { stubs: tip },
    });
    const chip = wrapper.get('[data-test="svcver-env-none"]');
    expect(chip.text()).toBe("envNo env");
    expect(wrapper.find('[data-test="svcver-env-inferred"]').exists()).toBe(false);
    const tooltip = wrapper.get('[data-test="svcver-env-tooltip"]').text().replace(/\s+/g, " ");
    const [setup, where, ...rest] = tooltip.split(". ");
    expect(setup).toContain("deployment.environment");
    expect(setup).toContain("click to set one");
    expect(where).toMatch(/^Where/);
    expect(rest).toEqual([]);
    expect(wrapper.text()).not.toMatch(/default/i);
  });

  it("shows No env for the pinned env the catalog passes as the shown env", () => {
    wrapper = mount(ServiceEnvChip, {
      props: { identity: noEnvScope, shownEnv: chipEnv(noEnvScope, ""), readonly: true },
      global: { stubs: tip },
    });
    expect(wrapper.find('[data-test="svcver-env-none"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/default/i);
  });

  it("keeps a real env named default as a normal chip", () => {
    wrapper = mount(ServiceEnvChip, {
      props: { identity: { ...base, env: "default", no_env: false }, readonly: true },
      global: { stubs: tip },
    });
    expect(wrapper.find('[data-test="svcver-env-none"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="svcver-env-chip"]').text()).toContain("default");
  });
});
