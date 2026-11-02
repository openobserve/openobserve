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
import { QueryClient } from "@tanstack/vue-query";
import autoobserve from "./autoobserve";
import { autoobserveSuggestionsPageQuery } from "./autoobserve.queries";
import { RAIL_CAP } from "@/components/autoobserve/live/liveCopy";

vi.mock("./autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn() },
}));

const suggestions = vi.mocked(autoobserve.suggestions);

describe("autoobserveSuggestionsPageQuery (OSS-11)", () => {
  beforeEach(() => {
    suggestions.mockReset();
    suggestions.mockResolvedValue({
      data: { suggestions: [], total: 3000, limit: RAIL_CAP, offset: 0 },
    } as never);
  });

  it("asks for one ranked page of proposed suggestions, however many there are", async () => {
    const client = new QueryClient();
    const page = await client.fetchQuery(autoobserveSuggestionsPageQuery("acme", RAIL_CAP, 0));
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveBeenCalledWith("acme", {
      status: "proposed",
      sort: "priority",
      limit: RAIL_CAP,
      offset: 0,
    });
    expect(page.total).toBe(3000);
  });

  it("keys each page apart, so paging the drawer never reuses another page", () => {
    const first = autoobserveSuggestionsPageQuery("acme", 25, 0).queryKey;
    const second = autoobserveSuggestionsPageQuery("acme", 25, 25).queryKey;
    expect(first).not.toEqual(second);
    expect(autoobserveSuggestionsPageQuery("acme", RAIL_CAP, 0).queryKey).not.toEqual(first);
  });
});
