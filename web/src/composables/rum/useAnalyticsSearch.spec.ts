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
import { flushPromises } from "@vue/test-utils";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});

const mockStore = {
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: { sql_base64_enabled: false },
  },
};
vi.mock("vuex", () => ({ useStore: () => mockStore }));

import searchService from "@/services/search";
import useAnalyticsSearch, { type SearchSpec } from "./useAnalyticsSearch";
import { b64DecodeUnicode } from "@/utils/formatters";

const SQL = 'SELECT 1 AS x FROM "_rumdata" LIMIT 1';
const spec = (sql = SQL): SearchSpec => ({ sql, startUs: 10, endUs: 20, limit: 1, sampled: 1 });

const deferred = () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useAnalyticsSearch", () => {
  beforeEach(() => {
    vi.mocked(searchService.search).mockReset();
    mockStore.state.zoConfig.sql_base64_enabled = false;
    mockStore.state.selectedOrganization.identifier = "org1";
  });

  it("posts the builder SQL to _rumdata search with explicit times and size (AC-37)", async () => {
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [{ x: 1 }] } } as never);
    const runner = useAnalyticsSearch();
    const res = await runner.run("p", spec(), "k1");
    expect(res.status).toBe("ok");
    expect(res.rows).toEqual([{ x: 1 }]);
    const [args, searchType] = vi.mocked(searchService.search).mock.calls[0];
    expect(searchType).toBe("RUM");
    expect(args.org_identifier).toBe("org1");
    expect(args.page_type).toBe("logs");
    expect(args.signal).toBeInstanceOf(AbortSignal);
    expect(args.query).toEqual({
      query: { sql: SQL, start_time: 10, end_time: 20, from: 0, size: 1 },
    });
  });

  it("base64-encodes the SQL when the server asks for it", async () => {
    mockStore.state.zoConfig.sql_base64_enabled = true;
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await useAnalyticsSearch().run("p", spec(), "k");
    const body = vi.mocked(searchService.search).mock.calls[0][0].query;
    expect(body.encoding).toBe("base64");
    expect(b64DecodeUnicode(body.query.sql)).toBe(SQL);
  });

  it("refuses SQL that joins or scans twice (AC-55)", async () => {
    const runner = useAnalyticsSearch();
    await expect(
      runner.run("p", spec('SELECT 1 FROM "_rumdata" a JOIN b ON 1=1'), "k"),
    ).rejects.toThrow();
    expect(searchService.search).not.toHaveBeenCalled();
  });

  it("maps 403 to forbidden and other failures to an error with Retry (AC-9)", async () => {
    vi.mocked(searchService.search)
      .mockRejectedValueOnce({ response: { status: 403, data: { message: "nope" } } })
      .mockRejectedValueOnce({ response: { status: 429, data: { message: "queue full" } } })
      .mockResolvedValueOnce({ data: { hits: [{ x: 2 }] } } as never);
    const runner = useAnalyticsSearch();
    expect((await runner.run("a", spec(), "k")).status).toBe("forbidden");
    const failed = await runner.run("b", spec(), "k");
    expect(failed.status).toBe("error");
    expect(failed.error).toEqual({ status: 429, message: "queue full" });
    await runner.retry("b");
    expect(runner.panel("b").value.status).toBe("ok");
    expect(runner.panel("a").value.status).toBe("forbidden");
    expect(searchService.search).toHaveBeenCalledTimes(3);
  });

  it("surfaces partial results and function_error", async () => {
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [], is_partial: true, function_error: "Query duration is modified" },
    } as never);
    const res = await useAnalyticsSearch().run("p", spec(), "k");
    expect(res.partial).toBe("Query duration is modified");
  });

  it("runs at most 4 searches at once (AC-38)", async () => {
    const pending = Array.from({ length: 6 }, deferred);
    let i = 0;
    vi.mocked(searchService.search).mockImplementation(() => pending[i++].promise as never);
    const runner = useAnalyticsSearch();
    const runs = ["a", "b", "c", "d", "e", "f"].map((id) => runner.run(id, spec(), "k"));
    await flushPromises();
    expect(searchService.search).toHaveBeenCalledTimes(4);
    expect(runner.active.value).toBe(4);
    pending[0].resolve({ data: { hits: [] } });
    await flushPromises();
    expect(searchService.search).toHaveBeenCalledTimes(5);
    pending.slice(1).forEach((d) => d.resolve({ data: { hits: [] } }));
    await Promise.all(runs);
    expect(runner.active.value).toBe(0);
  });

  it("abortAll marks in-flight panels aborted and rerunAborted re-runs only them (AC-38)", async () => {
    const first = deferred();
    vi.mocked(searchService.search)
      .mockResolvedValueOnce({ data: { hits: [{ done: 1 }] } } as never)
      .mockImplementationOnce(((args: { signal: AbortSignal }) => {
        args.signal.addEventListener("abort", () =>
          first.reject({ name: "CanceledError", code: "ERR_CANCELED" }),
        );
        return first.promise;
      }) as never)
      .mockResolvedValueOnce({ data: { hits: [{ again: 1 }] } } as never);
    const runner = useAnalyticsSearch();
    await runner.run("done", spec(), "k");
    const inflight = runner.run("slow", spec(), "k");
    await flushPromises();
    runner.abortAll();
    await inflight;
    expect(runner.panel("slow").value.status).toBe("aborted");
    expect(runner.panel("done").value.status).toBe("ok");
    await runner.rerunAborted();
    expect(searchService.search).toHaveBeenCalledTimes(3);
    expect(runner.panel("slow").value.rows).toEqual([{ again: 1 }]);
  });

  it("a superseded run of the same panel aborts the older request", async () => {
    const old = deferred();
    let oldSignal: AbortSignal | undefined;
    vi.mocked(searchService.search)
      .mockImplementationOnce(((args: { signal: AbortSignal }) => {
        oldSignal = args.signal;
        args.signal.addEventListener("abort", () => old.reject({ code: "ERR_CANCELED" }));
        return old.promise;
      }) as never)
      .mockResolvedValueOnce({ data: { hits: [{ v: 2 }] } } as never);
    const runner = useAnalyticsSearch();
    const a = runner.run("p", spec(), "k1");
    await flushPromises();
    const b = runner.run("p", spec(), "k2");
    await Promise.all([a, b]);
    expect(oldSignal?.aborted).toBe(true);
    expect(runner.panel("p").value).toMatchObject({ status: "ok", key: "k2", rows: [{ v: 2 }] });
  });

  it("a superseded request that ignores abort and resolves late never overwrites the newer result", async () => {
    const old = deferred();
    vi.mocked(searchService.search)
      .mockImplementationOnce((() => old.promise) as never)
      .mockResolvedValueOnce({ data: { hits: [{ v: 2 }] } } as never);
    const runner = useAnalyticsSearch();
    const a = runner.run("p", spec(), "k1");
    await flushPromises();
    const b = await runner.run("p", spec(), "k2");
    old.resolve({ data: { hits: [{ v: 1 }] } });
    const stale = await a;
    expect(b).toMatchObject({ status: "ok", key: "k2" });
    expect(stale.key).toBe("k2");
    expect(runner.panel("p").value).toMatchObject({ status: "ok", key: "k2", rows: [{ v: 2 }] });
  });

  it("binds the organization when a search is queued, not when it runs", async () => {
    const first = deferred();
    vi.mocked(searchService.search)
      .mockImplementationOnce((() => first.promise) as never)
      .mockResolvedValueOnce({ data: { hits: [] } } as never);
    const runner = useAnalyticsSearch(1);
    const a = runner.run("a", spec(), "k");
    const b = runner.run("b", spec(), "k");
    await flushPromises();
    mockStore.state.selectedOrganization.identifier = "org2";
    first.resolve({ data: { hits: [] } });
    await Promise.all([a, b]);
    const orgs = vi.mocked(searchService.search).mock.calls.map((c) => c[0].org_identifier);
    expect(orgs).toEqual(["org1", "org1"]);
  });
});
