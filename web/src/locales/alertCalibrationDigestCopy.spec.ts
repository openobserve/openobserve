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

import { describe, expect, it } from "vitest";
import enMessages from "@/locales/languages/en-US.json";

const resolveKey = (key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      enMessages,
    );

describe("alert calibration digest copy", () => {
  it("calibration copy never names the digest stream", () => {
    for (const key of ["alertCalibration.runRequested", "alertCalibration.detail.noRecords"]) {
      const copy = resolveKey(key);
      expect(typeof copy, key).toBe("string");
      expect(copy as string, key).not.toMatch(/\{stream\}|_o2_/);
    }
    expect(resolveKey("alertCalibration.detail.viewInLogs")).toBeUndefined();
    expect(resolveKey("alertCalibration.detail.viewInLogsHint")).toBeUndefined();
    for (const key of [
      "queryError.protectedStream",
      "queryError.protectedStreamDesc",
      "queryError.openCalibration",
      "queryError.openCalibrationDesc",
      "message.SearchStreamProtected",
    ]) {
      const copy = resolveKey(key);
      expect(typeof copy, key).toBe("string");
      expect(copy as string, key).not.toMatch(/_o2_|\{stream\}/);
    }
  });
});
