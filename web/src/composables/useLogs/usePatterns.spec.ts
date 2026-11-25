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
});
