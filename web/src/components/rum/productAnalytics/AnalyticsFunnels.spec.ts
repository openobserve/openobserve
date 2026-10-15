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
import { defineComponent, h, KeepAlive, ref, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRouter, createWebHistory, type Router } from "vue-router";
import { createStore } from "vuex";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      computed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const toastSpy = vi.hoisted(() => vi.fn());
const confirmSpy = vi.hoisted(() => vi.fn(async (_o: Record<string, unknown>) => true));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmSpy }),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return {
    ...mod,
    toast: (...a: Parameters<typeof mod.toast>) => {
      toastSpy(...a);
      return mod.toast(...a);
    },
  };
});

import searchService from "@/services/search";
import { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import { resetFunnelDraft } from "@/composables/rum/useFunnelDraft";
import useSavedFunnels, { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import AnalyticsFunnels from "./AnalyticsFunnels.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import i18n from "@/locales";
import { assertJoinFree } from "@/utils/rum/productAnalyticsQueries";
import { decodeDef, encodeDef } from "@/utils/rum/productAnalyticsModel";
import { alertCreationDialog } from "@/composables/alerts/useAlertCreation";

type Hit = Record<string, unknown>;
type Route = [RegExp, Hit[] | ((sql: string) => Hit[] | Promise<Hit[]>)];

const SUMMARY: Hit = {
  sessions: 500,
  prev_sessions: 400,
  views: 900,
  va_rows: 1000,
  synthetic_sessions: 0,
  data_through_us: 1790000000000000,
  usr_email__values: 50,
  usr_email__sessions: 300,
};

const funnelHit = (sql: string): Hit[] => {
  const n = (sql.match(/AS m\d+/g) ?? []).length;
  const counts = [200, 80, 40, 10].slice(0, n);
  const hit: Hit = {};
  counts.forEach((c, i) => {
    hit[`c${i + 1}`] = c;
    hit[`seen${i + 1}`] = c * 2;
    if (i > 0) {
      hit[`med${i + 1}`] = 12000 * (i + 1);
      hit[`p90_${i + 1}`] = 60000 * (i + 1);
    }
  });
  if (sql.includes("left_out")) Object.assign(hit, { s1_sessions: 230, left_out: 30 });
  return [hit];
};

let routes: Route[] = [];
const respond = () =>
  vi.mocked(searchService.search).mockImplementation((async (args: {
    query: { query: { sql: string } };
  }) => {
    const sql = args.query.query.sql;
    const hit = routes.find(([re]) => re.test(sql));
    if (!hit) return { data: { hits: [] } };
    const v = hit[1];
    return { data: { hits: typeof v === "function" ? await v(sql) : v } };
  }) as never);

const baseRoutes = (): Route[] => [
  [/AS app, COUNT/, [{ app: "web", sessions: 500 }]],
  [/va_rows/, [SUMMARY]],
  [/total_s/, [{ u: "a", s: 10, total_s: 300, n_values: 50 }]],
  [
    /entry_sessions/,
    [
      {
        k: "/web/login",
        entry_sessions: 90,
        prev_entry_sessions: 1,
        exit_sessions: 1,
        prev_exit_sessions: 1,
        rank_key: 93,
      },
      {
        k: "/web",
        entry_sessions: 50,
        prev_entry_sessions: 1,
        exit_sessions: 1,
        prev_exit_sessions: 1,
        rank_key: 53,
      },
    ],
  ],
  [
    /nu0 AS/,
    [
      { is_next: 1, kind: "c", k: "save-btn", units: 41 },
      { is_next: 1, kind: "p", k: "/web/dashboards", units: 38 },
    ],
  ],
  [
    /SELECT dim, /,
    [
      { dim: "Chrome", c1: 150, c2: 60 },
      { dim: "Firefox", c1: 50, c2: 20 },
    ],
  ],
  [/FROM ps LIMIT 1|FROM pu LIMIT 1/, funnelHit],
];

const sqls = () =>
  vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);
const funnelSqls = () => sqls().filter((s) => /FROM (ps|pu) LIMIT 1|SELECT dim, /.test(s));
const settle = async () => {
  await new Promise((r) => setTimeout(r, 350));
  await flushPromises();
  await flushPromises();
};

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: { sql_base64_enabled: false },
    timezone: "UTC",
    theme: "light",
  },
});

