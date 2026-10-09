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

import { config, mount, shallowMount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { slug: "abc" }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/services/public_dashboards", () => ({
  default: { getConfig: vi.fn(), getData: vi.fn() },
}));

import service from "@/services/public_dashboards";
import PublicDashboard from "@/views/Dashboards/PublicDashboard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

const CONFIG = {
  title: "My Dashboard",
  layout: [
    {
      tabId: "t1",
      name: "Overview",
      panels: [{ id: "p1", title: "Panel 1" }],
    },
  ],
  ranges: [
    { key: "r3600", type: "relative", secs: 3600 },
    { key: "r86400", type: "relative", secs: 86400 },
  ],
  default_key: "r3600",
  available_keys: ["r3600", "r86400"],
  built_at: 1_700_000_000_000_000,
  refresh_secs: 30,
};

// Shallow mounts stub OEmptyState; this stub keeps its title readable in the page text.
config.global.stubs.OEmptyState = { props: ["title"], template: "<div>{{ title }}</div>" };

const buildWrapper = () =>
  shallowMount(PublicDashboard, { global: { plugins: [i18n], provide: { store } } });

const has = (w: any, id: string) => w.find(`[data-test="${id}"]`).exists();
const find = (w: any, id: string) => w.find(`[data-test="${id}"]`);
const mountWithActions = () =>
  shallowMount(PublicDashboard, {
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: { OPageHeader: { template: "<div><slot name='actions' /></div>" } },
    },
  });
const grid = (w: any) => w.findComponent(RenderDashboardCharts);
const mountWithPicker = () =>
  shallowMount(PublicDashboard, {
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        OPageHeader: { template: "<div><slot name='actions' /></div>" },
        ODropdown: { template: "<div><slot /></div>" },
      },
    },
  });
const pickRange = (w: VueWrapper, key: string) =>
  w
    .findComponent<typeof ODropdownItem>(`[data-test="dashboards-public-dashboard-preset-${key}"]`)
    .vm.$emit("select");
const okSnapshot = (data: unknown) => ({
  status: 200,
  data: { panels: { p1: { state: { state: "ok" }, data } } },
});
const ABSOLUTE = {
  key: "a1000000-86401000000",
  type: "absolute",
  start: 1_000_000,
  end: 86_401_000_000,
};
const mockAbsoluteLink = () => {
  vi.mocked(service.getConfig).mockResolvedValue({
    data: {
      ...CONFIG,
      ranges: [ABSOLUTE],
      default_key: ABSOLUTE.key,
      available_keys: [ABSOLUTE.key],
    },
    status: 200,
  } as never);
  vi.mocked(service.getData).mockResolvedValue({
    status: 200,
    data: { built_at: 1_800_000_000_000_000, panels: { p1: { state: { state: "ok" }, data: [] } } },
  } as never);
};
const panelsConfig = (panels: Array<Record<string, unknown>>) => ({
  ...CONFIG,
  layout: [{ tabId: "t1", name: "Overview", panels }],
});

