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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import reports from "@/services/reports";
import { rememberManualRun } from "@/utils/reports/reportRun";
import type { ReportRunHit } from "@/services/reports";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ReportRunHistory from "./ReportRunHistory.vue";

const replace = vi.fn();
const routeQuery: Record<string, string> = {};
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn(), replace, resolve: () => ({ fullPath: "/" }) }),
  useRoute: () => ({ query: routeQuery }),
}));

vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getHistory: vi.fn(), getReportById: vi.fn() },
  });
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

const mounted: ReturnType<typeof mount>[] = [];
const mountHistory = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(ReportRunHistory, {
    props: { reportId: "r1", ...props },
    global: {
      plugins: [i18n, store, withQueryClient()],
      stubs: {
        OTable: { template: "<div><slot name='subheader' /><slot name='empty' /></div>" },
        ODrawer: { template: "<div data-test='drawer'><slot /></div>" },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
};

describe("ReportRunHistory", () => {
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
  });
  beforeEach(() => {
    for (const k of Object.keys(routeQuery)) delete routeQuery[k];
    vi.mocked(reports.getHistory).mockReset();
    vi.mocked(reports.getHistory).mockResolvedValue({ data: RESPONSE } as any);
    vi.mocked(reports.getReportById).mockReset();
    vi.mocked(reports.getReportById).mockRejectedValue({ response: { status: 404 } });
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
      data: { ...RESPONSE, total: 0, hits: [], disabled_reason: "usage_reporting_remote" },
    } as any);
    const w = mountHistory();
    await flushPromises();
    expect(w.find('[data-test="reports-reportrunhistory-disabled"]').text()).toContain(
      "ZO_USAGE_REPORTING_MODE",
    );
  });

  it("opens a run by writing its key into the URL", async () => {
    const w = mountHistory();
    await flushPromises();
    (w.vm as any).openRun(RESPONSE.hits[0]);
    expect(replace).toHaveBeenCalledWith({ query: { run: "10", run_report_id: "r1" } });
  });

  it("resolves a linked run behind 144 newer rows without changing table state", async () => {
    const ts = 1_760_000_000_000_000;
    const target = { ...RESPONSE.hits[0], timestamp: ts, retries: 2 };
    routeQuery.run = `${ts}-2`;
    vi.mocked(reports.getHistory).mockImplementation(
      async (_org, query) =>
        ({
          data:
            query.retries === 2
              ? { ...RESPONSE, total: 1, hits: [target] }
              : {
                  ...RESPONSE,
                  total: 145,
                  hits: Array.from({ length: 50 }, (_, i) => ({
                    ...target,
                    timestamp: ts + (144 - i) * 60_000_000,
                  })),
                },
        }) as any,
    );
    const w = mountHistory();
    await flushPromises();
    expect((w.vm as any).selectedRun).toEqual(target);
    expect((w.vm as any).range).toBe("7d");
    expect((w.vm as any).currentPage).toBe(1);
    expect((w.vm as any).tile).toBeNull();
    expect((w.vm as any).triggerSource).toBe("all");
    expect(
      vi
        .mocked(reports.getHistory)
        .mock.calls.some(
          ([, q]) =>
            q.start_time === ts && q.end_time === ts + 1 && q.report_id === "r1" && q.retries === 2,
        ),
    ).toBe(true);
  });

  it("uses the report ID to disambiguate simultaneous org-wide runs", async () => {
    routeQuery.run = "10";
    routeQuery.run_report_id = "r2";
    const target = { ...RESPONSE.hits[0], report_id: "r2" };
    vi.mocked(reports.getHistory).mockImplementation(
      async (_org, query) =>
        ({
          data: {
            ...RESPONSE,
            hits: query.run_report_id === "r2" ? [target] : [RESPONSE.hits[0], target],
          },
        }) as any,
    );
    const w = mountHistory({ reportId: undefined });
    await flushPromises();
    expect((w.vm as any).selectedRun).toEqual(target);
    expect(
      vi
        .mocked(reports.getHistory)
        .mock.calls.some(
          ([, q]) => q.run_report_id === "r2" && q.report_id === undefined && q.start_time === 10,
        ),
    ).toBe(true);
  });

  it("asks for a new link when a legacy org link is ambiguous", async () => {
    routeQuery.run = "10";
    vi.mocked(reports.getHistory).mockResolvedValue({
      data: {
        ...RESPONSE,
        total: 2,
        hits: [RESPONSE.hits[0], { ...RESPONSE.hits[0], report_id: "r2" }],
      },
    } as any);
    const w = mountHistory({ reportId: undefined });
    await flushPromises();
    expect((w.vm as any).selectedRun).toBeNull();
    expect((w.vm as any).linkedRunMessage).toContain("does not identify a unique report");
  });

  it.each([403, 200])("reports forbidden or missing retained runs (%s)", async (status) => {
    routeQuery.run = "10";
    vi.mocked(reports.getHistory).mockImplementation(async (_org, query) => {
      if (query.retries !== undefined && status === 403) throw { response: { status: 403 } };
      return { data: { ...RESPONSE, total: 0, hits: [] } } as any;
    });
    const w = mountHistory();
    await flushPromises();
    expect((w.vm as any).selectedRun).toBeNull();
    expect((w.vm as any).linkedRunMessage).toContain(status === 403 ? "permission" : "expired");
  });

  it("does not prepend manual rows outside the active microsecond range or under other sorts", async () => {
    const ts = Date.now() * 1000 - 1000;
    rememberManualRun(store.state.selectedOrganization.identifier, {
      ...RESPONSE.hits[0],
      timestamp: ts,
      trigger_source: "manual",
    } as ReportRunHit);
    vi.mocked(reports.getHistory).mockResolvedValue({
      data: { ...RESPONSE, total: 0, hits: [] },
    } as any);
    const w = mountHistory();
    await flushPromises();
    expect((w.vm as any).rows).toHaveLength(1);
    expect((w.vm as any).totalCount).toBe(1);
    for (const sort of [
      { column: "status", order: "desc" },
      { column: "retries", order: "desc" },
      { column: "timestamp", order: "asc" },
    ]) {
      (w.vm as any).onSortChange(sort);
      await flushPromises();
      expect((w.vm as any).rows).toEqual([]);
      expect((w.vm as any).totalCount).toBe(0);
    }
    (w.vm as any).onSortChange({ column: "timestamp", order: "desc" });
    (w.vm as any).onRangeChange("custom");
    (w.vm as any).onCustomRange({ startTime: ts - 100_000, endTime: ts - 10_000 });
    await flushPromises();
    expect((w.vm as any).rows).toEqual([]);
    expect((w.vm as any).totalCount).toBe(0);
  });

  it("accounts for a pending row in page sizes, offsets and total", async () => {
    const ts = Date.now() * 1000 - 1000;
    rememberManualRun(store.state.selectedOrganization.identifier, {
      ...RESPONSE.hits[0],
      report_id: "pagination",
      timestamp: ts,
      trigger_source: "manual",
    } as ReportRunHit);
    vi.mocked(reports.getHistory).mockImplementation(
      async (_org, query) =>
        ({
          data: {
            ...RESPONSE,
            total: 50,
            hits: Array.from(
              { length: Math.min(query.size ?? 50, 50 - (query.from ?? 0)) },
              (_, i) => ({
                ...RESPONSE.hits[0],
                report_id: "pagination",
                timestamp: ts - (i + 1 + (query.from ?? 0)) * 1000,
              }),
            ),
          },
        }) as any,
    );
    const w = mountHistory({ reportId: "pagination" });
    await flushPromises();
    expect((w.vm as any).rows).toHaveLength(50);
    expect((w.vm as any).rows[0].timestamp).toBe(ts);
    expect((w.vm as any).totalCount).toBe(51);
    (w.vm as any).onPaginationChange({ page: 2, size: 50 });
    await flushPromises();
    expect(
      vi
        .mocked(reports.getHistory)
        .mock.calls.some(([, q]) => q.retries === undefined && q.from === 49),
    ).toBe(true);
    expect((w.vm as any).rows).toHaveLength(1);
  });
  it("opens a dense org-wide link through list visibility even when report GET is denied", async () => {
    const target = { ...RESPONSE.hits[0], report_id: "visible-not-gettable", retries: 4 };
    routeQuery.run = "10-4";
    routeQuery.run_report_id = target.report_id;
    vi.mocked(reports.getHistory).mockImplementation(async (_org, query) => {
      if (query.report_id) throw { response: { status: 403 } };
      if (query.run_report_id) return { data: { ...RESPONSE, total: 1, hits: [target] } } as any;
      return {
        data: {
          ...RESPONSE,
          total: 2001,
          hits: Array.from({ length: 50 }, (_, i) => ({ ...target, report_id: `other-${i}` })),
        },
      } as any;
    });
    const w = mountHistory({ reportId: undefined });
    await flushPromises();
    expect((w.vm as any).selectedRun).toEqual(target);
    expect((w.vm as any).linkedRunMessage).toBeNull();
    expect(
      vi.mocked(reports.getHistory).mock.calls.every(([, q]) => q.report_id === undefined),
    ).toBe(true);
    expect(
      vi
        .mocked(reports.getHistory)
        .mock.calls.some(([, q]) => q.run_report_id === target.report_id && q.retries === 4),
    ).toBe(true);
  });

  it("loads the run's report for the org-wide drawer", async () => {
    const target = { ...RESPONSE.hits[0], report_id: "r9", scheduled_for: 10, error: null };
    routeQuery.run = "10";
    routeQuery.run_report_id = target.report_id;
    vi.mocked(reports.getHistory).mockResolvedValue({
      data: { ...RESPONSE, hits: [target] },
    } as any);
    vi.mocked(reports.getReportById).mockResolvedValue({
      data: {
        timezone: "Asia/Kolkata",
        dashboards: [{ dashboard: "d1", folder: "default", tabs: ["Overview"] }],
      },
    } as any);
    const w = mountHistory({ reportId: undefined });
    await flushPromises();
    expect(reports.getReportById).toHaveBeenCalledWith(expect.any(String), "r9", {
      silentForbidden: true,
    });
    expect(w.find('[data-test="reports-reportrundrawer-scheduled-for"]').text()).toMatch(
      / \(Asia\/Kolkata\)$/,
    );
    expect(w.find('[data-test="reports-reportrundrawer-dashboard-0"]').exists()).toBe(true);
  });

  it("opens the org-wide drawer quietly when the report GET is denied", async () => {
    const target = { ...RESPONSE.hits[0], report_id: "r9", scheduled_for: 10, error: null };
    routeQuery.run = "10";
    routeQuery.run_report_id = target.report_id;
    vi.mocked(reports.getHistory).mockResolvedValue({
      data: { ...RESPONSE, hits: [target] },
    } as any);
    vi.mocked(reports.getReportById).mockRejectedValue({ response: { status: 403 } });
    const w = mountHistory({ reportId: undefined });
    await flushPromises();
    expect(reports.getReportById).toHaveBeenCalled();
    expect((w.vm as any).selectedRun).toEqual(target);
    expect(w.find('[data-test="reports-reportrundrawer"]').exists()).toBe(true);
    expect(w.find('[data-test="reports-reportrundrawer-scheduled-for"]').text()).toMatch(
      / \(UTC\)$/,
    );
    expect(w.findAllComponents(OBanner)).toHaveLength(0);
  });

  it("does not fetch the report when the page passes it", async () => {
    routeQuery.run = "10";
    routeQuery.run_report_id = "r1";
    mountHistory({ report: { timezone: "Asia/Kolkata", dashboards: [] } });
    await flushPromises();
    expect(reports.getReportById).not.toHaveBeenCalled();
  });

  it("reconciles an ingested manual row while staying on page two", async () => {
    const ts = Date.now() * 1000 - 1000;
    const target = {
      ...RESPONSE.hits[0],
      report_id: "ingestion-later-page",
      timestamp: ts,
      trigger_source: "manual",
    } as ReportRunHit;
    rememberManualRun(store.state.selectedOrganization.identifier, target);
    const older = Array.from({ length: 50 }, (_, i) => ({
      ...target,
      timestamp: ts - (i + 1) * 1000,
    }));
    let ingested = false;
    vi.mocked(reports.getHistory).mockImplementation(async (_org, query) => {
      if (query.retries !== undefined)
        return {
          data: { ...RESPONSE, total: ingested ? 1 : 0, hits: ingested ? [target] : [] },
        } as any;
      const all = ingested ? [target, ...older] : older;
      return {
        data: {
          ...RESPONSE,
          total: all.length,
          counts: { succeeded: 0, cached: 0, error: all.length, skipped: 0, total: all.length },
          hits: all.slice(query.from ?? 0, (query.from ?? 0) + (query.size ?? 50)),
        },
      } as any;
    });
    const w = mountHistory({ reportId: target.report_id });
    await flushPromises();
    expect((w.vm as any).totalCount).toBe(51);
    expect((w.vm as any).counts.total).toBe(51);
    (w.vm as any).onPaginationChange({ page: 2, size: 50 });
    await flushPromises();
    ingested = true;
    (w.vm as any).refresh();
    await flushPromises();
    expect((w.vm as any).pending).toEqual([]);
    expect((w.vm as any).currentPage).toBe(2);
    expect((w.vm as any).totalCount).toBe(51);
    expect((w.vm as any).counts.total).toBe(51);
    expect((w.vm as any).rows).toEqual([older[49]]);
    expect(
      vi
        .mocked(reports.getHistory)
        .mock.calls.filter(([, q]) => q.retries === undefined)
        .at(-1)![1].from,
    ).toBe(50);
  });
});
