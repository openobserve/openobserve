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

// Schema-level spec for the config-driven prebuilt credential rules.
// PrebuiltDestinationForm is now a presentational DESCENDANT (no own form); the
// credential validation + toggle round-trip live entirely in these pure schema
// helpers, which the PARENT AddDestination form composes. Testing them directly
// keeps that coverage robust and mount-free.

import { describe, expect, it } from "vitest";
import {
  makePrebuiltDestinationSchema,
  prebuiltDestinationDefaults,
} from "@/components/alerts/PrebuiltDestinationForm.schema";
import { generateDestinationUrl } from "@/utils/prebuilt-templates";

// Passthrough translator — the tests assert validity/paths, not message copy.
const t = (key: string, named?: Record<string, unknown>): string =>
  named ? `${key} ${JSON.stringify(named)}` : key;

const VALID_SLACK = "https://hooks.slack.com/services/T000/B000/xxxxxxxx";
const US_OPSGENIE_URL = "https://api.opsgenie.com/v2/alerts";
const EU_OPSGENIE_URL = "https://api.eu.opsgenie.com/v2/alerts";
const OPSGENIE_KEY = "x".repeat(40);

describe("prebuilt credential schema - required + per-type validators", () => {
  it("slack: empty webhookUrl fails at the webhookUrl path", () => {
    const res = makePrebuiltDestinationSchema(t, "slack").safeParse({
      webhookUrl: "",
      channel: "",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === "webhookUrl")).toBe(true);
    }
  });

  it("slack: a valid webhook passes", () => {
    const res = makePrebuiltDestinationSchema(t, "slack").safeParse({
      webhookUrl: VALID_SLACK,
      channel: "#alerts",
    });
    expect(res.success).toBe(true);
  });

  it("slack: a non-slack URL is rejected by the per-type validator", () => {
    const res = makePrebuiltDestinationSchema(t, "slack").safeParse({
      webhookUrl: "https://example.com/not-slack",
      channel: "",
    });
    expect(res.success).toBe(false);
  });

  it("pagerduty: requires a 32-char integration key + severity", () => {
    expect(
      makePrebuiltDestinationSchema(t, "pagerduty").safeParse({
        integrationKey: "short",
        severity: "critical",
      }).success,
    ).toBe(false);

    expect(
      makePrebuiltDestinationSchema(t, "pagerduty").safeParse({
        integrationKey: "a".repeat(32),
        severity: "critical",
      }).success,
    ).toBe(true);
  });

  it("email: requires recipients", () => {
    expect(makePrebuiltDestinationSchema(t, "email").safeParse({ recipients: "" }).success).toBe(
      false,
    );
    expect(
      makePrebuiltDestinationSchema(t, "email").safeParse({
        recipients: "user@example.com",
      }).success,
    ).toBe(true);
  });

  it("opsgenie: optional priority/euRegion do not block a valid apiKey", () => {
    const res = makePrebuiltDestinationSchema(t, "opsgenie").safeParse({
      apiKey: OPSGENIE_KEY,
    });
    expect(res.success).toBe(true);
  });
});

// ── Toggle round-trip through STRING metadata ───────────────────────────────
// Credentials persist into destination metadata via String(v), so an edit-load
// hands a toggle back as the STRING "true"/"false", never a boolean. Two hazards:
//   1. A bare z.boolean() would REJECT the string → the (now parent) form could
//      not save → the destination is permanently unsaveable (Rule ④ break).
//   2. Leaving the string "false" in the value reads TRUTHY at generateDestinationUrl
//      → a US Opsgenie instance is misrouted to the EU endpoint.
describe("prebuilt credential defaults - euRegion string round-trip", () => {
  it.each([
    ["false", false],
    ["true", true],
    [false, false],
    [true, true],
  ])("seeds stored euRegion=%o as the boolean %o", (stored: any, expected) => {
    const seeded = prebuiltDestinationDefaults("opsgenie", {
      apiKey: OPSGENIE_KEY,
      euRegion: stored,
    });
    expect(seeded.euRegion).toBe(expected);
    expect(typeof seeded.euRegion).toBe("boolean");
  });

  it("non-toggle fields are coerced to strings", () => {
    const seeded = prebuiltDestinationDefaults("pagerduty", {
      integrationKey: 12345,
    });
    expect(seeded.integrationKey).toBe("12345");
  });

  it("only the active type's fields are present (no stale cross-type keys)", () => {
    const seeded = prebuiltDestinationDefaults("slack", {
      webhookUrl: VALID_SLACK,
      apiKey: "leaked-from-another-type",
    });
    expect(seeded).toHaveProperty("webhookUrl", VALID_SLACK);
    expect(seeded).not.toHaveProperty("apiKey");
  });

  it("the schema accepts the STRING toggle an edit-load provides", () => {
    const res = makePrebuiltDestinationSchema(t, "opsgenie").safeParse({
      apiKey: OPSGENIE_KEY,
      euRegion: "false",
    });
    expect(res.success).toBe(true);
  });

  // END-TO-END routing proof: the defaults the parent seeds feed
  // generateDestinationUrl, whose euRegion read is TRUTHY — a leaked string
  // "false" would send a US instance to the EU endpoint.
  it.each([
    ["false", US_OPSGENIE_URL],
    [false, US_OPSGENIE_URL],
    ["true", EU_OPSGENIE_URL],
    [true, EU_OPSGENIE_URL],
  ])("stored euRegion=%o routes to %s", (stored: any, expectedUrl) => {
    const seeded = prebuiltDestinationDefaults("opsgenie", {
      apiKey: OPSGENIE_KEY,
      euRegion: stored,
    });
    expect(generateDestinationUrl("opsgenie", seeded)).toBe(expectedUrl);
  });
});
