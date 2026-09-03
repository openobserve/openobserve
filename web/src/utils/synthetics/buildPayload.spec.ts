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
import type { BrowserCheck, BrowserStep, ProtocolCheck } from "@/types/synthetics";
import {
  buildCreateBrowserTestPayload,
  buildCreateProtocolCheckPayload,
  mapResponseToBrowserCheck,
} from "./buildPayload";

function journey(): BrowserStep[] {
  return [
    { id: "s1", action: "navigate", name: "Open", value: "https://app.test" },
    {
      id: "s2",
      action: "click",
      name: "Sign in",
      locator: { candidates: [{ kind: "test_attribute", value: '[data-test="login-sign-in"]' }] },
    },
  ];
}

function check(overrides: Partial<BrowserCheck> = {}): BrowserCheck {
  return {
    name: "Cloud login",
    url: "https://app.test",
    enabled: true,
    tags: [],
    journey: journey(),
    schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    locations: ["us-east"],
    notifications: { destinations: [] },
    rum: { collect: true, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
    ...overrides,
  };
}

describe("buildCreateBrowserTestPayload", () => {
  // `steps_version` existed to say which of two step formats the array was in.
  // There is only one format now, so sending the key at all would be rejected
  // as an unknown field.
  it("sends no steps_version key", () => {
    const config = buildCreateBrowserTestPayload(check()).config as Record<string, unknown>;

    expect("steps_version" in config).toBe(false);
  });

  it("builds every step through the version-2 writer", () => {
    const config = buildCreateBrowserTestPayload(check()).config as Record<string, unknown>;
    const steps = config.steps as Record<string, unknown>[];

    expect(steps.map((s) => s.action)).toEqual(["navigate", "click"]);
    expect(steps[1].locator).toEqual({
      candidates: [{ kind: "test_attribute", value: '[data-test="login-sign-in"]' }],
    });
    // The version-1 fields the editor used to carry never reach the wire.
    expect(steps[1]).not.toHaveProperty("selector");
    expect(steps[1]).not.toHaveProperty("selector_type");
    expect(steps[1]).not.toHaveProperty("code");
  });

  // The save gate rejects these before the payload is built. The throw is the
  // second line of defence, so that a gate that ever stops agreeing with the
  // writer fails loudly here instead of posting a step the server refuses.
  it("throws rather than emitting a step it cannot build", () => {
    // `wait`, not `hover`: hover became storable when Playwright 1.56 added it to
    // the recorder model. scroll, wait and screenshot still have no counterpart.
    const withRetired = check({
      journey: [...journey(), { id: "s3", action: "wait", name: "Pause" }],
    });

    expect(() => buildCreateBrowserTestPayload(withRetired)).toThrow(/cannot be stored/);
  });
});

describe("environments round-trip", () => {
  // CheckEnvironments edits this list; if either direction drops the field,
  // a save silently unpins the check from its environments.
  it("carries environments through the browser payload", () => {
    const payload = buildCreateBrowserTestPayload(check({ environments: ["env-1"] }));

    expect(payload.environments).toEqual(["env-1"]);
  });

  it("carries environments through the protocol payload", () => {
    const protocolCheck = {
      ...check({ environments: ["env-1"] }),
      checkType: "tcp",
      tcp: { port: 443, timeout_ms: 10000, response_contains: "" },
    } as unknown as ProtocolCheck;

    expect(buildCreateProtocolCheckPayload(protocolCheck).environments).toEqual(["env-1"]);
  });

  it("reads environments back off the wire", () => {
    const mapped = mapResponseToBrowserCheck({
      name: "Cloud login",
      target: "https://app.test",
      environments: ["env-1"],
      config: { steps: [] },
    });

    expect(mapped.environments).toEqual(["env-1"]);
  });
});
