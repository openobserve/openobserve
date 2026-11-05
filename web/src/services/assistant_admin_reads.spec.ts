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

import { belowUsageOf } from "./assistant_billing.queries";
import { grantsChat } from "./assistant_roles.queries";

const rejection = (status: number, data: unknown) => ({ response: { status, data } });

describe("assistant billing and role reads", () => {
  it("reads the typed below-usage refusal, flat or in the error envelope", () => {
    expect(belowUsageOf(rejection(409, { code: "below_usage", used: 125, limit: 100 }))).toEqual({
      used: 125,
      limit: 100,
    });
    expect(
      belowUsageOf(rejection(409, { error: { code: "below_usage", used: 9, limit: 1 } })),
    ).toEqual({ used: 9, limit: 1 });
    expect(belowUsageOf(rejection(409, { code: "conflict" }))).toBeNull();
    expect(belowUsageOf(rejection(400, { code: "below_usage", used: 1, limit: 0 }))).toBeNull();
    expect(belowUsageOf(new Error("offline"))).toBeNull();
  });

  it("counts chat only for a PUT or AllowAll on the assistant module", () => {
    expect(grantsChat([{ object: "ai:_all_default", permission: "AllowPut" }])).toBe(true);
    expect(grantsChat([{ object: "ai:_all_default", permission: "AllowAll" }])).toBe(true);
    expect(grantsChat([{ object: "ai:_all_default", permission: "AllowGet" }])).toBe(false);
    expect(grantsChat([{ object: "alert:x", permission: "AllowPut" }])).toBe(false);
    expect(grantsChat("nope")).toBe(false);
  });
});
