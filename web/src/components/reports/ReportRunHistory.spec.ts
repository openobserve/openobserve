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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import reports from "@/services/reports";
import ReportRunHistory from "./ReportRunHistory.vue";

const replace = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn(), replace, resolve: () => ({ fullPath: "/" }) }),
  useRoute: () => ({ query: {} }),
}));

vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { getHistory: vi.fn() } });
});

const RESPONSE = {
  total: 1,
  from: 0,
  size: 50,
  disabled_reason: null,
  counts: { succeeded: 41, cached: 5, error: 3, skipped: 2, total: 51 },
  hits: [
    {
      timestamp: 10,
      report_id: "r1",
      report_name: "",
      status: "error",
      is_cached: false,
      trigger_source: "scheduled",
      retries: 0,
      error: "report not found",
    },
  ],
};

const mountHistory = (props: Record<string, unknown> = {}) =>
  mount(ReportRunHistory, {
    props: { reportId: "r1", ...props },
    global: {
      plugins: [i18n, store, withQueryClient()],
      stubs: { OTable: { template: "<div><slot name='subheader' /><slot name='empty' /></div>" } },
    },
  });

describe("ReportRunHistory", () => {
  beforeEach(() => {
    vi.mocked(reports.getHistory).mockReset();
    vi.mocked(reports.getHistory).mockResolvedValue({ data: RESPONSE } as any);
  });

  it("reads one report's runs over the last 7 days by default", async () => {
    mountHistory();
    await flushPromises();
    const [, query] = vi.mocked(reports.getHistory).mock.calls[0];
    expect(query.report_id).toBe("r1");
    expect(query.end_time - query.start_time).toBe(7 * 24 * 60 * 60 * 1000 * 1000);
    expect(query.status).toBeUndefined();
  });

  it("takes the tile counts from the server facets, with All last", async () => {
    const w = mountHistory();
    await flushPromises();
    const tiles = (w.vm as any).tiles;
    expect(tiles.map((t: any) => t.key)).toEqual(["error", "skipped", "succeeded", "all"]);
    expect(tiles.find((t: any) => t.key === "succeeded").value).toBe(46);
    expect(tiles.at(-1).value).toBe(51);
  });

  it("splits Sent from Cached on the org-wide view", async () => {
    const w = mountHistory({ reportId: undefined, showCachedTile: true });
    await flushPromises();
    const tiles = (w.vm as any).tiles;
    expect(tiles.map((t: any) => t.key)).toEqual([
      "error",
      "skipped",
      "succeeded",
      "cached",
      "all",
    ]);
    (w.vm as any).onTileSelect("cached");
    await flushPromises();
    const query = vi.mocked(reports.getHistory).mock.calls.at(-1)![1];
    expect(query.status).toEqual(["succeeded"]);
    expect(query.is_cached).toBe(true);
  });

  it("filters by a tile and clears the filter when the tile is clicked again", async () => {
    const w = mountHistory();
    await flushPromises();
    (w.vm as any).onTileSelect("error");
    await flushPromises();
    expect(vi.mocked(reports.getHistory).mock.calls.at(-1)![1].status).toEqual(["error"]);
    (w.vm as any).onTileSelect("error");
    expect((w.vm as any).tile).toBeNull();
  });

  it("sends the manual trigger filter", async () => {
    const w = mountHistory();
    await flushPromises();
    (w.vm as any).onTriggerChange("manual");
    await flushPromises();
    expect(vi.mocked(reports.getHistory).mock.calls.at(-1)![1].trigger_source).toBe("manual");
  });

  it("names the cause when the org records no runs", async () => {
    vi.mocked(reports.getHistory).mockResolvedValue({
      data: { ...RESPONSE, total: 0, hits: [], disabled_reason: "usage_report_to_own_org_off" },
    } as any);
    const w = mountHistory();
    await flushPromises();
    expect(w.find('[data-test="reports-reportrunhistory-disabled"]').text()).toContain(
      "ZO_USAGE_REPORT_TO_OWN_ORG",
    );
  });

  it("opens a run by writing its key into the URL", async () => {
    const w = mountHistory();
    await flushPromises();
    (w.vm as any).openRun(RESPONSE.hits[0]);
    expect(replace).toHaveBeenCalledWith({ query: { run: "10" } });
  });
});
