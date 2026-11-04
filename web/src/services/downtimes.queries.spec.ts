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
import downtimes from "./downtimes";
import type { DowntimeDetail, DowntimeListItem } from "./downtimes";
import destination from "./alert_destination";
import {
  downtimesListQuery,
  downtimesLookupQuery,
  sendDowntimeTestMutation,
} from "./downtimes.queries";

vi.mock("./downtimes", () => ({ default: { list: vi.fn() } }));
vi.mock("./alert_destination", () => ({ default: { test: vi.fn(), testSend: vi.fn() } }));

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
  const downtime = {
    name: "Nightly",
    schedule: { starts_at: 1, ends_at: 2 },
    targets: [],
  } as unknown as DowntimeDetail;
  const send = (dest: Record<string, unknown>) =>
    (sendDowntimeTestMutation("acme").mutationFn as (v: unknown) => Promise<any>)({
      downtime,
      destinations: [dest],
      url: "https://o2",
    });

  it("asks the server to render o2_default for a destination without a downtime template", async () => {
    vi.mocked(destination.testSend).mockResolvedValue({ data: { success: true } } as never);
    const [result] = await send({ name: "ops-slack", type: "http", url: "https://hook" });
    expect(destination.testSend).toHaveBeenCalledWith({
      org_identifier: "acme",
      destination_name: "ops-slack",
      data: { template_name: "o2_default", kind: "downtime" },
    });
    expect(destination.test).not.toHaveBeenCalled();
    expect(result).toEqual({ destination: "ops-slack", ok: true, error: undefined });
  });

  it("sends the destination's own template by name through the server", async () => {
    vi.mocked(destination.testSend).mockClear();
    vi.mocked(destination.testSend).mockResolvedValue({
      data: { success: false, message: "bad gateway" },
    } as never);
    const [result] = await send({
      name: "hook",
      type: "http",
      url: "https://hook",
      template: "mine",
    });
    expect(destination.testSend).toHaveBeenCalledWith({
      org_identifier: "acme",
      destination_name: "hook",
      data: { template_name: "mine", kind: "downtime" },
    });
    expect(destination.test).not.toHaveBeenCalled();
    expect(result).toEqual({ destination: "hook", ok: false, error: "bad gateway" });
  });
});