describe("PublicDashboard viewer", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("shows the loading state before requests resolve", () => {
    (service.getConfig as any).mockReturnValue(new Promise(() => {}));
    const w = buildWrapper();
    expect(has(w, "dashboards-public-dashboard-loading")).toBe(true);
  });

  it("renders the dashboard grid view-only, fed with the snapshot (ready)", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [[{ y: 1 }]] } } },
    });
    const w = buildWrapper();
    await flushPromises();
    expect(grid(w).exists()).toBe(true);
    expect(grid(w).props("viewOnly")).toBe(true);
    expect(grid(w).props("dashboardData").tabs).toEqual(CONFIG.layout);
    expect(grid(w).props("dashboardData").variables).toEqual({ list: [] });
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
  });

  it("re-checks every 15 seconds while the rebuild is overdue", async () => {
    vi.useFakeTimers();
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    const w = mountWithActions();
    await flushPromises();
    expect(service.getData).toHaveBeenCalledTimes(1);
    expect(find(w, "dashboards-public-dashboard-next-refresh").text()).toBe("Refreshing…");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(service.getConfig).toHaveBeenCalledTimes(2);
    expect(service.getData).toHaveBeenCalledTimes(2);
  });

  it("aims the next read just after the next rebuild is due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    // Built 20s ago on a 30s cadence: the next rebuild is due in 10s, read 2s after it.
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: {
        built_at: 1_800_000_000_000_000,
        panels: { p1: { state: { state: "ok" }, data: [] } },
      },
    });
    buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(service.getData).toHaveBeenCalledTimes(2);
  });

  it("shows the preparing state on a 202 (snapshot not built yet)", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({ status: 202, data: "preparing" });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-loading")).toBe(true);
    expect(w.text()).toContain("Preparing");
  });

  it("shows preparing (not an infinite spinner) when no presets are built yet", async () => {
    (service.getConfig as any).mockResolvedValue({
      data: { ...CONFIG, available_keys: [] },
      status: 200,
    });
    const w = buildWrapper();
    await flushPromises();
    expect(w.text()).toContain("Preparing");
    expect(service.getData).not.toHaveBeenCalled();
  });

  it("keeps polling while preparing and renders once the first snapshot exists", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig)
      .mockResolvedValueOnce({
        data: { ...CONFIG, available_keys: [] },
        status: 200,
      } as never)
      .mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    expect(w.text()).toContain("Preparing");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(service.getData).toHaveBeenCalledWith(expect.any(String), "r3600");
    expect(grid(w).exists()).toBe(true);
  });

  it("keeps the page out of search indexes and Referer headers while open", () => {
    vi.mocked(service.getConfig).mockReturnValue(new Promise(() => {}));
    const count = (name: string, content: string) =>
      document.head.querySelectorAll(`meta[name="${name}"][content="${content}"]`).length;
    const before = count("robots", "noindex, nofollow");
    const w = buildWrapper();
    expect(count("robots", "noindex, nofollow")).toBe(before + 1);
    expect(count("referrer", "no-referrer")).toBeGreaterThan(0);
    w.unmount();
    expect(count("robots", "noindex, nofollow")).toBe(before);
  });

  it("shows not-found on a 404", async () => {
    (service.getConfig as any).mockRejectedValue({ response: { status: 404 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("doesn't exist or was turned off");
  });

  it("shows the expired message on a 410", async () => {
    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 410 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("Ask the person who shared it to extend it.");
  });

  it("shows a paused link as turned off, and brings it back once it is resumed", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockRejectedValueOnce({ response: { status: 503 } });
    const w = buildWrapper();
    await flushPromises();
    expect(w.text()).toContain("turned off right now");

    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    } as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
    expect(grid(w).exists()).toBe(true);
  });

  it("asks the viewer to try again later after a rate limit or network error", async () => {
    vi.mocked(service.getConfig).mockRejectedValueOnce({ response: { status: 429 } });
    const limited = buildWrapper();
    await flushPromises();
    expect(limited.text()).toContain("Too many requests. Please try again in a while.");

    vi.mocked(service.getConfig).mockRejectedValueOnce(new Error("Network Error"));
    const offline = buildWrapper();
    await flushPromises();
    expect(offline.text()).toContain("Can't reach the server. Please try again in a while.");
  });

  it("keeps the dashboard on screen through a network error and retries with backoff", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    vi.mocked(service.getConfig).mockRejectedValue(new Error("Network Error"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(grid(w).exists()).toBe(true);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
    const calls = vi.mocked(service.getConfig).mock.calls.length;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(service.getConfig).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getConfig).toHaveBeenCalledTimes(calls + 1);
  });

  it("counts down to the next refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: {
        built_at: 1_800_000_000_000_000,
        panels: { p1: { state: { state: "ok" }, data: [] } },
      },
    });
    const w = mountWithActions();
    await flushPromises();
    expect(find(w, "dashboards-public-dashboard-next-refresh").text()).toBe("Next refresh in 10s");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(find(w, "dashboards-public-dashboard-next-refresh").text()).toBe("Next refresh in 7s");
  });

  it("shows an absolute range's fixed window without a countdown, checking status each minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    mockAbsoluteLink();
    const w = mountWithActions();
    await flushPromises();
    expect(service.getData).toHaveBeenCalledWith("abc", ABSOLUTE.key);
    expect(grid(w).props("currentTimeObj").__global.start_time.getTime()).toBe(1000);
    expect(grid(w).props("currentTimeObj").__global.end_time.getTime()).toBe(86_401_000);
    expect(has(w, "dashboards-public-dashboard-next-refresh")).toBe(false);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.getConfig).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getConfig).toHaveBeenCalledTimes(2);
  });

  it("shows a pause to a viewer on an absolute range within a minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    mockAbsoluteLink();
    const w = buildWrapper();
    await flushPromises();
    expect(grid(w).exists()).toBe(true);

    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 503 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.text()).toContain("turned off right now");
  });

  it("shows a revoke to a viewer on a day-long cadence within a minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, refresh_secs: 86_400 },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { built_at: 1_800_000_000_000_000, panels: { p1: { state: { state: "ok" } } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    expect(grid(w).exists()).toBe(true);

    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 503 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.text()).toContain("turned off right now");

    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 404 } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.text()).toContain("doesn't exist or was turned off");
    const calls = vi.mocked(service.getConfig).mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(service.getConfig).toHaveBeenCalledTimes(calls);
  });

  it("does not re-read nonstop on a month-long cadence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, refresh_secs: 2_592_000 },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { built_at: 1_800_000_000_000_000, panels: { p1: { state: { state: "ok" } } } },
    } as never);
    buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.getConfig).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(241_000);
    expect(service.getConfig).toHaveBeenCalledTimes(6);
  });

  it("offers the time range picker only when viewers can switch", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    const editable = mountWithActions();
    await flushPromises();
    expect(editable.findComponent(ODropdown).exists()).toBe(true);

    (service.getConfig as any).mockResolvedValue({
      data: {
        ...CONFIG,
        ranges: [{ key: "r3600", type: "relative", secs: 3600 }],
        available_keys: ["r3600"],
      },
      status: 200,
    });
    const fixed = mountWithActions();
    await flushPromises();
    expect(fixed.findComponent(ODropdown).exists()).toBe(false);
  });

  it("passes frozen values to the grid as read-only constants in their own scope", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: {
        ...CONFIG,
        variables: [
          { label: "env", value: "prod" },
          { label: "svc", value: "api", tab_id: "t1" },
          { label: "pod", value: ["a", "b"], panel_id: "p1" },
          { label: "region", value: null },
        ],
      },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const list = grid(w).props("dashboardData").variables.list;
    expect(list.map((v: { type: string }) => v.type)).toEqual([
      "constant",
      "constant",
      "constant",
      "constant",
    ]);
    expect(new Set(list.map((v: { name: string }) => v.name)).size).toBe(4);
    expect(list.map(({ name: _n, type: _t, ...rest }: Record<string, unknown>) => rest)).toEqual([
      { label: "env", value: "prod", scope: "global" },
      { label: "svc", value: "api", scope: "tabs", tabs: ["t1"] },
      { label: "pod", value: "a, b", scope: "panels", panels: ["p1"] },
      { label: "region", value: "Not set", scope: "global" },
    ]);
  });

  it("shows the values the snapshot was built with over the link's frozen ones", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, variables: [{ label: "env", value: null }] },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: {
        panels: { p1: { state: { state: "ok" }, data: [] } },
        variables: [{ label: "env", value: "default-env" }],
      },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const list = grid(w).props("dashboardData").variables.list;
    expect(list.map((v: { value: string }) => v.value)).toEqual(["default-env"]);
  });

  it("falls back to the default range when the author removes the viewer's range", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([]) as never);
    const w = mountWithPicker();
    await flushPromises();
    pickRange(w, "r86400");
    await flushPromises();
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r86400");

    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, ranges: [CONFIG.ranges[0]], available_keys: ["r3600"] },
      status: 200,
    } as never);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r3600");
    expect(grid(w).exists()).toBe(true);
  });

  it("drops a slower reply for a range the viewer already switched away from", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValueOnce(okSnapshot([]) as never);
    const w = mountWithPicker();
    await flushPromises();

    let resolveSlow: (v: unknown) => void = () => {};
    let resolveFast: (v: unknown) => void = () => {};
    vi.mocked(service.getData)
      .mockReturnValueOnce(new Promise((r) => (resolveSlow = r)) as never)
      .mockReturnValueOnce(new Promise((r) => (resolveFast = r)) as never);
    pickRange(w, "r86400");
    pickRange(w, "r3600");
    resolveFast(okSnapshot([[{ y: 1 }]]));
    await flushPromises();
    resolveSlow(okSnapshot([[{ y: 24 }]]));
    await flushPromises();
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
  });

  it("keeps the link's timestamp column after the bootstrap config lands", async () => {
    const original = store.state.zoConfig;
    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, timestamp_column: "event_time" },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([]) as never);
    const w = buildWrapper();
    await flushPromises();
    expect(store.state.zoConfig.timestamp_column).toBe("event_time");

    await store.dispatch("setConfig", { version: "v1" });
    await flushPromises();
    expect(store.state.zoConfig.timestamp_column).toBe("event_time");
    expect(store.state.zoConfig.version).toBe("v1");
    w.unmount();
    await store.dispatch("setConfig", original);
  });

  it("injects a Not-available error for a withheld panel", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "not_available", reason: "unauthorized" } } } },
    });
    const w = buildWrapper();
    await flushPromises();
    const p1 = grid(w).props("injectedPanelData").p1;
    expect(p1.data).toEqual([]);
    expect(p1.errorDetail.message).toBe("This panel isn't available on the public view.");
    // The renderer replaces the message of a non-4xx error with "Error Loading Data".
    expect(p1.errorDetail.code).toMatch(/^4/);
  });

  it("renders markdown and HTML panels from the layout without an error", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([
        { id: "md", type: "markdown", markdownContent: "# Hi" },
        { id: "html", type: "html", htmlContent: "<b>Hi</b>" },
      ]),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { md: { state: { state: "not_available", reason: "no_query" } } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    for (const id of ["md", "html"]) {
      expect(injected[id]).toEqual({ data: [], metadata: { queries: [] }, resultMetaData: [] });
    }
  });

  it("shows a custom chart as not available on the public view", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([{ id: "cc", type: "custom_chart" }]),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: {} },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const cc = grid(w).props("injectedPanelData").cc;
    expect(cc.errorDetail.message).toBe("This panel isn't available on the public view.");
    expect(cc.errorDetail.code).toMatch(/^4/);
  });

  it("shows a panel added since the last build as coming with the next update", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([
        { id: "p1", type: "line" },
        { id: "new", type: "line" },
      ]),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([[{ y: 1 }]]) as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    expect(injected.p1.data).toEqual([[{ y: 1 }]]);
    expect(injected.p1.errorDetail).toBeUndefined();
    expect(injected.new.errorDetail.message).toBe("This panel will appear after the next update.");
    expect(injected.new.errorDetail.code).toMatch(/^4/);
  });

  it("gets its messages and markdown content past the real panel renderer", async () => {
    const panels = [
      { id: "p1", type: "line", queryType: "sql", queries: [], config: {} },
      { id: "new", type: "line", queryType: "sql", queries: [], config: {} },
      { id: "cc", type: "custom_chart", queryType: "sql", queries: [], config: {} },
      {
        id: "md",
        type: "markdown",
        queryType: "sql",
        queries: [],
        config: {},
        markdownContent: "# Hi",
      },
    ];
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig(panels),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "not_available", reason: "unauthorized" } } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    const render = async (panelSchema: (typeof panels)[number]) => {
      const r = mount(PanelSchemaRenderer, {
        props: {
          selectedTimeObj: { start_time: new Date(0), end_time: new Date(1000) },
          panelSchema,
          variablesData: { values: [] },
          injectedPromqlData: injected[panelSchema.id],
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          stubs: {
            ChartRenderer: true,
            MarkdownRenderer: {
              props: ["markdownContent"],
              template: "<div data-test='md'>{{ markdownContent }}</div>",
            },
          },
        },
      });
      await flushPromises();
      return r;
    };
    const error = (r: VueWrapper) => r.find('[data-test="panel-schema-renderer-error-message"]');
    const notAvailable = "This panel isn't available on the public view.";
    expect(error(await render(panels[0])).text()).toBe(notAvailable);
    expect(error(await render(panels[1])).text()).toBe(
      "This panel will appear after the next update.",
    );
    expect(error(await render(panels[2])).text()).toBe(notAvailable);
    const md = await render(panels[3]);
    expect(error(md).exists()).toBe(false);
    expect(md.find('[data-test="md"]').text()).toBe("# Hi");
  });
});
