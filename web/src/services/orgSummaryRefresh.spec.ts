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

import { queryClient } from "@/composables/query/queryClient";
import { organizationKeys } from "./organizations.querykeys";
import { refreshOrgSummarySoon } from "./orgSummaryRefresh";

describe("refreshOrgSummarySoon", () => {
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    invalidate.mockRestore();
  });

  const summaryCalls = (org: string) =>
    invalidate.mock.calls.filter(
      ([filters]: any[]) =>
        JSON.stringify(filters?.queryKey) === JSON.stringify(organizationKeys.summary(org)),
    ).length;

  it("marks the summary stale once for a burst of creates", () => {
    for (let i = 0; i < 10; i += 1) {
      refreshOrgSummarySoon("burst");
      vi.advanceTimersByTime(300);
    }
    expect(summaryCalls("burst")).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(summaryCalls("burst")).toBe(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: organizationKeys.summary("burst"),
      exact: true,
    });
  });

  it("keeps orgs apart", () => {
    refreshOrgSummarySoon("a");
    refreshOrgSummarySoon("b");
    vi.advanceTimersByTime(1_000);
    expect(summaryCalls("a")).toBe(1);
    expect(summaryCalls("b")).toBe(1);
  });
});
