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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import AlertHistory from "@/components/alerts/AlertHistory.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listByFolderId: vi.fn(), getHistory: vi.fn() },
  });
});

import alertsService from "@/services/alerts";

const hit = (name: string, ts: number) => ({
  alert_name: name,
  alert_id: name,
  timestamp: ts,
  start_time: ts - 1000,
  end_time: ts,
  status: "success",
  is_realtime: true,
  is_silenced: false,
  retries: 0,
  error: null,
});

let wrapper: VueWrapper<any>;

const mountHistory = async (stubs: Record<string, unknown> = {}) => {
  wrapper = mount(AlertHistory, {
    attachTo: document.body,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        ODialog: true,
        DateTime: { template: "<div />" },
        OSelect: { template: "<div />" },
        NoData: { template: "<div />" },
        ...stubs,
      },
    },
  });
  await flushPromises();
};

beforeEach(() => {
  queryClient.clear();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: [] } } as any);
  vi.mocked(alertsService.getHistory).mockResolvedValue({
    data: { hits: [hit("checkout-latency", 1699900000000000)], total: 1 },
  } as any);
});

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

describe("AlertHistory sort failure", () => {
  const failSortOnce = (status = 400) =>
    vi.mocked(alertsService.getHistory).mockRejectedValueOnce({
      response: { status, data: { message: "Can't sort by that column" } },
    });
  const REFRESH = '[data-test="alert-history-refresh-btn"]';
  const FAILED = `${REFRESH}[data-state="failed"]`;

  it("keeps the previous sort's rows at full opacity with the refresh button failed, not the table's error state", async () => {
    await mountHistory();
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("checkout-latency");

    failSortOnce();
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();

    const body = wrapper.find('[data-test="o2-table-body"]');
    expect(body.text()).toContain("checkout-latency");
    expect(body.classes()).not.toContain("opacity-60");
    expect(wrapper.text()).not.toContain("Can't sort by that column");
    expect(wrapper.vm.historyError).toBe("Can't sort by that column");
    const button = wrapper.find(FAILED);
    expect(button.exists()).toBe(true);
    expect(button.attributes("aria-label")).toBe("Retry");
    expect(button.find('[data-test="alert-history-refresh-btn-failed"]').text()).toMatch(
      /^Refresh failed at .+ · showing data from .+$/,
    );
    expect(button.classes()).toContain("bg-status-error-bg!");
    expect(wrapper.find('[data-test="o2-table-pagination-info"]').classes()).not.toContain(
      "invisible",
    );
    const details = wrapper.find('[data-test="alert-history-view-details"]');
    expect(details.attributes("aria-disabled")).toBeUndefined();
    expect(details.attributes("disabled")).toBeUndefined();
    await details.trigger("click");
    expect(wrapper.vm.selectedRow.alert_name).toBe("checkout-latency");
    expect(wrapper.vm.detailsDialog).toBe(true);
  });

  it("retries the filter and time range that failed, not ones staged since", async () => {
    await mountHistory();
    const failedRange = { ...wrapper.vm.dateTimeValues };
    failSortOnce(500);
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();
    expect(wrapper.vm.refreshFailure).not.toBeNull();

    wrapper.vm.searchQuery = "staged-alert";
    wrapper.vm.dateTimeValues = { ...failedRange, startTime: 1, endTime: 2 };
    await wrapper.find(FAILED).trigger("click");
    await flushPromises();

    const retried = vi.mocked(alertsService.getHistory).mock.calls.at(-1)?.[1];
    expect(retried.alert_id).toBeUndefined();
    expect(retried.start_time).toBe(String(failedRange.startTime));
    expect(retried.end_time).toBe(String(failedRange.endTime));
  });

  it.each([
    ["another alert", (vm: any) => (vm.searchQuery = "other-alert")],
    [
      "another time range",
      (vm: any) =>
        (vm.dateTimeValues = {
          startTime: 1,
          endTime: 2,
          type: "absolute",
          relativeTimePeriod: "",
        }),
    ],
  ])(
    "drops the shown rows when a read for %s fails, so they never pass for its result",
    async (_what, change) => {
      await mountHistory();
      expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("checkout-latency");

      failSortOnce(500);
      change(wrapper.vm);
      wrapper.vm.manualSearch();
      await flushPromises();

      expect(wrapper.vm.refreshFailure).toBeNull();
      expect(wrapper.text()).not.toContain("checkout-latency");
      expect(wrapper.text()).toContain("Can't sort by that column");
    },
  );

  it("keeps the shown rows when a refresh of the same relative range fails", async () => {
    await mountHistory();
    failSortOnce(500);
    const now = wrapper.vm.dateTimeValues;
    wrapper.vm.dateTimeValues = { ...now, startTime: now.startTime + 5, endTime: now.endTime + 5 };
    wrapper.vm.manualSearch();
    await flushPromises();

    expect(wrapper.vm.refreshFailure).not.toBeNull();
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("checkout-latency");
  });

  it("puts the failed read's times on the header's inline refresh button, and takes them off once a read lands", async () => {
    await mountHistory();
    const button = () => wrapper.findComponent({ name: "ORefreshButton" });
    expect(button().props("layout")).toBe("inline");
    expect(button().props("dataTest")).toBe("alert-history-refresh-btn");
    expect(button().props("failedAt")).toBeFalsy();

    failSortOnce();
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();
    expect(button().props("failedAt")).toBe(wrapper.vm.refreshFailure.failedAt);
    expect(button().props("failedAt")).toEqual(expect.any(Number));
    expect(button().props("dataFrom")).toBe(wrapper.vm.refreshFailure.dataFrom);
    expect(button().props("dataFrom")).toEqual(expect.any(Number));
    expect(wrapper.find('[data-test="alert-history-refresh-failed"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-pagination-status-note"]').exists()).toBe(false);

    await wrapper.find(FAILED).trigger("click");
    await flushPromises();
    expect(button().props("failedAt")).toBeFalsy();
    expect(wrapper.find(FAILED).exists()).toBe(false);
  });

  it("puts the sort indicator back on the sort the kept rows were read with", async () => {
    await mountHistory();
    const th = (id: string) => wrapper.find(`th[data-test="o2-table-th-${id}"]`);
    expect(th("timestamp").attributes("aria-sort")).toBe("descending");

    failSortOnce();
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();

    expect(wrapper.vm.sortBy).toBe("timestamp");
    expect(wrapper.vm.sortOrder).toBe("desc");
    expect(th("timestamp").attributes("aria-sort")).toBe("descending");
    expect(th("alert_name").attributes("aria-sort")).not.toBe("ascending");
  });

  it("announces the failure once through the alert region", async () => {
    await mountHistory();
    failSortOnce();
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();
    const alerts = document.querySelectorAll('[data-test="region-announcer-alert"] [role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/^Refresh failed at .+ · showing data from .+$/);
  });

  it("shows the table's error state when no rows are kept", async () => {
    failSortOnce(403);
    await mountHistory();
    expect(wrapper.find('[data-test="o2-table-body"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Can't sort by that column");
    expect(wrapper.find(FAILED).exists()).toBe(false);
    const range = wrapper.find('[data-test="o2-table-pagination-info"]');
    expect(range.classes()).toContain("invisible");
    expect(range.attributes("aria-hidden")).toBe("true");
  });

  it("retries the failed sort from the refresh button, which keeps focus", async () => {
    await mountHistory();
    failSortOnce();
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();
    const calls = vi.mocked(alertsService.getHistory).mock.calls.length;
    const retry = wrapper.find(FAILED);
    (retry.element as HTMLElement).focus();

    await retry.trigger("click");
    await flushPromises();

    expect(vi.mocked(alertsService.getHistory).mock.calls.length).toBe(calls + 1);
    expect(vi.mocked(alertsService.getHistory).mock.calls.at(-1)?.[1]).toMatchObject({
      sort_by: "alert_name",
      sort_order: "asc",
    });
    expect(wrapper.find(FAILED).exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-body"]').classes()).not.toContain("opacity-60");
    expect(document.activeElement).toBe(wrapper.find(REFRESH).element);
    expect(
      document.querySelectorAll('[data-test="region-announcer-alert"] [role="alert"]'),
    ).toHaveLength(0);
  });

  it("withdraws the failure's alert when the page is left", async () => {
    await mountHistory();
    failSortOnce();
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();
    const alerts = () =>
      document.querySelectorAll('[data-test="region-announcer-alert"] [role="alert"]');
    expect(alerts()).toHaveLength(1);
    wrapper.unmount();
    expect(alerts()).toHaveLength(0);
  });

  it("does not announce a refresh that fails after the page is left", async () => {
    await mountHistory();
    let reject!: (e: unknown) => void;
    vi.mocked(alertsService.getHistory).mockImplementationOnce(
      () => new Promise((_res, rej) => (reject = rej)) as any,
    );
    const pending = wrapper.vm.fetchAlertHistory(true);
    await flushPromises();
    expect(reject).toBeTypeOf("function");
    wrapper.unmount();
    reject({ response: { status: 400, data: { message: "Can't sort by that column" } } });
    await pending;
    await flushPromises();
    expect(
      document.querySelectorAll('[data-test="region-announcer-alert"] [role="alert"]'),
    ).toHaveLength(0);
  });

  it("clears the error and shows rows again once a later read succeeds", async () => {
    await mountHistory();
    vi.mocked(alertsService.getHistory).mockRejectedValueOnce({
      response: { status: 400, data: { message: "Can't sort by that column" } },
    });
    await wrapper.vm.onSortChange({ column: "alert_name", order: "asc" });
    await flushPromises();

    await wrapper.vm.onSortChange({ column: "timestamp", order: "desc" });
    await flushPromises();
    expect(wrapper.vm.historyError).toBeNull();
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("checkout-latency");
    expect(wrapper.find('[data-test="o2-table-pagination-info"]').classes()).not.toContain(
      "invisible",
    );
  });
});

describe("AlertHistory failed page read", { timeout: 30000 }, () => {
  const TOTAL = 60;
  const pagedHistory = () =>
    vi.mocked(alertsService.getHistory).mockImplementation(async (_org: any, q: any) => {
      const from = Number(q.from);
      const size = Number(q.size);
      const count = Math.max(0, Math.min(size, TOTAL - from));
      return {
        data: {
          hits: Array.from({ length: count }, (_, i) =>
            hit(`alert-${from + i + 1}`, 1699900000000000 - (from + i) * 1000),
          ),
          total: TOTAL,
        },
      } as any;
    });
  const failOnce = () =>
    vi.mocked(alertsService.getHistory).mockRejectedValueOnce({
      response: { status: 503, data: { message: "History is unavailable" } },
    });
  const FAILED = '[data-test="alert-history-refresh-btn"][data-state="failed"]';
  // Reads here render 20-50 rows whose real cell children cost seconds under CI load; no test here reads them.
  const ROW_CHILD_STUBS = {
    OTooltip: true,
    OTimeCell: true,
    OTag: true,
    OIcon: true,
    OTruncatedText: true,
  };
  const ROW_STUBS = { ...ROW_CHILD_STUBS, ODropdown: true };
  const range = () =>
    wrapper.find('[data-test="o2-table-pagination-info"]').text().replace(/\s+/g, " ");
  // The read Retry made, not the next-page prefetch that follows it.
  const retry = async () => {
    const before = vi.mocked(alertsService.getHistory).mock.calls.length;
    await wrapper.find(FAILED).trigger("click");
    await flushPromises();
    return vi.mocked(alertsService.getHistory).mock.calls[before]?.[1] as any;
  };

  beforeEach(() => {
    pagedHistory();
  });

  it("keeps the shown page's range over its rows when a later page fails, and Retry asks for that page", async () => {
    await mountHistory(ROW_STUBS);
    expect(range()).toBe("Showing 1 - 20 of 60");

    failOnce();
    await wrapper.vm.onPaginationChange({ page: 3, size: 20 });
    await flushPromises();

    expect(wrapper.find(FAILED).exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("alert-1");
    expect(wrapper.vm.currentPage).toBe(1);
    expect(range()).toBe("Showing 1 - 20 of 60");

    expect(await retry()).toMatchObject({ from: "40", size: "20" });
    expect(wrapper.vm.currentPage).toBe(3);
    expect(range()).toBe("Showing 41 - 60 of 60");
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("alert-41");
  });

  it("keeps the shown page size when a page-size change fails, and Retry asks for the new size", async () => {
    await mountHistory(ROW_STUBS);
    failOnce();
    await wrapper.vm.onPaginationChange({ page: 1, size: 50 });
    await flushPromises();

    expect(wrapper.vm.pageSize).toBe(20);
    expect(range()).toBe("Showing 1 - 20 of 60");

    expect(await retry()).toMatchObject({ from: "0", size: "50" });
    expect(range()).toBe("Showing 1 - 50 of 60");
  });

  it("drops the shown page when a new time range fails, and the table's Retry asks for the new range", async () => {
    await mountHistory(ROW_STUBS);
    await wrapper.vm.onPaginationChange({ page: 2, size: 20 });
    await flushPromises();
    expect(range()).toBe("Showing 21 - 40 of 60");

    failOnce();
    wrapper.vm.updateDateTime({ startTime: 1, endTime: 2, relativeTimePeriod: "1h" });
    await flushPromises();

    expect(wrapper.find(FAILED).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("alert-21");
    expect(wrapper.text()).toContain("History is unavailable");

    const before = vi.mocked(alertsService.getHistory).mock.calls.length;
    await wrapper.find('[data-test="o2-table-error-retry-btn"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(alertsService.getHistory).mock.calls[before]?.[1]).toMatchObject({
      from: "0",
      start_time: "1",
      end_time: "2",
    });
    expect(range()).toBe("Showing 1 - 20 of 60");
  });

  it("lets an open row menu act on the kept row after the refresh fails", async () => {
    await mountHistory(ROW_CHILD_STUBS);
    await wrapper.find('[data-test="alert-history-row-more-actions"]').trigger("click");
    await flushPromises();
    const item = () =>
      document.querySelector<HTMLElement>('[data-test="alert-history-view-details-menu"]');
    expect(item()).not.toBeNull();

    failOnce();
    await wrapper.vm.refreshData();
    await flushPromises();

    expect(wrapper.find(FAILED).exists()).toBe(true);
    expect(item()).not.toBeNull();
    expect(item()!.getAttribute("aria-disabled")).toBeNull();
    expect(item()!.hasAttribute("data-disabled")).toBe(false);
    item()!.click();
    await flushPromises();
    expect(wrapper.vm.selectedRow.alert_name).toBe("alert-1");
    expect(wrapper.vm.detailsDialog).toBe(true);
  });

  it("closes an open row menu whose row a successful read replaced", async () => {
    await mountHistory(ROW_CHILD_STUBS);
    await wrapper.find('[data-test="alert-history-row-more-actions"]').trigger("click");
    await flushPromises();
    expect(document.querySelector('[data-test="alert-history-view-details-menu"]')).not.toBeNull();

    await wrapper.vm.onPaginationChange({ page: 2, size: 20 });
    await flushPromises();

    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("alert-21");
    expect(document.querySelector('[data-test="alert-history-view-details-menu"]')).toBeNull();
  });
});
