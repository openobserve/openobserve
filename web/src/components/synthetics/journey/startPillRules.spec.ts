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
import type { SyntheticsEnvironment } from "@/types/synthetics";
import { atEnvironmentCap, lockedEnvironmentIds, toggleEnvironment } from "./startPillRules";

const env = (id: string): SyntheticsEnvironment => ({
  id,
  name: id,
  description: "",
  is_global: false,
  created_at: 0,
  updated_at: 0,
  checks_count: 0,
  variables: [],
});

describe("toggleEnvironment", () => {
  it("adds an environment that is not selected", () => {
    expect(toggleEnvironment(["prod"], "stg")).toEqual(["prod", "stg"]);
  });

  it("removes an environment that is selected", () => {
    expect(toggleEnvironment(["prod", "stg"], "prod")).toEqual(["stg"]);
  });
});

describe("atEnvironmentCap", () => {
  it("is false below 5 environments", () => {
    expect(atEnvironmentCap(["a", "b", "c", "d"])).toBe(false);
  });

  it("is true at 5 environments", () => {
    expect(atEnvironmentCap(["a", "b", "c", "d", "e"])).toBe(true);
  });
});

describe("lockedEnvironmentIds", () => {
  it("returns the selected ids missing from the readable list", () => {
    expect(lockedEnvironmentIds(["prod", "eu-prod", "stg"], [env("prod"), env("stg")])).toEqual([
      "eu-prod",
    ]);
  });

  it("is empty when every selected environment is readable", () => {
    expect(lockedEnvironmentIds(["prod"], [env("prod"), env("stg")])).toEqual([]);
  });
});