describe("AnalyticsFunnels", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  const mountFunnels = async (query: Record<string, string> = {}, shown?: Ref<boolean>) => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/f", name: "productAnalyticsFunnels", component: { template: "<div />" } },
        { path: "/fb", name: "productAnalyticsFunnelBuilder", component: { template: "<div />" } },
        { path: "/r", name: "productAnalyticsRetention", component: { template: "<div />" } },
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
      ],
    });
    await router.push({ path: "/fb", query: { app: "web", period: "7d", ...query } });
    useProductAnalytics().initFromRoute(router.currentRoute.value.query);
    const host = shown
      ? defineComponent({
          setup: () => () => h(KeepAlive, null, shown.value ? [h(AnalyticsFunnels)] : []),
        })
      : AnalyticsFunnels;
    wrapper = mount(host, {
      global: {
        plugins: [router, store],
        stubs: {
          DropoffDrawer: {
            name: "DropoffDrawer",
            props: ["open", "cohort", "sampled", "expectedDropped", "events"],
            emits: ["paths", "update:open"],
            template: "<div data-test='dropoff-stub' />",
          },
          AddToDashboard: {
            name: "AddToDashboard",
            props: ["open", "panels", "dashboardPanelData", "notice"],
            template: "<div data-test='add-to-dashboard-stub' />",
          },
          VueDraggableNext: {
            name: "VueDraggableNext",
            props: ["modelValue"],
            emits: ["update:modelValue"],
            template: "<div><slot /></div>",
          },
          ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
          OPopover: {
            props: ["open"],
            emits: ["update:open"],
            data: () => ({ inner: false }),
            computed: {
              shown(this: { open?: boolean; inner: boolean }) {
                return this.open ?? this.inner;
              },
            },
            methods: {
              flip(this: {
                shown: boolean;
                inner: boolean;
                $emit: (e: string, v: boolean) => void;
              }) {
                this.inner = !this.shown;
                this.$emit("update:open", this.inner);
              },
            },
            template:
              '<div><div @click="flip"><slot name="trigger" /></div><slot v-if="shown" /></div>',
          },
          ODropdownItem: {
            emits: ["select"],
            template: "<button @click=\"$emit('select')\"><slot /></button>",
          },
        },
      },
      attachTo: document.body,
    });
    await settle();
  };

  const setSteps = async (steps: string[][]) => {
    const pa = useProductAnalytics();
    pa.funnel.value = {
      steps: steps.map(([kind, key]) => ({ kind: kind as "p" | "c", key })),
      unit: "sessions",
      window: "session",
      breakdown: null,
    };
    await settle();
  };

  const text = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).text();

  // Suggestions and the step picker render only once the toolbar Add step has been clicked.
  const openAddStep = async () => {
    if (wrapper!.find('[data-test="rum-analytics-funnel-add-step"]').exists()) return;
    await wrapper!.find('[data-test="rum-analytics-funnel-add-step-btn"]').trigger("click");
    await settle();
  };

  const dragSteps = async (order: number[]) => {
    const steps = useProductAnalytics().funnel.value.steps;
    wrapper!.findComponent({ name: "VueDraggableNext" }).vm.$emit(
      "update:modelValue",
      order.map((i) => steps[i]),
    );
    await settle();
  };

  beforeEach(() => {
    resetProductAnalytics();
    resetNamedEvents();
    resetSavedFunnels();
    resetFunnelDraft();
    api.reset();
    toastSpy.mockClear();
    confirmSpy.mockReset().mockResolvedValue(true);
    window.localStorage.clear();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" }, user_agent_user_agent_family: { name: "b" } },
    };
    routes = baseRoutes();
    respond();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("a cold tab offers the top entry pages and starts a funnel in one click (AC-58)", async () => {
    await mountFunnels();
    expect(text("rum-analytics-funnel-entry-start-0")).toContain("/web/login");
    await wrapper!.find('[data-test="rum-analytics-funnel-entry-start-0"]').trigger("click");
    await settle();
    await openAddStep();
    await settle();
    expect(useProductAnalytics().funnel.value.steps).toEqual([{ kind: "p", key: "/web/login" }]);
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').exists()).toBe(true);
  });

  it("Build funnel then two suggestions computes a 3-step funnel with no typing (AC-10)", async () => {
    await mountFunnels();
    await setSteps([["p", "/web/logs"]]);
    await openAddStep();
    expect(text("rum-analytics-funnel-suggestion-0")).toContain("save-btn");
    expect(text("rum-analytics-funnel-suggestion-0")).toContain("41");
    await wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').trigger("click");
    await settle();
    await openAddStep();
    await wrapper!.find('[data-test="rum-analytics-funnel-suggestion-1"]').trigger("click");
    await settle();
    expect(useProductAnalytics().funnel.value.steps.map((s) => s.key)).toEqual([
      "/web/logs",
      "save-btn",
      "/web/dashboards",
    ]);
    expect(text("rum-analytics-funnel-step-2-count")).toBe("40");
  });

  it("each step shows count, share of step 1, share of previous and the drop-off (AC-11)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
      ["p", "/c"],
    ]);
    expect(text("rum-analytics-funnel-step-0-count")).toBe("200");
    expect(text("rum-analytics-funnel-step-1-count")).toBe("80");
    expect(text("rum-analytics-funnel-step-1")).toContain("40.0%");
    expect(text("rum-analytics-funnel-step-2")).toContain("50.0%");
    expect(text("rum-analytics-funnel-dropoff-0")).toContain("120");
    expect(text("rum-analytics-funnel-overall")).toContain("20.0%");
    const header = wrapper!.find('[data-test="rum-analytics-funnel-steps-header"]');
    expect(header.findAll("[data-test^=rum-analytics-funnel-col-]").map((c) => c.text())).toEqual([
      "Step",
      "Sessions",
      "From previous",
      "Time from step 1",
      "Of step 1",
    ]);
    expect(header.text()).not.toContain("Reached, as share of step 1");
    expect(
      wrapper!
        .find('[data-test="rum-analytics-funnel-col-step"] [aria-label]')
        .attributes("aria-label"),
    ).toBe("In order (other events allowed between)");
    expect(
      wrapper!
        .find('[data-test="rum-analytics-funnel-col-unit"] [aria-label]')
        .attributes("aria-label"),
    ).toBe("Sessions that reached this step");
  });

  it("computes with one join-free search scoped to the app (AC-12, AC-14)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/it's"],
      ["c", "b"],
    ]);
    const last = funnelSqls().at(-1)!;
    expect(() => assertJoinFree(last)).not.toThrow();
    expect(last).toContain("application_id = 'web'");
    expect(last).toContain("'/it''s'");
  });

  it("reorders and removes steps and recomputes without a Run button (AC-13)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
      ["p", "/c"],
    ]);
    const before = funnelSqls().length;
    await dragSteps([0, 2, 1]);
    expect(useProductAnalytics().funnel.value.steps.map((s) => s.key)).toEqual(["/a", "/c", "b"]);
    await wrapper!.find('[data-test="rum-analytics-funnel-step-0-remove"]').trigger("click");
    await settle();
    expect(useProductAnalytics().funnel.value.steps.map((s) => s.key)).toEqual(["/c", "b"]);
    expect(funnelSqls().length).toBe(before + 2);
  });

  it("Users is offered with an identity and states the left-out step-1 sessions (AC-15)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    await wrapper!.find('[data-test="rum-analytics-funnel-count-by-users"]').trigger("click");
    await settle();
    expect(funnelSqls().at(-1)).toContain("left_out");
    expect(text("rum-analytics-funnel-left-out")).toContain("30");
    expect(text("rum-analytics-funnel-left-out")).toContain("230");
    expect(wrapper!.find('[data-test="rum-analytics-funnel-window-select"]').exists()).toBe(true);
  });

  it("without an identity Users is disabled and a hint opens the retention unlock (AC-15, AC-30)", async () => {
    routes = baseRoutes().map(([re, v]) =>
      String(re) === String(/total_s/)
        ? [re, [{ u: "guest", s: 300, total_s: 300, n_values: 1 }]]
        : [re, v],
    ) as Route[];
    respond();
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(
      wrapper!.find('[data-test="rum-analytics-funnel-count-by-users"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper!.find('[data-test="rum-analytics-funnel-window-fixed"]').exists()).toBe(true);
    await wrapper!.find('[data-test="rum-analytics-funnel-identity-hint-link"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsRetention");
  });

  const withIdentity = (summary: Hit, tops: Hit[]) => {
    routes = baseRoutes().map(([re, v]) => {
      if (String(re) === String(/va_rows/)) return [re, [{ ...SUMMARY, ...summary }]];
      if (String(re) === String(/total_s/)) return [re, tops];
      return [re, v];
    }) as Route[];
    respond();
  };
  const usersButton = () => wrapper!.find('[data-test="rum-analytics-funnel-count-by-users"]');
  const usersItem = () =>
    wrapper!.findAllComponents(OToggleGroupItem).find((c) => c.props("value") === "users");

  it("a partial identity labels Users with its coverage, keeps Sessions the default, and counts identified users (scope addition 6)", async () => {
    withIdentity({ sessions: 6400, usr_email__values: 174, usr_email__sessions: 6100 }, [
      { u: "synthetic-bot@synthetic.test", s: 5300, total_s: 6100, n_values: 174 },
      { u: "a@synthetic.test", s: 40, total_s: 6100, n_values: 174 },
    ]);
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(useProductAnalytics().funnel.value.unit).toBe("sessions");
    const item = usersItem()!;
    expect(item.text()).toBe("Identified users (12.5% of sessions)");
    expect(usersButton().attributes("disabled")).toBeUndefined();
    expect(String(item.props("tooltip"))).toContain("Identified users (12.5% of sessions)");
    await wrapper!.find('[data-test="rum-analytics-funnel-count-by-users"]').trigger("click");
    await settle();
    expect(text("rum-analytics-funnel-left-out")).toContain("identified users");
    expect(wrapper!.find('[data-test="rum-analytics-funnel"]').text()).toContain(
      "Identified users",
    );
  });

  it("a constant usr_email says it is a placeholder, with its share and never its value (scope addition 6)", async () => {
    withIdentity({ sessions: 500, usr_email__values: 1, usr_email__sessions: 499 }, [
      { u: "placeholder@synthetic.test", s: 499, total_s: 499, n_values: 1 },
    ]);
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    const item = usersItem()!;
    expect(usersButton().attributes("disabled")).toBeDefined();
    const tip = String(item.props("tooltip"));
    expect(tip).toMatch(/placeholder/i);
    expect(tip).toContain("99.8%");
    expect(tip).toContain("usr_email");
    expect(tip).not.toContain("placeholder@synthetic.test");
    expect(tip).not.toContain("Set one up from Retention");
    const hint = text("rum-analytics-funnel-identity-hint");
    expect(hint).toMatch(/placeholder or a constant setUser call/);
    expect(hint).toContain("99.8%");
    expect(wrapper!.html()).not.toContain("placeholder@synthetic.test");
  });

  it("an anonymous id labels the unit Visitors (scope addition 6)", async () => {
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_anonymous_id: { name: "usr_anonymous_id" } },
    };
    withIdentity({ usr_anonymous_id__values: 400, usr_anonymous_id__sessions: 450 }, [
      { u: "anon-1", s: 3, total_s: 450, n_values: 400 },
    ]);
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(usersItem()!.text()).toBe("Visitors");
  });

  it("keeps the funnel in the URL and lists it under Recent after a reload (AC-20)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(decodeDef(router.currentRoute.value.query.funnel as string)).toEqual({
      s: [
        ["p", "/a"],
        ["c", "b"],
      ],
      u: "sessions",
      w: "session",
    });
    wrapper!.unmount();
    resetProductAnalytics();
    await mountFunnels();
    expect(text("rum-analytics-funnel-recent-0")).toContain("/a");
    await wrapper!.find('[data-test="rum-analytics-funnel-recent-0"]').trigger("click");
    await settle();
    expect(useProductAnalytics().funnel.value.steps).toHaveLength(2);
  });

  it("picking a Recent funnel while a saved one is open starts an unsaved funnel instead of editing it", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    const row = api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/web/login"],
        ["p", "/web"],
      ],
      u: "sessions",
      w: "session",
    });
    await useSavedFunnels().load("org1", "web", true);
    const pa = useProductAnalytics();
    pa.openSavedFunnel(useSavedFunnels().funnels.value.find((f) => f.id === row.id)!);
    await settle();
    const mine = wrapper!
      .findAll('[data-test^="rum-analytics-funnel-recent-menu-"]')
      .find((b) => b.text().includes("/a"));
    await mine!.trigger("click");
    await settle();
    expect(pa.openedFunnel.value).toBeNull();
    expect(pa.funnel.value.steps.map((x) => x.key)).toEqual(["/a", "b"]);
    expect(text("rum-analytics-funnel-saved-name")).toBe("Unsaved funnel");
  });

  it("an empty step 1 names the step and range with a widen action (AC-21)", async () => {
    routes = [[/FROM ps LIMIT 1/, [{ c1: 0, c2: 0, seen1: 0, seen2: 0 }]], ...baseRoutes()];
    respond();
    await mountFunnels();
    await setSteps([
      ["p", "/nowhere"],
      ["c", "b"],
    ]);
    expect(text("rum-analytics-funnel-step1-empty")).toContain("/nowhere");
    await wrapper!.find('[data-test="rum-analytics-funnel-widen-range-btn"]').trigger("click");
    await flushPromises();
    expect(useProductAnalytics().state.datetime.relativeTimePeriod).toBe("30d");
  });

  it("tags a step never seen in range while the funnel still computes (AC-21)", async () => {
    routes = [[/FROM ps LIMIT 1/, [{ c1: 100, c2: 0, seen1: 150, seen2: 0 }]], ...baseRoutes()];
    respond();
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "missing"],
    ]);
    expect(wrapper!.find('[data-test="rum-analytics-funnel-step-1-not-seen"]').exists()).toBe(true);
    expect(text("rum-analytics-funnel-step-0-count")).toBe("100");
  });

  it("shows median and p90 time from step 1 and the overall time to convert (AC-46)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
      ["p", "/c"],
    ]);
    expect(text("rum-analytics-funnel-step-0-time")).toBe("—");
    expect(text("rum-analytics-funnel-step-1-time")).toContain("24 s");
    expect(text("rum-analytics-funnel-step-1-time")).toContain("2.0 min");
    expect(text("rum-analytics-funnel-overall-time")).toContain("36 s");
  });

  it("splits by a breakdown dimension into rows summing to the total and keeps it in the URL (AC-47)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    useProductAnalytics().funnel.value = {
      ...useProductAnalytics().funnel.value,
      breakdown: "browser",
    };
    await settle();
    expect(funnelSqls().at(-1)).toMatch(/^WITH/);
    expect(funnelSqls().at(-1)).toContain("SELECT dim, ");
    expect(text("rum-analytics-funnel-breakdown-row-0")).toContain("Chrome");
    expect(text("rum-analytics-funnel-breakdown")).toContain("200");
    expect(wrapper!.find('[data-test="rum-analytics-funnel-step-1-time"]').exists()).toBe(false);
    expect((decodeDef(router.currentRoute.value.query.funnel as string) as { b: string }).b).toBe(
      "browser",
    );
  });

  it("a drop-off opens the drawer for that step in one click and See paths hands over the cohort (AC-16, AC-25)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
      ["p", "/c"],
    ]);
    const trigger = wrapper!
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "rum-analytics-funnel-dropoff-1")!;
    expect(trigger.props("variant")).toBe("ghost-primary");
    expect(trigger.props("size")).toBe("xs");
    expect(trigger.props("iconRight")).toBe("chevron-right");
    expect(trigger.attributes("aria-haspopup")).toBe("dialog");
    expect(trigger.text()).toMatch(/^40 dropped \(\d+\.\d%\)$/);
    expect(trigger.attributes("aria-label")).toBe(
      `${trigger.text()} after step 2, see why in a side panel`,
    );
    expect(trigger.text()).not.toContain("Why?");
    expect(trigger.findComponent(OTooltip).props("content")).toBe("See why they dropped");
    await wrapper!.find('[data-test="rum-analytics-funnel-dropoff-1"]').trigger("click");
    await flushPromises();
    const drawer = wrapper!.findComponent({ name: "DropoffDrawer" });
    expect(drawer.props("cohort")).toMatchObject({ stepIndex: 2, side: "dropped" });
    expect(drawer.props("expectedDropped")).toBe(40);
    drawer.vm.$emit("paths", drawer.props("cohort"));
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsPaths");
    expect(useProductAnalytics().paths.value.cohort?.stepIndex).toBe(2);
  });

  it("See paths of dropped sessions stores the open saved funnel's name on the cohort", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
      ["p", "/c"],
    ]);
    const pa = useProductAnalytics();
    pa.openSavedFunnel(
      {
        id: "Checkout0000000000000000001",
        app: "web",
        name: "Checkout drop-off",
        def: pa.funnel.value,
        sql: "SELECT 1",
        eventIds: [],
        version: 1,
        createdBy: "a@x.com",
        createdAt: 1,
        updatedBy: "a@x.com",
        updatedAt: 1,
      },
      true,
    );
    await flushPromises();
    await wrapper!.find('[data-test="rum-analytics-funnel-dropoff-1"]').trigger("click");
    await flushPromises();
    const drawer = wrapper!.findComponent({ name: "DropoffDrawer" });
    drawer.vm.$emit("paths", drawer.props("cohort"));
    await flushPromises();
    expect(pa.paths.value.cohort?.name).toBe("Checkout drop-off");
    expect(pa.paths.value.cohort?.funnelId).toBe("Checkout0000000000000000001");
  });

  it("Add to dashboard does not reopen when the user comes back from the dashboard it opened (AC-53)", async () => {
    const shown = ref(true);
    await mountFunnels({}, shown);
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    await wrapper!.find('[data-test="rum-analytics-funnel-add-dashboard-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper!.findComponent({ name: "AddToDashboard" }).exists()).toBe(true);
    shown.value = false;
    await settle();
    shown.value = true;
    await settle();
    expect(wrapper!.findComponent({ name: "AddToDashboard" }).exists()).toBe(false);
  });

  it("adds a Sessions funnel without breakdown to a dashboard as a bar panel (AC-53)", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    await wrapper!.find('[data-test="rum-analytics-funnel-add-dashboard-btn"]').trigger("click");
    await flushPromises();
    const dialog = wrapper!.findComponent({ name: "AddToDashboard" });
    expect(dialog.props("open")).toBe(true);
    const panels = dialog.props("panels") as { type: string; queries: { query: string }[] }[];
    expect(panels[0].type).toBe("bar");
    expect(panels[0].queries[0].query).toContain("unnest(make_array('1. /a', '2. b'))");
    useProductAnalytics().funnel.value = {
      ...useProductAnalytics().funnel.value,
      breakdown: "browser",
    };
    await settle();
    expect(
      wrapper!.find('[data-test="rum-analytics-funnel-add-dashboard-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("Alert me hands the alert form a star-free conversion alert at today's rate", async () => {
    alertCreationDialog.value = null;
    await mountFunnels();
    await setSteps([["p", "/a"]]);
    expect(
      wrapper!.find('[data-test="rum-analytics-funnel-alert-btn"]').attributes("disabled"),
    ).toBeDefined();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    await wrapper!.find('[data-test="rum-analytics-funnel-alert-btn"]').trigger("click");
    const prefill = alertCreationDialog.value!.prefill;
    expect(prefill.source).toBe("rumfunnel");
    expect(prefill.streamName).toBe("_rumdata");
    expect(prefill.sql).not.toMatch(/select[ ]+\*/i);
    expect(prefill.sql).toMatch(/ < 40$/);
    expect(prefill.warnings.map((w) => w.key)).toContain("rumFunnelSnapshot");
    alertCreationDialog.value = null;
  });

  const EVT = "EvtDashboards00000000000001";
  const EVENT_FUNNEL = encodeDef({
    s: [
      ["p", "/web/login"],
      ["e", EVT],
    ],
    u: "sessions",
    w: "session",
  });
  const has = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).exists();
  const skeletonsIn = (dt: string) =>
    wrapper!.find(`[data-test="${dt}"]`).findAll(".bg-skeleton-base");
  const serveEvent = () => {
    const row = api.seedEvent("web", "Dashboards", {
      rules: [{ t: "view", op: "eq", value: "/web/dashboards" }],
    });
    api.events.delete(row.id);
    api.events.set(EVT, { ...row, id: EVT });
  };

  it("a named-event step waits for the events to load instead of counting zero under a deleted tag or a skeleton (F22, F30)", async () => {
    api.failNext("listEvents", 503);
    await mountFunnels({ funnel: EVENT_FUNNEL });
    expect(funnelSqls()).toEqual([]);
    expect(has("rum-analytics-funnel-events-unavailable")).toBe(true);
    expect(has("rum-analytics-funnel-step-1-unavailable")).toBe(true);
    expect(has("rum-analytics-funnel-step-1-deleted")).toBe(false);
    expect(skeletonsIn("rum-analytics-funnel-step-0")).toHaveLength(0);
    expect(has("rum-analytics-funnel-step-0-held")).toBe(true);
    expect(text("rum-analytics-funnel-step-1")).toContain("Named event");
    expect(wrapper!.text()).not.toContain(EVT);
    serveEvent();
    await wrapper!.find('[data-test="rum-analytics-funnel-events-retry-btn"]').trigger("click");
    await settle();
    expect(funnelSqls()).toHaveLength(1);
    expect(funnelSqls()[0]).toContain("/web/dashboards");
    expect(has("rum-analytics-funnel-events-unavailable")).toBe(false);
    expect(has("rum-analytics-funnel-step-1-unavailable")).toBe(false);
  });

  it("a first open of a funnel with a named-event step shows no failure banner or raw event id while the events load, and runs once (F24, F38)", async () => {
    serveEvent();
    const release = api.gate("listEvents");
    await mountFunnels({ funnel: EVENT_FUNNEL });
    expect(has("rum-analytics-funnel-events-unavailable")).toBe(false);
    expect(has("rum-analytics-funnel-events-forbidden")).toBe(false);
    expect(has("rum-analytics-funnel-step-1-unavailable")).toBe(false);
    expect(has("rum-analytics-funnel-step-1-deleted")).toBe(false);
    expect(funnelSqls()).toEqual([]);
    expect(skeletonsIn("rum-analytics-funnel-step-0").length).toBeGreaterThan(0);
    expect(has("rum-analytics-funnel-step-0-held")).toBe(false);
    expect(text("rum-analytics-funnel-step-1")).toContain("Named event");
    expect(wrapper!.text()).not.toContain(EVT);
    release();
    await settle();
    expect(api.service.listEvents).toHaveBeenCalledTimes(1);
    expect(funnelSqls()).toHaveLength(1);
    expect(funnelSqls()[0]).toContain("/web/dashboards");
    expect(has("rum-analytics-funnel-events-unavailable")).toBe(false);
  });

  it("no read access to named events says so, offers no Retry, never counts the step as zero and draws no endless skeletons (F25, F30)", async () => {
    api.failNext("listEvents", 403);
    await mountFunnels({ funnel: EVENT_FUNNEL });
    expect(has("rum-analytics-funnel-events-forbidden")).toBe(true);
    expect(has("rum-analytics-funnel-events-unavailable")).toBe(false);
    expect(has("rum-analytics-funnel-events-retry-btn")).toBe(false);
    expect(funnelSqls()).toEqual([]);
    for (const i of [0, 1]) {
      expect(skeletonsIn(`rum-analytics-funnel-step-${i}`)).toHaveLength(0);
      expect(has(`rum-analytics-funnel-step-${i}-held`)).toBe(true);
    }
    expect(text("rum-analytics-funnel-step-1")).toContain("Named event");
    expect(wrapper!.text()).not.toContain(EVT);
  });

  it("a funnel with no named-event step never shows held dashes while its panel is idle under forbidden events (F35)", async () => {
    api.failNext("listEvents", 403);
    await mountFunnels({ funnel: EVENT_FUNNEL });
    expect(has("rum-analytics-funnel-step-0-held")).toBe(true);
    useProductAnalytics().funnel.value = {
      steps: [
        { kind: "p", key: "/web/login" },
        { kind: "p", key: "/web" },
      ],
      unit: "sessions",
      window: "session",
      breakdown: null,
    };
    await flushPromises();
    expect(funnelSqls()).toEqual([]);
    for (const i of [0, 1]) {
      expect(has(`rum-analytics-funnel-step-${i}-held`)).toBe(false);
      expect(skeletonsIn(`rum-analytics-funnel-step-${i}`).length).toBeGreaterThan(0);
    }
    await settle();
    expect(funnelSqls()).toHaveLength(1);
    expect(has("rum-analytics-funnel-step-0-count")).toBe(true);
  });

  it("a shared link naming a deleted event drops the step before the funnel's first run (D-45)", async () => {
    await mountFunnels({ funnel: EVENT_FUNNEL });
    expect(useProductAnalytics().funnel.value.steps).toEqual([{ kind: "p", key: "/web/login" }]);
    expect(useProductAnalytics().deletedEventLink.value).toBe(true);
    expect(funnelSqls().length).toBeGreaterThan(0);
    for (const sql of funnelSqls()) {
      expect(sql.match(/AS m\d+/g)).toHaveLength(1);
      expect(sql).not.toContain("1 = 0");
    }
  });

  it("a funnel run in flight when the events become unavailable never lands on the held panel (F27)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    routes = [
      [
        /FROM ps LIMIT 1/,
        async (sql: string) => {
          await gate;
          return funnelHit(sql);
        },
      ],
      ...baseRoutes(),
    ];
    respond();
    serveEvent();
    await mountFunnels({ funnel: EVENT_FUNNEL });
    expect(funnelSqls()).toHaveLength(1);
    resetNamedEvents();
    api.failNext("listEvents", 503);
    await settle();
    expect(has("rum-analytics-funnel-events-unavailable")).toBe(true);
    release();
    await settle();
    expect(has("rum-analytics-funnel-step-0-count")).toBe(false);
    expect(funnelSqls()).toHaveLength(1);
  });

  it("a failed funnel search shows Retry for the funnel only (AC-9)", async () => {
    routes = [
      [
        /FROM ps LIMIT 1/,
        () => Promise.reject({ response: { status: 429, data: { message: "busy" } } }),
      ],
      ...baseRoutes(),
    ];
    respond();
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(text("rum-analytics-funnel-error")).toContain("429");
    routes = baseRoutes();
    respond();
    await wrapper!.find('[data-test="rum-analytics-funnel-retry-btn"]').trigger("click");
    await settle();
    expect(text("rum-analytics-funnel-step-0-count")).toBe("200");
  });

  it("a partial funnel result says it may be incomplete and holds back Alert me", async () => {
    const base = vi.mocked(searchService.search).getMockImplementation()!;
    vi.mocked(searchService.search).mockImplementation((async (args: {
      query: { query: { sql: string } };
    }) => {
      const res = (await base(args as never)) as { data: Record<string, unknown> };
      if (/FROM ps LIMIT 1/.test(args.query.query.sql)) res.data.is_partial = true;
      return res;
    }) as never);
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(text("rum-analytics-funnel-partial")).toContain("may be incomplete");
    expect(text("rum-analytics-funnel-step-0-count")).toBe("200");
    expect(
      wrapper!.find('[data-test="rum-analytics-funnel-alert-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("an empty step 1 keeps the builder, so its steps can still be edited", async () => {
    routes = [[/FROM ps LIMIT 1/, [{ c1: 0, c2: 0, seen1: 0, seen2: 0 }]], ...baseRoutes()];
    respond();
    await mountFunnels();
    await setSteps([
      ["p", "/nowhere"],
      ["c", "b"],
    ]);
    expect(text("rum-analytics-funnel-step1-empty")).toContain("/nowhere");
    await wrapper!.find('[data-test="rum-analytics-funnel-step-0-remove"]').trigger("click");
    await settle();
    expect(useProductAnalytics().funnel.value.steps.map((s) => s.key)).toEqual(["b"]);
  });

  it("drops next-step suggestions as soon as the steps change, so one cannot be added twice", async () => {
    await mountFunnels();
    await setSteps([["p", "/web/logs"]]);
    await openAddStep();
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').exists()).toBe(true);
    await wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').trigger("click");
    await flushPromises();
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').exists()).toBe(false);
  });

  it("a failed suggestions query shows its own error state instead of silently disappearing (o2-enterprise#2799)", async () => {
    routes = [
      [/nu0 AS/, () => Promise.reject({ response: { status: 400, data: { message: "bad" } } })],
      ...baseRoutes().filter(([re]) => re.source !== /nu0 AS/.source),
    ];
    respond();
    await mountFunnels();
    await setSteps([["p", "/web/logs"]]);
    await openAddStep();
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').exists()).toBe(false);
    expect(text("rum-analytics-funnel-suggestions-error")).toContain("400");
    const funnelCallsBeforeRetry = funnelSqls().length;
    routes = baseRoutes();
    respond();
    await wrapper!
      .find('[data-test="rum-analytics-funnel-suggestions-retry-btn"]')
      .trigger("click");
    await settle();
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestions-error"]').exists()).toBe(
      false,
    );
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').exists()).toBe(true);
    // Retrying the suggestions row is cheaper than a full recompute: the funnel counts
    // are already known good, so only the "next" panel's query should run again.
    expect(funnelSqls().length).toBe(funnelCallsBeforeRetry);
  });

  it("returning while a run was cut short reloads the funnel and its suggestions", async () => {
    const shown = ref(true);
    await mountFunnels({}, shown);
    const base = vi.mocked(searchService.search).getMockImplementation()!;
    // A real search rejects once its signal aborts, which is what leaving the tab does.
    vi.mocked(searchService.search).mockImplementation(((args: {
      query: { query: { sql: string } };
      signal?: AbortSignal;
    }) =>
      /FROM ps LIMIT 1/.test(args.query.query.sql)
        ? new Promise((_r, reject) =>
            args.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          )
        : base(args as never)) as never);
    const pa = useProductAnalytics();
    pa.funnel.value = {
      steps: [{ kind: "p", key: "/web/logs" }],
      unit: "sessions",
      window: "session",
      breakdown: null,
    };
    await settle();
    shown.value = false;
    await settle();
    respond();
    shown.value = true;
    await settle();
    await openAddStep();
    expect(wrapper!.find('[data-test="rum-analytics-funnel-suggestion-0"]').exists()).toBe(true);
  });

  it("a Refresh while the tab is hidden is applied on return", async () => {
    const shown = ref(true);
    await mountFunnels({}, shown);
    useProductAnalytics().setScope({
      datetime: {
        valueType: "absolute",
        startTime: 1789000000000000,
        endTime: 1790000000000000,
        relativeTimePeriod: null,
      },
    });
    await settle();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    shown.value = false;
    await settle();
    await useProductAnalytics().refresh();
    await settle();
    const before = funnelSqls().length;
    shown.value = true;
    await settle();
    expect(funnelSqls().length).toBe(before + 1);
  });

  it("names its icon-only buttons for screen readers", async () => {
    await mountFunnels();
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(wrapper!.find('[data-test="rum-analytics-funnel-add-step-btn"]').text()).toBe(
      "Add step",
    );
    for (const dt of [
      "rum-analytics-funnel-step-0-filters",
      "rum-analytics-funnel-step-0-remove",
    ]) {
      expect(wrapper!.find(`[data-test="${dt}"]`).attributes("aria-label"), dt).toBeTruthy();
    }
    expect(wrapper!.find('[data-test="rum-analytics-funnel-alert-btn"]').text()).toBe("Alert");
    expect(wrapper!.find('[data-test="rum-analytics-funnel-add-dashboard-btn"]').text()).toBe(
      "Add to dashboard",
    );
  });

  it("explains a disabled Alert me or Add to dashboard by its real reason", async () => {
    const tips = () =>
      wrapper!.findAllComponents(OTooltip).map((c) => String(c.props("content") ?? ""));
    routes = [[/FROM ps LIMIT 1/, () => new Promise<Hit[]>(() => undefined)], ...baseRoutes()];
    respond();
    await mountFunnels();
    await setSteps([["p", "/a"]]);
    expect(tips()).toContain("Add a second step to add this funnel to a dashboard");
    await setSteps([
      ["p", "/a"],
      ["c", "b"],
    ]);
    expect(tips()).toContain("Wait for the funnel to finish counting");
  });

  it("refuses a step that would make the funnel too long to keep in its link", async () => {
    await mountFunnels();
    const long = (c: string) => `/${c.repeat(1000)}`;
    await setSteps([
      ["p", long("a")],
      ["p", long("b")],
      ["p", long("c")],
      ["p", long("d")],
      ["p", long("e")],
    ]);
    const pa = useProductAnalytics();
    for (const c of ["f", "g", "h", "i"]) {
      await openAddStep();
      const builder = wrapper!.findComponent({ name: "FunnelAddStep" });
      (builder.vm as unknown as { add: (s: { kind: "p"; key: string }) => void }).add({
        kind: "p",
        key: long(c),
      });
      await flushPromises();
    }
    await settle();
    const encoded = encodeDef({
      s: pa.funnel.value.steps.map((s) => [s.kind, s.key]),
      u: "sessions",
      w: "session",
    });
    expect(encoded.length).toBeLessThanOrEqual(8192);
    expect(decodeDef(router.currentRoute.value.query.funnel as string)).toBeDefined();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("too long") }),
    );
  });

  it("Clear on an opened saved funnel with edits asks first, and keeps it when declined", async () => {
    const row = api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/a"],
        ["p", "/b"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountFunnels();
    await useSavedFunnels().load("org1", "web", true);
    const pa = useProductAnalytics();
    pa.openSavedFunnel(useSavedFunnels().funnels.value.find((f) => f.id === row.id)!);
    pa.funnel.value = {
      ...pa.funnel.value,
      steps: [...pa.funnel.value.steps, { kind: "p", key: "/c" }],
    };
    await settle();
    confirmSpy.mockResolvedValueOnce(false);
    await wrapper!.find('[data-test="rum-analytics-funnel-clear-btn"]').trigger("click");
    await settle();
    expect(confirmSpy).toHaveBeenCalled();
    expect(pa.openedFunnel.value?.id).toBe(row.id);
    expect(pa.funnel.value.steps).toHaveLength(3);
  });

  describe("saved funnels (G8)", () => {
    const LOGIN_WEB = {
      s: [
        ["p", "/web/login"],
        ["p", "/web"],
      ],
      u: "sessions",
      w: "session",
    };
    const CARRIED = encodeDef({
      s: [
        ["p", "/x"],
        ["p", "/y"],
      ],
      u: "sessions",
      w: "session",
    });

    it("an sf link opens the saved funnel by name over the funnel it carried (AC-70)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      await mountFunnels({ sf: row.id, funnel: CARRIED });
      await settle();
      expect(useProductAnalytics().funnel.value.steps.map((x) => x.key)).toEqual([
        "/web/login",
        "/web",
      ]);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      expect(router.currentRoute.value.query.sf).toBe(row.id);
      expect(decodeDef(router.currentRoute.value.query.funnel as string)).toEqual(LOGIN_WEB);
      expect(funnelSqls().every((q) => !q.includes("'/x'"))).toBe(true);
      await wrapper!.find('[data-test="rum-analytics-funnel-add-dashboard-btn"]').trigger("click");
      await flushPromises();
      const panels = wrapper!.findComponent({ name: "AddToDashboard" }).props("panels") as {
        title: string;
      }[];
      expect(panels[0].title).toBe("Signup");
    });

    it("an sf link whose funnel is gone keeps the carried funnel, says so and drops sf (AC-70)", async () => {
      routes = baseRoutes();
      respond();
      await mountFunnels({ sf: "Missing0000000000000000001A", funnel: CARRIED });
      await settle();
      expect(useProductAnalytics().funnel.value.steps.map((x) => x.key)).toEqual(["/x", "/y"]);
      expect(text("rum-analytics-funnel-saved-missing")).toBe(
        "This link's saved funnel is no longer available; showing the funnel it held when shared",
      );
      expect(router.currentRoute.value.query.sf).toBeUndefined();
      expect(text("rum-analytics-funnel-saved-name")).toBe("Unsaved funnel");
    });

    it("a saved funnel whose named-event step was deleted opens with it tagged and stays editable (AC-69)", async () => {
      routes = baseRoutes();
      respond();
      const gone = "GoneEvent000000000000000001";
      const row = api.seedFunnel("web", "With event", {
        ...LOGIN_WEB,
        s: [
          ["p", "/web/login"],
          ["e", gone],
        ],
      });
      await mountFunnels({ sf: row.id });
      await settle();
      expect(useProductAnalytics().funnel.value.steps).toEqual([
        { kind: "p", key: "/web/login" },
        { kind: "e", key: gone },
      ]);
      expect(has("rum-analytics-funnel-step-1-deleted")).toBe(true);
      expect(useProductAnalytics().deletedEventLink.value).toBe(false);
      const pa = useProductAnalytics();
      pa.funnel.value = { ...pa.funnel.value, unit: "users" };
      await settle();
      expect(
        wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]').attributes("disabled"),
      ).toBe(undefined);
    });

    it("a saved funnel whose first step names a deleted event keeps the builder with it tagged, not the empty step-1 state (AC-69)", async () => {
      // A deleted event compiles to no match, so the engine counts no one at step 1.
      routes = [
        [/FROM ps LIMIT 1|FROM pu LIMIT 1/, [{ c1: 0, c2: 0, seen1: 0, seen2: 0 }]],
        ...baseRoutes(),
      ];
      respond();
      const gone = "GoneEvent000000000000000001";
      const row = api.seedFunnel("web", "Gone first", {
        ...LOGIN_WEB,
        s: [
          ["e", gone],
          ["p", "/web"],
        ],
      });
      await mountFunnels({ sf: row.id });
      await settle();
      expect(text("rum-analytics-funnel-saved-name")).toBe("Gone first");
      expect(funnelSqls().length).toBeGreaterThan(0);
      expect(has("rum-analytics-funnel-step1-empty")).toBe(false);
      expect(has("rum-analytics-funnel-step-0-deleted")).toBe(true);
      expect(has("rum-analytics-funnel-step-1-deleted")).toBe(false);
    });

    it("an empty builder keeps its header and quick starts, but lists no saved funnels, which live on the list page (AC-58, AC-67)", async () => {
      routes = baseRoutes();
      respond();
      api.seedFunnel("web", "Signup", LOGIN_WEB);
      await mountFunnels();
      await settle();
      expect(has("rum-analytics-funnel-cold")).toBe(true);
      expect(has("rum-analytics-funnel-back-btn")).toBe(true);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Unsaved funnel");
      expect(has("rum-analytics-funnel-quick-starts")).toBe(true);
      expect(has("rum-analytics-funnel-saved-list")).toBe(false);
      expect(has("rum-analytics-saved-funnel-row-0")).toBe(false);
      expect(has("rum-analytics-funnel-saved-btn")).toBe(false);
    });

    it("Save stores the funnel's compiled, time-relative SQL beside its def", async () => {
      routes = baseRoutes();
      respond();
      await mountFunnels({ funnel: encodeDef(LOGIN_WEB) });
      await settle();
      await wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]').trigger("click");
      await settle();
      const input = document.querySelector<HTMLInputElement>(
        '[data-test="rum-analytics-save-funnel-name"] input',
      )!;
      input.value = "Login to home";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
      document
        .querySelector("#rum-analytics-save-funnel-form")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
      const [body] = api.bodies("createFunnel");
      expect(body).toMatchObject({ name: "Login to home", def: LOGIN_WEB });
      expect(body.sql).toBe(funnelSqls()[0]);
      expect(body.sql).not.toMatch(/_timestamp >= \d/);
      expect(router.currentRoute.value.query.sf).toBe(useProductAnalytics().openedFunnel.value?.id);
    });

    const submitSave = async (name: string) => {
      await wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]').trigger("click");
      await settle();
      const input = document.querySelector<HTMLInputElement>(
        '[data-test="rum-analytics-save-funnel-name"] input',
      )!;
      input.value = name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
      document
        .querySelector("#rum-analytics-save-funnel-form")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
    };
    const usersSql = (sql: unknown) => /left_out/.test(String(sql));

    it("the stored def and sql are one definition: a Users funnel stores Users SQL (F49)", async () => {
      routes = baseRoutes();
      respond();
      const users = { ...LOGIN_WEB, u: "users", w: "7d" };
      await mountFunnels({ funnel: encodeDef(users) });
      await settle();
      await submitSave("Users funnel");
      const [body] = api.bodies("createFunnel");
      expect(body.def).toEqual(users);
      expect(usersSql(body.sql)).toBe(true);
      expect(body.sql).toBe(funnelSqls().at(-1));
    });

    it("a Users funnel cannot be saved while Users cannot be counted, so def and sql never disagree (F49)", async () => {
      routes = baseRoutes().map(([re, v]) =>
        String(re) === String(/total_s/)
          ? [re, [{ u: "guest", s: 300, total_s: 300, n_values: 1 }]]
          : [re, v],
      ) as Route[];
      respond();
      await mountFunnels({ funnel: encodeDef({ ...LOGIN_WEB, u: "users", w: "7d" }) });
      await settle();
      expect(has("rum-analytics-funnel-users-fallback")).toBe(true);
      expect(usersSql(funnelSqls().at(-1))).toBe(false);
      const save = wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]');
      expect(save.attributes("disabled")).toBeDefined();
      useProductAnalytics().funnel.value = {
        ...useProductAnalytics().funnel.value,
        unit: "sessions",
        window: "session",
      };
      await settle();
      await submitSave("Sessions funnel");
      const [body] = api.bodies("createFunnel");
      expect(body.def).toEqual(LOGIN_WEB);
      expect(usersSql(body.sql)).toBe(false);
    });

    it("an sf link whose list fails to load keeps sf and the carried funnel and offers Retry, never 'no longer available' (F50)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      api.failNext("listFunnels", 503);
      await mountFunnels({ sf: row.id, funnel: CARRIED });
      await settle();
      expect(useProductAnalytics().funnel.value.steps.map((x) => x.key)).toEqual(["/x", "/y"]);
      expect(has("rum-analytics-funnel-saved-missing")).toBe(false);
      expect(router.currentRoute.value.query.sf).toBe(row.id);
      expect(text("rum-analytics-funnel-saved-link-failed")).toContain(
        "This link's saved funnel could not be loaded; showing the funnel it held when shared",
      );
      await wrapper!
        .find('[data-test="rum-analytics-funnel-saved-link-retry-btn"]')
        .trigger("click");
      await settle();
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      expect(useProductAnalytics().funnel.value.steps.map((x) => x.key)).toEqual([
        "/web/login",
        "/web",
      ]);
      expect(router.currentRoute.value.query.sf).toBe(row.id);
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
    });

    it("an sf link whose by-id read fails is not missing; a later 404 is (F50)", async () => {
      routes = baseRoutes();
      respond();
      const id = "Missing0000000000000000001A";
      api.failNext("getFunnel", 503);
      await mountFunnels({ sf: id, funnel: CARRIED });
      await settle();
      expect(has("rum-analytics-funnel-saved-missing")).toBe(false);
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(true);
      expect(router.currentRoute.value.query.sf).toBe(id);
      await wrapper!
        .find('[data-test="rum-analytics-funnel-saved-link-retry-btn"]')
        .trigger("click");
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(has("rum-analytics-funnel-saved-missing")).toBe(true);
      expect(router.currentRoute.value.query.sf).toBeUndefined();
      expect(useProductAnalytics().funnel.value.steps.map((x) => x.key)).toEqual(["/x", "/y"]);
    });

    it("an sf link the role cannot read says so and keeps sf, never 'no longer available' (F50)", async () => {
      routes = baseRoutes();
      respond();
      const id = "Signup00000000000000000001A";
      api.failNext("listFunnels", 403);
      await mountFunnels({ sf: id, funnel: CARRIED });
      await settle();
      expect(has("rum-analytics-funnel-saved-missing")).toBe(false);
      expect(text("rum-analytics-funnel-saved-link-forbidden")).toBe(
        "Your role cannot read RUM data (the _rumdata stream), so saved funnels are not shown",
      );
      expect(has("rum-analytics-funnel-saved-link-retry-btn")).toBe(false);
      expect(router.currentRoute.value.query.sf).toBe(id);
    });

    it("a link issue belongs to its org, app and link: an app switch drops it and reads the link there, and switching back reads it again (F56)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      api.failNext("listFunnels", 503);
      await mountFunnels({ sf: row.id, funnel: CARRIED });
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(true);
      const pa = useProductAnalytics();
      const release = api.gate("listFunnels");
      pa.setScope({ app: "mobile" }, true);
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(api.service.listFunnels).toHaveBeenLastCalledWith("org1", "mobile");
      pa.setScope({ app: "web" }, true);
      release();
      await settle();
      expect(api.service.listFunnels).toHaveBeenLastCalledWith("org1", "web");
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      expect(router.currentRoute.value.query.sf).toBe(row.id);
    });

    it("re-entering the same sf link reads it again instead of keeping the old failure (F56)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      api.failNext("listFunnels", 503);
      const shown = ref(true);
      await mountFunnels({ sf: row.id, funnel: CARRIED }, shown);
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(true);
      shown.value = false;
      await settle();
      const calls = api.service.listFunnels.mock.calls.length;
      shown.value = true;
      await settle();
      expect(api.service.listFunnels.mock.calls.length).toBe(calls + 1);
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");

      const pa = useProductAnalytics();
      api.failNext("listFunnels", 503);
      await useSavedFunnels().load("org1", "web", true);
      pa.initFromRoute({ app: "web", period: "7d", sf: row.id, funnel: CARRIED });
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(true);
      await useSavedFunnels().load("org1", "web", true);
      pa.initFromRoute({ app: "web", period: "7d", sf: row.id, funnel: CARRIED });
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      expect(router.currentRoute.value.query.sf).toBe(row.id);
    });

    it("an sf link whose list load was superseded by a forced reload waits for that reload and is never marked missing (F56)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      const first = api.gate("listFunnels");
      const second = api.gate("listFunnels");
      await mountFunnels({ sf: row.id, funnel: CARRIED });
      void useSavedFunnels().load("org1", "web", true);
      await flushPromises();
      first();
      await settle();
      expect(has("rum-analytics-funnel-saved-missing")).toBe(false);
      expect(router.currentRoute.value.query.sf).toBe(row.id);
      expect(useProductAnalytics().funnel.value.steps.map((x) => x.key)).toEqual(["/x", "/y"]);
      second();
      await settle();
      expect(has("rum-analytics-funnel-saved-missing")).toBe(false);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      expect(router.currentRoute.value.query.sf).toBe(row.id);
    });

    it("a list load superseded twice keeps joining the newest reload and never reports a failure (F61)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      const first = api.gate("listFunnels");
      const second = api.gate("listFunnels");
      const third = api.gate("listFunnels");
      await mountFunnels({ sf: row.id, funnel: CARRIED });
      void useSavedFunnels().load("org1", "web", true);
      await flushPromises();
      first();
      await settle();
      void useSavedFunnels().load("org1", "web", true);
      await flushPromises();
      second();
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(has("rum-analytics-funnel-saved-missing")).toBe(false);
      expect(router.currentRoute.value.query.sf).toBe(row.id);
      third();
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(false);
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      expect(router.currentRoute.value.query.sf).toBe(row.id);
    });

    it("Back to a URL carrying this tab's edits to a saved funnel keeps them, not the stored steps", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      await mountFunnels({ sf: row.id });
      await settle();
      const pa = useProductAnalytics();
      pa.funnel.value = {
        ...pa.funnel.value,
        steps: [...pa.funnel.value.steps, { kind: "p", key: "/mine" }],
      };
      await settle();
      pa.initFromRoute({ ...router.currentRoute.value.query });
      await (wrapper!.vm as unknown as { compute: (f?: boolean) => Promise<void> }).compute();
      await settle();
      expect(pa.funnel.value.steps.map((x) => x.key)).toEqual(["/web/login", "/web", "/mine"]);
      expect(pa.openedFunnel.value?.id).toBe(row.id);
    });

    it("asks the browser before a reload drops edits to an opened saved funnel", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      await mountFunnels({ sf: row.id });
      await settle();
      const unload = () => {
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      };
      expect(unload()).toBe(false);
      const pa = useProductAnalytics();
      pa.funnel.value = { ...pa.funnel.value, unit: "users" };
      await settle();
      expect(unload()).toBe(true);
    });

    it("returning to the tab re-reads a failed link quietly, so the load failure toasts once per episode (F62)", async () => {
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB);
      const loadToasts = () =>
        toastSpy.mock.calls.filter(
          ([o]) =>
            String((o as { message: unknown }).message) === "Saved funnels could not be loaded",
        ).length;
      api.failNext("listFunnels", 503);
      const shown = ref(true);
      await mountFunnels({ sf: row.id, funnel: CARRIED }, shown);
      await settle();
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(true);
      expect(loadToasts()).toBe(1);
      api.failNext("listFunnels", 503);
      shown.value = false;
      await settle();
      const calls = api.service.listFunnels.mock.calls.length;
      shown.value = true;
      await settle();
      expect(api.service.listFunnels.mock.calls.length).toBe(calls + 1);
      expect(has("rum-analytics-funnel-saved-link-failed")).toBe(true);
      expect(loadToasts()).toBe(1);
      api.failNext("listFunnels", 503);
      await wrapper!
        .find('[data-test="rum-analytics-funnel-saved-link-retry-btn"]')
        .trigger("click");
      await settle();
      expect(loadToasts()).toBe(2);
    });
  });

  describe("pa gap fixes: funnels", () => {
    const svc = api.service as unknown as Record<string, Mock>;
    const CURRENT_HASH = "0123456789abcdef";
    const settingsOf = (app: string, extra: Record<string, unknown> = {}) => ({
      id: `settings-${app}`.padEnd(27, "0"),
      app,
      bots: true,
      builtinBots: {
        version: 1,
        families: ["HeadlessChrome", "PhantomJS", "Spider"],
        devices: ["Spider"],
      },
      sessions: [],
      pages: [],
      version: 1,
      rulesHash: CURRENT_HASH,
      createdBy: "admin@x.com",
      createdAt: 1,
      updatedBy: "admin@x.com",
      updatedAt: 1,
      ...extra,
    });
    const LOGIN_WEB = {
      s: [
        ["p", "/web/login"],
        ["p", "/web"],
      ],
      u: "sessions",
      w: "session",
    };
    const THREE = (u: string, w: string, x: unknown[]) =>
      encodeDef({
        s: [
          ["p", "/web"],
          ["p", "/web/logs"],
          ["p", "/web/billings"],
        ],
        u,
        w,
        x,
      } as never);
    const BETWEEN = { s: ["p", "/web/ingestion"], a: 2, b: 3 };
    const pageText = () => document.body.textContent ?? "";

    beforeEach(() => {
      svc.getAppSettings = vi.fn(async (_org: string, app: string) => ({ data: settingsOf(app) }));
    });
    afterEach(() => {
      delete svc.getAppSettings;
    });

    // Each mount starts from a clean module state so two opened funnels can be compared.
    const openedSavedText = async (fields: Record<string, unknown>) => {
      wrapper?.unmount();
      wrapper = null;
      document.body.innerHTML = "";
      resetProductAnalytics();
      resetSavedFunnels();
      resetFunnelDraft();
      api.reset();
      // reset() restores the default settings, whose hash would not match the rows' currentRulesHash.
      svc.getAppSettings.mockImplementation(async (_org: string, app: string) => ({
        data: settingsOf(app),
      }));
      routes = baseRoutes();
      respond();
      const row = api.seedFunnel("web", "Signup", LOGIN_WEB, fields);
      await mountFunnels({ sf: row.id });
      await settle();
      expect(text("rum-analytics-funnel-saved-name")).toBe("Signup");
      return wrapper!.text();
    };

    it("P7-R11: a saved funnel whose stored rulesHash differs from currentRulesHash shows the stale banner, and a NULL stored hash counts as changed", async () => {
      const fresh = await openedSavedText({
        rulesHash: CURRENT_HASH,
        currentRulesHash: CURRENT_HASH,
      });
      const changed = await openedSavedText({
        rulesHash: "aaaaaaaaaaaaaaaa",
        currentRulesHash: CURRENT_HASH,
      });
      const nullHash = await openedSavedText({ rulesHash: null, currentRulesHash: CURRENT_HASH });
      expect(changed.length).toBeGreaterThan(fresh.length);
      expect(nullHash).toBe(changed);
    }, 30_000);

    const leafTexts = () =>
      new Set(
        [...document.body.querySelectorAll("*")]
          .filter((el) => el.children.length === 0)
          .map((el) => el.textContent?.trim() ?? "")
          .filter(Boolean),
      );

    it("P7-R11: Save on a stale saved funnel stores the current rules_hash and clears the stale banner", async () => {
      await openedSavedText({ rulesHash: CURRENT_HASH, currentRulesHash: CURRENT_HASH });
      const freshLeaves = leafTexts();
      await openedSavedText({ rulesHash: "aaaaaaaaaaaaaaaa", currentRulesHash: CURRENT_HASH });
      const banner = [...leafTexts()].filter((t) => !freshLeaves.has(t));
      expect(banner.length).toBeGreaterThan(0);
      const update = api.service.updateFunnel.getMockImplementation()!;
      api.service.updateFunnel.mockImplementation(async (...args: never[]) => {
        const [, , id, body] = args as unknown as [string, string, string, Record<string, unknown>];
        const res = (await update(...args)) as { data: Record<string, unknown> };
        const stored = api.funnels.get(id)!;
        stored.rulesHash = body.rules_hash ?? null;
        stored.currentRulesHash = CURRENT_HASH;
        return {
          data: { ...res.data, rulesHash: stored.rulesHash, currentRulesHash: CURRENT_HASH },
        };
      });
      const pa = useProductAnalytics();
      pa.funnel.value = {
        ...pa.funnel.value,
        steps: [
          { kind: "p", key: "/web/login" },
          { kind: "p", key: "/web/logs" },
        ],
      };
      await settle();
      await wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]').trigger("click");
      await settle();
      expect(api.bodies("updateFunnel").at(-1)).toMatchObject({ rules_hash: CURRENT_HASH });
      const after = leafTexts();
      expect(banner.filter((t) => after.has(t))).toEqual([]);
    }, 30_000);

    it("an unchanged stale funnel can be saved to refresh its sql, while an unchanged fresh one cannot", async () => {
      const save = () => wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]');
      await openedSavedText({ rulesHash: CURRENT_HASH, currentRulesHash: CURRENT_HASH });
      expect(save().attributes("disabled")).toBeDefined();
      await openedSavedText({ rulesHash: "aaaaaaaaaaaaaaaa", currentRulesHash: CURRENT_HASH });
      expect(save().attributes("disabled")).toBeUndefined();
      await save().trigger("click");
      await settle();
      expect(api.bodies("updateFunnel").at(-1)).toMatchObject({ rules_hash: CURRENT_HASH });
    }, 30_000);

    it("P7-R11: Save is disabled when the app's settings failed to load", async () => {
      svc.getAppSettings = vi.fn(async () => {
        throw { response: { status: 503, data: {} } };
      });
      await mountFunnels({ funnel: encodeDef(LOGIN_WEB) });
      await settle();
      const save = wrapper!.find('[data-test="rum-analytics-funnel-save-btn"]');
      expect(save.exists()).toBe(true);
      expect(save.attributes("disabled")).toBeDefined();
    });

    it("P6-R2: a saved funnel with an unknown key in an exclusion shows This funnel needs a newer version", async () => {
      const row = api.seedFunnel("web", "Future", {
        ...LOGIN_WEB,
        x: [{ s: ["p", "/web/ingestion"], a: 1, b: 2, zz: 1 }],
      });
      await mountFunnels({ sf: row.id });
      await settle();
      expect(pageText()).toContain("This funnel needs a newer version");
    });

    it("P6-R2: a funnel link with an unknown key in a step's options shows This funnel needs a newer version", async () => {
      await mountFunnels({
        funnel: encodeDef({
          ...LOGIN_WEB,
          s: [["p", "/web/login", { min: 1000, zz: 1 }], ...LOGIN_WEB.s.slice(1)],
        } as never),
      });
      await settle();
      expect(pageText()).toContain("This funnel needs a newer version");
    });

    it("P7-R12: a Sessions funnel with an exclusion says Exclusions are checked per session", async () => {
      await mountFunnels({ funnel: THREE("sessions", "session", [BETWEEN]) });
      await settle();
      expect(pageText()).toContain("Exclusions are checked per session");
      expect(pageText()).not.toContain("across sessions within");
    });

    it("P7-R12: a Users funnel with a 7d window says the exclusions are checked across sessions within 7 days", async () => {
      await mountFunnels({ funnel: THREE("users", "7d", [BETWEEN]) });
      await settle();
      expect(pageText()).toContain("across sessions within 7 days");
      expect(pageText()).not.toContain("Exclusions are checked per session");
    });

    it("P7-R12: a Users funnel with a 1d window says Exclusions are checked across sessions within 1 day", async () => {
      await mountFunnels({ funnel: THREE("users", "1d", [BETWEEN]) });
      await settle();
      expect(pageText()).toContain("Exclusions are checked across sessions within 1 day");
    });

    it("P7-R12: removing a step an exclusion references drops that exclusion and toasts its name", async () => {
      await mountFunnels({ funnel: THREE("sessions", "session", [BETWEEN]) });
      await settle();
      toastSpy.mockClear();
      await wrapper!.find('[data-test="rum-analytics-funnel-step-2-remove"]').trigger("click");
      await settle();
      const sent = decodeDef(router.currentRoute.value.query.funnel as string) as {
        s: unknown[];
        x?: unknown[];
      };
      expect(sent.s).toEqual([
        ["p", "/web"],
        ["p", "/web/logs"],
      ]);
      expect(sent.x ?? []).toEqual([]);
      const messages = toastSpy.mock.calls.map((c) =>
        String((c[0] as { message: unknown }).message),
      );
      expect(messages.some((m) => m.includes("/web/ingestion"))).toBe(true);
    });

    it("P7-R13: the By app table says named events use the primary app's rules and marks an app without a settings row built-in rule only", async () => {
      svc.getAppSettings = vi.fn(async (_org: string, app: string) => ({
        data:
          app === "web"
            ? settingsOf(app)
            : settingsOf(app, {
                id: null,
                version: 0,
                createdBy: null,
                createdAt: null,
                updatedBy: null,
                updatedAt: null,
              }),
      }));
      routes = [
        [
          /AS app, COUNT/,
          [
            { app: "web", sessions: 500 },
            { app: "web-eu1", sessions: 200 },
          ],
        ],
        [
          /SELECT dim, /,
          [
            { dim: "web", c1: 150, c2: 60 },
            { dim: "web-eu1", c1: 50, c2: 20 },
          ],
        ],
        ...baseRoutes(),
      ];
      respond();
      await mountFunnels({ apps: "web-eu1", funnel: encodeDef({ ...LOGIN_WEB, b: "app" }) });
      await settle();
      expect(pageText()).toContain("Named events use web's rules");
      const rows = wrapper!.findAll('[data-test^="rum-analytics-funnel-breakdown-row-"]');
      const eu1 = rows.find((r) => r.text().includes("web-eu1"));
      const primary = rows.find((r) => r.text().includes("web") && !r.text().includes("web-eu1"));
      expect(eu1?.text()).toContain("built-in rule only");
      expect(primary?.text()).not.toContain("built-in rule only");
    });

    const PICKER_ROWS = [
      { kind: "p", k: "/web", sessions: 10, at: null },
      { kind: "c", k: "save-btn", sessions: 8, at: "click" },
    ];
    const openPicker = async (pickerRows: Hit[]) => {
      api.seedEvent("web", "Opened logs");
      // The pickers read action_type and error_message only when the stream has them.
      usePerformance().performanceState.data.streams._rumdata = {
        name: "_rumdata",
        schema: {
          usr_email: { name: "usr_email" },
          user_agent_user_agent_family: { name: "b" },
          action_type: { name: "action_type" },
          error_message: { name: "error_message" },
        },
      };
      routes = [
        [
          /substr\(error_message, 1, 120\) AS k/,
          [{ k: "Failed to fetch billing info", sessions: 4 }],
        ],
        [/\bAS at\b/, pickerRows],
        ...baseRoutes(),
      ];
      respond();
      await mountFunnels();
      await setSteps([["p", "/a"]]);
      await openAddStep();
      await settle();
    };
    const rowText = (step: string) => {
      const row = wrapper!.find(`[data-test="rum-analytics-funnel-add-step-${step}"]`);
      return row.exists() ? row.text() : "";
    };

    it("P7-R15: the step list groups Named events, Clicks and custom actions with a custom action tagged Event, and Errors", async () => {
      await openPicker([
        ...PICKER_ROWS,
        { kind: "c", k: "signup_completed", sessions: 5, at: "custom" },
      ]);
      const list = wrapper!.find('[data-test="rum-analytics-funnel-add-step-picker"]').text();
      for (const header of ["Named events", "Clicks and custom actions", "Errors"])
        expect(list).toContain(header);
      expect(list.indexOf("Failed to fetch billing info")).toBeGreaterThan(list.indexOf("Errors"));
      expect(rowText("c:signup_completed")).toContain("Event");
      expect(rowText("c:signup_completed")).toContain("5");
      expect(text("rum-analytics-funnel-suggestion-0")).toContain("save-btn");
      expect(rowText("c:save-btn")).toBe("");
      expect(pageText()).not.toContain("No custom actions in range");
    });

    it("P7-R15: with no custom actions in range the clicks group says why", async () => {
      await openPicker(PICKER_ROWS);
      expect(pageText()).toContain(
        "No custom actions in range. Custom actions come only from users with telemetry on",
      );
    });

    const NOTE = "Uses this app's app filters as of now; re-create it after they change";

    it("P7-R17: Alert me hands the alert form a note that it keeps this app's app filters as of creation", async () => {
      alertCreationDialog.value = null;
      await mountFunnels();
      await setSteps([
        ["p", "/a"],
        ["c", "b"],
      ]);
      await wrapper!.find('[data-test="rum-analytics-funnel-alert-btn"]').trigger("click");
      const prefill = alertCreationDialog.value!.prefill;
      const lines = prefill.warnings.map((w) =>
        String(i18n.global.t(`alerts.prefill.warnings.${w.key}`, w.params ?? {})),
      );
      expect(lines.some((l) => l.includes(NOTE))).toBe(true);
      alertCreationDialog.value = null;
    });

    it("P7-R17: Add to dashboard carries a note that the panel keeps this app's app filters as of creation", async () => {
      await mountFunnels();
      await setSteps([
        ["p", "/a"],
        ["c", "b"],
      ]);
      await wrapper!.find('[data-test="rum-analytics-funnel-add-dashboard-btn"]').trigger("click");
      await flushPromises();
      expect(String(wrapper!.findComponent({ name: "AddToDashboard" }).props("notice"))).toContain(
        NOTE,
      );
    });
  });

  describe("app filters on the Funnels tab", () => {
    const FILTERED = { ...SUMMARY, total_sessions: 650, builtin_kept_sessions: 560 };
    const filtered = () => {
      routes = [[/va_rows/, [FILTERED]], ...baseRoutes()];
      respond();
    };
    const at = (dt: string) => wrapper!.find(`[data-test="${dt}"]`);

    it("the card line lists built-in and saved-rule removals from the page summary", async () => {
      filtered();
      await mountFunnels();
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
      await settle();
      expect(at("rum-analytics-funnel-app-filters-builtin").text()).toBe("Built-in bot rule 90");
      expect(at("rum-analytics-funnel-app-filters-rules").text()).toBe("Saved rules 60");
    });

    it("the rail section says nothing is hidden when the app filters removed nothing", async () => {
      routes = [
        [/va_rows/, [{ ...SUMMARY, total_sessions: 500, builtin_kept_sessions: 500 }]],
        ...baseRoutes(),
      ];
      respond();
      await mountFunnels();
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
      expect(at("rum-analytics-funnel-app-filters-none").exists()).toBe(true);
      expect(at("rum-analytics-funnel-app-filters-builtin").exists()).toBe(false);
    });

    it("Include hidden sessions sets includeExcluded and xall", async () => {
      filtered();
      await mountFunnels();
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
      wrapper!.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
      await settle();
      expect(useProductAnalytics().state.includeExcluded).toBe(true);
      expect(router.currentRoute.value.query.xall).toBe("1");
    });

    it("turning the rail switch off clears includeExcluded and drops xall from the URL", async () => {
      filtered();
      await mountFunnels({ xall: "1" });
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
      expect(router.currentRoute.value.query.xall).toBe("1");
      wrapper!.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", false);
      await settle();
      expect(useProductAnalytics().state.includeExcluded).toBe(false);
      expect(router.currentRoute.value.query.xall).toBeUndefined();
    });

    it("Edit app filters asks the page to open the drawer", async () => {
      filtered();
      await mountFunnels();
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
      await at("rum-analytics-funnel-app-filters-edit").trigger("click");
      expect(wrapper!.emitted("open-exclusions")).toHaveLength(1);
    });

    it("while hidden sessions are included, synthetic sessions stay listed even when the rule count fails", async () => {
      const { performanceState } = usePerformance();
      performanceState.data.streams._rumdata.schema.session_type = { name: "session_type" };
      let fail = true;
      const row = { ...FILTERED, synthetic_sessions: 7 };
      routes = [
        [
          /va_rows/,
          (sql: string) => {
            if (/\b0 AS xb\b/.test(sql)) return [row];
            if (fail) throw new Error("search failed");
            return [row];
          },
        ],
        ...baseRoutes(),
      ];
      respond();
      await mountFunnels({ xall: "1" });
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
      expect(at("rum-analytics-funnel-app-filters-synthetic").text()).toBe(
        "Synthetic tests 7 · always excluded",
      );
      expect(fail).toBe(true);
    });

    it("an exclusion's removed count comes from its xr column", async () => {
      routes = [
        [/FROM ps LIMIT 1/, [{ c1: 200, c2: 80, seen1: 1, seen2: 1, xr1: 7 }]],
        ...baseRoutes(),
      ];
      respond();
      await mountFunnels();
      const pa = useProductAnalytics();
      pa.funnel.value = {
        steps: [
          { kind: "p", key: "/a" },
          { kind: "p", key: "/b" },
        ],
        unit: "sessions",
        window: "session",
        breakdown: null,
        x: [{ step: { kind: "p", key: "/x" }, a: 1, b: 2 }],
      };
      await settle();
      expect(at("rum-analytics-funnel-exclusion-0-removed").text()).toBe("7 removed at step 2");
      expect(
        at("rum-analytics-funnel-bar-1")
          .find('[data-test="rum-analytics-funnel-bar-removed"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("phase 2: Filter all steps, Why N?, stored SQL without page scope", () => {
    const at = (dt: string) => wrapper!.find(`[data-test="${dt}"]`);
    const layout = () => wrapper!.findComponent({ name: "FunnelLayoutRail" });
    const twoSteps = async () => {
      await setSteps([
        ["p", "/a"],
        ["p", "/b"],
      ]);
    };
    const withSchema = (fields: string[]) => {
      const { performanceState } = usePerformance();
      performanceState.data.streams._rumdata = {
        name: "_rumdata",
        schema: Object.fromEntries(fields.map((f) => [f, { name: f }])),
      };
    };

    it("refuses any definition change past a link's length, not only an added step", async () => {
      await mountFunnels();
      await twoSteps();
      const pa = useProductAnalytics();
      const before = pa.funnel.value;
      const many = Array.from({ length: 20 }, (_, i) => `${"v".repeat(400)}${i}`);
      layout().vm.$emit("update:def", {
        ...before,
        f: (["geo_info_city", "usr_email", "usr_id"] as const).map((field) => ({
          field,
          op: "in",
          values: many,
        })),
      });
      await settle();
      expect(pa.funnel.value).toBe(before);
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("too long") }),
      );
      layout().vm.$emit("update:def", {
        ...before,
        f: [{ field: "geo_info_city", op: "in", values: ["Pune"] }],
      });
      await settle();
      expect(pa.funnel.value.f).toEqual([{ field: "geo_info_city", op: "in", values: ["Pune"] }]);
    });

    it("a filter applies to the live funnel query", async () => {
      withSchema(["usr_email", "geo_info_country"]);
      await mountFunnels();
      await twoSteps();
      layout().vm.$emit("update:def", {
        ...useProductAnalytics().funnel.value,
        f: [{ field: "geo_info_country", op: "in", values: ["India"] }],
      });
      await settle();
      expect(funnelSqls().at(-1)).toContain(
        "(geo_info_country IS NOT NULL AND geo_info_country IN ('India'))",
      );
    });

    it("the layout's filter-values request runs the value query and hands the rows back", async () => {
      withSchema(["usr_email", "geo_info_country"]);
      routes = [[/SELECT geo_info_country AS v/, [{ v: "India", sessions: 212 }]], ...baseRoutes()];
      respond();
      await mountFunnels();
      await twoSteps();
      expect(layout().props("filterFields")).toEqual(["geo_info_country", "usr_email"]);
      layout().vm.$emit("filter-values", "geo_info_country");
      await settle();
      expect(layout().props("filterValues")).toEqual({
        field: "geo_info_country",
        status: "ok",
        rows: [{ value: "India", sessions: 212 }],
      });
    });

    it("Why N? runs its own query only when opened, and its lines add up to the entry count", async () => {
      routes = [
        [
          /va_rows/,
          [{ ...SUMMARY, total_sessions: 600, builtin_kept_sessions: 520, sessions: 500 }],
        ],
        [/AS opened/, [{ opened: 230, kept: 200 }]],
        ...baseRoutes(),
      ];
      respond();
      await mountFunnels();
      await twoSteps();
      const whySql = () => sqls().filter((q) => q.includes("AS opened"));
      expect(whySql()).toHaveLength(0);
      const why = wrapper!.findComponent({ name: "WhyEnteredPopover" });
      expect(at("rum-analytics-funnel-why-btn").text()).toBe("Why 200?");
      why.vm.$emit("open", true);
      await settle();
      expect(whySql()).toHaveLength(1);
      const lines = why.props("lines") as { lines: { id: string; count: number }[] };
      expect(lines.lines.map((l) => [l.id, l.count])).toEqual([
        ["app", 600],
        ["synthetic", 0],
        ["bots", 80],
        ["appFilters", 20],
        ["step1", 270],
        ["entered", 200],
      ]);
      expect(why.props("estimated")).toBe(false);
    });

    it("while Why N? is open, edits rerun its query once they settle, not per keystroke", async () => {
      routes = [[/AS opened/, [{ opened: 230, kept: 200 }]], ...baseRoutes()];
      respond();
      await mountFunnels();
      await twoSteps();
      const whySql = () => sqls().filter((q) => q.includes("AS opened"));
      wrapper!.findComponent({ name: "WhyEnteredPopover" }).vm.$emit("open", true);
      await settle();
      expect(whySql()).toHaveLength(1);
      const pa = useProductAnalytics();
      for (const v of ["a", "ab", "abc"]) {
        pa.funnel.value = {
          ...pa.funnel.value,
          f: [{ field: "usr_email", op: "in", values: [v] }],
        };
        await flushPromises();
      }
      expect(whySql()).toHaveLength(1);
      await settle();
      expect(whySql()).toHaveLength(2);
      expect(whySql()[1]).toContain("'abc'");
    });

    it("Why N? is not offered while the funnel counts users", async () => {
      await mountFunnels();
      await twoSteps();
      expect(wrapper!.findComponent({ name: "WhyEnteredPopover" }).exists()).toBe(true);
      useProductAnalytics().funnel.value = { ...useProductAnalytics().funnel.value, unit: "users" };
      await settle();
      expect(wrapper!.findComponent({ name: "WhyEnteredPopover" }).exists()).toBe(false);
    });

    it("stored SQL and the dashboard panel leave out the page's env, while the live funnel keeps it", async () => {
      withSchema(["usr_email", "env"]);
      await mountFunnels();
      await twoSteps();
      const compile = wrapper!.findComponent({ name: "SavedFunnelBar" }).props("compileSql") as (
        d: unknown,
      ) => string;
      const plain = compile(useProductAnalytics().funnel.value);
      useProductAnalytics().setScope({ env: ["prod"] });
      await settle();
      expect(funnelSqls().at(-1)).toContain("env IN ('prod')");
      expect(compile(useProductAnalytics().funnel.value)).toBe(plain);
      expect(plain).not.toContain("env IN");
      await at("rum-analytics-funnel-add-dashboard-btn").trigger("click");
      await flushPromises();
      const panels = wrapper!.findComponent({ name: "AddToDashboard" }).props("panels") as {
        queries: { query: string }[];
      }[];
      expect(panels[0].queries[0].query).not.toContain("env IN");
    });
  });
});
