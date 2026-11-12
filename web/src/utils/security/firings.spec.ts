// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { evidenceSummary, evidenceValueField } from "./firings";
import type { NormalizedEvent } from "./ocsf";

const OKTA_TRAVEL_SQL =
  'SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY "client_geographicalcontext_country" ORDER BY "_timestamp" DESC) AS "zo_rn" FROM "okta_auth") WHERE "zo_rn" = 1';

const event = (over: Partial<NormalizedEvent>): NormalizedEvent =>
  ({
    actor: "",
    srcIp: "",
    activity: "",
    operation: "",
    message: "",
    raw: {},
    ...over,
  }) as NormalizedEvent;

describe("evidenceValueField", () => {
  it("reads the counted column from a value-count rule's evidence SQL", () => {
    expect(evidenceValueField(OKTA_TRAVEL_SQL)).toBe("client_geographicalcontext_country");
  });

  it("is null for a plain row query", () => {
    expect(
      evidenceValueField('SELECT * FROM "azure_signin" ORDER BY "_timestamp" DESC'),
    ).toBeNull();
    expect(evidenceValueField(undefined)).toBeNull();
  });
});

describe("evidenceSummary", () => {
  const signIn = event({
    actor: "opal@acme.io",
    srcIp: "102.129.143.20",
    activity: "user.session.start",
    message: "User login to Okta",
    raw: { client_geographicalcontext_country: "Nigeria" },
  });

  it("names the country an impossible-travel row contributed", () => {
    expect(evidenceSummary(signIn, "client_geographicalcontext_country")).toBe(
      "opal@acme.io · Nigeria · 102.129.143.20 · user.session.start · User login to Okta",
    );
  });

  it("leaves the counted value out when the rule counts nothing", () => {
    expect(evidenceSummary(signIn)).toBe(
      "opal@acme.io · 102.129.143.20 · user.session.start · User login to Okta",
    );
  });

  it("says a repeated value once", () => {
    const row = event({
      actor: "bob@acme.io",
      activity: "user.session.start",
      message: "user.session.start",
    });
    expect(evidenceSummary(row)).toBe("bob@acme.io · user.session.start");
  });
});
