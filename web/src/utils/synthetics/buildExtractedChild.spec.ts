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
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import { raw } from "@/types/i18n";
import { buildCreateBrowserTestPayload } from "./buildPayload";
import {
  buildExtractedChildCheck,
  seedChildName,
  splitVariablesForChild,
  type ExtractedChildInput,
} from "./buildExtractedChild";

const range: BrowserStep[] = [
  {
    id: "s2",
    action: "navigate",
    name: "Open login",
    value: "https://app.test/login",
    wire: { id: "s2", action: "navigate", url: "https://app.test/login" },
  },
  {
    id: "s3",
    action: "type",
    name: "Email",
    value: "{{USER}}",
    locator: { candidates: [{ kind: "css", value: "#email" }] },
    wire: { id: "s3", action: "type", selector: "#email", value: "{{USER}}" },
  },
  {
    id: "s4",
    action: "type",
    name: "Password",
    value: "{{PASSWORD}}",
    locator: { candidates: [{ kind: "css", value: "#password" }] },
  },
];

function parent(overrides: Partial<BrowserCheck> = {}): BrowserCheck {
  return {
    id: "parent-1",
    name: "Checkout",
    url: "https://app.test",
    description: raw("The parent's description"),
    enabled: true,
    folder: "folder-1",
    tags: ["shop"],
    journey: [
      { id: "s1", action: "navigate", name: "Open shop", value: "https://app.test" },
      ...range,
      {
        id: "s5",
        action: "click",
        name: "Cart",
        locator: { candidates: [{ kind: "css", value: "#cart" }] },
      },
    ],
    schedule: { type: "interval", intervalValue: 15, intervalUnit: "minutes" },
    locations: ["us-east", "eu-west"],
    retries: 2,
    waitBeforeRetrySecs: 10,
    alertIfFails: 3,
    cooldownMins: 7,
    tz_offset: 330,
    browserDevices: [{ browser: "firefox", device: "mobile" }],
    notifications: { destinations: ["pagerduty"] },
    rum: { collect: true, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
    auth: { type: "basic", username: "u", password: "p" },
    cookies: [{ name: "sid", value: "1", domain: "app.test" }],
    headers: [{ key: "X-Env", value: "test" }],
    variables: [
      { name: "USER", value: "alice", example: "someone" },
      { name: "PASSWORD", value: "", secure: true },
      { name: "UNUSED", value: "x" },
    ],
    secrets: [{ name: "API_KEY", value: "k" }],
    ...overrides,
  };
}

function input(overrides: Partial<ExtractedChildInput> = {}): ExtractedChildInput {
  const p = parent();
  // Locations and schedule differ from the parent's so the input, not the parent, is what gets copied.
  return {
    parent: p,
    range,
    name: "Checkout — Open login",
    folder: "folder-2",
    locations: ["eu-west"],
    schedule: { type: "interval", intervalValue: 30, intervalUnit: "minutes" },
    ...overrides,
  };
}

describe("buildExtractedChildCheck", () => {
  it("builds one POST-shaped payload with enabled false and none of the parent's private config", () => {
    const payload = buildCreateBrowserTestPayload(buildExtractedChildCheck(input()));

    expect(payload).toMatchObject({
      type: "browser",
      name: "Checkout — Open login",
      enabled: false,
      target: "https://app.test/login",
      folder_id: "folder-2",
      locations: ["eu-west"],
      tags: [],
      retries: 2,
      wait_before_retry_secs: 10,
      alert_if_fails: 3,
      cooldown_mins: 7,
      destinations: ["pagerduty"],
      frequency: { type: "minutes", interval: 30 },
    });
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("auth");
    expect(payload).not.toHaveProperty("cookies");
    expect(payload).not.toHaveProperty("id");
    const config = payload.config as Record<string, unknown>;
    expect(config).not.toHaveProperty("secrets");
    expect(config).not.toHaveProperty("headers");
    expect(config.browser_devices).toEqual([{ browser: "firefox", device: "mobile" }]);
  });

  it("gives every copied step a fresh id", () => {
    const child = buildExtractedChildCheck(input());
    const ids = child.journey.map((s) => s.id);

    expect(child.journey).toHaveLength(range.length);
    expect(child.journey.map((s) => s.action)).toEqual(["navigate", "type", "type"]);
    expect(new Set(ids).size).toBe(range.length);
    for (const id of ids) expect(range.map((s) => s.id)).not.toContain(id);
  });

  it("drops the recorded wire step from every copied step", () => {
    const child = buildExtractedChildCheck(input());

    for (const step of child.journey) expect(step.wire).toBeUndefined();
  });

  it("starts now even when the parent was scheduled for a past date", () => {
    const before = Date.now();
    const schedule: BrowserCheck["schedule"] = {
      type: "interval",
      intervalValue: 15,
      intervalUnit: "minutes",
      startType: "later",
      startDate: "2020-01-01",
      startTime: "09:00",
      timezone: "UTC",
    };
    const original = { ...schedule };
    const payload = buildCreateBrowserTestPayload(buildExtractedChildCheck(input({ schedule })));

    // `start` is microseconds, truncated to the minute the payload was built in.
    expect(payload.start).toBeGreaterThanOrEqual((before - 60_000) * 1000);
    expect(payload.start).toBeLessThanOrEqual(Date.now() * 1000);
    // The host hands over the live form's schedule by reference; it must not be mutated.
    expect(schedule).toEqual(original);
  });

  it("does not copy a secure variable and lists it to define", () => {
    const split = splitVariablesForChild(parent(), range);
    const child = buildExtractedChildCheck(input());

    expect(split.toDefine).toContain("PASSWORD");
    expect(split.copied).not.toContain("PASSWORD");
    expect(child.variables?.map((v) => v.name)).not.toContain("PASSWORD");
  });

  it("lists a secret the range uses to define", () => {
    const secretRange: BrowserStep[] = [
      range[0],
      {
        id: "s9",
        action: "type",
        name: "Key",
        value: "{{API_KEY}}",
        locator: { candidates: [{ kind: "css", value: "#key" }] },
      },
    ];
    const split = splitVariablesForChild(parent(), secretRange);
    const child = buildExtractedChildCheck(input({ range: secretRange }));

    expect(split.toDefine).toEqual(["API_KEY"]);
    expect(split.copied).toEqual([]);
    expect(child.variables).toEqual([]);
    expect(child.secrets).toBeUndefined();
  });

  it("copies a plain variable the range uses, with its value", () => {
    // `{{USER}}` twice in the range: copied once, not per occurrence.
    const repeated: BrowserStep[] = [
      ...range,
      {
        id: "s6",
        action: "type",
        name: "Email again",
        value: "{{USER}}",
        locator: { candidates: [{ kind: "css", value: "#email2" }] },
      },
    ];
    const split = splitVariablesForChild(parent(), repeated);
    const child = buildExtractedChildCheck(input({ range: repeated }));

    expect(split.copied).toEqual(["USER"]);
    expect(child.variables).toEqual([
      { name: "USER", value: "alice", secure: false, example: "someone" },
    ]);
  });

  it("leaves journey_budget_ms out of the created payload", () => {
    // Guards against spreading the parent: nothing outside the field table may leak into the child.
    const withBudget = { ...parent(), journey_budget_ms: 120_000 } as BrowserCheck;
    const payload = buildCreateBrowserTestPayload(
      buildExtractedChildCheck(input({ parent: withBudget })),
    );

    expect(payload).not.toHaveProperty("journey_budget_ms");
  });

  it("uses the new-check rum and capture defaults, not the parent's", () => {
    const child = buildExtractedChildCheck(
      input({
        parent: parent({
          rum: { collect: false, sessionReplay: true },
          capture: { screenshot: "always", trace: "off" },
        }),
      }),
    );

    expect(child.rum).toEqual({ collect: true, sessionReplay: false });
    expect(child.capture).toEqual({ screenshot: "on-fail", trace: "on-fail" });
  });

  it("keeps optional and alwaysRun on the copied steps through to the payload", () => {
    const flagged: BrowserStep[] = [
      { ...range[0], optional: true },
      { ...range[1], alwaysRun: true },
    ];
    const config = buildCreateBrowserTestPayload(
      buildExtractedChildCheck(input({ range: flagged })),
    ).config as { steps: Record<string, unknown>[] };

    expect(config.steps[0].optional).toBe(true);
    expect(config.steps[0]).not.toHaveProperty("always_run");
    expect(config.steps[1].always_run).toBe(true);
    expect(config.steps[1]).not.toHaveProperty("optional");
  });
});

describe("seedChildName", () => {
  it("joins the parent and step names, or uses the step name alone", () => {
    expect(seedChildName("Checkout", "Open login")).toBe("Checkout — Open login");
    expect(seedChildName("", "Open login")).toBe("Open login");
    expect(seedChildName("   ", "Open login")).toBe("Open login");
  });

  it("truncates a 300-byte seed to at most 256 bytes without splitting a character", () => {
    // "€" is three bytes, so byte 256 falls mid-character.
    const seed = seedChildName("", "€".repeat(100));
    const bytes = new TextEncoder().encode(seed);

    expect(bytes.length).toBe(255);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(seed);
    expect(seed).toBe("€".repeat(85));
    // ASCII fills the limit exactly, so the cap is 256 and not one short of it.
    expect(seedChildName("", "a".repeat(300))).toBe("a".repeat(256));
  });
});
