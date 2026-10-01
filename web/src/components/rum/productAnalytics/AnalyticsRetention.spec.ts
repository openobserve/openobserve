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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const streamStats = { doc_time_min: 0 };
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(async () => ({ name: "_rumdata", schema: [], stats: { ...streamStats } })),
  }),
}));

import searchService from "@/services/search";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import { encodeDef } from "@/utils/rum/productAnalyticsModel";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import AnalyticsRetention from "./AnalyticsRetention.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { b64DecodeUnicode } from "@/utils/formatters";

type Hit = Record<string, unknown>;
const DAY_US = 86400000000;

const GRID: Hit[] = [
  { cohort: 0, k: 0, size_part: 50, users_on: 50, users_last: 10 },
  { cohort: 0, k: 1, size_part: 0, users_on: 20, users_last: 25 },
  { cohort: 0, k: 2, size_part: 0, users_on: 15, users_last: 15 },
  { cohort: 1, k: 0, size_part: 40, users_on: 40, users_last: 30 },
  { cohort: 1, k: 1, size_part: 0, users_on: 10, users_last: 10 },
];

let identityRows: Hit[] = [{ u: "a", s: 10, total_s: 300, n_values: 50 }];
let summaryExtra: Hit = {};
const respond = () =>
  vi.mocked(searchService.search).mockImplementation((async (args: {
    query: { query: { sql: string } };
  }) => {
    const sql = args.query.query.sql;
    if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "web", sessions: 500 }] } };
    if (/va_rows/.test(sql)) {
      return {
        data: {
          hits: [
            {
              sessions: 500,
              prev_sessions: 1,
              views: 1,
              va_rows: 1000,
              usr_email__values: 50,
              usr_email__sessions: 300,
              ...summaryExtra,
            },
          ],
        },
      };
    }
    if (/total_s/.test(sql)) return { data: { hits: identityRows } };
    if (/AS retained/.test(sql)) {
      return {
        data: {
          hits: [
            { u: "keeper@x.com", retained: 1, sessions: 4, last_seen: 1790000000000000 },
            { u: "o'leaver@x.com", retained: 0, sessions: 1, last_seen: 1789000000000000 },
          ],
        },
      };
    }
    if (/AS size_part/.test(sql)) return { data: { hits: GRID } };
    return { data: { hits: [] } };
  }) as never);

const sqls = () =>
  vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);
const gridSqls = () => sqls().filter((s) => /AS size_part/.test(s));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
    theme: "light",
  },
});

