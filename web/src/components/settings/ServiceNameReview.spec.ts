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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import ServiceNameReview, {
  aliasScopes,
  collisionOf,
  unresolvedFrom,
} from "./ServiceNameReview.vue";
import CorrelationSettings from "./CorrelationSettings.vue";
import DiscoveredServices, {
  proposedWorkloadsOf,
  scopeForRow,
  workloadOf,
} from "./DiscoveredServices.vue";
import serviceStreamsService from "@/services/service_streams";
import type { Alias, Collision, Scope } from "@/services/service_versions";
import stage7 from "@/test/unit/fixtures/serviceVersions/stage7.json";
import stage8 from "@/test/unit/fixtures/serviceVersions/stage8.json";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  post: vi.fn(),
}));
const router = vi.hoisted(() => ({
  route: { params: { tab: "services" }, query: {} as Record<string, string> },
  push: vi.fn(),
}));
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
  useRoute: () => router.route,
  useRouter: () => ({ push: router.push, replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}));
vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: vi.fn().mockResolvedValue({ data: [] }),
    updateSemanticGroups: vi.fn(),
    getServicesList: vi.fn().mockResolvedValue({ data: [] }),
    resetServices: vi.fn(),
  },
}));

// Aliases, rows and responses below come from the recorded Stage 8 producer run in stage8.json, trimmed.
const aliases = stage8.aliases_list.aliases as unknown as Alias[];
const byAlias = (alias: string) => aliases.find((row) => row.alias === alias)!;
const medium = byAlias("alertquerier");
const low = byAlias("worker");
const rename = byAlias("stock-svc");
const manual = byAlias("legacy-cart");
const collision = stage8.collision_409.collisions[0] as Collision;
const rowsGolden = stage8.service_streams;
const version = stage8.traces_latest_hit.first_event.o2_service_version;
// The Stage 8 golden has no _services read, so trace scopes are the Stage 7 real-producer scope moved to Stage 8 places.
const goldenScope = stage7.services_rum.services[0] as unknown as Scope;
const scope = (service: string, namespace: string, env: string): Scope => ({
  ...goldenScope,
  service,
  scope_key: `${service}/${namespace}`,
  env,
  where_key: `k8s:stage8/${namespace}`,
  where: { kind: "k8s", k8s_cluster: "stage8", k8s_namespace: namespace },
  newest_version: version,
});
const scopes: Scope[] = [
  scope("querier", "o2", "prod"),
  scope("querier", "pentest", "pentest"),
  scope("billing-worker", "batch", "prod"),
  scope("InventoryService", "shop", "prod"),
  scope("PaymentService", "shop", "prod"),
];
const conflict = (body: unknown = { error: "alias_collision", collisions: [collision] }) => ({
  isAxiosError: true,
  response: { status: 409, data: body },
});
const status = (code: number) => ({ isAxiosError: true, response: { status: code, data: {} } });

let lists: Record<string, { aliases: Alias[]; total: number }>;
let listError: unknown;
let placeholders: { service: string; last_seen: number }[];
let catalog: Scope[];
let stripped: number | undefined;

function answer(url: string, config: { params?: Record<string, unknown> }) {
  const params = config?.params || {};
  if (url.endsWith("/service_identity/overrides"))
    return Promise.resolve({ data: stage7.overrides });
  if (url.endsWith("/service_identity/envs")) return Promise.resolve({ data: stage7.envs });
  if (url.endsWith("/service_versions/_services"))
    return Promise.resolve({
      data: { ...stage7.services_rum, services: catalog, stripped_versions: stripped },
    });
  if (url.endsWith("/service_identity/unresolved"))
    return Promise.resolve({ data: { no_version: [], placeholder_names: placeholders } });
  if (!url.endsWith("/service_identity/aliases")) return Promise.reject(status(404));
  if (params.limit === 50 && listError) return Promise.reject(listError);
  const key = `${params.status}${params.confidence ? `:${params.confidence}` : ""}`;
  const data = lists[key] || { aliases: [], total: 0 };
  return Promise.resolve({
    data: params.limit === 1 ? { aliases: data.aliases.slice(0, 1), total: data.total } : data,
  });
}

function mountReview(props: Partial<InstanceType<typeof ServiceNameReview>["$props"]> = {}) {
  return mount(ServiceNameReview, {
    props: {
      services: [],
      scopes,
      traceNames: [...new Set(scopes.map((row) => row.service))],
      canEdit: true,
      ...props,
    },
    attachTo: document.body,
  });
}

