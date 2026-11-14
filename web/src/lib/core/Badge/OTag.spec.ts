// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTag from "./OTag.vue";
import OBadge from "./OBadge.vue";
import { BADGE_GROUPS } from "./badgeGroups";
import { raw } from "@/types/i18n";

const DOT_CLASS = "size-1.5";

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

  it("a status tone in a plain-mode group still gets a dot (never colour alone)", () => {
    const html = mount(OTag, { props: { type: "logLevel", value: "error" } }).html();
    expect(html.includes(DOT_CLASS)).toBe(true);
  });

  it("a neutral plain-mode value renders no dot", () => {
    const html = mount(OTag, { props: { type: "logLevel", value: "debug" } }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });

  it("manual neutral chip renders NO dot", () => {
    const html = mount(OTag, {
      props: { tone: "neutral" },
      slots: { default: "12" },
    }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });

  it("manual accent chip with a value but no type renders NO dot", () => {
    const html = mount(OTag, {
      props: { tone: "accent", value: "x" },
      slots: { default: "x" },
    }).html();
    expect(html.includes(DOT_CLASS)).toBe(false);
  });
});

describe("OTag look", () => {
  it("every chip has radius 4", () => {
    for (const props of [
      { type: "alertStatus", value: "active" },
      { type: "fieldType", value: "string" },
      { tone: "neutral" as const },
    ]) {
      expect(mount(OTag, { props }).classes()).toContain("rounded-chip");
    }
  });

  it("group-declared class is merged onto the chip (qualityStatus bare dot)", () => {
    const html = mount(OTag, { props: { type: "qualityStatus", value: "healthy" } }).html();
    expect(html.includes("!bg-transparent")).toBe(true);
  });

  it("a per-call tone wins over the registry", () => {
    const w = mount(OTag, { props: { type: "alertStatus", value: "active", tone: "neutral" } });
    expect(w.findComponent(OBadge).props("tone")).toBe("neutral");
  });

  it("mono is forwarded", () => {
    const w = mount(OTag, { props: { tone: "neutral", mono: true }, slots: { default: "v1" } });
    expect(w.classes()).toContain("font-mono");
  });

  it("renders the dash for an empty typed value", () => {
    const w = mount(OTag, { props: { type: "alertStatus", value: "" } });
    expect(w.text()).toBe("—");
  });
});

describe("OTag size", () => {
  it("typed and untyped chips both default to sm (20 px)", () => {
    const typed = mount(OTag, { props: { type: "userRole", value: "admin" } });
    const untyped = mount(OTag, { props: { value: "custom" }, slots: { default: "Custom" } });
    expect(typed.classes()).toContain("h-5");
    expect(untyped.classes()).toContain("h-5");
  });

  it("a registry md group renders 24 px", () => {
    const w = mount(OTag, { props: { type: "cliPreset", value: "kubectl" } });
    expect(w.classes()).toContain("h-control-xs");
  });
});

describe("OTag toggle", () => {
  it("renders a pressed toggle button and re-emits click", async () => {
    const w = mount(OTag, { props: { toggle: true, pressed: true, label: raw("Has alerts") } });
    expect(w.element.tagName).toBe("BUTTON");
    expect(w.attributes("aria-pressed")).toBe("true");
    await w.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
  });
});

describe("OTag removable", () => {
  // V5: the delete affordance used to be a bare <button> nested inside the tag
  // at the call site — not focus-styled, not sized, an unstyled tab stop.
  it("renders no remove control by default", () => {
    const w = mount(OTag, { props: { value: "prod" } });
    expect(w.find("[data-test='o2-badge-remove']").exists()).toBe(false);
  });

  it("renders a real button with an accessible name when removable", () => {
    const w = mount(OTag, { props: { value: "prod", removable: true } });
    const btn = w.find("[data-test='o2-badge-remove']");
    expect(btn.exists()).toBe(true);
    expect(btn.element.tagName).toBe("BUTTON");
    expect(btn.attributes("type")).toBe("button");
    expect(btn.attributes("aria-label")).toBeTruthy();
  });

  it("emits remove, not click", async () => {
    const w = mount(OTag, { props: { value: "prod", removable: true } });
    await w.find("[data-test='o2-badge-remove']").trigger("click");
    expect(w.emitted("remove")).toHaveLength(1);
    expect(w.emitted("click")).toBeUndefined();
  });

  it("does not also fire the chip's own click", async () => {
    const w = mount(OTag, { props: { value: "prod", removable: true, toggle: true } });
    await w.find("[data-test='o2-badge-remove']").trigger("click");
    expect(w.emitted("remove")).toHaveLength(1);
    expect(w.emitted("click")).toBeUndefined();
  });

  // A button inside a button is invalid markup browsers repair by hoisting the
  // inner one out of the chip.
  it("keeps a removable toggle chip a span, not a nested button", () => {
    const w = mount(OTag, { props: { value: "prod", removable: true, toggle: true } });
    // The ✕ is the ONLY button; the chip itself stays a span.
    expect(w.findAll("button")).toHaveLength(1);
    expect(w.find("button").attributes("data-test")).toBe("o2-badge-remove");
  });

  it("suppresses remove when disabled", async () => {
    const w = mount(OTag, { props: { value: "prod", removable: true, disabled: true } });
    await w.find("[data-test='o2-badge-remove']").trigger("click");
    expect(w.emitted("remove")).toBeUndefined();
  });

  it("takes a caller-supplied accessible name", () => {
    const w = mount(OTag, {
      props: { value: "prod", removable: true, removeLabel: raw("Remove prod") },
    });
    expect(w.find("[data-test='o2-badge-remove']").attributes("aria-label")).toBe("Remove prod");
  });
});
