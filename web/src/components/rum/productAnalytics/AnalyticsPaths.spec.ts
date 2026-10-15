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

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRouter, createWebHistory, type Router } from "vue-router";
import { createStore } from "vuex";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const confirmMock = vi.hoisted(() => vi.fn(async (_o: Record<string, unknown>) => true));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

import searchService from "@/services/search";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import AnalyticsPaths from "./AnalyticsPaths.vue";
import PathSessionsDrawer from "./PathSessionsDrawer.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import StepPicker from "./StepPicker.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { PathFlow } from "@/utils/rum/productAnalyticsModel";

type Hit = Record<string, unknown>;

const PATH_ROWS = (pathCount = 3): Hit[] => [
  {
    s1: "c:<img src=x onerror=alert(1)>",
    s2: "p:/web/traces",
    s3: null,
    sessions: 50,
    anchor_sessions: 100,
    path_count: pathCount,
  },
  {
    s1: "p:/web/dashboards",
    s2: null,
    s3: null,
    sessions: 30,
    anchor_sessions: 100,
    path_count: pathCount,
  },
  { s1: null, s2: null, s3: null, sessions: 20, anchor_sessions: 100, path_count: pathCount },
];

let pathRows = PATH_ROWS();
let branchTotal = 50;
const LOGIN_ENTRY: Hit[] = [
  {
    k: "/web/login",
    entry_sessions: 90,
    prev_entry_sessions: 1,
    exit_sessions: 1,
    prev_exit_sessions: 1,
  },
];
let entryRows: Hit[] | "fail" = LOGIN_ENTRY;
let branchPage: (() => Promise<unknown>) | null = null;
let droppedRow = true;
const respond = () =>
  vi.mocked(searchService.search).mockImplementation((async (args: {
    query: { query: { sql: string } };
  }) => {
    const sql = args.query.query.sql;
    if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "web", sessions: 500 }] } };
    if (/va_rows/.test(sql))
      return { data: { hits: [{ sessions: 500, prev_sessions: 1, views: 1, va_rows: 1000 }] } };
    if (/entry_sessions/.test(sql)) {
      if (entryRows === "fail")
        throw { response: { status: 500, data: { message: "entry lookup failed" } } };
      return { data: { hits: entryRows } };
    }
    if (/hu AS/.test(sql)) {
      return {
        data: {
          hits: droppedRow
            ? [{ side: "dropped", units: 87, sessions: 104, with_error: 1, with_frustration: 0 }]
            : [],
        },
      };
    }
    if (branchPage && /AS total FROM pa/.test(sql) && /OFFSET 200/.test(sql)) return branchPage();
    if (/COUNT\(\*\) OVER \(\) AS total FROM pa/.test(sql)) {
      return {
        data: {
          hits: [
            {
              sid: "s1",
              step_t: 1790000000000,
              errors: 0,
              frustrations: 0,
              has_replay: 1,
              started: 1,
              ended: 2,
              total: branchTotal,
            },
          ],
        },
      };
    }
    if (/AS path_count/.test(sql)) return { data: { hits: pathRows } };
    return { data: { hits: [] } };
  }) as never);

const sqls = () =>
  vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);
const pathSqls = () => sqls().filter((s) => /AS path_count/.test(s));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
    theme: "light",
  },
});

const FlowStub = {
  name: "PathsFlow",
  props: ["flow", "seriesId", "selected", "direction"],
  emits: ["select"],
  template: "<div data-test='flow-stub' />",
};
const DrawerStub = {
  name: "PathSessionsDrawer",
  props: [
    "open",
    "def",
    "predicate",
    "stepDepth",
    "title",
    "expectedTotal",
    "sampled",
    "events",
    "pathKeys",
  ],
  emits: ["update:open", "build-funnel"],
  template: "<div data-test='branch-drawer-stub' />",
};

