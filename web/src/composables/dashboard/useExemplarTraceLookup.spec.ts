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
import { useExemplarTraceLookup } from "./useExemplarTraceLookup";
import searchService from "@/services/search";

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org1" } } }),
}));

vi.mock("@/services/search", () => ({
  default: { get_trace_time_ranges: vi.fn() },
}));

const lookupMock = searchService.get_trace_time_ranges as unknown as ReturnType<typeof vi.fn>;

const ok = (results: unknown[], partial_coverage = false) => ({
  data: { results, partial_coverage },
});

const httpError = (status: number) => ({ response: { status } });

describe("useExemplarTraceLookup", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps found to the returned stream and range, searching all retention with a hint", async () => {
    lookupMock.mockResolvedValue(
      ok([
        {
          trace_id: "t1",
          status: "found",
          stream: "default",
          range: { start_time: 5, end_time: 9 },
        },
      ]),
    );
    const { lookup } = useExemplarTraceLookup();
    await expect(lookup("t1", 1_000)).resolves.toEqual({
      state: "found",
      stream: "default",
      startUs: 5,
      endUs: 9,
    });
    const args = lookupMock.mock.calls[0][0];
    expect(args).toMatchObject({ org_identifier: "org1", trace_ids: ["t1"], hint_ts: 1_000_000 });
    expect(args.start_time).toBeUndefined();
    expect(args.end_time).toBeUndefined();
    expect(args.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [
      "not_found with full coverage",
      ok([{ trace_id: "t", status: "not_found" }]),
      { state: "not_available" },
    ],
    [
      "not_found with partial coverage",
      ok([{ trace_id: "t", status: "not_found" }], true),
      { state: "unverified", reason: "partial" },
    ],
    [
      "a server timeout",
      ok([{ trace_id: "t", status: "timeout" }]),
      { state: "unverified", reason: "timeout" },
    ],
  ])("maps %s", async (_label, response, verdict) => {
    lookupMock.mockResolvedValue(response);
    await expect(useExemplarTraceLookup().lookup("t", 1)).resolves.toEqual(verdict);
  });

  it.each([
    [403, { state: "unverified", reason: "forbidden" }],
    [404, { state: "unverified", reason: "error" }],
    [405, { state: "unverified", reason: "error" }],
    [500, { state: "unverified", reason: "error" }],
  ])("maps HTTP %s", async (status, verdict) => {
    lookupMock.mockImplementation(async () => {
      throw httpError(status);
    });
    await expect(useExemplarTraceLookup().lookup("t", 1)).resolves.toEqual(verdict);
  });

  it("aborts at the client cap and reports a timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    lookupMock.mockImplementation((args: { signal: AbortSignal }) => {
      signal = args.signal;
      return new Promise((_resolve, reject) => {
        args.signal.addEventListener("abort", () => reject({ name: "CanceledError" }));
      });
    });
    const pending = useExemplarTraceLookup({ timeoutMs: 8000 }).lookup("t", 1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(signal?.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ state: "unverified", reason: "timeout" });
  });

  it("sends nothing until asked", () => {
    useExemplarTraceLookup();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("caches per trace_id and shares one in-flight request", async () => {
    let resolve: (v: unknown) => void = () => {};
    lookupMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { lookup, peek } = useExemplarTraceLookup();
    const first = lookup("t1", 1);
    const concurrent = lookup("t1", 2);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(peek("t1")).toBeUndefined();
    resolve(ok([{ trace_id: "t1", status: "not_found" }]));
    await expect(first).resolves.toEqual({ state: "not_available" });
    await expect(concurrent).resolves.toEqual({ state: "not_available" });
    await lookup("t1", 3);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(peek("t1")).toEqual({ state: "not_available" });
  });

  it("retries after a transient error but keeps a found verdict cached", async () => {
    lookupMock.mockImplementationOnce(async () => {
      throw httpError(502);
    });
    const { lookup, peek } = useExemplarTraceLookup();
    await expect(lookup("t1", 1)).resolves.toEqual({ state: "unverified", reason: "error" });
    expect(peek("t1")).toBeUndefined();
    lookupMock.mockResolvedValue(
      ok([{ trace_id: "t1", status: "found", stream: "s", range: { start_time: 1, end_time: 2 } }]),
    );
    await expect(lookup("t1", 1)).resolves.toMatchObject({ state: "found" });
    await lookup("t1", 1);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("sends one request per distinct trace_id", async () => {
    lookupMock.mockResolvedValue(ok([{ status: "not_found" }]));
    const { lookup } = useExemplarTraceLookup();
    await Promise.all([lookup("a", 1), lookup("b", 1), lookup("a", 1)]);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });
});
