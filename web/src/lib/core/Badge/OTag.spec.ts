// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTag from "./OTag.vue";
import { BADGE_GROUPS } from "./badgeGroups";

const DOT_CLASS = "size-1.75";

const DOT_SAMPLES: Record<string, string> = {
  alertStatus: "active",
  incidentStatus: "open",
  severity: "critical",
  invoiceStatus: "paid",
  evalStatus: "active",
  queryStatus: "running",
  serviceStatus: "healthy",
  anomalyStatus: "ready",
  deletionStatus: "completed",
  licenseStatus: "active",
  spanStatus: "OK",
  frustrationSeverity: "high",
  cardinalityClass: "high",
  evalRunStatus: "success",
  qualityStatus: "healthy",
  billingGroupMemberStatus: "active",
  booleanState: "yes",
};

describe("OTag dot rendering", () => {
  for (const [group, cfg] of Object.entries(BADGE_GROUPS)) {
    if ((cfg as any).mode !== "dot") continue;
    const sample = DOT_SAMPLES[group] ?? Object.keys((cfg as any).values)[0];
    it(`${group} ("${sample}") renders the leading dot`, () => {
      const html = mount(OTag, { props: { type: group, value: sample } }).html();
      expect(html.includes(DOT_CLASS), `${group} lost its dot`).toBe(true);
    });
  }

  it("explicit :dot=false suppresses the dot (code-badge use)", () => {
    const html = mount(OTag, {
      props: { type: "spanStatus", value: "OK", dot: false },
    }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });

  it("plain-mode group renders no dot", () => {
    const html = mount(OTag, { props: { type: "logLevel", value: "error" } }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });

  it("manual badge (no type) renders NO dot", () => {
    const html = mount(OTag, {
      props: { variant: "default-soft" },
      slots: { default: "12" },
    }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });

  it("manual badge with a value but no type renders NO dot", () => {
    const html = mount(OTag, {
      props: { variant: "primary-soft", value: "x" },
      slots: { default: "x" },
    }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });
});

describe("OTag shape", () => {
  it("status group is pill (rounded-full)", () => {
    const html = mount(OTag, { props: { type: "alertStatus", value: "active" } }).html();
    expect(html.includes("rounded-full")).toBe(true);
  });
  it("group declaring shape 'pill' renders rounded-full", () => {
    const html = mount(OTag, { props: { type: "alertStatus", value: "active" } }).html();
    expect(html.includes("rounded-full")).toBe(true);
  });
  it("fieldType (dtype chip) renders rounded, matching the wildcard pattern chip", () => {
    const html = mount(OTag, { props: { type: "fieldType", value: "string" } }).html();
    expect(html.includes("rounded-default")).toBe(true);
  });
  it("groups that opt into rounded render rounded-default", () => {
    const html = mount(OTag, { props: { type: "logsResultChip", value: "neutral" } }).html();
    expect(html.includes("rounded-default")).toBe(true);
  });
  it("group-declared class is merged onto the badge (qualityStatus naked dot)", () => {
    const html = mount(OTag, { props: { type: "qualityStatus", value: "healthy" } }).html();
    expect(html.includes("!bg-transparent")).toBe(true);
  });
  it("manual badge defaults to pill", () => {
    const html = mount(OTag, {
      props: { variant: "default-soft" },
      slots: { default: "5" },
    }).html();
    expect(html.includes("rounded-full")).toBe(true);
  });
});

describe("OTag size", () => {
  it("typed and untyped badges both default to sm (matching height)", () => {
    const typed = mount(OTag, { props: { type: "userRole", value: "admin" } }).html();
    const untyped = mount(OTag, {
      props: { value: "custom" },
      slots: { default: "Custom" },
    }).html();
    expect(typed.includes("py-1.5")).toBe(true);
    expect(untyped.includes("py-1.5")).toBe(true);
    expect(typed.includes("py-2")).toBe(false);
    expect(untyped.includes("py-2")).toBe(false);
  });
});
