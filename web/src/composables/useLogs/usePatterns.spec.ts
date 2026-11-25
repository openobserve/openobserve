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

import { describe, it, expect, vi } from "vitest";
import usePatterns, { patternsState } from "./usePatterns";
import patternsService from "@/services/patterns";

vi.mock("@/services/patterns", () => ({
  default: { extractPatterns: vi.fn() },
}));

describe("usePatterns partial warning", () => {
  it("keeps the backend's partial warning on the stored result", async () => {
    vi.mocked(patternsService.extractPatterns).mockResolvedValue({
      data: {
        patterns: [],
        statistics: { total_logs_analyzed: 0 },
        is_partial: true,
        function_error: ["Query duration is modified due to query range restriction of 1 hours"],
      },
    } as never);

    await usePatterns(((k: string) => k) as never).extractPatterns("org", "s", {} as never);

    expect(patternsState.value.patterns?.is_partial).toBe(true);
    expect(patternsState.value.patterns?.function_error).toEqual([
      "Query duration is modified due to query range restriction of 1 hours",
    ]);
  });

  it("a superseded request that lands last does not replace the newer result", async () => {
    const { extractPatterns, cancelPatterns } = usePatterns(((k: string) => k) as never);
    const resolvers: Array<(v: unknown) => void> = [];
    vi.mocked(patternsService.extractPatterns).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)) as never,
    );
    const body = (tid: string) => ({
      data: { patterns: [{ template: tid, frequency: 1 }], statistics: { total_logs_analyzed: 1 } },
    });

    const first = extractPatterns("org", "s", { tid: "T1" } as never);
    cancelPatterns();
    const second = extractPatterns("org", "s", { tid: "T2" } as never);

    resolvers[1](body("T2"));
    await second;
    resolvers[0](body("T1"));
    await first;

    expect(patternsState.value.patterns?.patterns[0].template).toBe("T2");
  });

  it("a superseded request settling does not clear the newer request's abort controller", async () => {
    const { extractPatterns, cancelPatterns } = usePatterns(((k: string) => k) as never);
    const signals: AbortSignal[] = [];
    const rejecters: Array<(e: unknown) => void> = [];
    vi.mocked(patternsService.extractPatterns).mockImplementation(((args: {
      signal: AbortSignal;
    }) => {
      signals.push(args.signal);
      return new Promise((_, reject) => rejecters.push(reject));
    }) as never);

    const first = extractPatterns("org", "s", {} as never);
    cancelPatterns();
    const second = extractPatterns("org", "s", {} as never);
    rejecters[0]({ name: "CanceledError" });
    await first;

    cancelPatterns();
    expect(signals[1].aborted).toBe(true);
    rejecters[1]({ name: "CanceledError" });
    await second;
  });
});