const SAVED_SIGNUP = {
  id: "Signup0000000000000000000001",
  app: "web",
  name: "Signup",
  def: {
    steps: [
      { kind: "p" as const, key: "/a" },
      { kind: "p" as const, key: "/b" },
    ],
    unit: "sessions" as const,
    window: "session" as const,
    breakdown: null,
  },
  sql: "SELECT 1",
  eventIds: [],
  version: 1,
  createdBy: "a@x.com",
  createdAt: 1,
  updatedBy: "a@x.com",
  updatedAt: 1,
};

describe("AnalyticsPaths", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  const mountPaths = async (setup: () => void = () => undefined) => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
        { path: "/f", name: "productAnalyticsFunnels", component: { template: "<div />" } },
        { path: "/fb", name: "productAnalyticsFunnelBuilder", component: { template: "<div />" } },
      ],
    });
    await router.push("/p?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    setup();
    wrapper = mount(AnalyticsPaths, {
      global: {
        plugins: [router, store],
        stubs: { PathsFlow: FlowStub, PathSessionsDrawer: DrawerStub },
      },
      attachTo: document.body,
    });
    for (let i = 0; i < 5; i++) await flushPromises();
  };

  const flow = () => wrapper!.findComponent(FlowStub).props("flow") as PathFlow;

  beforeEach(() => {
    resetProductAnalytics();
    resetNamedEvents();
    api.reset();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    pathRows = PATH_ROWS();
    branchTotal = 50;
    entryRows = LOGIN_ENTRY;
    branchPage = null;
    droppedRow = true;
    respond();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("Build funnel from a branch opens the funnel builder with those steps", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    await wrapper!
      .find('[data-test="rum-analytics-paths-top-row-1-sessions-btn"]')
      .trigger("click");
    await flushPromises();
    const steps = [
      { kind: "p", key: "/" },
      { kind: "p", key: "/web/dashboards" },
    ];
    wrapper!.findComponent(DrawerStub).vm.$emit("build-funnel", steps);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder");
    expect(useProductAnalytics().funnel.value.steps).toEqual(steps);
  });

  it("Build funnel from a branch closes an unedited saved funnel without asking, so Save never overwrites it", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    const pa = useProductAnalytics();
    pa.openSavedFunnel(SAVED_SIGNUP);
    confirmMock.mockClear();
    await wrapper!
      .find('[data-test="rum-analytics-paths-top-row-1-sessions-btn"]')
      .trigger("click");
    await flushPromises();
    const steps = [
      { kind: "p", key: "/" },
      { kind: "p", key: "/web/dashboards" },
    ];
    wrapper!.findComponent(DrawerStub).vm.$emit("build-funnel", steps);
    await flushPromises();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(pa.openedFunnel.value).toBeNull();
    expect(pa.funnel.value.steps).toEqual(steps);
    expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder");
    expect(router.currentRoute.value.query.sf).toBeUndefined();
  });

  it("draws the next steps from an Overview anchor, with Left the app, and a Top paths twin (AC-23, AC-25)", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/web/logs" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    expect(pathSqls().at(-1)).toContain("key = 'p:/web/logs'");
    const f = flow();
    expect(f.nodes.filter((n) => n.depth === 1).map((n) => n.kind)).toEqual(["c", "p", "exit"]);
    expect(wrapper!.find('[data-test="rum-analytics-paths-top-row-0"]').text()).toContain(
      "<img src=x onerror=alert(1)>",
    );
    expect(document.querySelector("img")).toBeNull();
    expect(wrapper!.find('[data-test="rum-analytics-paths-truncated"]').exists()).toBe(false);
  });

  it("an event anchor waits for the named events, and a failed load shows Retry, not an empty flow (F26)", async () => {
    const has = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).exists();
    api.failNext("listEvents", 503);
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "e", key: "EvtDashboards00000000000001" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    expect(pathSqls()).toEqual([]);
    expect(has("rum-analytics-paths-events-unavailable")).toBe(true);
    expect(has("rum-analytics-paths-empty")).toBe(false);
    api.seedEvent("web", "Dashboards", {
      id: "EvtDashboards00000000000001",
      rules: [{ t: "view", op: "eq", value: "/web/dashboards" }],
    });
    const release = api.gate("listEvents");
    await wrapper!.find('[data-test="rum-analytics-paths-events-retry-btn"]').trigger("click");
    for (let i = 0; i < 5; i++) await flushPromises();
    expect(has("rum-analytics-paths-events-unavailable")).toBe(false);
    expect(pathSqls()).toEqual([]);
    release();
    for (let i = 0; i < 8; i++) await flushPromises();
    expect(pathSqls()).toHaveLength(1);
    expect(pathSqls()[0]).toContain("/web/dashboards");
    expect(pathSqls()[0]).not.toContain("1 = 0");
  });

  const LOGIN = { kind: "p" as const, key: "/web/login" };
  const LOGS = { kind: "p" as const, key: "/web/logs" };
  const GONE = { kind: "e" as const, key: "GoneEvent000000000000000001" };
  it.each([
    ["the step after the anchor", [LOGIN, GONE], 1, null, LOGIN],
    ["the anchor itself", [LOGIN, GONE, LOGS], 2, null, LOGIN],
    ["a later step", [LOGIN, GONE, LOGS], 1, { steps: [LOGIN, LOGS], k: 1 }, null],
    ["a step before the anchor", [GONE, LOGIN, LOGS], 2, { steps: [LOGIN, LOGS], k: 1 }, null],
  ])(
    "a shared cohort link whose deleted event is %s never queries it as a zero-match (F29)",
    async (_what, steps, k, kept, anchor) => {
      await mountPaths(() => {
        useProductAnalytics().paths.value = {
          anchor: null,
          direction: "next",
          depth: 3,
          include: "all",
          cohort: {
            funnel: { steps, unit: "sessions", window: "session", breakdown: null },
            stepIndex: k,
            side: "dropped",
          },
        };
      });
      const pa = useProductAnalytics();
      expect(pa.deletedEventLink.value).toBe(true);
      const cohort = pa.paths.value.cohort;
      expect(cohort ? { steps: cohort.funnel.steps, k: cohort.stepIndex } : null).toEqual(kept);
      expect(pa.paths.value.anchor).toEqual(anchor);
      expect(pathSqls().length).toBeGreaterThan(0);
      for (const sql of sqls()) expect(sql).not.toContain("(1 = 0)");
    },
  );

  it("a failed default-anchor lookup shows the error with Retry, not a skeleton (W19)", async () => {
    entryRows = "fail";
    await mountPaths();
    const has = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).exists();
    expect(has("rum-analytics-paths-loading")).toBe(false);
    expect(wrapper!.find('[data-test="rum-analytics-paths-error"]').text()).toContain(
      "entry lookup failed",
    );
    entryRows = LOGIN_ENTRY;
    await wrapper!.find('[data-test="rum-analytics-paths-retry-btn"]').trigger("click");
    for (let i = 0; i < 6; i++) await flushPromises();
    expect(useProductAnalytics().paths.value.anchor).toEqual({ kind: "p", key: "/web/login" });
    expect(pathSqls()).toHaveLength(1);
    expect(has("rum-analytics-paths-error")).toBe(false);
  });

  it("no entry pages in range shows the empty state, not a skeleton (W19)", async () => {
    entryRows = [];
    await mountPaths();
    const has = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).exists();
    expect(has("rum-analytics-paths-loading")).toBe(false);
    expect(has("rum-analytics-paths-no-anchor")).toBe(true);
    expect(pathSqls()).toEqual([]);
  });

  it("a cold tab anchors at the top entry page", async () => {
    await mountPaths();
    expect(useProductAnalytics().paths.value.anchor).toEqual({ kind: "p", key: "/web/login" });
    expect(pathSqls().at(-1)).toContain("key = 'p:/web/login'");
  });

  it("switches direction and depth and recomputes (AC-23, AC-24)", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    await wrapper!.find('[data-test="rum-analytics-paths-direction-prev"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(pathSqls().at(-1)).toContain("n BETWEEN n0 - 3 AND n0");
    expect(flow().nodes.find((n) => n.depth === 1 && n.key === "")?.kind).toBe("start");
  });

  it("states the share shown when more than 5,000 paths exist (AC-23)", async () => {
    pathRows = PATH_ROWS(7000);
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    expect(wrapper!.find('[data-test="rum-analytics-paths-truncated"]').text()).toContain("100.0%");
  });

  const COHORT_DEF = (name?: string) => ({
    anchor: null,
    direction: "next" as const,
    depth: 3,
    include: "all" as const,
    cohort: {
      funnel: {
        steps: [
          { kind: "p" as const, key: "/a" },
          { kind: "c" as const, key: "b" },
        ],
        unit: "sessions" as const,
        window: "session" as const,
        breakdown: null,
      },
      stepIndex: 1,
      side: "dropped" as const,
      ...(name ? { name } : {}),
    },
  });

  const cohortChip = () => wrapper!.find('[data-test="rum-analytics-paths-session-filter"]');
  // The popover portals to <body>, outside the wrapper's subtree.
  const cohortPopover = () =>
    document.body.querySelector('[data-test="rum-analytics-paths-cohort-popover"]');
  const openCohortPopover = async () => {
    await cohortChip().trigger("click");
    await vi.waitFor(() => expect(cohortPopover()).not.toBeNull());
  };
  const popoverButton = (id: string) => {
    const el = document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
    expect(el).not.toBeNull();
    return el!;
  };

  it("filters to a funnel's dropped sessions and names the chip after the step alone (AC-25)", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    expect(wrapper!.find('[data-test="rum-analytics-paths-cohort-word"]').text()).toBe(
      "From drop-off after",
    );
    expect(cohortChip().text()).toMatch(/^step 1\s*\/a$/);
    expect(pathSqls().at(-1)).toContain("MAX(CASE WHEN t <= step_t THEN n END)");
  });

  it("the chip opens a popover that states the drop-off condition and its count", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    expect(cohortPopover()).toBeNull();
    await openCohortPopover();
    const text = cohortPopover()!.textContent ?? "";
    expect(text).toContain("Reached /a, then did not reach b.");
    expect(text).toContain("104 sessions");
  });

  const cohortSource = () => wrapper!.find('[data-test="rum-analytics-paths-cohort-source"]');

  it("in cohort mode the toolbar leads with a back button, a funnel icon, the funnel's name and a divider", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF("Signup");
    });
    const source = cohortSource();
    expect(source.find('[data-test="rum-analytics-paths-cohort-back-btn"]').exists()).toBe(true);
    expect(source.find('[data-test="rum-analytics-paths-cohort-funnel"]').text()).toBe("Signup");
    expect(source.findAllComponents(OIcon).map((i) => i.props("name"))).toContain("filter-alt");
    expect(source.findComponent(OSeparator).props("vertical")).toBe(true);
  });

  it("names the funnel the cohort came from, not whichever funnel is open now", async () => {
    await mountPaths(() => {
      const pa = useProductAnalytics();
      pa.openSavedFunnel(SAVED_SIGNUP);
      pa.paths.value = COHORT_DEF("Checkout");
    });
    expect(cohortSource().find('[data-test="rum-analytics-paths-cohort-funnel"]').text()).toBe(
      "Checkout",
    );
  });

  it("a cohort from an unsaved funnel says so", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    expect(cohortSource().find('[data-test="rum-analytics-paths-cohort-funnel"]').text()).toBe(
      "Unsaved funnel",
    );
  });

  it("outside cohort mode there is no back button or funnel name", async () => {
    await mountPaths();
    expect(cohortSource().exists()).toBe(false);
  });

  it("zero dropped sessions reads as 0, never as a pending count", async () => {
    droppedRow = false;
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    await openCohortPopover();
    expect(cohortPopover()!.textContent).toContain("0 sessions");
  });

  it("'Back to funnel' returns to the funnel builder and keeps the cohort", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    await wrapper!.find('[data-test="rum-analytics-paths-cohort-back-btn"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder");
    expect(useProductAnalytics().paths.value.cohort).not.toBeNull();
  });

  it("'Back to funnel' reopens the cohort's own saved funnel even after another one was opened", async () => {
    const row = api.seedFunnel("web", "Checkout", {
      s: [
        ["p", "/a"],
        ["c", "b"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountPaths(() => {
      const pa = useProductAnalytics();
      pa.openSavedFunnel(SAVED_SIGNUP);
      const base = COHORT_DEF("Checkout");
      pa.paths.value = { ...base, cohort: { ...base.cohort, funnelId: row.id as string } };
    });
    await wrapper!.find('[data-test="rum-analytics-paths-cohort-back-btn"]').trigger("click");
    await vi.waitFor(() =>
      expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder"),
    );
    expect(useProductAnalytics().openedFunnel.value?.id).toBe(row.id);
  });

  it("'Back to funnel' from an unsaved funnel's cohort rebuilds that funnel", async () => {
    await mountPaths(() => {
      const pa = useProductAnalytics();
      pa.openSavedFunnel(SAVED_SIGNUP);
      pa.paths.value = COHORT_DEF();
    });
    await wrapper!.find('[data-test="rum-analytics-paths-cohort-back-btn"]').trigger("click");
    await vi.waitFor(() =>
      expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder"),
    );
    const pa = useProductAnalytics();
    expect(pa.openedFunnel.value).toBeNull();
    expect(pa.funnel.value.steps).toEqual([
      { kind: "p", key: "/a" },
      { kind: "c", key: "b" },
    ]);
  });

  it("'Clear funnel scope' keeps the step as a plain anchor and restores the picker", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    await openCohortPopover();
    popoverButton("rum-analytics-paths-cohort-clear-btn").click();
    await flushPromises();
    expect(useProductAnalytics().paths.value.cohort).toBeNull();
    expect(useProductAnalytics().paths.value.anchor).toEqual({ kind: "p", key: "/a" });
    expect(cohortChip().exists()).toBe(false);
    expect(wrapper!.find('[data-test="rum-analytics-paths-anchor-select"]').exists()).toBe(true);
  });

  it("the chip's remove control names what it does", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    const remove = cohortChip().find("button");
    expect(remove.attributes("aria-label")).toBe("Clear funnel scope");
  });

  it("an empty cohort says no sessions dropped and offers the way back, not a hidden picker", async () => {
    pathRows = [];
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF();
    });
    const empty = wrapper!.find('[data-test="rum-analytics-paths-empty"]');
    expect(empty.text()).toContain("No sessions dropped after /a in this range");
    expect(empty.text()).not.toContain("pick another anchor");
    expect(empty.find('[data-test="rum-analytics-paths-empty-back-btn"]').exists()).toBe(true);
  });

  const toolbarText = () =>
    wrapper!.find('[data-test="rum-analytics-paths-toolbar"]').text().replace(/\s+/g, " ");

  it("the toolbar reads as one sentence from the anchor to what counts as a step", async () => {
    await mountPaths();
    expect(toolbarText()).toMatch(
      /^From.*show the.*next.*previous.*3 steps.*counting.*pages and clicks.*pages.*clicks/,
    );
  });

  it("in cohort mode the toolbar sentence starts from the drop-off", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = COHORT_DEF("Signup");
    });
    expect(toolbarText()).toMatch(
      /^Signup.*From drop-off after.*step 1.*\/a.*show the.*next.*counting/,
    );
  });

  it("the depth select keeps its compact width instead of spanning the toolbar", async () => {
    await mountPaths();
    const depth = wrapper!
      .findAllComponents(OSelect)
      .find((c) => c.attributes("data-test") === "rum-analytics-paths-depth-select");
    expect(depth?.props("width")).toBe("xs");
  });

  it("a Top paths row opens the branch drawer with the exact tuple and its count (AC-26, AC-59)", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    await wrapper!
      .find('[data-test="rum-analytics-paths-top-row-1-sessions-btn"]')
      .trigger("click");
    await flushPromises();
    const drawer = wrapper!.findComponent(DrawerStub);
    expect(drawer.props("predicate")).toBe(
      "s1 = 'p:/web/dashboards' AND s2 IS NULL AND s3 IS NULL",
    );
    expect(drawer.props("expectedTotal")).toBe(30);
    expect(drawer.props("stepDepth")).toBe(1);
  });

  it("the toolbar carries only controls, no methodology caption or click hint", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    const text = toolbarText();
    expect(text).not.toContain("Weighted by distinct sessions");
    expect(text).not.toContain("Click a branch to see its sessions");
    expect(wrapper!.find('[data-test="rum-analytics-paths-click-hint"]').exists()).toBe(false);
  });

  it("a flow node opens the drawer for that node", async () => {
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    wrapper!
      .findComponent(FlowStub)
      .vm.$emit("select", { type: "node", depth: 1, key: "p:/web/dashboards", parentKey: null });
    await flushPromises();
    const drawer = wrapper!.findComponent(DrawerStub);
    expect(drawer.props("predicate")).toContain("s1 = 'p:/web/dashboards'");
    expect(drawer.props("expectedTotal")).toBe(30);
  });

  it("a deep flow link keeps every intermediate step, not just the endpoints (bug: dropped steps)", async () => {
    pathRows = [
      {
        s1: "p:/deals/new",
        s2: "p:/search",
        s3: "p:/products/:id",
        sessions: 53,
        anchor_sessions: 53,
        path_count: 1,
      },
    ];
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    // The band from /search (depth 2) to /products/:id (depth 3).
    wrapper!.findComponent(FlowStub).vm.$emit("select", {
      type: "link",
      depth: 3,
      key: "p:/products/:id",
      parentKey: "p:/search",
    });
    await flushPromises();
    const drawer = wrapper!.findComponent(DrawerStub);
    expect(drawer.props("expectedTotal")).toBe(53);
    expect(drawer.props("pathKeys")).toEqual(["p:/deals/new", "p:/search", "p:/products/:id"]);
  });

  it("a flow box keeps the full dominant path leading to it, not just the clicked key (bug: dropped steps)", async () => {
    pathRows = [
      {
        s1: "p:/deals/new",
        s2: "p:/search",
        s3: "p:/products/:id",
        sessions: 53,
        anchor_sessions: 53,
        path_count: 1,
      },
    ];
    await mountPaths(() => {
      useProductAnalytics().paths.value = {
        anchor: { kind: "p", key: "/" },
        direction: "next",
        depth: 3,
        include: "all",
        cohort: null,
      };
    });
    wrapper!.findComponent(FlowStub).vm.$emit("select", {
      type: "node",
      depth: 3,
      key: "p:/products/:id",
      parentKey: null,
    });
    await flushPromises();
    const drawer = wrapper!.findComponent(DrawerStub);
    expect(drawer.props("pathKeys")).toEqual(["p:/deals/new", "p:/search", "p:/products/:id"]);
  });
});

