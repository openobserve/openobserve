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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { queryOptions } from "@tanstack/vue-query";
import { fetchInto } from "./fetchInto";
import { queryClient } from "./queryClient";
import { orgKey } from "./keys";

const options = (fn: any, key = "list") =>
  queryOptions({ queryKey: orgKey("acme", "spec", key), queryFn: fn });

describe("fetchInto", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("applies the fetched value and resolves it", async () => {
    const apply = vi.fn();
    const data = await fetchInto(
      options(async () => ["a", "b"]),
      { apply },
    );

    expect(data).toEqual(["a", "b"]);
    expect(apply).toHaveBeenCalledWith(["a", "b"]);
  });

  it("paints the cached value before the request resolves", async () => {
    const key = orgKey("acme", "spec", "warm");
    queryClient.setQueryData(key, ["cached"]);

    const seen: unknown[] = [];
    await fetchInto(
      { ...queryOptions({ queryKey: key, queryFn: async () => ["fresh"] }), staleTime: 0 },
      { apply: (v) => seen.push(v), force: true },
    );

    // cached paint first, then the server's answer — the rows never blank out
    expect(seen).toEqual([["cached"], ["fresh"]]);
  });

  it("only raises `loading` for a cold read, but `fetching` for every read", async () => {
    const loading = ref(false);
    const fetching = ref(false);
    const key = orgKey("acme", "spec", "flags");

    let peakLoading = false;
    let peakFetching = false;
    const queryFn = async () => {
      peakLoading = loading.value;
      peakFetching = fetching.value;
      return ["x"];
    };

    // cold: nothing on screen yet, so the skeleton is allowed
    await fetchInto(
      { ...queryOptions({ queryKey: key, queryFn }), staleTime: 0 },
      {
        apply: () => {},
        loading,
        fetching,
      },
    );
    expect(peakLoading).toBe(true);
    expect(peakFetching).toBe(true);

    // warm: rows are already painted, so only the refresh spinner turns on
    await fetchInto(
      { ...queryOptions({ queryKey: key, queryFn }), staleTime: 0 },
      {
        apply: () => {},
        loading,
        fetching,
        force: true,
      },
    );
    expect(peakLoading).toBe(false);
    expect(peakFetching).toBe(true);
  });

  it("clears both flags when the request rejects", async () => {
    const loading = ref(false);
    const fetching = ref(false);

    await expect(
      fetchInto(
        {
          ...queryOptions({
            queryKey: orgKey("acme", "spec", "boom"),
            queryFn: async () => {
              throw new Error("nope");
            },
          }),
          retry: false,
        },
        { apply: () => {}, loading, fetching },
      ),
    ).rejects.toThrow("nope");

    expect(loading.value).toBe(false);
    expect(fetching.value).toBe(false);
  });

  it("serves a fresh entry without calling the endpoint again", async () => {
    const queryFn = vi.fn(async () => ["once"]);
    const opts = { ...options(queryFn, "shared"), staleTime: 60_000 };

    await fetchInto(opts, { apply: () => {} });
    await fetchInto(opts, { apply: () => {} });

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
