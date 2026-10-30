// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  ALERT_FIND_ENTRIES,
  isTieredSetting,
  matchScore,
  searchAlertSettings,
  type AlertFindId,
} from "./alertSettingFind";
import { ALERT_SETTING_TIERS } from "./alertSettingTiers";

const t = i18n.global.t as unknown as TranslateFn;
const all = () => true;
const top = (query: string, available: (id: AlertFindId) => boolean = all) =>
  searchAlertSettings(query, t, available)[0]?.entry.id;
const ids = (query: string) => searchAlertSettings(query, t, all).map((m) => m.entry.id);

describe("ALERT_FIND_ENTRIES", () => {
  it("lists every control once, with a label, a group and a target", () => {
    const list = ALERT_FIND_ENTRIES.map((e) => e.id);
    expect(new Set(list).size).toBe(list.length);
    for (const e of ALERT_FIND_ENTRIES) {
      expect(t(e.labelKey)).not.toBe(e.labelKey);
      expect(t(e.groupKey)).not.toBe(e.groupKey);
      expect(e.targets.length).toBeGreaterThan(0);
    }
  });

  it("covers every tiered setting with the same section and tier", () => {
    for (const def of ALERT_SETTING_TIERS) {
      const entry = ALERT_FIND_ENTRIES.find((e) => e.id === def.id);
      expect(entry, def.id).toBeDefined();
      expect([entry?.section, entry?.tier]).toEqual([def.section, def.tier]);
      expect(isTieredSetting(def.id)).toBe(true);
    }
    expect(isTieredSetting("cron")).toBe(false);
  });
});

describe("matchScore", () => {
  it("ranks exact over prefix over word start over substring over scattered words", () => {
    expect(matchScore("Skip duplicates", "skip duplicates")).toBe(100);
    expect(matchScore("Skip duplicates", "skip")).toBe(80);
    expect(matchScore("Skip duplicates", "dup")).toBe(60);
    expect(matchScore("Skip duplicates", "plic")).toBe(40);
    expect(matchScore("Look back over", "look over")).toBe(30);
    expect(matchScore("Look back over", "zzz")).toBe(0);
  });

  it("ignores case and punctuation", () => {
    expect(matchScore("On-call team", "on call")).toBe(80);
    expect(matchScore("At most once every", "  AT MOST ")).toBe(80);
  });
});

describe("searchAlertSettings", () => {
  it("returns nothing for blank text", () => {
    expect(searchAlertSettings("   ", t, all)).toEqual([]);
  });

  it.each([
    ["dedup", "dedup"],
    ["deduplication", "dedup"],
    ["cooldown", "cooldown"],
    ["silence", "cooldown"],
    ["critical", "threshold"],
    ["lookback", "lookBack"],
    ["period", "lookBack"],
    ["cron", "cron"],
    ["timezone", "timezone"],
    ["vrl", "vrl"],
    ["compare", "compareWithPast"],
    ["template", "template"],
    ["row template", "rowTemplate"],
    ["variables", "variables"],
    ["incident", "createsIncident"],
    ["recovery", "recovery"],
    ["priority", "priority"],
    ["tags", "tags"],
    ["folder", "folder"],
    ["group by", "groupBy"],
    ["multi", "groupBy"],
    ["frequency", "checkEvery"],
    ["oncall", "oncall"],
  ])("finds %s by its old or visible name", (query, id) => {
    expect(top(query)).toBe(id);
  });

  it("matches the visible label too", () => {
    expect(top("skip dup")).toBe("dedup");
    expect(top("at most once")).toBe("cooldown");
  });

  it("puts a label match ahead of an equal alias match", () => {
    const found = ids("template");
    expect(found.indexOf("template")).toBeLessThan(found.indexOf("rowTemplate"));
    expect(found).toContain("rowTemplate");
  });

  it("lists a setting's own controls right after it", () => {
    expect(ids("dedup").slice(0, 3)).toEqual(["dedup", "dedupFields", "dedupWindow"]);
    expect(top("identical within")).toBe("dedupWindow");
  });

  it("gates a control by the setting that shows it", () => {
    const found = searchAlertSettings("dedup", t, (id) => id !== "dedup").map((m) => m.entry.id);
    expect(found).toEqual([]);
  });

  it("leaves out settings that do not apply", () => {
    expect(top("dedup", (id) => id !== "dedup")).toBeUndefined();
    expect(ids("cron")).toContain("cron");
    expect(
      searchAlertSettings("cron", t, (id) => id !== "cron").map((m) => m.entry.id),
    ).not.toContain("cron");
  });
});
