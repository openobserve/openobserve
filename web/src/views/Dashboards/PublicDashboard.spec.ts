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

import { shallowMount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("vue-router", () => ({ useRoute: () => ({ params: { slug: "abc" } }) }));
vi.mock("@/services/public_dashboards", () => ({
  default: { getConfig: vi.fn(), getData: vi.fn() },
}));

import service from "@/services/public_dashboards";
import PublicDashboard from "@/views/Dashboards/PublicDashboard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

const CONFIG = {
  title: "My Dashboard",
  layout: [
    {
      tabId: "t1",
      name: "Overview",
      panels: [{ id: "p1", title: "Panel 1" }],
    },
  ],
  time_range: { editable: true, default_range_secs: 3600, allowed_presets_secs: [3600, 86400] },
  available_presets: [3600, 86400],
  built_at: 1_700_000_000_000_000,
  refresh_secs: 30,
};

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
      data: { ...CONFIG, available_presets: [], time_range: { editable: true } },
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
        data: { ...CONFIG, available_presets: [], time_range: { editable: true } },
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
    expect(service.getData).toHaveBeenCalledWith(expect.any(String), 3600);
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
    expect(w.text()).toContain("not available");
  });

  it("shows the expired message on a 410", async () => {
    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 410 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("This link has expired.");
  });

  it("shows unavailable on a 503 (paused / org suspended)", async () => {
    (service.getConfig as any).mockRejectedValue({ response: { status: 503 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("currently unavailable");
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
        available_presets: [3600],
        time_range: { editable: false, default_range_secs: 3600, allowed_presets_secs: [3600] },
      },
      status: 200,
    });
    const fixed = mountWithActions();
    await flushPromises();
    expect(fixed.findComponent(ODropdown).exists()).toBe(false);
  });

  it("passes frozen variables to the grid as a read-only row", async () => {
    (service.getConfig as any).mockResolvedValue({
      data: { ...CONFIG, variables: [{ label: "Namespace", value: "ziox" }] },
      status: 200,
    });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    const w = shallowMount(PublicDashboard, {
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: { RenderDashboardCharts: { template: "<div><slot name='before_panels' /></div>" } },
      },
    });
    await flushPromises();
    const input = w.findComponent({ name: "OInput" });
    expect(input.props("label")).toBe("Namespace");
    expect(input.props("modelValue")).toBe("ziox");
    expect(input.props("readonly")).toBe(true);
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
    expect(p1.errorDetail.message).toContain("Not available");
  });
});
