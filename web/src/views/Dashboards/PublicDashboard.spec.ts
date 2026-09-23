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
import { describe, expect, it, beforeEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("vue-router", () => ({ useRoute: () => ({ params: { slug: "abc" } }) }));
vi.mock("@/services/public_dashboards", () => ({
  default: { getConfig: vi.fn(), getData: vi.fn() },
}));

import service from "@/services/public_dashboards";
import PublicDashboard from "@/views/Dashboards/PublicDashboard.vue";

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
};

const buildWrapper = () =>
  shallowMount(PublicDashboard, { global: { plugins: [i18n], provide: { store } } });

const has = (w: any, id: string) => w.find(`[data-test="${id}"]`).exists();

describe("PublicDashboard viewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the loading state before requests resolve", () => {
    (service.getConfig as any).mockReturnValue(new Promise(() => {}));
    const w = buildWrapper();
    expect(has(w, "dashboards-public-dashboard-loading")).toBe(true);
  });

  it("renders panels once config + snapshot load (ready)", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-panel-p1")).toBe(true);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
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

  it("renders the Not-available placeholder for a withheld panel", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "not_available", reason: "unauthorized" } } } },
    });
    const w = buildWrapper();
    await flushPromises();
    expect(w.text()).toContain("Not available");
  });
});
