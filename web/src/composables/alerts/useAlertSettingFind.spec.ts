// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick, reactive } from "vue";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { AlertSectionId } from "@/components/alerts/alertFormSections";
import type { AlertSettingId } from "@/components/alerts/alertSettingTiers";
import type { AlertSettingTiers } from "./useAlertSettingTiers";
import { findControl, focusControl, useAlertSettingFind } from "./useAlertSettingFind";
import { ALERT_FIND_ENTRIES } from "@/components/alerts/alertSettingFind";

const t = i18n.global.t as unknown as TranslateFn;

// A visible stand-in for a rendered control; jsdom reports no layout boxes by itself.
const mountControl = (testId: string, inner = "<input />") => {
  const el = document.createElement("div");
  el.dataset.test = testId;
  el.innerHTML = inner;
  el.getClientRects = () => [{}] as unknown as DOMRectList;
  document.body.appendChild(el);
  return el;
};

// Tiers whose tucked/one-click settings only render once expanded or revealed, like AddAlert.
const fakeTiers = (onShow: (id: AlertSettingId) => void) => {
  const state = reactive({ expanded: new Set<AlertSectionId>(), revealed: new Set<string>() });
  const tiers: AlertSettingTiers = {
    isVisible: (id) =>
      ["destinations", "description", "rowTemplate"].includes(id) || state.revealed.has(id),
    view: () => ({ addLinks: [], tucked: [], expanded: false }),
    reveal: vi.fn((id: AlertSettingId) => {
      state.revealed.add(id);
      onShow(id);
    }),
    toggle: vi.fn(),
    expand: vi.fn((section: AlertSectionId) => {
      state.expanded.add(section);
      ALERT_FIND_ENTRIES.filter((e) => e.section === section && e.tier === "tucked").forEach((e) =>
        onShow(e.id as AlertSettingId),
      );
    }),
  };
  return tiers;
};

const setup = () => {
  const shown: string[] = [];
  const tiers = fakeTiers((id) => {
    shown.push(id);
    const entry = ALERT_FIND_ENTRIES.find((e) => e.id === id);
    if (entry) mountControl(entry.targets[0]);
  });
  const goToSection = vi.fn();
  const reveal = vi.fn();
  const find = useAlertSettingFind({ t, available: () => true, tiers, goToSection, reveal });
  return { find, tiers, goToSection, reveal, shown };
};

describe("useAlertSettingFind", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists ranked results with section question and group", () => {
    const { find } = setup();
    find.query.value = "dedup";
    expect(find.items.value[0]).toEqual({
      id: "dedup",
      label: "Skip duplicates",
      context: ["Who should hear about it?", "More settings"],
    });
    expect(find.countText.value).toMatch(/setting/);
  });

  it("expands a tucked group, then scrolls to and focuses the control", async () => {
    const { find, tiers, reveal } = setup();
    await find.select("dedup");
    expect(tiers.expand).toHaveBeenCalledWith("notify");
    const control = document.querySelector<HTMLElement>(
      '[data-test="alert-dedup-fingerprint-fields"]',
    );
    expect(reveal).toHaveBeenCalledWith(control);
    expect(document.activeElement).toBe(control?.querySelector("input"));
  });

  it("expands the group of the setting that gates a sub-control", async () => {
    const { find, tiers, reveal } = setup();
    await find.select("dedupWindow");
    expect(tiers.expand).toHaveBeenCalledWith("notify");
    expect(reveal).toHaveBeenCalledWith(
      document.querySelector('[data-test="alert-dedup-time-window"]'),
    );
  });

  it("reveals a one-click setting without expanding its section", async () => {
    const { find, tiers } = setup();
    await find.select("template");
    expect(tiers.reveal).toHaveBeenCalledWith("template");
    expect(tiers.expand).not.toHaveBeenCalled();
  });

  it("does not touch the tiers for an always-shown control", async () => {
    const { find, tiers, reveal } = setup();
    const control = mountControl("alert-settings-silence-duration-input");
    await find.select("cooldown");
    expect(tiers.expand).not.toHaveBeenCalled();
    expect(tiers.reveal).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledWith(control);
  });

  it("falls back to the section when the control is not on screen", async () => {
    const { find, goToSection, reveal } = setup();
    await find.select("timezone");
    expect(goToSection).toHaveBeenCalledWith("schedule");
    expect(reveal).not.toHaveBeenCalled();
  });

  it("ignores unknown ids", async () => {
    const { find, goToSection } = setup();
    await find.select("nope");
    await nextTick();
    expect(goToSection).not.toHaveBeenCalled();
  });
});

describe("findControl / focusControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes the first target that is on screen", () => {
    const hidden = document.createElement("div");
    hidden.dataset.test = "alert-check-every-input";
    document.body.appendChild(hidden);
    const unit = mountControl("alert-check-every-unit-select", "<button>min</button>");
    const entry = ALERT_FIND_ENTRIES.find((e) => e.id === "checkEvery")!;
    expect(findControl(entry)).toBe(unit);
  });

  it("focuses the control itself when it is focusable", () => {
    const el = mountControl("x", "");
    const button = document.createElement("button");
    el.appendChild(button);
    focusControl(button);
    expect(document.activeElement).toBe(button);
  });
});