let wrapper: VueWrapper | undefined;
beforeEach(() => {
  queryClient.clear();
  lists = {
    proposed: { aliases: [medium, low, { ...rename, status: "proposed" }], total: 3 },
    "proposed:high": { aliases: [rename], total: stage8.proposed_high_total },
    accepted: { aliases: [manual], total: 1 },
    rejected: { aliases: [], total: 0 },
  };
  listError = undefined;
  placeholders = [];
  catalog = scopes;
  stripped = undefined;
  transport.get.mockImplementation(answer);
  transport.put.mockResolvedValue({ data: {} });
  transport.post.mockResolvedValue({ data: {} });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

const byTest = (id: string) => wrapper!.find(`[data-test="${id}"]`);

const row = (key: Alias) => `svcver-alias-row-${key.alias_key}`;
const act = (action: string, key: Alias) => byTest(`svcver-alias-${action}-${key.alias_key}`);

describe("Name review list", () => {
  it("shows the pending rows with evidence, env per workload and the filter counts", async () => {
    wrapper = mountReview();
    await flushPromises();
    expect(byTest("svcver-name-review-filter-pending").text()).toContain("3");
    expect(byTest("svcver-name-review-filter-accepted").text()).toContain("1");
    expect(byTest("svcver-name-review-filter-rejected").text()).toContain("0");
    expect(byTest("svcver-name-review-accept-high").text()).toBe(
      `Accept ${stage8.proposed_high_total} high-confidence`,
    );
    expect(byTest(row(medium)).text()).toBe("querier");
    const text = byTest("svcver-name-review-table").text();
    expect(text).toContain("alertquerier");
    expect(text).toContain("2 of 2 pods shared");
    expect(text).toContain("2 pods across 2 services");
    expect(text).toContain("renamed from stock-svc");
    expect(text).toContain("Medium");
    expect(byTest(`svcver-alias-env-stays-${medium.alias_key}`).text()).toBe(
      "Env stays per workload: pentest and prod stay separate",
    );
    expect(byTest(`svcver-alias-env-stays-${rename.alias_key}`).exists()).toBe(false);
  });

  it("keeps a k8s_workload alias to its own namespace's scopes", () => {
    expect(aliasScopes(medium, scopes).map((entry) => entry.env)).toEqual(["pentest"]);
    expect(aliasScopes(low, scopes).map((entry) => entry.env)).toEqual(["prod"]);
    expect(aliasScopes({ ...rename, scope: "elsewhere" }, scopes)).toHaveLength(1);
  });

  it("accepts and rejects by alias key and never sends a display field", async () => {
    wrapper = mountReview();
    await flushPromises();
    await act("accept", medium).trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenCalledWith(
      `/api/org/service_identity/aliases/${medium.alias_key}`,
      { status: "active" },
      expect.anything(),
    );
    expect(wrapper.emitted("changed")).toHaveLength(1);
    await act("reject", low).trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenLastCalledWith(
      `/api/org/service_identity/aliases/${low.alias_key}`,
      { status: "rejected" },
      expect.anything(),
    );
  });

  it("maps the real 409 to the qualified choice and hides use-anyway", async () => {
    transport.put.mockRejectedValueOnce(conflict());
    wrapper = mountReview();
    await flushPromises();
    await act("accept", medium).trigger("click");
    await flushPromises();
    expect(byTest("svcver-alias-collision").text()).toBe(
      'querier is already shown for querier (prod). Two different components would both read "querier".',
    );
    expect(byTest("svcver-alias-collision-anyway").exists()).toBe(false);
    expect(byTest("svcver-alias-collision-qualified").text()).toBe("Use querier (pentest)");
    await byTest("svcver-alias-collision-qualified").trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenLastCalledWith(
      `/api/org/service_identity/aliases/${medium.alias_key}`,
      { status: "active", allow_collisions: true },
      expect.anything(),
    );
    expect(byTest("svcver-alias-collision").exists()).toBe(false);
  });

  it("lists a replicated alias that lost a collision as Pending, and its Accept gets the collision choices", async () => {
    // Remote apply stores the losing row as proposed with no acceptance, so an accepted rename comes back this way.
    const demoted: Alias = { ...manual, status: "proposed", accepted_by: null, accepted_at: null };
    lists.proposed = { aliases: [demoted], total: 1 };
    lists.accepted = { aliases: [], total: 0 };
    transport.put.mockRejectedValueOnce(
      conflict({
        error: "alias_collision",
        collisions: [{ ...collision, alias_key: demoted.alias_key }],
      }),
    );
    wrapper = mountReview();
    await flushPromises();
    expect(byTest("svcver-name-review-filter-pending").text()).toContain("1");
    expect(byTest(row(demoted)).exists()).toBe(true);
    await act("accept", demoted).trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenLastCalledWith(
      `/api/org/service_identity/aliases/${demoted.alias_key}`,
      { status: "active" },
      expect.anything(),
    );
    expect(byTest("svcver-alias-collision").exists()).toBe(true);
    expect(byTest("svcver-alias-collision-qualified").text()).toBe("Use querier (pentest)");
    expect(byTest("svcver-alias-collision-keep").exists()).toBe(true);
  });

  it("keeps the detected name by rejecting the colliding alias", async () => {
    transport.put.mockRejectedValueOnce(conflict());
    wrapper = mountReview();
    await flushPromises();
    await act("accept", medium).trigger("click");
    await flushPromises();
    await byTest("svcver-alias-collision-keep").trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenLastCalledWith(
      `/api/org/service_identity/aliases/${medium.alias_key}`,
      { status: "rejected" },
      expect.anything(),
    );
  });

  it("offers only Keep detected name when the server suggests no qualifier", async () => {
    transport.put.mockRejectedValueOnce(
      conflict({
        error: "alias_collision",
        collisions: [{ ...collision, suggested_qualifier: null, existing: [] }],
      }),
    );
    wrapper = mountReview();
    await flushPromises();
    await act("accept", medium).trigger("click");
    await flushPromises();
    expect(byTest("svcver-alias-collision").text()).toBe(
      'querier is already shown for another service. Two different components would both read "querier".',
    );
    expect(byTest("svcver-alias-collision-qualified").exists()).toBe(false);
    expect(byTest("svcver-alias-collision-keep").exists()).toBe(true);
  });

  it("reads a collision only from a 409 alias_collision body", () => {
    expect(collisionOf(conflict())).toEqual(collision);
    expect(collisionOf(status(409))).toBeNull();
    expect(collisionOf(status(500))).toBeNull();
    expect(collisionOf(new Error("x"))).toBeNull();
  });

  it("edits inline and PUTs the new display as canonical", async () => {
    wrapper = mountReview();
    await flushPromises();
    await act("edit", rename).trigger("click");
    await flushPromises();
    const editor = byTest("svcver-name-review-inline-edit");
    expect(editor.text()).toContain("Display as");
    expect(editor.text()).toContain("Changes the display only");
    expect(editor.find("input").element.value).toBe("InventoryService");
    await editor.find("input").setValue("Inventory");
    await byTest("svcver-alias-display-as-save").trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenLastCalledWith(
      `/api/org/service_identity/aliases/${rename.alias_key}`,
      { status: "active", canonical: "Inventory" },
      expect.anything(),
    );
    expect(byTest("svcver-name-review-inline-edit").exists()).toBe(false);
  });

  it("accepts high-confidence by filter, shows the names, then undoes the batch", async () => {
    transport.post.mockImplementation((url: string) =>
      Promise.resolve({ data: url.endsWith("/_bulk") ? stage8.bulk_accept_high : stage8.undo }),
    );
    wrapper = mountReview();
    await flushPromises();
    await byTest("svcver-name-review-accept-high").trigger("click");
    await flushPromises();
    expect(transport.post).toHaveBeenCalledWith(
      "/api/org/service_identity/aliases/_bulk",
      {
        action: "accept",
        alias_keys: null,
        filter: { status: "proposed", confidence: "high" },
        allow_collisions: false,
      },
      expect.anything(),
    );
    expect(byTest("svcver-name-review-accept-high").text()).toBe(
      `Accept ${stage8.bulk_accept_high.changed} high-confidence · done`,
    );
    const snack = document.querySelector('[data-test="svcver-name-review-undo"]');
    expect(snack?.textContent).toContain("Accepted 1 display name: InventoryService");
    (document.querySelector('[data-test="svcver-name-review-undo-action"]') as HTMLElement).click();
    await flushPromises();
    expect(transport.post).toHaveBeenLastCalledWith(
      "/api/org/service_identity/aliases/_undo",
      { batch_id: stage8.bulk_accept_high.batch_id },
      expect.anything(),
    );
    expect(document.querySelector('[data-test="svcver-name-review-undo"]')?.textContent).toContain(
      "Restored 1 name",
    );
  });

  it("says nothing was undone when the batch expired", async () => {
    transport.post.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith("/_bulk") ? stage8.bulk_accept_high : { restored: 0 },
      }),
    );
    wrapper = mountReview();
    await flushPromises();
    await byTest("svcver-name-review-accept-high").trigger("click");
    await flushPromises();
    (document.querySelector('[data-test="svcver-name-review-undo-action"]') as HTMLElement).click();
    await flushPromises();
    expect(document.querySelector('[data-test="svcver-name-review-undo"]')?.textContent).toContain(
      "Nothing to undo",
    );
  });

  it("lists skipped collisions after a bulk accept and opens the qualified choice", async () => {
    transport.post.mockResolvedValue({
      data: {
        ...stage8.bulk_accept_high,
        changed: 0,
        skipped_collisions: 1,
        collisions: [{ ...collision, alias_key: rename.alias_key }],
      },
    });
    wrapper = mountReview();
    await flushPromises();
    await byTest("svcver-name-review-accept-high").trigger("click");
    await flushPromises();
    expect(byTest("svcver-name-review-skipped").exists()).toBe(true);
    expect(byTest("svcver-alias-collision").exists()).toBe(true);
    expect(document.querySelector('[data-test="svcver-name-review-undo-action"]')).toBeNull();
  });

  it("reverts an accepted mapping with PUT rejected", async () => {
    wrapper = mountReview();
    await flushPromises();
    await byTest("svcver-name-review-filter-accepted").trigger("click");
    await flushPromises();
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org/service_identity/aliases",
      expect.objectContaining({ params: { status: "accepted", limit: 50, offset: 0 } }),
    );
    expect(act("accept", manual).exists()).toBe(false);
    await act("revert", manual).trigger("click");
    await flushPromises();
    expect(transport.put).toHaveBeenLastCalledWith(
      `/api/org/service_identity/aliases/${manual.alias_key}`,
      { status: "rejected" },
      expect.anything(),
    );
  });
});

