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

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import config from "@/aws-exports";
import { preselectDestination, type PreselectInput } from "./preselectDestination";

const input = (overrides: Partial<PreselectInput> = {}): PreselectInput => ({
  isNew: true,
  alert: {},
  orgDestinations: [],
  defaultDestination: null,
  smtpEnabled: true,
  userEmail: "priya@example.com",
  ...overrides,
});

describe("preselectDestination", () => {
  const original = { isEnterprise: config.isEnterprise, isCloud: config.isCloud };
  beforeEach(() => {
    config.isEnterprise = "true";
    config.isCloud = "false";
  });
  afterEach(() => {
    config.isEnterprise = original.isEnterprise;
    config.isCloud = original.isCloud;
  });

  describe("org default destination", () => {
    it("picks the org default when it still exists", () => {
      expect(
        preselectDestination(
          input({ orgDestinations: ["oncall-slack"], defaultDestination: "oncall-slack" }),
        ),
      ).toEqual({ kind: "orgDefault", destination: "oncall-slack" });
    });

    it("picks the default even when SMTP is off, since it need not be email", () => {
      expect(
        preselectDestination(
          input({ orgDestinations: ["hook"], defaultDestination: "hook", smtpEnabled: false }),
        ),
      ).toEqual({ kind: "orgDefault", destination: "hook" });
    });

    it.each([
      ["a default the org no longer has", "deleted-dest"],
      ["a blank default", "  "],
      ["no default", null],
      ["an undefined default", undefined],
    ])("treats %s as unset and falls through to Email me", (_case, defaultDestination) => {
      expect(preselectDestination(input({ defaultDestination }))).toEqual({ kind: "emailMe" });
    });

    it("treats a dangling default as unset in an org that has other destinations", () => {
      expect(
        preselectDestination(input({ orgDestinations: ["slack"], defaultDestination: "gone" })),
      ).toEqual({ kind: "none" });
    });
  });

  describe("Email me", () => {
    it("is picked for a new alert in an org with no destinations and SMTP on", () => {
      expect(preselectDestination(input())).toEqual({ kind: "emailMe" });
    });

    it("stays offered while SMTP is unknown (an older node omits the flag)", () => {
      expect(preselectDestination(input({ smtpEnabled: undefined }))).toEqual({ kind: "emailMe" });
    });

    it("is not picked when SMTP is off", () => {
      expect(preselectDestination(input({ smtpEnabled: false }))).toEqual({ kind: "none" });
    });

    it("is not picked when the org already has destinations", () => {
      expect(preselectDestination(input({ orgDestinations: ["team-slack"] }))).toEqual({
        kind: "none",
      });
    });

    it.each([
      ["no signed-in email", undefined],
      ["a blank email", " "],
    ])("is not picked with %s", (_case, userEmail) => {
      expect(preselectDestination(input({ userEmail }))).toEqual({ kind: "none" });
    });
  });

  describe("routes already set", () => {
    it.each([
      ["a destination", { destinations: ["slack"] }],
      ["a workflow", { workflows: ["wf-1"] }],
      ["an on-call team", { oncall_team: "sre" }],
      ["an incident", { creates_incident: true }],
    ])("adds nothing to an alert that already has %s", (_case, alert) => {
      expect(preselectDestination(input({ alert }))).toEqual({ kind: "none" });
      expect(
        preselectDestination(input({ alert, orgDestinations: ["d"], defaultDestination: "d" })),
      ).toEqual({ kind: "none" });
    });

    it("ignores workflow and on-call fields in OSS, where they deliver nothing", () => {
      config.isEnterprise = "false";
      expect(
        preselectDestination(input({ alert: { workflows: ["wf-1"], oncall_team: "sre" } })),
      ).toEqual({ kind: "emailMe" });
    });
  });

  describe("editing", () => {
    it("never adds a recipient to an alert being edited", () => {
      expect(preselectDestination(input({ isNew: false }))).toEqual({ kind: "none" });
      expect(
        preselectDestination(
          input({ isNew: false, orgDestinations: ["d"], defaultDestination: "d" }),
        ),
      ).toEqual({ kind: "none" });
    });
  });
});