describe("PathSessionsDrawer (AC-26, AC-59)", () => {
  let router: Router;
  const def = {
    anchor: { kind: "p" as const, key: "/" },
    direction: "next" as const,
    depth: 3,
    include: "all" as const,
    cohort: null,
  };

  const mountDrawer = async (expectedTotal: number) => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
        { path: "/s/:id", name: "SessionViewer", component: { template: "<div />" } },
      ],
    });
    await router.push("/p?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    const w = mount(PathSessionsDrawer, {
      props: {
        open: true,
        def,
        predicate: "s1 = 'p:/x'",
        stepDepth: 1,
        title: "x",
        expectedTotal,
        sampled: 1,
        events: [],
      },
      global: { plugins: [router, store] },
      attachTo: document.body,
    });
    for (let i = 0; i < 5; i++) await flushPromises();
    return w;
  };

  beforeEach(() => {
    resetProductAnalytics();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    branchTotal = 50;
    respond();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists the branch sessions replay first and opens one at that step", async () => {
    const w = await mountDrawer(50);
    const branch = sqls().filter((s) => /AS total FROM pa/.test(s));
    expect(branch).toHaveLength(1);
    expect(branch[0]).toContain("WHERE s1 = 'p:/x' ORDER BY has_replay DESC, step_t DESC, sid");
    expect(
      document.querySelector('[data-test="rum-analytics-paths-branch-incomplete"]'),
    ).toBeNull();
    document
      .querySelector<HTMLElement>('[data-test="rum-analytics-paths-branch-sessions-row-0"]')!
      .click();
    await flushPromises();
    expect(router.currentRoute.value.params.id).toBe("s1");
    expect(router.currentRoute.value.query.event_time).toBe("1790000000000");
    w.unmount();
  });

  it("opens full height at lg with a scrim, and Build funnel points away with a forward arrow", async () => {
    const w = await mountDrawer(50);
    const drawer = w.findComponent(ODrawer);
    expect(drawer.props("size")).toBe("lg");
    expect(drawer.props("anchor") ?? null).toBeNull();
    expect(drawer.props("seamless")).toBe(false);
    const btn = w
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "rum-analytics-paths-branch-funnel-btn")!;
    expect(btn.props("iconRight")).toBe("arrow-forward");
    w.unmount();
  });

  it("Load more on one branch never appends into the branch opened after it (W17)", async () => {
    branchTotal = 450;
    let release!: () => void;
    branchPage = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            data: {
              hits: [
                {
                  sid: "stale",
                  step_t: 1,
                  errors: 0,
                  frustrations: 0,
                  has_replay: 0,
                  started: 1,
                  ended: 2,
                  total: 450,
                },
              ],
            },
          });
      });
    const w = await mountDrawer(450);
    document
      .querySelector<HTMLElement>(
        '[data-test="rum-analytics-paths-branch-sessions-load-more-btn"]',
      )!
      .click();
    await flushPromises();
    await w.setProps({ predicate: "s1 = 'p:/y'" });
    for (let i = 0; i < 5; i++) await flushPromises();
    release();
    for (let i = 0; i < 5; i++) await flushPromises();
    expect(
      document.querySelector('[data-test="rum-analytics-paths-branch-sessions-cap"]')?.textContent,
    ).toContain("First 1 of 450");
    w.unmount();
  });

  it("a failed Load more says so (W17)", async () => {
    branchTotal = 450;
    branchPage = async () => {
      throw { response: { status: 500, data: { message: "page failed" } } };
    };
    const w = await mountDrawer(450);
    document
      .querySelector<HTMLElement>(
        '[data-test="rum-analytics-paths-branch-sessions-load-more-btn"]',
      )!
      .click();
    for (let i = 0; i < 5; i++) await flushPromises();
    expect(
      document.querySelector('[data-test="rum-analytics-paths-branch-sessions-load-more-error"]'),
    ).not.toBeNull();
    w.unmount();
  });

  it("opens a session with a named-event anchor labelled by the event's name (W24)", async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
        { path: "/s/:id", name: "SessionViewer", component: { template: "<div />" } },
      ],
    });
    await router.push("/p?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    const w = mount(PathSessionsDrawer, {
      props: {
        open: true,
        def: { ...def, anchor: { kind: "e" as const, key: "EvtSignup000000000000000001" } },
        predicate: "s1 IS NULL",
        stepDepth: 0,
        title: "x",
        expectedTotal: 50,
        sampled: 1,
        events: [
          {
            id: "EvtSignup000000000000000001",
            name: "Signup",
            rules: [{ t: "view", op: "eq", value: "/x" }],
          },
        ] as never,
        pathKeys: [],
      },
      global: { plugins: [router, store] },
      attachTo: document.body,
    });
    for (let i = 0; i < 5; i++) await flushPromises();
    document
      .querySelector<HTMLElement>('[data-test="rum-analytics-paths-branch-sessions-row-0"]')!
      .click();
    await flushPromises();
    expect(router.currentRoute.value.query.af_label).toBe("Signup");
    w.unmount();
  });

  it("re-runs once and flags a total that disagrees with the clicked branch", async () => {
    branchTotal = 49;
    const w = await mountDrawer(50);
    expect(sqls().filter((s) => /AS total FROM pa/.test(s))).toHaveLength(2);
    expect(
      document.querySelector('[data-test="rum-analytics-paths-branch-incomplete"]'),
    ).not.toBeNull();
    w.unmount();
  });
});

