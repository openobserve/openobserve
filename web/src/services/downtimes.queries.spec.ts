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
import downtimes from "./downtimes";
import type { DowntimeDetail, DowntimeListItem } from "./downtimes";
import {
  downtimesListQuery,
  downtimesLookupQuery,
  sendDowntimeTestMutation,
} from "./downtimes.queries";

vi.mock("./downtimes", () => ({ default: { list: vi.fn(), test: vi.fn() } }));

const COUNTS = { active: 1, scheduled: 2, recurring: 3, ended: 4, cancelled: 5, ended_early: 6 };
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `dt-${i}` }) as DowntimeListItem);

const run = async (query: typeof downtimesListQuery, total: number, shown: number) => {
  vi.mocked(downtimes.list).mockResolvedValue({
    data: { items: items(shown), total, counts: COUNTS },
  } as never);
  const options = query("acme");
  return (options.queryFn as () => Promise<any>)();
};

describe("the downtime list queries", () => {
  it("flag a response that holds fewer rows than the org", async () => {
    const result = await run(downtimesListQuery, 600, 500);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(600);
    expect(result.counts).toEqual(COUNTS);
    expect((await run(downtimesLookupQuery, 600, 500)).truncated).toBe(true);
  });

  it("do not flag a response that holds the whole org", async () => {
    expect((await run(downtimesListQuery, 500, 500)).truncated).toBe(false);
    expect((await run(downtimesListQuery, 3, 3)).truncated).toBe(false);
  });
});

describe("the downtime test send", () => {
  const downtime = { id: "dt-1", folder_id: "f1" } as unknown as DowntimeDetail;
  const send = (names: string[]) =>
    (sendDowntimeTestMutation("acme").mutationFn as (v: unknown) => Promise<any>)({
      downtime,
      destinations: names.map((name) => ({ name })),
      url: "https://o2",
    });

  beforeEach(() => {
    vi.mocked(downtimes.test).mockReset();
  });

  it("asks the server to send through the live path and returns its results", async () => {
    const results = [
      { destination: "hook", ok: true },
      { destination: "pd", ok: false, unsupported: true, error: "platform_not_for_kind" },
    ];
    vi.mocked(downtimes.test).mockResolvedValue({ data: results } as never);
    expect(await send(["hook", "pd"])).toEqual(results);
    expect(downtimes.test).toHaveBeenCalledWith("acme", "dt-1", ["hook", "pd"], "f1");
  });

  it("marks every destination failed when the request fails", async () => {
    vi.mocked(downtimes.test).mockImplementation(async () => {
      throw { response: { data: { message: "boom" } } };
    });
    expect(await send(["hook"])).toEqual([{ destination: "hook", ok: false, error: "boom" }]);
  });
});
