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

import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "./fleet.queries";

describe("fetchAllPages", () => {
  it("reads every page until the list ends, so an org past one page is complete", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => i);
    const fetchPage = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
      items: rows.slice(offset, offset + limit),
      total: rows.length,
    }));
    expect(await fetchAllPages(fetchPage, 3)).toEqual(rows);
    expect(fetchPage.mock.calls.map(([p]) => p.offset)).toEqual([0, 3, 6]);
  });

  it("stops on a short page even when the server sends no total", async () => {
    const fetchPage = vi.fn(async ({ offset }: { offset: number }) => ({
      items: offset === 0 ? [1, 2] : [],
    }));
    expect(await fetchAllPages(fetchPage, 2)).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed page", async () => {
    await expect(fetchAllPages(async () => undefined)).rejects.toThrow("Malformed fleet list");
  });
});
