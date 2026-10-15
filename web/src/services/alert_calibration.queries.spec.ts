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
import { alertCalibrationConfigQuery } from "./alert_calibration.queries";

vi.mock("./alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alert_calibration")>();
  return { ...actual, default: { ...actual.default, getConfig: vi.fn() } };
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
