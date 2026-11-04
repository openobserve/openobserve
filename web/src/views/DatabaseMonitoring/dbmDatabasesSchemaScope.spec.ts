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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, type PropType } from "vue";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabasesResponse, QueryStatsRow } from "@/services/db_monitoring";
import type { DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import type { DbmRowAction } from "@/components/dbm/DbmRowActions.vue";

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "acme" },
      zoConfig: { database_monitoring_enabled: true },
      theme: "light",
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock("@/services/db_monitoring", () => ({
  default: {
    getBadges: vi.fn(),
    getDatabases: vi.fn(),
    getInstanceMetrics: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn().mockResolvedValue({ list: [] }) }),
}));

const { default: dbMonitoringService } = await import("@/services/db_monitoring");
const { queryClient } = await import("@/composables/query/queryClient");
const { contextRegistry } = await import("@/composables/contextProviders");
const { default: DbmShell } = await import("./DbmShell.vue");
const { default: DatabasesPage } = await import("./DatabasesPage.vue");

const service = dbMonitoringService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const SECOND = 1_000_000_000;

/** `/databases` as the server answers it: one row per (system, instance, namespace). */
const databasesResponse = (): DatabasesResponse => ({
  hits: [
    {
      db_system: "postgresql",
      db_instance: "pg-orders",
      db_namespace: "orders",
      calls: 800,
      errors: 0,
      total_time_ns: 8 * SECOND,
      p95_ns: 4_000_000,
      calling_services: ["checkout"],
    },
    {
      db_system: "postgresql",
      db_instance: "pg-billing",
      db_namespace: "billing",
      calls: 400,
      errors: 0,
      total_time_ns: 2 * SECOND,
      p95_ns: 9_000_000,
      calling_services: ["invoice"],
    },
    {
      db_system: "postgresql",
      db_instance: "pg-billing",
      db_namespace: "ledger",
      calls: 100,
      errors: 0,
      total_time_ns: 1 * SECOND,
      p95_ns: 3_000_000,
      calling_services: ["ledger-svc"],
    },
    {
      db_system: "mysql",
      db_instance: "my-cart",
      db_namespace: "",
      calls: 50,
      errors: 0,
      total_time_ns: 1 * SECOND,
      p95_ns: 2_000_000,
      calling_services: ["cart"],
    },
    {
      db_system: "redis",
      db_instance: "valkey-cart",
      db_namespace: "",
      calls: 30,
      errors: 0,
      total_time_ns: 1 * SECOND,
      p95_ns: 1_000_000,
      calling_services: ["cart"],
    },
  ],
  baseline_hits: [],
  breakdown: {
    // `invoice` covers half of `billing`; `ledger-svc` covers all of `ledger`.
    "pg-billing": [
      stat("pg-billing", "billing", "invoice", SECOND),
      stat("pg-billing", "ledger", "ledger-svc", SECOND),
    ],
    "pg-orders": [stat("pg-orders", "orders", "checkout", 8 * SECOND)],
    // Schemaless engine: 60% of its time attributed to a service.
    "my-cart": [stat("my-cart", null, "cart", 0.6 * SECOND, "mysql")],
    // Nothing attributed at all: the `empty` placeholder speaks, not a caveat.
    "valkey-cart": [],
  },
  freshness: { data_through: 1_700_000_000_000_000 },
});

function stat(
  instance: string,
  namespace: string | null,
  serviceName: string,
  totalTimeNs: number,
  system = "postgresql",
): QueryStatsRow {
  return {
    fingerprint: `${instance}-${serviceName}`,
    db_system: system,
    db_instance: instance,
    ...(namespace ? { db_namespace: namespace } : {}),
    service_name: serviceName,
    calls: 10,
    errors: 0,
    total_time_ns: totalTimeNs,
    p95_ns: 1_000_000,
  } as QueryStatsRow;
}

/** `/badges`: the client vantage names two postgres servers; activity knows a replica too. */
const badgesEnvelope = () => ({
  databases: databasesResponse(),
  queries: { total: 12, hits: [] },
  activity: {
    by_state: [{ state: "active", sessions: 1 }],
    hits: [{ db_system: "postgresql", db_instance: "pg-replica" }],
  },
  deadlocks: { total: 0 },
  blocking: { total: 0 },
  table_health: { total: 0 },
});

interface TreeRow {
  rowKey: string;
  db_instance?: string;
  namespace?: string | null;
  children?: TreeRow[];
}

