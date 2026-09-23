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

  it("re-reads config and snapshot every refresh_secs", async () => {
    vi.useFakeTimers();
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    buildWrapper();
    await flushPromises();
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.getConfig).toHaveBeenCalledTimes(2);
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

  it("shows not-found on a 404", async () => {
    (service.getConfig as any).mockRejectedValue({ response: { status: 404 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("not available");
  });

  it("shows unavailable on a 503 (expired / org suspended)", async () => {
    (service.getConfig as any).mockRejectedValue({ response: { status: 503 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("currently unavailable");
  });

  it("counts down to the next auto refresh", async () => {
    vi.useFakeTimers();
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    const w = buildWrapper();
    await flushPromises();
    const countdown = () =>
      w.find('[data-test="dashboards-public-dashboard-refresh-countdown"]').text();
    expect(countdown()).toBe("Auto refresh in 30s");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(countdown()).toBe("Auto refresh in 25s");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(countdown()).toBe("Auto refresh in 30s");
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
