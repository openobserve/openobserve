// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  evidenceFallbackFields,
  evidenceKeyFields,
  evidenceSummary,
  evidenceValueField,
} from "./firings";
import type { NormalizedEvent } from "./ocsf";

const OKTA_TRAVEL_SQL =
  'SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY "client_geographicalcontext_country" ORDER BY "_timestamp" DESC) AS "zo_rn" FROM "okta_auth") WHERE "zo_rn" = 1';

const event = (over: Partial<NormalizedEvent>): NormalizedEvent =>
  ({
    actor: "",
    srcIp: "",
    srcPort: "",
    dstIp: "",
    dstPort: "",
    host: "",
    process: "",
    resource: "",
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

describe("evidenceKeyFields", () => {
  it("lays out a mapped row as actor, counted value, src, dst, action and object", () => {
    const row = event({
      actor: "opal@acme.io",
      srcIp: "102.129.143.20",
      dstIp: "10.0.0.5",
      dstPort: "443",
      activity: "user.session.start",
      resource: "okta",
      raw: { client_geographicalcontext_country: "Nigeria" },
    });
    expect(
      evidenceKeyFields(row, "client_geographicalcontext_country").map((f) => [f.key, f.value]),
    ).toEqual([
      ["actor", "opal@acme.io"],
      ["counted", "Nigeria"],
      ["src", "102.129.143.20"],
      ["dst", "10.0.0.5:443"],
      ["action", "user.session.start"],
      ["object", "okta"],
    ]);
  });

  it("reads an unmapped vendor row by its column names", () => {
    const row = event({
      raw: {
        _timestamp: 1,
        userPrincipalName: "dave@acme.io",
        ipAddress: "185.220.101.47",
        ResultType: "50126",
        appDisplayName: "Office 365",
      },
    });
    expect(evidenceKeyFields(row).map((f) => [f.key, f.column, f.value])).toEqual([
      ["actor", "userPrincipalName", "dave@acme.io"],
      ["src", "ipAddress", "185.220.101.47"],
      ["action", "ResultType", "50126"],
    ]);
  });

  it("falls back to the first populated columns when nothing is recognised", () => {
    expect(
      evidenceFallbackFields({ _timestamp: 1, zo_rn: 1, a: "x", b: "", c: { d: 1 }, e: 2 }),
    ).toEqual([
      { column: "a", value: "x" },
      { column: "e", value: "2" },
    ]);
  });
});
