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
  featureLockedPath,
  featureState,
  forbiddenState,
  licenseDeniedFeatures,
  menuState,
} from "./featureGate";

const forbidden = (data: Record<string, unknown>) => ({ response: { status: 403, data } });

describe("featureState", () => {
  it("treats a key the backend did not send as enabled", () => {
    expect(featureState(undefined, "workflows")).toBe("enabled");
    expect(featureState({}, "workflows")).toBe("enabled");
    expect(featureState({ oncall: "locked" }, "workflows")).toBe("enabled");
  });

  it("returns each state the backend sent", () => {
    const features = { workflows: "enabled", oncall: "locked", incidents: "hidden" } as const;
    expect(featureState(features, "workflows")).toBe("enabled");
    expect(featureState(features, "oncall")).toBe("locked");
    expect(featureState(features, "incidents")).toBe("hidden");
  });
});

describe("menuState", () => {
  it("keeps locked and hidden whatever the runtime flag says", () => {
    expect(menuState({ oncall: "locked" }, "oncall", false)).toBe("locked");
    expect(menuState({ oncall: "hidden" }, "oncall", true)).toBe("hidden");
  });

  it("hides an enabled feature whose runtime flag is off, as older backends expect", () => {
    expect(menuState(undefined, "oncall", true)).toBe("enabled");
    expect(menuState(undefined, "oncall", false)).toBe("hidden");
    expect(menuState({ oncall: "enabled" }, "oncall", false)).toBe("hidden");
  });
});

describe("featureLockedPath", () => {
  it("points at the shared upsell route", () => {
    expect(featureLockedPath("ai_assistant")).toBe("/feature-locked/ai_assistant");
  });
});

describe("licenseDeniedFeatures", () => {
  it("returns the missing keys of a 403 with code 40001", () => {
    expect(
      licenseDeniedFeatures(forbidden({ code: 40001, error_detail: "oncall, workflows" })),
    ).toEqual(["oncall", "workflows"]);
    expect(licenseDeniedFeatures(forbidden({ code: 40001, error_detail: "incidents" }))).toEqual([
      "incidents",
    ]);
  });

  it("still flags a denial whose detail is missing", () => {
    expect(licenseDeniedFeatures(forbidden({ code: 40001 }))).toEqual([]);
  });

  it("ignores RBAC 403s and other statuses", () => {
    expect(licenseDeniedFeatures(forbidden({}))).toBeNull();
    expect(
      licenseDeniedFeatures(forbidden({ code: 403, message: "Unauthorized Access" })),
    ).toBeNull();
    expect(
      licenseDeniedFeatures({
        response: { status: 400, data: { code: 40001, error_detail: "x" } },
      }),
    ).toBeNull();
    expect(licenseDeniedFeatures(undefined)).toBeNull();
  });
});

describe("forbiddenState", () => {
  it("returns the missing keys for a license 403, true for an RBAC 403, false otherwise", () => {
    expect(forbiddenState(forbidden({ code: 40001, error_detail: "dashboards" }))).toEqual([
      "dashboards",
    ]);
    expect(forbiddenState(forbidden({ code: 403, message: "Unauthorized Access" }))).toBe(true);
    expect(forbiddenState({ response: { status: 500, data: {} } })).toBe(false);
    expect(forbiddenState(undefined)).toBe(false);
  });
});