describe("pa gap fixes (Paths ignored pages)", () => {
  let wrapper: VueWrapper | null = null;
  const settingsApi = api.service as unknown as Record<string, Mock>;
  const IGNORED = [
    { op: "eq", value: "/web/login" },
    { op: "eq", value: "/web/cb" },
  ];

  const mountAt = async (anchor: string) => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
        { path: "/f", name: "productAnalyticsFunnels", component: { template: "<div />" } },
        { path: "/fb", name: "productAnalyticsFunnelBuilder", component: { template: "<div />" } },
      ],
    });
    await router.push("/p?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    useProductAnalytics().paths.value = {
      anchor: { kind: "p", key: anchor },
      direction: "next",
      depth: 3,
      include: "all",
      cohort: null,
    };
    wrapper = mount(AnalyticsPaths, {
      global: {
        plugins: [router, store],
        stubs: { PathsFlow: FlowStub, PathSessionsDrawer: DrawerStub },
      },
      attachTo: document.body,
    });
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 5; i++) await flushPromises();
  };

  beforeEach(() => {
    resetProductAnalytics();
    resetNamedEvents();
    api.reset();
    vi.mocked(searchService.search).mockReset();
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    pathRows = PATH_ROWS();
    entryRows = LOGIN_ENTRY;
    branchPage = null;
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: {
        id: "web-settings-id",
        app: "web",
        bots: true,
        builtinBots: {
          version: 1,
          families: ["HeadlessChrome", "PhantomJS", "Spider"],
          devices: ["Spider"],
        },
        sessions: [],
        pages: IGNORED,
        version: 1,
        rulesHash: "0123456789abcdef",
        createdBy: "admin@x.com",
        createdAt: 1,
        updatedBy: "admin@x.com",
        updatedAt: 1,
      },
    }));
    respond();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("P7-R10: the Paths footnote names the ignored pages", async () => {
    await mountAt("/");
    expect(pathSqls()).not.toEqual([]);
    expect(wrapper!.text()).toContain("/web/login");
    expect(wrapper!.text()).toContain("/web/cb");
  });

  it("P7-R10: with no path left after collapsing, the empty state still names the ignored pages", async () => {
    pathRows = [];
    await mountAt("/");
    expect(wrapper!.find('[data-test="rum-analytics-paths-empty"]').exists()).toBe(true);
    expect(wrapper!.text()).toContain("/web/login");
    expect(wrapper!.text()).toContain("/web/cb");
  });

  it("P7-R10: the anchor picker's options query leaves out the ignored pages", async () => {
    await mountAt("/");
    wrapper!.findComponent(StepPicker).findComponent(OSelect).vm.$emit("open");
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 4; i++) await flushPromises();
    const picker = sqls().filter((s) => /GROUP BY kind, k/.test(s));
    expect(picker).toHaveLength(1);
    expect(picker[0]).toMatch(/NOT \([^)]*'\/web\/login'/);
    expect(picker[0]).toMatch(/NOT \([^)]*'\/web\/cb'/);
  });

  it("P7-R10: a deep link to an ignored anchor says the page is hidden and offers Edit app filters", async () => {
    await mountAt("/web/login");
    expect(wrapper!.text()).toContain("This page is hidden by the app filters");
    expect(
      wrapper!
        .findAll("button, a, [role='button']")
        .some((b) => b.text().trim() === "Edit app filters"),
    ).toBe(true);
  });
});