describe("Name review states", () => {
  it("shows the denied state on a 403 read", async () => {
    listError = status(403);
    wrapper = mountReview();
    await flushPromises();
    expect(byTest("svcver-name-review-denied").exists()).toBe(true);
    expect(byTest("svcver-name-review-accept-high").exists()).toBe(false);
  });

  it("says unavailable on a 503 and offers retry", async () => {
    listError = status(503);
    wrapper = mountReview();
    await vi.waitFor(
      async () => {
        await flushPromises();
        expect(byTest("svcver-name-review-error").exists()).toBe(true);
      },
      { timeout: 4000 },
    );
    expect(byTest("svcver-name-review-error").text()).toContain("unavailable right now");
  });

  it("says there are no high-confidence names instead of offering to accept 0", async () => {
    lists["proposed:high"] = { aliases: [], total: 0 };
    wrapper = mountReview();
    await flushPromises();
    const button = byTest("svcver-name-review-accept-high");
    expect(button.text()).toBe("No high-confidence names");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("shows the empty state when nothing is pending", async () => {
    lists.proposed = { aliases: [], total: 0 };
    wrapper = mountReview();
    await flushPromises();
    expect(byTest("svcver-name-review-empty").text()).toContain("No names to review");
  });

  it("is read-only without edit rights: rows stay visible, actions go", async () => {
    wrapper = mountReview({ canEdit: false });
    await flushPromises();
    expect(byTest(row(medium)).exists()).toBe(true);
    expect(byTest("svcver-name-review-readonly").exists()).toBe(true);
    expect(act("accept", medium).exists()).toBe(false);
    expect(byTest("svcver-name-review-accept-high").exists()).toBe(false);
  });

  it("latches read-only after a write comes back 403", async () => {
    transport.put.mockRejectedValueOnce(status(403));
    wrapper = mountReview();
    await flushPromises();
    await act("accept", medium).trigger("click");
    await flushPromises();
    expect(act("accept", low).exists()).toBe(false);
    expect(byTest("svcver-name-review-readonly").exists()).toBe(true);
  });
});

describe("Unresolved group", () => {
  it("lists detection keys and placeholder names, never trace or alias rows", () => {
    const rows = unresolvedFrom(
      rowsGolden,
      stage8.unresolved.placeholder_names.map((entry) => entry.service),
    );
    const names = rows.map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining(["nats", "openobserve", "unknown_service:node"]));
    for (const key of ["checkoutservice", "payments-api", "legacy-cart", "querier"])
      expect(names).not.toContain(key);
    const ambiguous = rows.find((entry) => entry.name === "openobserve")!;
    expect(ambiguous.candidates).toEqual(["compactor", "ingester", "querier"]);
    expect(rows.find((entry) => entry.name === "nats")!.signals).toEqual(["logs"]);
    expect(rows.find((entry) => entry.name === "unknown_service:node")).toMatchObject({
      placeholder: true,
      signals: ["traces"],
    });
  });

  it("wraps the reason text instead of cutting it", async () => {
    placeholders = [{ service: "unknown_service:java", last_seen: 1 }];
    wrapper = mountReview();
    await flushPromises();
    const table = wrapper
      .findAllComponents({ name: "OTable" })
      .find((candidate) => candidate.attributes("data-test") === "svcver-unresolved-table");
    expect(table?.props("wrap")).toBe(true);
  });

  it("explains ambiguity without an action and offers Display as… elsewhere", async () => {
    placeholders = stage8.unresolved.placeholder_names;
    wrapper = mountReview({ services: rowsGolden });
    await flushPromises();
    const table = byTest("svcver-unresolved-table").text();
    expect(table).toContain(
      "One detected name covers pods of 3 trace services (compactor, ingester, querier)",
    );
    expect(table).not.toContain("No trace service runs on these pods");
    expect(table).toContain("Placeholder name sent by the SDK");
    expect(table).not.toContain("SDK placeholder; the name is shown as is");
    expect(table).not.toContain("Map pods");
    expect(byTest("svcver-unresolved-display-as-openobserve").exists()).toBe(false);
    expect(byTest("svcver-unresolved-display-as-unknown-service-node").exists()).toBe(true);
    await byTest("svcver-unresolved-display-as-nats").trigger("click");
    await flushPromises();
    await byTest("svcver-name-review-inline-edit").find("input").setValue("NATS");
    await byTest("svcver-alias-display-as-save").trigger("click");
    await flushPromises();
    expect(transport.post).toHaveBeenCalledWith(
      "/api/org/service_identity/aliases",
      { kind: "rename", scope: "", alias: "nats", canonical: "NATS" },
      expect.anything(),
    );
  });

  const detected = (service_name: string, all_dimensions: Record<string, string> = {}) => ({
    service_name,
    display_source: "detection" as const,
    all_dimensions,
    logs_streams: ["default"],
    traces_streams: [],
    metrics_streams: [],
  });

  it("says the pods sentence once for the group when every plain row runs on pods", async () => {
    wrapper = mountReview({
      services: [
        detected("billing-worker", { "k8s-namespace": "jobs" }),
        detected("cron-runner", { "k8s-deployment": "cron", "k8s-namespace": "jobs" }),
      ],
    });
    await flushPromises();
    expect(byTest("svcver-unresolved-pods").text()).toBe(
      "No trace service runs on these pods; the detected name is shown as is",
    );
    expect(wrapper.findAll('[data-test="svcver-unresolved-pods"]')).toHaveLength(1);
    expect(byTest("svcver-unresolved-table").text()).not.toContain("these pods");
  });

  it("never claims pods while a row without pods is in the group", async () => {
    wrapper = mountReview({
      services: [detected("billing-worker", { "k8s-namespace": "jobs" }), detected("mailer")],
    });
    await flushPromises();
    expect(byTest("svcver-unresolved-pods").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("these pods");
    expect(byTest("svcver-unresolved-sub").exists()).toBe(true);
  });

  it("offers no Display as… for an internal stream name or an empty name", async () => {
    placeholders = [{ service: "", last_seen: 1 }];
    wrapper = mountReview({ services: [detected("_rumdata"), detected("mailer")] });
    await flushPromises();
    expect(byTest("svcver-unresolved-rumdata").text()).toBe("_rumdata");
    expect(byTest("svcver-unresolved-display-as-rumdata").exists()).toBe(false);
    expect(byTest("svcver-unresolved-name").text()).toBe('""');
    expect(byTest("svcver-unresolved-display-as-name").exists()).toBe(false);
    expect(byTest("svcver-unresolved-display-as-mailer").exists()).toBe(true);
  });

  it("says no service name was sent for the empty and default names, the SDK line for unknown_service", async () => {
    placeholders = [
      { service: "", last_seen: 1 },
      { service: "default", last_seen: 1 },
      { service: "unknown_service:java", last_seen: 1 },
    ];
    wrapper = mountReview();
    await flushPromises();
    const rows = wrapper.findAll('[data-test="svcver-unresolved-table"] tbody tr');
    const why = (name: string) => rows.find((row) => row.text().startsWith(name))?.text() ?? "";
    expect(why('""')).toContain("No service name was sent");
    expect(why("default")).toContain("No service name was sent");
    expect(why("default")).not.toContain("SDK placeholder");
    expect(why("unknown_service:java")).toContain("Placeholder name sent by the SDK");
    expect(why("unknown_service:java")).not.toContain("shown as is");
  });

  it("keeps one inline editor open at a time", async () => {
    wrapper = mountReview({ services: [detected("mailer"), detected("billing-worker")] });
    await flushPromises();
    await act("edit", rename).trigger("click");
    await flushPromises();
    await byTest("svcver-unresolved-display-as-mailer").trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-test="svcver-name-review-inline-edit"]')).toHaveLength(1);
    await byTest("svcver-unresolved-display-as-billing-worker").trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-test="svcver-name-review-inline-edit"]')).toHaveLength(1);
    await act("edit", rename).trigger("click");
    await flushPromises();
    const editors = wrapper.findAll('[data-test="svcver-name-review-inline-edit"]');
    expect(editors).toHaveLength(1);
    expect(editors[0].find("input").element.value).toBe("InventoryService");
  });

  it("retries a colliding Display as… qualified with allow_collisions", async () => {
    transport.post.mockRejectedValueOnce(conflict());
    wrapper = mountReview({ services: rowsGolden });
    await flushPromises();
    await byTest("svcver-unresolved-display-as-nats").trigger("click");
    await flushPromises();
    await byTest("svcver-name-review-inline-edit").find("input").setValue("querier");
    await byTest("svcver-alias-display-as-save").trigger("click");
    await flushPromises();
    await byTest("svcver-alias-collision-qualified").trigger("click");
    await flushPromises();
    expect(transport.post).toHaveBeenLastCalledWith(
      "/api/org/service_identity/aliases",
      {
        kind: "rename",
        scope: "",
        alias: "nats",
        canonical: "querier",
        allow_collisions: true,
      },
      expect.anything(),
    );
  });
});

