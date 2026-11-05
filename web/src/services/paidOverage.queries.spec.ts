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

import { QueryClient } from "@tanstack/vue-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("./paidOverage", () => ({ default: api }));

import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

import { paidOverageQuery, setPaidOverageMutation } from "./paidOverage.queries";
import { paidOverageKeys } from "./paidOverage.querykeys";

describe("paidOverage queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the org's status under its own key on the live tier", async () => {
    api.get.mockResolvedValue({ data: { effective: true } });
    const options = paidOverageQuery("org1", "ai_credits");
    expect(options.queryKey).toEqual(paidOverageKeys.status("org1", "ai_credits"));
    expect(options.staleTime).toBe(LIVE_STALE_TIME);
    await expect(new QueryClient().fetchQuery(options)).resolves.toEqual({ effective: true });
    expect(api.get).toHaveBeenCalledWith("org1", "ai_credits");
  });

  it("never asks without an org", () => {
    expect(paidOverageQuery("", "ai_credits").enabled).toBe(false);
  });

  it("writes through a mutation that invalidates every read of that org", async () => {
    api.update.mockResolvedValue({ data: { effective: true } });
    const options = setPaidOverageMutation("org1", "ai_credits");
    expect(options.meta?.invalidates).toEqual([paidOverageKeys.all("org1")]);
    await expect((options.mutationFn as (v: boolean) => Promise<unknown>)(true)).resolves.toEqual({
      effective: true,
    });
    expect(api.update).toHaveBeenCalledWith("org1", "ai_credits", true);
  });
});
