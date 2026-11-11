// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import ServiceEnvVersionSettings from "./ServiceEnvVersionSettings.vue";
import CorrelationSettings from "./CorrelationSettings.vue";
import DiscoveredServices from "./DiscoveredServices.vue";
import { envFixtures } from "@/components/shared/ChangeEnvPopover.fixtures";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  post: vi.fn(),
}));
const route = vi.hoisted(() => ({ params: { tab: "env-versions" }, query: {} }));
vi.mock("@/services/http", () => ({ default: () => transport }));
vi.mock("@/aws-exports", async (original) => {
  const actual = await original<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});
vi.mock("vuex", async (original) => ({
  ...(await original<object>()),
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org" },
      userInfo: { email: "admin@example.com" },
      timezone: "UTC",
      organizationSettings: {},
    },
  }),
}));
vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}));
vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: vi.fn().mockResolvedValue({ data: [] }),
    updateSemanticGroups: vi.fn(),
    getServicesList: vi.fn().mockResolvedValue({
      data: [
        {
          id: "1",
          org_id: "org",
          service_name: "ingester",
          set_id: "s",
          disambiguation: {},
          all_dimensions: {},
          logs_streams: [],
          traces_streams: ["default"],
          metrics_streams: [],
          field_name_mapping: {},
          last_seen: 1,
        },
      ],
    }),
    resetServices: vi.fn(),
  },
}));

const { previous, overrideRow } = envFixtures;
const clusterRow = {
  ...previous,
  rule_key: "org/cluster/c1//",
  scope: "cluster" as const,
  k8s_cluster: "c1",
  where_key: "",
  value: "prod",
  inferred_value: "c1",
  inferred_source: "cluster_name",
  created_by: "prabhat@example.com",
  updated_by: "prabhat@example.com",
  affected: { services: 15, versions: 27 },
};
const whereRow = overrideRow;
let wrapper: VueWrapper | undefined;
const $ = (test: string) => document.body.querySelector<HTMLElement>(`[data-test="${test}"]`);
const fail = (status: number) => ({ isAxiosError: true, response: { status, data: {} } });

function serve(overrides: unknown[] | { reject: unknown }) {
  transport.get.mockImplementation(async () => {
    if (!Array.isArray(overrides)) throw overrides.reject;
    return { data: { overrides, total: overrides.length } };
  });
}

async function render() {
  wrapper = mount(ServiceEnvVersionSettings, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  queryClient.clear();
  document.body.innerHTML = "";
});

describe("Environments & versions", () => {
  it("lists what each override matches, its inferred and set labels and its reach", async () => {
    serve([whereRow, clusterRow]);
    const view = await render();
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org/service_identity/overrides",
      expect.objectContaining({ params: { limit: 50, offset: 0 } }),
    );
    const text = view.get('[data-test="svcver-overrides-table"]').text();
    expect(text).toContain("namespace shop-cloud-prod in cluster eu-a");
    expect(text).toContain("1 service · 2 versions");
    expect(text).toContain("cluster c1 (all namespaces)");
    expect(text).toContain("from cluster name");
    expect(text).toContain("prabhat");
    expect(view.text()).toContain("2 · they win over detection for what they match");
  });

  it("removes with DELETE and Undo re-PUTs the removed override", async () => {
    serve([whereRow]);
    transport.delete.mockResolvedValue({ data: { removed: whereRow } });
    transport.put.mockResolvedValue({
      data: {
        override: whereRow,
        previous: null,
        removed: false,
        affected: { services: 9, versions: 14 },
      },
    });
    const view = await render();
    await view.get(`[data-test="svcver-override-remove-${whereRow.rule_key}"]`).trigger("click");
    await flushPromises();
    expect(transport.delete.mock.calls[0][0]).toBe(
      `/api/org/service_identity/overrides/${encodeURIComponent(whereRow.rule_key)}`,
    );
    $("svcver-overrides-undo")!.click();
    await flushPromises();
    expect(transport.put.mock.calls[0][1]).toEqual({
      scope: "where",
      where_key: whereRow.where_key,
      k8s_cluster: "eu-a",
      service_name: "",
      value: "eu1cloud",
    });
    expect($("svcver-overrides-undo-bar")).toBeNull();
  });

  it("shows the empty state with the detection sentence and the versions note", async () => {
    serve([]);
    const view = await render();
    expect(view.get('[data-test="svcver-overrides-empty"]').text()).toContain("No overrides");
    expect(view.get('[data-test="svcver-overrides-empty"]').text()).toContain(
      "deployment.environment",
    );
    expect(view.get('[data-test="svcver-overrides-versions-note"]').text()).toContain(
      "Nothing to configure.",
    );
  });

  it.each([
    [403, "svcver-overrides-denied", ""],
    [503, "svcver-overrides-error", "unavailable right now"],
    [500, "svcver-overrides-error", "Couldn't load env overrides."],
  ])("renders the %s read state", async (status, test, copy) => {
    serve({ reject: fail(status) });
    const view = await render();
    // Reads retry once on 5xx before settling into the error state.
    await vi.waitFor(() => expect(view.find(`[data-test="${test}"]`).exists()).toBe(true), {
      timeout: 3000,
    });
    expect(view.text()).toContain(copy);
    expect(view.find('[data-test="svcver-overrides-table"]').exists()).toBe(false);
  });

  it("keeps the row and says why when Remove fails", async () => {
    serve([whereRow]);
    transport.delete.mockRejectedValue(fail(503));
    const view = await render();
    await view.get(`[data-test="svcver-override-remove-${whereRow.rule_key}"]`).trigger("click");
    await flushPromises();
    expect(view.get('[data-test="svcver-overrides-action-error"]').text()).toContain(
      "Couldn't remove the override",
    );
    expect($("svcver-overrides-undo-bar")).toBeNull();
  });
});

describe("Correlation Settings entry points", () => {
  it("opens the env-versions tab from its slug after Detection Rules", async () => {
    serve([]);
    wrapper = mount(CorrelationSettings, {
      global: {
        stubs: {
          ServiceEnvVersionSettings: { template: '<div data-test="env-versions-pane" />' },
          DiscoveredServices: true,
          ServiceIdentitySetup: true,
          OrganizationDeduplicationSettings: true,
          SemanticFieldGroupsConfig: true,
        },
      },
    });
    await flushPromises();
    const tabs = wrapper.findAll("[role=tab], [data-test$='-tab']").map((tab) => tab.text());
    expect(tabs.indexOf("Environments & versions")).toBe(tabs.indexOf("Detection Rules") + 1);
    expect(wrapper.find('[data-test="env-versions-pane"]').exists()).toBe(true);
  });

  it("links the override count from Discovered Services", async () => {
    transport.get.mockResolvedValue({ data: { overrides: [whereRow], total: 3 } });
    wrapper = mount(DiscoveredServices);
    await flushPromises();
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org/service_identity/overrides",
      expect.objectContaining({ params: { limit: 1 } }),
    );
    expect(wrapper.get('[data-test="svcver-tile-overrides"]').text()).toContain("3");
    const link = wrapper.get('[data-test="svcver-tile-overrides-view"]');
    expect(link.text()).toBe("View →");
    expect(link.find('[data-test="svcver-overrides-link"]').exists()).toBe(true);
    await link.trigger("click");
    expect(wrapper.emitted("navigate-to-env-versions")).toHaveLength(1);
  });
});
