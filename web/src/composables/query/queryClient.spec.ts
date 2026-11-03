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

vi.mock("./persisters", () => ({
  purgeAllPersisted: vi.fn(),
  purgePersistedExceptOrg: vi.fn(),
  purgePersistedOrg: vi.fn(),
}));
vi.mock("@/composables/fieldValueStore", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("purgeOrgQueries on a stale deploy", () => {
  it("swallows a failed fieldValueStore chunk import", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { purgeOrgQueries } = await import("./queryClient");

    purgeOrgQueries("org-a", "org-b");
    await new Promise((resolve) => setTimeout(resolve, 50));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("a mutation's stales meta", () => {
  it("marks the scope stale without refetching a query that is in use", async () => {
    const { queryClient } = await import("./queryClient");
    const { QueryObserver } = await import("@tanstack/query-core");
    const fetches = vi.fn().mockResolvedValue(["row"]);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["stales-test", "list"],
      queryFn: fetches,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(fetches).toHaveBeenCalledTimes(1));

    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: async () => "ok",
        meta: { stales: [["stales-test"]] },
      })
      .execute(undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetches).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(["stales-test", "list"])?.isInvalidated).toBe(true);
    unsubscribe();
  });
});
