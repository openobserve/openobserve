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

import { afterEach, describe, expect, it } from "vitest";

import config from "@/aws-exports";
import { hasDeliveryTarget } from "./deliveryTarget";

describe("hasDeliveryTarget", () => {
  const original = { isEnterprise: config.isEnterprise, isCloud: config.isCloud };
  afterEach(() => {
    config.isEnterprise = original.isEnterprise;
    config.isCloud = original.isCloud;
  });
  const build = (isEnterprise: string, isCloud: string) => {
    config.isEnterprise = isEnterprise;
    config.isCloud = isCloud;
  };

  it.each([
    ["nothing", {}],
    ["empty lists", { destinations: [], workflows: [] }],
    ["null lists", { destinations: null, workflows: null }],
    ["a blank on-call team", { oncall_team: "  " }],
  ])("is false for %s", (_case, alert) => {
    build("true", "false");
    expect(hasDeliveryTarget(alert)).toBe(false);
  });

  it("is true for a destination in every build", () => {
    build("false", "false");
    expect(hasDeliveryTarget({ destinations: ["slack"] })).toBe(true);
  });

  // Like the backend: only enterprise and cloud builds run workflows or page on-call teams.
  it.each([
    ["a workflow", { workflows: ["wf-1"] }],
    ["an on-call team", { oncall_team: "sre" }],
  ])("counts %s only in enterprise and cloud builds", (_case, alert) => {
    build("false", "false");
    expect(hasDeliveryTarget(alert)).toBe(false);
    build("true", "false");
    expect(hasDeliveryTarget(alert)).toBe(true);
    build("false", "true");
    expect(hasDeliveryTarget(alert)).toBe(true);
  });
});
