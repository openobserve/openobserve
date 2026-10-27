// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or
// modify it under the terms of the GNU Affero General Public License
// as published by the Free Software Foundation, either version 3 of
// the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import { useDownloadAllResults } from "./downloadAllResults";

const searchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const searchObj = vi.hoisted(() => ({ value: null as any }));

vi.mock("@/services/search", () => ({
  default: { search: searchMock },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: toastMock,
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj: searchObj.value }),
}));

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ _timestamp: i }));

const buildSearchObj = (hitsCount: number, total: number, withSnapshot = true) => ({
  organizationIdentifier: "default",
  meta: { executed: { complete: true, signature: "sig-1" } },
  data: {
    stream: { streamType: "logs" },
    queryResults: { hits: rows(hitsCount), total },
    ...(withSnapshot
      ? {
          customDownloadQueryObj: {
            query: { sql: "c2VsZWN0ICogZnJvbSBzdHJlYW0x", from: 99, size: 100 },
          },
        }
      : {}),
  },
});

const TestComponent = defineComponent({
  setup() {
    return { ...useDownloadAllResults() };
  },
  template: "<div></div>",
});

describe("useDownloadAllResults", () => {
  let wrapper: any;
  let downloadLogsSpy: any;

  const mountComposable = async () => {
    wrapper = mount(TestComponent, { global: { plugins: [i18n] } });
    await flushPromises();
    return wrapper.vm;
  };

  beforeEach(() => {
    downloadLogsSpy = vi.fn();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("refetches every row of the last-run query when more rows exist than the loaded page", async () => {
    const allRows = rows(350);
    searchMock.mockResolvedValue({ data: { hits: allRows } });
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(searchMock).toHaveBeenCalledTimes(1);
    const [request, context] = searchMock.mock.calls[0];
    expect(context).toBe("ui");
    expect(request.org_identifier).toBe("default");
    expect(request.page_type).toBe("logs");
    expect(request.query.query.from).toBe(0);
    expect(request.query.query.size).toBe(10000);
    expect(request.query.query).not.toBe(searchObj.value.data.customDownloadQueryObj.query);
    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy).toHaveBeenCalledWith(allRows, "csv");
  });

  it("pages through until a short page when the total is only a paging lower bound (histogram off)", async () => {
    searchMock
      .mockResolvedValueOnce({ data: { hits: rows(10000) } })
      .mockResolvedValueOnce({ data: { hits: rows(37) } });
    // "101+" lower bound: rowsPerPage * currentPage + 1 with more rows on the server
    searchObj.value = buildSearchObj(100, 101);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock.mock.calls[0][0].query.query).toMatchObject({ from: 0, size: 10000 });
    expect(searchMock.mock.calls[1][0].query.query).toMatchObject({ from: 10000, size: 10000 });
    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy.mock.calls[0][0]).toHaveLength(10037);
    expect(downloadLogsSpy.mock.calls[0][1]).toBe("csv");
  });

  it("follows one size-of-total request with a confirmation page before stopping", async () => {
    searchMock
      .mockResolvedValueOnce({ data: { hits: rows(25000) } })
      .mockResolvedValueOnce({ data: { hits: [] } });
    searchObj.value = buildSearchObj(100, 25000);

    const vm = await mountComposable();
    await vm.downloadAllResults("json", downloadLogsSpy);

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock.mock.calls[0][0].query.query).toMatchObject({ from: 0, size: 25000 });
    expect(searchMock.mock.calls[1][0].query.query).toMatchObject({ from: 25000, size: 10000 });
    expect(downloadLogsSpy.mock.calls[0][0]).toHaveLength(25000);
  });

  it("does not mutate the stored query snapshot", async () => {
    searchMock.mockResolvedValue({ data: { hits: rows(350) } });
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    await vm.downloadAllResults("json", downloadLogsSpy);

    expect(searchObj.value.data.customDownloadQueryObj.query.from).toBe(99);
    expect(searchObj.value.data.customDownloadQueryObj.query.size).toBe(100);
  });

  it("exports the loaded hits without refetching when the page already holds every row", async () => {
    searchObj.value = buildSearchObj(80, 80);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(searchMock).not.toHaveBeenCalled();
    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy).toHaveBeenCalledWith(searchObj.value.data.queryResults.hits, "csv");
  });

  it("falls back to the loaded hits when no query snapshot exists", async () => {
    searchObj.value = buildSearchObj(100, 500, false);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(searchMock).not.toHaveBeenCalled();
    expect(downloadLogsSpy).toHaveBeenCalledWith(searchObj.value.data.queryResults.hits, "csv");
  });

  it("exports the shown hits as-is when no tracked run produced them (search-around view)", async () => {
    searchObj.value = buildSearchObj(100, 500);
    searchObj.value.meta.executed = null;

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(searchMock).not.toHaveBeenCalled();
    expect(downloadLogsSpy).toHaveBeenCalledWith(searchObj.value.data.queryResults.hits, "csv");
  });

  it("exports a first page larger than the spread-argument limit", async () => {
    searchMock
      .mockResolvedValueOnce({ data: { hits: rows(200000) } })
      .mockResolvedValueOnce({ data: { hits: [] } });
    searchObj.value = buildSearchObj(100, 200000);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy.mock.calls[0][0]).toHaveLength(200000);
  });

  it("falls back to the loaded hits when the refetch comes back empty", async () => {
    searchMock.mockResolvedValue({ data: { hits: [] } });
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy).toHaveBeenCalledWith(searchObj.value.data.queryResults.hits, "csv");
  });

  it("falls back to the loaded hits when the refetch returns fewer rows than the loaded page", async () => {
    searchMock.mockResolvedValue({ data: { hits: rows(2) } });
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy).toHaveBeenCalledWith(searchObj.value.data.queryResults.hits, "csv");
  });

  it("warns instead of downloading when neither the refetch nor the loaded hits have rows", async () => {
    searchMock.mockResolvedValue({ data: { hits: [] } });
    searchObj.value = buildSearchObj(0, 350);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(downloadLogsSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
  });

  it("toasts the error and skips the download when the refetch fails", async () => {
    searchMock.mockRejectedValue(new Error("search failed"));
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    await vm.downloadAllResults("csv", downloadLogsSpy);

    expect(downloadLogsSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("clears isDownloadingAll once the refetch settles", async () => {
    let resolveSearch: (value: any) => void = () => {};
    searchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    const pending = vm.downloadAllResults("csv", downloadLogsSpy);
    expect(vm.isDownloadingAll).toBe(true);
    resolveSearch({ data: { hits: rows(350) } });
    await pending;

    expect(vm.isDownloadingAll).toBe(false);
  });

  it("ignores repeat invocations while a download fetch is in flight", async () => {
    let resolveSearch: (value: any) => void = () => {};
    searchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    const first = vm.downloadAllResults("csv", downloadLogsSpy);
    await vm.downloadAllResults("csv", downloadLogsSpy);
    resolveSearch({ data: { hits: rows(350) } });
    await first;

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
  });

  it("skips the download with an error toast when a new run replaces this one mid-fetch", async () => {
    let resolveSearch: (value: any) => void = () => {};
    searchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    const pending = vm.downloadAllResults("csv", downloadLogsSpy);
    // a new search invalidates the executed record while the fetch is in flight
    searchObj.value.meta.executed = null;
    resolveSearch({ data: { hits: rows(350) } });
    await pending;

    expect(downloadLogsSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("still exports when the run is re-executed with the same signature mid-fetch", async () => {
    let resolveSearch: (value: any) => void = () => {};
    searchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    searchObj.value = buildSearchObj(100, 350);

    const vm = await mountComposable();
    const pending = vm.downloadAllResults("csv", downloadLogsSpy);
    // same query re-executed (auto-refresh): different record, identical signature
    searchObj.value.meta.executed = { complete: true, signature: "sig-1" };
    resolveSearch({ data: { hits: rows(350) } });
    await pending;

    expect(downloadLogsSpy).toHaveBeenCalledTimes(1);
  });
});