const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: { type: Array as PropType<TreeRow[]>, default: () => [] },
    getRowWarning: { type: Function as PropType<(row: TreeRow) => boolean>, default: null },
    expandedIds: { type: Array as PropType<string[]>, default: () => [] },
  },
  emits: ["row-click", "update:expandedIds", "sort-change"],
  setup(props, { slots }) {
    const walk = (rows: TreeRow[]): TreeRow[] =>
      rows.flatMap((row) => [
        row,
        ...(props.expandedIds.includes(row.rowKey) ? walk(row.children ?? []) : []),
      ]);
    return () =>
      h("div", [
        slots.toolbar?.(),
        ...walk(props.data).map((row) =>
          h("div", { key: row.rowKey }, [
            props.getRowWarning?.(row) ? slots["tree-warning"]?.({ row }) : null,
            slots["cell-actions"]?.({ row }),
          ]),
        ),
      ]);
  },
});

const DbmPageChromeStub = defineComponent({
  name: "DbmPageChrome",
  props: { tabCounts: { type: Object, default: () => ({}) } },
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots.default?.()),
});

const DbmTableToolbarStub = defineComponent({
  name: "DbmTableToolbar",
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots.filters?.()),
});

const DbmScopeFiltersStub = defineComponent({
  name: "DbmScopeFilters",
  props: { filters: { type: Array as PropType<DbmScopeFilter[]>, default: () => [] } },
  setup: () => () => h("div"),
});

const DbmRowActionsStub = defineComponent({
  name: "DbmRowActions",
  props: { actions: { type: Array as PropType<DbmRowAction[]>, default: () => [] } },
  emits: ["action"],
  setup: () => () => h("div"),
});

const stubs = {
  OTable: OTableStub,
  DbmPageChrome: DbmPageChromeStub,
  DbmTableToolbar: DbmTableToolbarStub,
  DbmScopeFilters: DbmScopeFiltersStub,
  DbmRowActions: DbmRowActionsStub,
  DbmCoverageLine: true,
  DbmEmptyState: true,
  DbmInstanceHealthCell: true,
  DbmRowChips: true,
  DbmServiceList: true,
  DbmSubheaderBand: true,
  DbmOverlapValue: true,
  DateTime: true,
  ORefreshButton: true,
  OEmptyState: true,
  OTag: true,
  OTruncatedText: true,
  OIcon: true,
  OStatStrip: true,
  OTooltip: true,
};

const Elsewhere = defineComponent({ name: "DbmElsewhere", render: () => h("div") });

let wrapper: VueWrapper | null = null;

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await flushPromises();
};

const mountOverview = async (query: Record<string, string> = {}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/dbm",
        component: DbmShell,
        children: [
          { path: "databases", name: "dbmDatabases", component: DatabasesPage },
          { path: "metrics", name: "dbmMetrics", component: Elsewhere },
          { path: "queries", name: "dbmQueries", component: Elsewhere },
        ],
      },
    ],
  });
  await router.push({ name: "dbmDatabases", query: { org_identifier: "acme", ...query } });
  await router.isReady();
  wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [router], stubs },
  });
  await settle();
  return { router, wrapper };
};

const chrome = () => wrapper!.findComponent(DbmPageChromeStub);
const table = () => wrapper!.findComponent(OTableStub);
const badge = () => (chrome().props("tabCounts") as { databaseCount: unknown }).databaseCount;
const topRows = () => table().props("data") as TreeRow[];
const serverRow = (instance: string) => topRows().find((row) => row.db_instance === instance)!;

const setSchema = async (value: string | null) => {
  const filters = wrapper!.findComponent(DbmScopeFiltersStub).props("filters") as DbmScopeFilter[];
  filters.find((filter) => filter.key === "namespace")!.onChange(value as string);
  await settle();
};