describe("AnalyticsRetention", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  const mountRetention = async (query: Record<string, string> = { period: "7d" }) => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/r", name: "productAnalyticsRetention", component: { template: "<div />" } },
        { path: "/s", name: "Sessions", component: { template: "<div />" } },
      ],
    });
    await router.push({ path: "/r", query: { app: "web", ...query } });
    useProductAnalytics().initFromRoute(router.currentRoute.value.query);
    wrapper = mount(AnalyticsRetention, {
      global: { plugins: [router, store] },
      attachTo: document.body,
    });
    for (let i = 0; i < 6; i++) await flushPromises();
  };

  beforeEach(() => {
    resetProductAnalytics();
    resetNamedEvents();
    api.reset();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" } },
    };
    identityRows = [{ u: "a", s: 10, total_s: 300, n_values: 50 }];
    summaryExtra = {};
    streamStats.doc_time_min = 0;
    respond();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("without an identity shows the unlock state with the setUser snippet and never a grid (AC-30)", async () => {
    identityRows = [{ u: "guest", s: 300, total_s: 300, n_values: 1 }];
    await mountRetention();
    const unlock = wrapper!.find('[data-test="rum-analytics-retention-unlock"]');
    expect(unlock.exists()).toBe(true);
    expect(unlock.text()).toContain("openobserveRum.setUser");
    expect(unlock.text()).toContain("currentUser.id");
    expect(
      wrapper!.find('[data-test="rum-analytics-retention-unlock-unidentified"]').text(),
    ).toContain("500");
    expect(wrapper!.find('[data-test="rum-analytics-retention-unlock-docs-link"]').exists()).toBe(
      true,
    );
    expect(wrapper!.find('[data-test="rum-analytics-retention-grid"]').exists()).toBe(false);
    expect(gridSqls()).toHaveLength(0);
  });

  it("a constant usr_email says why retention is locked, with its share and never its value (scope addition 6)", async () => {
    identityRows = [{ u: "placeholder@synthetic.test", s: 300, total_s: 300, n_values: 1 }];
    await mountRetention();
    const unlock = wrapper!.find('[data-test="rum-analytics-retention-unlock"]');
    expect(unlock.text()).toMatch(/placeholder/i);
    expect(unlock.text()).toContain("60.0%");
    expect(unlock.text()).toContain("usr_email");
    expect(unlock.text()).not.toContain("Call setUser once the user is known");
    expect(wrapper!.html()).not.toContain("placeholder@synthetic.test");
  });

  it("with no identity field at all the unlock says none is present (scope addition 6)", async () => {
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    await mountRetention();
    const unlock = wrapper!.find('[data-test="rum-analytics-retention-unlock"]');
    expect(unlock.text()).toContain("No session in this range carries");
    expect(unlock.text()).not.toContain("Call setUser once the user is known");
  });

  it("a partial identity labels the header with its coverage (scope addition 6)", async () => {
    identityRows = [
      { u: "synthetic-bot@synthetic.test", s: 240, total_s: 300, n_values: 50 },
      { u: "a@synthetic.test", s: 10, total_s: 300, n_values: 50 },
    ];
    await mountRetention();
    expect(wrapper!.find('[data-test="rum-analytics-retention-identity"]').text()).toContain(
      "Identified users (12.0% of sessions)",
    );
  });

  it("an anonymous id labels the header Visitors (scope addition 6)", async () => {
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_anonymous_id: { name: "usr_anonymous_id" } },
    };
    summaryExtra = { usr_anonymous_id__values: 50, usr_anonymous_id__sessions: 300 };
    await mountRetention();
    expect(wrapper!.find('[data-test="rum-analytics-retention-identity"]').text()).toContain(
      "Visitors",
    );
  });

  it("an event start step with no read access to named events says so and draws no zero grid (F26, F25)", async () => {
    const has = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).exists();
    api.failNext("listEvents", 403);
    await mountRetention({ period: "7d", rs: encodeDef(["e", "EvtDashboards00000000000001"]) });
    expect(gridSqls()).toEqual([]);
    expect(has("rum-analytics-retention-events-forbidden")).toBe(true);
    expect(has("rum-analytics-retention-events-retry-btn")).toBe(false);
  });

  it("an event start step whose named events fail to load shows Retry and runs no grid (F26)", async () => {
    const has = (dt: string) => wrapper!.find(`[data-test="${dt}"]`).exists();
    api.failNext("listEvents", 503);
    await mountRetention({ period: "7d", rs: encodeDef(["e", "EvtDashboards00000000000001"]) });
    expect(gridSqls()).toEqual([]);
    expect(has("rum-analytics-retention-events-unavailable")).toBe(true);
    expect(has("rum-analytics-retention-events-retry-btn")).toBe(true);
  });

  it("renders a daily grid on open with zero clicks and names the identity field (AC-28, AC-31)", async () => {
    await mountRetention();
    expect(gridSqls()).toHaveLength(1);
    expect(wrapper!.find('[data-test="rum-analytics-retention-identity"]').text()).toContain(
      "usr_email",
    );
    expect(wrapper!.find('[data-test="rum-analytics-retention-identity"]').text()).toContain(
      "60.0%",
    );
    expect(wrapper!.find('[data-test="rum-analytics-retention-cell-0-1"]').text()).toContain(
      "40.0%",
    );
    expect(wrapper!.find('[data-test="rum-analytics-retention-row-0"]').text()).toContain("50");
  });

  it("switches to On or after without a new search (AC-51)", async () => {
    await mountRetention();
    const before = sqls().length;
    await wrapper!.find('[data-test="rum-analytics-retention-mode-after"]').trigger("click");
    await flushPromises();
    expect(wrapper!.find('[data-test="rum-analytics-retention-cell-0-1"]').text()).toContain(
      "80.0%",
    );
    expect(sqls().length).toBe(before);
  });

  it("marks the running period incomplete and leaves it out of the average (AC-33)", async () => {
    await mountRetention();
    const cells = wrapper!.findAll('[data-incomplete="true"]');
    expect(cells.length).toBeGreaterThan(0);
    expect(wrapper!.find('[data-test="rum-analytics-retention-average-row"]').exists()).toBe(true);
  });

  it("narrows the start event with the shared picker and recomputes (AC-34)", async () => {
    await mountRetention();
    useProductAnalytics().retention.value = {
      ...useProductAnalytics().retention.value,
      start: { kind: "c", key: "signup-btn" },
    };
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(gridSqls()).toHaveLength(2);
    expect(gridSqls()[1]).toContain("= 'signup-btn'");
  });

  it("notes the data start and draws no cohort before it (AC-36)", async () => {
    const now = Date.now() * 1000;
    streamStats.doc_time_min = now - 3 * DAY_US;
    await mountRetention();
    expect(wrapper!.find('[data-test="rum-analytics-retention-data-start"]').exists()).toBe(true);
    const bounds = gridSqls()[0].match(/_timestamp < (\d+)/g) ?? [];
    expect(new Set(bounds).size).toBeLessThanOrEqual(3);
  });

  it("refuses a one-day range with a widen action", async () => {
    await mountRetention({ period: "1d" });
    expect(wrapper!.find('[data-test="rum-analytics-retention-too-short"]').exists()).toBe(true);
    expect(gridSqls()).toHaveLength(0);
  });

  it("the legend says a cell click shows who returned", async () => {
    await mountRetention();
    expect(wrapper!.find('[data-test="rum-analytics-retention-cell-hint"]').text()).toBe(
      "Click a cell to see who returned",
    );
  });

  it("the cell drawer counts the grid's cohort, not the rows it lists, and says when the list is cut (W4)", async () => {
    await mountRetention();
    await wrapper!.find('[data-test="rum-analytics-retention-cell-0-1"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();
    const text = document.querySelector(
      '[data-test="rum-analytics-retention-cell-drawer"]',
    )?.textContent;
    expect(text).toContain("20 of 50");
    expect(text).not.toContain("1 of 2");
    expect(
      document.querySelector('[data-test="rum-analytics-retention-users-truncated"]')?.textContent,
    ).toContain("1 most recently seen of 20");
  });

  it("names a cell for a screen reader with its unit and whether it is still running (W30)", async () => {
    await mountRetention();
    const aria = wrapper!
      .find('[data-test="rum-analytics-retention-cell-0-1"]')
      .attributes("aria-label");
    expect(aria).toContain("20 of 50 users");
    const running = wrapper!.find('[data-incomplete="true"]').attributes("aria-label");
    expect(running).toContain("still running");
  });

  it("a cell opens a full-height lg drawer whose View in Sessions points away", async () => {
    await mountRetention();
    await wrapper!.find('[data-test="rum-analytics-retention-cell-0-1"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();
    const drawer = wrapper!.findComponent(ODrawer);
    expect(drawer.props("size")).toBe("lg");
    expect(drawer.props("anchor") ?? null).toBeNull();
    expect(drawer.props("seamless")).toBe(false);
    const btn = wrapper!
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "rum-analytics-retention-user-0-sessions-btn")!;
    expect(btn.props("iconRight")).toBe("arrow-forward");
  });

  it("a cell opens retained and not retained users, and View in Sessions filters Sessions to that user (AC-35)", async () => {
    await mountRetention();
    await wrapper!.find('[data-test="rum-analytics-retention-cell-0-1"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();
    const q17 = sqls().filter((s) => /AS retained/.test(s));
    expect(q17[0]).toContain("MAX(CASE WHEN p = 1 AND r = 1 THEN 1 ELSE 0 END) AS retained");
    expect(
      document.querySelector('[data-test="rum-analytics-retention-user-0"]')?.textContent,
    ).toContain("keeper@x.com");
    const lost = document.querySelector<HTMLElement>(
      '[data-test="rum-analytics-retention-drawer-lost-tab"]',
    )!;
    lost.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    lost.click();
    await flushPromises();
    document
      .querySelector<HTMLElement>('[data-test="rum-analytics-retention-user-0-sessions-btn"]')!
      .click();
    await flushPromises();
    const route = router.currentRoute.value;
    expect(route.name).toBe("Sessions");
    expect(b64DecodeUnicode(route.query.query as string)).toBe("usr_email='o''leaver@x.com'");
    expect(route.query.period).toBe("7d");
  });
});