describe("Name review deep link", () => {
  const stubs = {
    DiscoveredServices: {
      name: "DiscoveredServices",
      props: ["view"],
      emits: ["update:view"],
      template: '<div data-test="ds" :data-view="view" />',
    },
    ServiceIdentitySetup: true,
    ServiceEnvVersionSettings: true,
    OrganizationDeduplicationSettings: true,
    SemanticFieldGroupsConfig: true,
  };

  it("opens Name review from ?view=name-review and keeps it in the URL", async () => {
    router.route.query = { org_identifier: "org", view: "name-review" };
    wrapper = mount(CorrelationSettings, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get('[data-test="ds"]').attributes("data-view")).toBe("name-review");
    wrapper.findComponent({ name: "DiscoveredServices" }).vm.$emit("update:view", "services");
    expect(router.push).toHaveBeenLastCalledWith({
      name: "correlationSettings",
      params: { tab: "services" },
      query: { org_identifier: "org" },
    });
  });

  it("adds the view to the URL and drops it when leaving the tab", async () => {
    router.route.query = { org_identifier: "org" };
    wrapper = mount(CorrelationSettings, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get('[data-test="ds"]').attributes("data-view")).toBe("services");
    wrapper.findComponent({ name: "DiscoveredServices" }).vm.$emit("update:view", "name-review");
    expect(router.push).toHaveBeenLastCalledWith({
      name: "correlationSettings",
      params: { tab: "services" },
      query: { org_identifier: "org", view: "name-review" },
    });
    router.route.query = { org_identifier: "org", view: "name-review" };
    await (wrapper.vm as unknown as { onTabChange: (tab: string) => Promise<void> }).onTabChange(
      "discovery",
    );
    expect(router.push).toHaveBeenLastCalledWith({
      name: "correlationSettings",
      params: { tab: "service-discovery" },
      query: { org_identifier: "org" },
    });
  });
});

