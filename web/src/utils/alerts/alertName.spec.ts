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
import { savedAlertName, unusedAlertName } from "./alertName";

describe("savedAlertName", () => {
  it.each([
    ["cpu_high", "cpu_high"],
    ["  http 5xx error rate > 5% per service ", "http_5xx_error_rate_>_5_per_service"],
    ["a: b/c & 'd'", "a_b_c_d"],
    ["_rundata errors", "_rundata_errors"],
    ["%%%", ""],
  ])("%j saves as %j", (typed, saved) => {
    expect(savedAlertName(typed)).toBe(saved);
  });
});

describe("unusedAlertName", () => {
  it.each([
    ["default_alert", [], "default_alert"],
    ["default_alert", ["default_alert"], "default_alert_2"],
    ["default_alert", ["default_alert", "default_alert_2"], "default_alert_3"],
    ["", ["x"], ""],
  ])("%j beside %j is %j", (name, taken, expected) => {
    expect(unusedAlertName(name, new Set(taken))).toBe(expected);
  });
});