const expand = async (instance: string) => {
  table().vm.$emit("update:expandedIds", [serverRow(instance).rowKey]);
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  service.getDatabases.mockImplementation(() => Promise.resolve({ data: databasesResponse() }));
  service.getBadges.mockImplementation(() => Promise.resolve({ data: badgesEnvelope() }));
  service.getInstanceMetrics.mockResolvedValue({ data: { hits: [], streams: [] } });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("the Schema filter republishes the fleet count under the scope it narrowed", () => {
  it("publishes the server count, trafficless replica included", async () => {
    await mountOverview();
    expect(topRows().map((row) => row.db_instance)).toHaveLength(5);
    expect(badge()).toBe(5);
  });

  it("narrows the badge to the servers holding the schema", async () => {
    await mountOverview();
    await setSchema("ledger");
    expect(topRows().map((row) => row.db_instance)).toEqual(["pg-billing"]);
    expect(badge()).toBe(1);
  });

  // The cached unfiltered fan-out replaces the snapshot on re-key, so a count published first is lost.
  it("keeps the page's own count once the cleared filter's URL has settled", async () => {
    const { router } = await mountOverview();
    await setSchema("ledger");
    await setSchema(null);
    expect(router.currentRoute.value.query.namespace).toBeUndefined();
    expect(topRows()).toHaveLength(5);
    expect(badge(), "the fan-out's 4 must not stand over the page's exact union").toBe(5);
  });
});

describe("the coverage caveat follows the shared shortfall rule at runtime", () => {
  const caveats = () =>
    wrapper!
      .findAll('[data-test^="dbm-databases-shortfall-"]')
      .map((node) => [node.attributes("data-test"), node.text()]);

  it("states a schema row's own gap, not its server's", async () => {
    await mountOverview();
    await expand("pg-billing");
    const parent = serverRow("pg-billing").rowKey;
    expect(caveats()).toEqual([
      [`dbm-databases-shortfall-${parent}/schema:billing`, expect.stringContaining("50%")],
    ]);
  });

  it("states a schemaless server's gap against its total", async () => {
    await mountOverview();
    await expand("my-cart");
    expect(caveats()).toEqual([
      [`dbm-databases-shortfall-${serverRow("my-cart").rowKey}`, expect.stringContaining("40%")],
    ]);
  });

  it("stays silent when nothing was attributed", async () => {
    await mountOverview();
    await expand("valkey-cart");
    expect(caveats()).toEqual([]);
  });
});

describe("a hand-off from the overview scopes the target, not the overview", () => {
  const pushed = (router: Router) => router.currentRoute.value;

  it("opens Metrics for a single-schema server without naming its schema", async () => {
    const { router } = await mountOverview();
    table().vm.$emit("row-click", serverRow("pg-orders"));
    await settle();
    expect(pushed(router).name).toBe("dbmMetrics");
    expect(pushed(router).query.instance).toBe("pg-orders");
    expect(pushed(router).query.namespace).toBeUndefined();
  });

  it("opens Top queries for a single-schema server without naming its schema", async () => {
    const { router } = await mountOverview();
    const index = topRows().findIndex((row) => row.db_instance === "pg-orders");
    wrapper!.findAllComponents(DbmRowActionsStub)[index].vm.$emit("action", "open");
    await settle();
    expect(pushed(router).name).toBe("dbmQueries");
    expect(pushed(router).query.instance).toBe("pg-orders");
    expect(pushed(router).query.namespace).toBeUndefined();
  });

  it("carries the active Schema filter on a server hand-off", async () => {
    const { router } = await mountOverview();
    await setSchema("ledger");
    table().vm.$emit("row-click", serverRow("pg-billing"));
    await settle();
    expect(pushed(router).name).toBe("dbmMetrics");
    expect(pushed(router).query.namespace).toBe("ledger");
  });

  it("keeps the overview unfiltered when the Overview tab carries a child's schema back", async () => {
    const { router } = await mountOverview();
    await expand("pg-billing");
    const ledger = serverRow("pg-billing").children!.find((row) => row.namespace === "ledger")!;
    table().vm.$emit("row-click", ledger);
    await settle();
    expect(pushed(router).name).toBe("dbmMetrics");
    expect(pushed(router).query.namespace).toBe("ledger");

    // What DbmSectionTabs' Overview link carries: the current query, unchanged.
    await router.push({ name: "dbmDatabases", query: { ...pushed(router).query } });
    await settle();
    expect(topRows()).toHaveLength(5);
    expect(pushed(router).query.namespace).toBeUndefined();
  });

  it("adopts a different schema the reader picked on the target page", async () => {
    const { router } = await mountOverview();
    await expand("pg-billing");
    const ledger = serverRow("pg-billing").children!.find((row) => row.namespace === "ledger")!;
    table().vm.$emit("row-click", ledger);
    await settle();
    await router.push({
      name: "dbmDatabases",
      query: { ...pushed(router).query, namespace: "orders" },
    });
    await settle();
    expect(topRows().map((row) => row.db_instance)).toEqual(["pg-orders"]);
  });
});

describe("the AI assistant sees the Schema filter", () => {
  it("puts the active schema in the page context", async () => {
    await mountOverview({ namespace: "ledger" });
    const context = await contextRegistry.getActiveContext();
    expect(context?.db_namespace).toBe("ledger");
  });

  it("names no schema when the filter is off", async () => {
    await mountOverview();
    const context = await contextRegistry.getActiveContext();
    expect(context?.db_namespace).toBeUndefined();
  });
});