describe("Discovered Services", () => {
  const mountDiscovered = async () => {
    vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
      data: rowsGolden,
    } as never);
    wrapper = mount(DiscoveredServices, { attachTo: document.body });
    await flushPromises();
  };
  const tile = (id: string) => byTest(`svcver-tile-${id}`).text();
  const shownName = (entry: (typeof rowsGolden)[number]) =>
    entry.display_name || entry.service_name;
  const keys = new Set(rowsGolden.map(shownName));
  const traced = new Set(
    rowsGolden.filter((entry) => entry.display_source === "trace").map(shownName),
  );

  it("counts two detected keys of one trace service as one service in the footer", async () => {
    await mountDiscovered();
    const vm = wrapper!.vm as unknown as { searchQuery: string };
    vm.searchQuery = "PaymentService";
    await flushPromises();
    const footer = wrapper!.text();
    expect(footer).toContain("1 Service");
    expect(footer).not.toContain("2 Services");
  });

  it("names the workload Name review proposes instead of none", async () => {
    const billing = rowsGolden.find((entry) => entry.service_name === "billing-worker")!;
    expect(proposedWorkloadsOf(billing, lists.proposed.aliases)).toEqual(["worker"]);
    const querier = rowsGolden.find((entry) => entry.service_name === "querier")!;
    expect(proposedWorkloadsOf(querier, lists.proposed.aliases)).toEqual([]);
    await mountDiscovered();
    const cells = wrapper!.findAll('[data-test="svcver-discovered-workload-proposed"]');
    expect(cells.map((cell) => cell.text())).toContain("proposed: worker");
  });

  it("fills the five tiles from the Contract calls", async () => {
    catalog = [...scopes, { ...scopes[0], scope_key: "other", newest_version: "v-other" }];
    await mountDiscovered();
    expect(tile("discovered")).toBe(
      `Discovered (all signals)${keys.size}${traced.size} of these send traces`,
    );
    expect(tile("envs")).toBe(`Envs detected${stage7.envs.envs.length}prod`);
    expect(tile("overrides")).toContain(String(stage7.overrides.total));
    expect(tile("names")).toBe("Names to review3Review →");
    expect(tile("versions")).toBe("Versions2");
    expect(tile("versions")).not.toContain("raw");
    await byTest("svcver-tile-overrides-view").trigger("click");
    expect(wrapper!.emitted("navigate-to-env-versions")).toHaveLength(1);
    await byTest("svcver-tile-names-review").trigger("click");
    await flushPromises();
    expect(wrapper!.emitted("update:view")).toEqual([["name-review"]]);
    expect(byTest("svcver-name-review").exists()).toBe(true);
    const notice = byTest("svcver-name-review-banner");
    expect(notice.classes()).toContain("bg-surface-panel");
    expect(notice.html()).not.toContain("bg-banner-info");
  });

  it.each([
    [0, "Versions2"],
    [1, "Versions21 git hash stripped"],
    [3, "Versions23 git hashes stripped"],
  ])("says how many git hashes were stripped only when some were (%i)", async (count, text) => {
    catalog = [...scopes, { ...scopes[0], scope_key: "other", newest_version: "v-other" }];
    stripped = count;
    await mountDiscovered();
    expect(tile("versions")).toBe(text);
  });

  it("shows the trace name with detected as, and the joined env and version", async () => {
    catalog = scopes;
    await mountDiscovered();
    const vm = wrapper!.vm as unknown as { searchQuery: string };
    vm.searchQuery = "payments-api";
    await flushPromises();
    const label = byTest("svcver-service-name");
    expect(label.text()).toContain("PaymentService");
    expect(byTest("svcver-service-name-detected").text()).toContain("payments-api");
    expect(byTest("o2-table-cell-env").find('[data-test="svcver-env-chip"]').text()).toContain(
      "prod",
    );
    expect(byTest("o2-table-cell-version").text()).toBe(version);
    expect(byTest("o2-table-cell-workload").text()).toBe("payments");
    vm.searchQuery = "nats";
    await flushPromises();
    expect(byTest("o2-table-cell-env").find('[data-test="svcver-env-chip"]').exists()).toBe(false);
    expect(byTest("o2-table-cell-version").text()).toBe("—");
    expect(
      byTest("svcver-discovered-no-version").findComponent({ name: "OTooltip" }).props("content"),
    ).toBe("no version");
    expect(byTest("o2-table-cell-workload").text()).toBe("—");
    expect(byTest("svcver-discovered-banner").text()).toContain("Service = name from traces.");
    expect(byTest("svcver-discovered-banner").classes()).toContain("bg-surface-panel");
    expect(byTest("svcver-discovered-banner").classes()).not.toContain("bg-banner-info-bg");
  });

  it("searches by key or display, groups by key and sorts by display", async () => {
    await mountDiscovered();
    const vm = wrapper!.vm as unknown as {
      searchQuery: string;
      sortColumn: string;
      sortOrder: string;
      visibleGroups: { service_name: string }[];
    };
    vm.searchQuery = "PaymentService";
    await flushPromises();
    expect(vm.visibleGroups.map((group) => group.service_name).sort()).toEqual([
      "payments-api",
      "paymentservice",
    ]);
    vm.searchQuery = "legacy";
    await flushPromises();
    expect(vm.visibleGroups.map((group) => group.service_name)).toEqual(["legacy-cart"]);
    vm.searchQuery = "";
    vm.sortColumn = "service_name";
    vm.sortOrder = "asc";
    await flushPromises();
    const order = vm.visibleGroups.map((group) => group.service_name);
    expect(order).toHaveLength(new Set(rowsGolden.map((entry) => entry.service_name)).size);
    // By key checkoutservice sorts before legacy-cart; by display CartService sorts first.
    expect(order.indexOf("legacy-cart")).toBeLessThan(order.indexOf("checkoutservice"));
  });

  it("titles the drawer with the display name", async () => {
    await mountDiscovered();
    const vm = wrapper!.vm as unknown as {
      handleRowClick: (entry: unknown) => void;
      flatRows: { service_name: string }[];
    };
    vm.handleRowClick(vm.flatRows.find((entry) => entry.service_name === "payments-api"));
    await flushPromises();
    expect(document.querySelector('[data-test="service-side-panel"]')?.textContent).toContain(
      "PaymentService",
    );
  });

  it("joins a row to a scope only by display name and place, never by guess", () => {
    const at = (key: string) => rowsGolden.find((entry) => entry.service_name === key)!;
    // The list carries one querier row per capture, in either namespace, so both twins are placed explicitly.
    const querierIn = (namespace: string) => ({
      ...at("querier"),
      disambiguation: {
        "k8s-cluster": "stage8",
        "k8s-deployment": "querier",
        "k8s-namespace": namespace,
      },
    });
    expect(scopeForRow(at("payments-api"), scopes)?.scope_key).toBe("PaymentService/shop");
    expect(scopeForRow(querierIn("pentest"), scopes)?.scope_key).toBe("querier/pentest");
    expect(scopeForRow(querierIn("o2"), scopes)?.scope_key).toBe("querier/o2");
    expect(scopeForRow(at("nats"), scopes)).toBeNull();
    const elsewhere = {
      ...at("querier"),
      disambiguation: { "k8s-namespace": "o2", "k8s-cluster": "c2" },
    };
    expect(scopeForRow(elsewhere, scopes)).toBeNull();
    const flat = { ...scopes[0], scope_key: "flat", where_key: "env:prod", where: undefined };
    const envRow = {
      ...at("querier"),
      disambiguation: { environment: "prod" },
      all_dimensions: {},
    };
    expect(scopeForRow(envRow, [...scopes, flat])?.scope_key).toBe("flat");
    expect(scopeForRow({ ...envRow, disambiguation: {} }, [flat])?.scope_key).toBe("flat");
    expect(scopeForRow({ ...envRow, disambiguation: {} }, scopes)).toBeNull();
  });

  it("reads the Kubernetes workload from the identity dimensions", () => {
    const at = (key: string) => rowsGolden.find((entry) => entry.service_name === key)!;
    expect(workloadOf(at("payments-api"))).toBe("payments");
    expect(workloadOf(at("billing-worker"))).toBe("");
    expect(workloadOf({ disambiguation: {}, all_dimensions: { "k8s-daemonset": "agent" } })).toBe(
      "agent",
    );
  });
});
