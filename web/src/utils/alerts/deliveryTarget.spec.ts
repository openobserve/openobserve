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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  hasDeliveryTarget,
  incidentReachGap,
  reachesSomeone,
  unreachableLine,
} from "./deliveryTarget";

const original = { isEnterprise: config.isEnterprise, isCloud: config.isCloud };
afterEach(() => {
  config.isEnterprise = original.isEnterprise;
  config.isCloud = original.isCloud;
});
const build = (isEnterprise: string, isCloud: string) => {
  config.isEnterprise = isEnterprise;
  config.isCloud = isCloud;
};

describe("hasDeliveryTarget", () => {
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

describe("incidentReachGap / reachesSomeone (AutoObserve is the destination)", () => {
  const t = i18n.global.t as unknown as TranslateFn;
  const on = { incidents_enabled: true, oncall_enabled: true };

  it("finds no gap when incidents and on-call are both on in an enterprise build", () => {
    build("true", "false");
    expect(incidentReachGap(on)).toBeNull();
  });

  it.each([
    [{ incidents_enabled: false, oncall_enabled: true }, "incidents"],
    [{ incidents_enabled: true, oncall_enabled: false }, "oncall"],
    [{}, "both"],
  ] as const)("names what is off: %o -> %s", (zo, gap) => {
    build("true", "false");
    expect(incidentReachGap(zo)).toBe(gap);
  });

  it("an OSS build never pages through incidents", () => {
    build("false", "false");
    expect(incidentReachGap(on)).toBe("both");
  });

  it("an incident-creating alert with no destination reaches someone only while incidents page on-call", () => {
    build("true", "false");
    expect(reachesSomeone({ destinations: [], creates_incident: true }, on)).toBe(true);
    expect(reachesSomeone({ destinations: [], creates_incident: false }, on)).toBe(false);
    expect(
      reachesSomeone({ destinations: [], creates_incident: true }, { incidents_enabled: true }),
    ).toBe(false);
    expect(reachesSomeone({ destinations: ["ops"], creates_incident: false }, {})).toBe(true);
  });

  it("an org with no on-call team pages no one, even with both switches on (F1)", () => {
    build("true", "false");
    const noTeam = { ...on, incidents_page_oncall: false };
    expect(incidentReachGap(noTeam)).toBe("noTeam");
    expect(incidentReachGap({ ...on, incidents_page_oncall: true })).toBeNull();
    expect(reachesSomeone({ destinations: [], creates_incident: true }, noTeam)).toBe(false);
    expect(reachesSomeone({ destinations: ["ops"], creates_incident: true }, noTeam)).toBe(true);
    expect(unreachableLine(t, "noTeam", 1)).toBe(
      "Choose a destination for this alert, or set up on-call. This organization has no on-call team, so its incident pages no one.",
    );
    expect(unreachableLine(t, "noTeam", 3)).toBe(
      "Choose a destination for these 3 alerts, or set up on-call. This organization has no on-call team, so their incidents page no one.",
    );
  });

  it("says what is missing, in one sentence per situation, for one and for many", () => {
    expect(unreachableLine(t, "incidents", 1)).toBe(
      "Choose a destination for this alert. Incidents are off in this organization, so an alert with no destination reaches no one.",
    );
    expect(unreachableLine(t, "both", 3)).toBe(
      "Choose a destination for these 3 alerts. Incidents and on-call are off in this organization, so an alert with no destination reaches no one.",
    );
    expect(unreachableLine(t, "oncall", 2)).toContain("On-call is off in this organization");
    expect(unreachableLine(t, null, 1)).toBe(
      "Choose a destination for this alert, or turn on Creates Incident. With neither, it reaches no one.",
    );
  });
});
