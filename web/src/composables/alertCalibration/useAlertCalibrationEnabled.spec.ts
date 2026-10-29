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
import { isAlertCalibrationOff } from "./useAlertCalibrationEnabled";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

describe("whether a page leaves because alert calibration is off", () => {
  it("waits for /config, then leaves when the deployment flag is off or absent", () => {
    expect(isAlertCalibrationOff(undefined)).toBe(false);
    expect(isAlertCalibrationOff({})).toBe(false);
    expect(isAlertCalibrationOff({ version: "v1", alert_calibration_enabled: false })).toBe(true);
    expect(isAlertCalibrationOff({ version: "v1" })).toBe(true);
    expect(isAlertCalibrationOff({ version: "v1", alert_calibration_enabled: true })).toBe(false);
  });

  it("stays on a license-locked page, which renders locked, but leaves a hidden one", () => {
    const off = { version: "v1", alert_calibration_enabled: false };
    expect(isAlertCalibrationOff({ ...off, features: { alerts: "locked" } })).toBe(false);
    expect(isAlertCalibrationOff({ ...off, features: { alerts: "hidden" } })).toBe(true);
  });
});
