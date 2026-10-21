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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetOverview from "./FleetOverview.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listCollectors: vi.fn(), listTokens: vi.fn(), summary: vi.fn() },
}));

const summary = {
  collectors: { total: 7, unknown: 1, online: 4, degraded: 1, offline: 1, outdated: 2 },
  versions: [],
  target_version: "0.163.1",
  rollouts_active: 3,
};

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 50));
  await flushPromises();
};

async function mountOverview() {
  const wrapper = mount(FleetOverview, {
    global: { plugins: [i18n, store], stubs: { FleetFlowOverview: true } },
  });
  await settle();
  return wrapper;
}

const tile = (w: VueWrapper, key: string) => w.find(`[data-test="fleet-overview-stat-${key}"]`);

describe("FleetOverview", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(fleet.listTokens).mockResolvedValue({ data: { items: [] } } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { items: [] } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("shows only collector states, total first then online, no outdated or rollout tile", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountOverview();
    const tiles = wrapper.findAll('[data-test^="fleet-overview-stat-"]');
    expect(tiles.map((el) => el.attributes("data-test"))).toEqual([
      "fleet-overview-stat-total",
      "fleet-overview-stat-online",
      "fleet-overview-stat-offline",
      "fleet-overview-stat-degraded",
      "fleet-overview-stat-unknown",
    ]);
    expect(tile(wrapper, "total").text()).toContain("7");
    expect(tile(wrapper, "online").text()).toContain("4");
    expect(tile(wrapper, "offline").text()).toContain("1");
    expect(tile(wrapper, "unknown").text()).toContain("Not reported");
  });

  it("shows dashes while the summary is unavailable", async () => {
    vi.mocked(fleet.summary).mockRejectedValue({ response: { status: 403 } });
    wrapper = await mountOverview();
    expect(tile(wrapper, "total").text()).toContain("—");
    expect(tile(wrapper, "online").text()).toContain("—");
  });

  it("opens the Fleets tab filtered by the clicked state, or unfiltered from Total", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountOverview();
    await tile(wrapper, "offline").trigger("click");
    await tile(wrapper, "total").trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([
      ["fleets", { scope: "all", status: "offline" }],
      ["fleets", { scope: "all" }],
    ]);
  });
});
