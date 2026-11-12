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
import {
  isReservedIngestionTokenName,
  isSystemIngestionToken,
  pickableIngestionTokens,
} from "./ingestionTokens";

describe("isSystemIngestionToken", () => {
  it("is true only for a reserved name the server created", () => {
    expect(isSystemIngestionToken({ name: "_o2_x", created_by: "system" })).toBe(true);
    expect(isSystemIngestionToken({ name: "_o2_alert_calibration", created_by: "system" })).toBe(
      true,
    );
  });

  it("is false for a reserved name a user created", () => {
    expect(isSystemIngestionToken({ name: "_o2_x", created_by: "admin@demo-org" })).toBe(false);
    expect(isSystemIngestionToken({ name: "_o2_x" })).toBe(false);
  });

  it("is false for the server-made default token", () => {
    expect(isSystemIngestionToken({ name: "default", created_by: "system" })).toBe(false);
  });

  it("is false for a name that only contains the prefix", () => {
    expect(isSystemIngestionToken({ name: "o2_ci", created_by: "system" })).toBe(false);
  });
});

describe("isReservedIngestionTokenName", () => {
  it("matches every _o2_ name and nothing else", () => {
    expect(isReservedIngestionTokenName("_o2_alert_calibration")).toBe(true);
    expect(isReservedIngestionTokenName("_o2_old")).toBe(true);
    expect(isReservedIngestionTokenName("default")).toBe(false);
    expect(isReservedIngestionTokenName("o2_ci")).toBe(false);
    expect(isReservedIngestionTokenName(undefined)).toBe(false);
  });
});

describe("pickableIngestionTokens", () => {
  it("drops every _o2_ token, system or user-made, and keeps the rest in order", () => {
    const tokens = [
      { name: "default", created_by: "system" },
      { name: "_o2_alert_calibration", created_by: "system" },
      { name: "ci-collector", created_by: "admin@demo-org" },
      { name: "_o2_old", created_by: "admin@demo-org" },
      { name: "o2_ci", created_by: "admin@demo-org" },
    ];
    expect(pickableIngestionTokens(tokens).map((t) => t.name)).toEqual([
      "default",
      "ci-collector",
      "o2_ci",
    ]);
  });

  it("returns an empty list for an empty list", () => {
    expect(pickableIngestionTokens([])).toEqual([]);
  });
});
