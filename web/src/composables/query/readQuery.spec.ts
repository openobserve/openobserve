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
import { queryOptions } from "@tanstack/vue-query";
import { readQuery } from "./readQuery";
import { queryClient } from "./queryClient";
import { orgKey } from "./keys";
import { NORMAL_STALE_TIME } from "./cachePolicy";

const list = (fn: () => Promise<string[]>) =>
  queryOptions({
    queryKey: orgKey("acme", "spec", "read"),
    queryFn: fn,
    staleTime: NORMAL_STALE_TIME,
  });

describe("readQuery", () => {
  beforeEach(() => queryClient.clear());

  it("answers a fresh entry from the cache without a second request", async () => {
    const fn = vi.fn(async () => ["a"]);
    await readQuery(list(fn));
    expect(await readQuery(list(fn))).toEqual(["a"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("asks again, once, when forced", async () => {
    const fn = vi.fn().mockResolvedValueOnce(["a"]).mockResolvedValueOnce(["b"]);
    await readQuery(list(fn));
    expect(await readQuery(list(fn), true)).toEqual(["b"]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
