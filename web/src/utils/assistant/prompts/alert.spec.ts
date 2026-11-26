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

import { INJECTION, expectNoInjection, expectPromptRules } from "./__fixtures__/prompts";
import { alertInputOf, buildAlertPrompt, thresholdText, type AlertInput } from "./alert";

const input = (over: Partial<AlertInput> = {}): AlertInput => ({
  org: "default",
  alertId: "a1",
  name: "Checkout 5xx",
  stream: "default",
  condition: "SELECT count(*) AS c FROM default WHERE code >= 500",
  threshold: { op: ">", value: 50, unit: "events" },
  periodMinutes: 10,
  lastFiredAt: Date.UTC(2026, 9, 14, 13, 50, 0),
  destinations: 2,
  timeZone: "UTC",
  ...over,
});

describe("buildAlertPrompt", () => {
  it("pins the Troubleshoot wording; destinations are a count, never a URL", () => {
    const build = buildAlertPrompt(input(), "troubleshoot");
    expect(build.text).toBe(
      "Troubleshoot the alert in the attached Alert block: threshold > 50 events for 10 minutes, last fired 2026-10-14 13:50:00 UTC, destinations: 2. The block holds its name, stream and condition. Why did it fire and is the threshold right?",
    );
    expect(build.text).not.toMatch(/https?:/);
    expectPromptRules(build);
  });

  it("carries name, stream and condition in a serialised Alert chip (F3)", () => {
    const build = buildAlertPrompt(input(), "explain");
    expect(build.text).toMatch(/What does it watch, and is it set up to catch what matters\?$/);
    expect(build.chips[0]).toMatchObject({
      kind: "alert",
      label: "Alert · Checkout 5xx",
      sent: "serialized",
      ref: { type: "alert", id: "a1" },
      data: { name: "Checkout 5xx", stream: "default", condition: input().condition },
    });
    expect(build.title).toBe("Alert · Checkout 5xx");
  });

  it("says (unsaved) for an alert being created and labels it a new alert", () => {
    const build = buildAlertPrompt(input({ alertId: undefined, name: "" }), "explain");
    expect(build.text).toContain("in the attached Alert block (unsaved)");
    expect(build.chips[0].label).toBe("Alert · new alert");
  });

  it("omits absent facts and drops an unknown operator", () => {
    const build = buildAlertPrompt(
      { org: "default", alertId: "a1", name: "X", timeZone: "UTC" },
      "troubleshoot",
    );
    expect(build.text).toBe(
      "Troubleshoot the alert in the attached Alert block. The block holds its name, stream and condition. Why did it fire and is the threshold right?",
    );
    expect(thresholdText({ op: "Contains", value: 1 })).toBeNull();
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildAlertPrompt(
      input({
        name: INJECTION,
        stream: INJECTION,
        condition: INJECTION,
        threshold: { op: INJECTION, value: 1, unit: INJECTION },
      }),
      "troubleshoot",
    );
    expectNoInjection(build);
  });

  it("maps a server alert, with the period in minutes and only the destination count", () => {
    expect(
      alertInputOf(
        {
          alert_id: "a1",
          name: "n",
          trigger_condition: { period: 5, operator: ">", threshold: 3 },
          destination: ["https://hooks.example/x"],
        },
        { org: "o", timeZone: "UTC" },
      ),
    ).toMatchObject({ alertId: "a1", periodMinutes: 5, destinations: 1 });
  });
});
