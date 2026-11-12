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
import alertCalibration, { errorMessage } from "./alert_calibration";
import { activeDismissalsQuery, alertCalibrationConfigQuery } from "./alert_calibration.queries";

vi.mock("./alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alert_calibration")>();
  return {
    ...actual,
    default: { ...actual.default, getConfig: vi.fn(), listDismissals: vi.fn() },
  };
});

const read = () => (alertCalibrationConfigQuery("acme").queryFn as () => Promise<unknown>)();
const httpError = (status: number, data: unknown) =>
  Object.assign(new Error("Request failed"), { response: { status, data } });

describe("the alert calibration config query", () => {
  it("reads an org with no config row as null rather than as a failure", async () => {
    vi.mocked(alertCalibration.getConfig).mockRejectedValue(
      httpError(404, { code: 404, message: "none" }),
    );
    await expect(read()).resolves.toBeNull();
  });

  it("still fails on any other error", async () => {
    vi.mocked(alertCalibration.getConfig).mockRejectedValue(
      httpError(500, { code: 500, message: "db down" }),
    );
    await expect(read()).rejects.toThrow("Request failed");
  });
});

describe("errorMessage", () => {
  it("prefers the server's message, including the plain text a refused body gets", () => {
    expect(errorMessage(httpError(400, { code: 400, message: "out of range" }))).toBe(
      "out of range",
    );
    expect(errorMessage(httpError(422, "unknown field `enabledd`"))).toBe(
      "unknown field `enabledd`",
    );
    expect(errorMessage(new Error("Network Error"))).toBe("Network Error");
  });
});

describe("the active dismissals query", () => {
  const readAll = () =>
    (
      activeDismissalsQuery("acme").queryFn as unknown as (ctx: {
        signal: AbortSignal;
      }) => Promise<{ items: { id: string }[]; total: number; capped: boolean }>
    )({ signal: new AbortController().signal });
  const pageOf = (n: number, total: number, next: string | null) => ({
    data: { items: [{ id: `id${n}` }], next_cursor: next, total },
  });

  it("the_state_query_pages_to_the_cap", async () => {
    const list = vi.mocked(alertCalibration.listDismissals);
    list.mockReset();
    list
      .mockResolvedValueOnce(pageOf(1, 3, "c1") as never)
      .mockResolvedValueOnce(pageOf(2, 99, "c2") as never)
      .mockResolvedValueOnce(pageOf(3, 99, null) as never);
    await expect(readAll()).resolves.toEqual({
      items: [{ id: "id1" }, { id: "id2" }, { id: "id3" }],
      total: 3,
      capped: false,
    });
    expect(list.mock.calls.map((call) => call[1])).toEqual([
      { state: "active", limit: 200 },
      { state: "active", limit: 200, cursor: "c1" },
      { state: "active", limit: 200, cursor: "c2" },
    ]);

    list.mockReset();
    for (let n = 1; n <= 7; n += 1) list.mockResolvedValueOnce(pageOf(n, 1400, `c${n}`) as never);
    const capped = await readAll();
    expect(list).toHaveBeenCalledTimes(5);
    expect(capped.capped).toBe(true);
    expect(capped.total).toBe(1400);
    expect(capped.items).toHaveLength(5);
  });
});
