// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import { raw, type TranslateFn } from "@/types/i18n";
import {
  ALERT_SETTING_TIERS,
  isTierVisible,
  moreLinkLabel,
  sectionTierView,
  type AlertSettingId,
  type AlertTierState,
} from "./alertSettingTiers";
import { useAlertSettingTiers } from "@/composables/alerts/useAlertSettingTiers";

const t = i18n.global.t as unknown as TranslateFn;

const state = (over: Partial<AlertTierState> = {}): AlertTierState => ({
  available: () => true,
  isSet: () => false,
  revealed: new Set<AlertSettingId>(),
  expanded: () => false,
  ...over,
});

describe("ALERT_SETTING_TIERS", () => {
  it("tiers every setting once, from the usage study", () => {
    const ids = ALERT_SETTING_TIERS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const count = (tier: string) => ALERT_SETTING_TIERS.filter((d) => d.tier === tier).length;
    expect([count("shown"), count("one"), count("tucked")]).toEqual([3, 3, 10]);
  });

  it("puts every one-click setting in a labelled row", () => {
    for (const d of ALERT_SETTING_TIERS.filter((x) => x.tier === "one")) {
      expect(d.row).toBeDefined();
    }
  });
});

describe("sectionTierView", () => {
  it("names the condition section's tucked settings and has no add links", () => {
    const view = sectionTierView("condition", state());
    expect(view.addLinks).toEqual([]);
    expect(view.tucked.map((d) => d.id)).toEqual([
      "warning",
      "holdFor",
      "groupBy",
      "compareWithPast",
    ]);
  });

  it("drops a set tucked setting from the count, and unavailable ones", () => {
    const view = sectionTierView(
      "condition",
      state({
        isSet: (id) => id === "compareWithPast",
        available: (id) => id !== "groupBy",
      }),
    );
    expect(view.tucked.map((d) => d.id)).toEqual(["warning", "holdFor"]);
  });

  it("offers one-click links in the notify section until added or set", () => {
    const revealed = new Set<AlertSettingId>(["template"]);
    const view = sectionTierView(
      "notify",
      state({ revealed, isSet: (id) => id === "createsIncident" }),
    );
    expect(view.addLinks.map((d) => d.id)).toEqual(["variables"]);
    expect(view.tucked.map((d) => d.id)).toEqual(["recovery", "oncall", "dedup", "keepFiring"]);
  });
});

describe("isTierVisible", () => {
  it("always shows a shown setting and hides an unset tucked one", () => {
    expect(isTierVisible("destinations", state())).toBe(true);
    expect(isTierVisible("priority", state())).toBe(false);
    expect(isTierVisible("template", state())).toBe(false);
  });

  it("shows a tucked setting with a non-default value", () => {
    expect(isTierVisible("compareWithPast", state({ isSet: () => true }))).toBe(true);
  });

  it("shows tucked settings while their section is expanded", () => {
    const s = state({ expanded: (section) => section === "details" });
    expect(isTierVisible("priority", s)).toBe(true);
    expect(isTierVisible("recovery", s)).toBe(false);
  });

  it("does not expand a tucked setting that does not apply here", () => {
    const s = state({ expanded: () => true, available: (id) => id !== "compareWithPast" });
    expect(isTierVisible("compareWithPast", s)).toBe(false);
    expect(isTierVisible("warning", s)).toBe(true);
  });

  it("shows a one-click setting once added, and never via expand", () => {
    expect(isTierVisible("template", state({ expanded: () => true }))).toBe(false);
    expect(isTierVisible("template", state({ revealed: new Set(["template"]) }))).toBe(true);
  });
});

describe("moreLinkLabel", () => {
  it("lists every name up to five", () => {
    const names = ["warning", "hold for", "group by", "compare with past"].map(raw);
    expect(moreLinkLabel(names, t)).toBe("4 more: warning, hold for, group by, compare with past");
  });

  it("past five, names the first three and counts the rest", () => {
    const names = ["a", "b", "c", "d", "e", "f"].map(raw);
    expect(moreLinkLabel(names, t)).toBe("6 more: a, b, c and 3 more");
  });
});

describe("useAlertSettingTiers", () => {
  it("expands and collapses a section in place", () => {
    const tiers = useAlertSettingTiers({ available: () => true, isSet: () => false });
    expect(tiers.isVisible("tags")).toBe(false);
    tiers.toggle("details");
    expect(tiers.view("details").expanded).toBe(true);
    expect(tiers.isVisible("tags")).toBe(true);
    tiers.toggle("details");
    expect(tiers.isVisible("tags")).toBe(false);
  });

  it("keeps an added one-click setting in place", () => {
    const tiers = useAlertSettingTiers({ available: () => true, isSet: () => false });
    tiers.reveal("variables");
    expect(tiers.isVisible("variables")).toBe(true);
    expect(tiers.view("notify").addLinks.map((d) => d.id)).toEqual(["createsIncident", "template"]);
  });
});
