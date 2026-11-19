// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick, reactive } from "vue";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { AlertSettingId } from "@/components/alerts/alertSettingTiers";
import type { AlertSettingTiers } from "./useAlertSettingTiers";
import { findControl, focusControl, LANDED_MS, useAlertSettingFind } from "./useAlertSettingFind";
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

// Tiers whose rare settings only render once revealed, like AddAlert.
const fakeTiers = (onShow: (id: AlertSettingId) => void) => {
  const state = reactive({ revealed: new Set<string>() });
  const tiers: AlertSettingTiers = {
    isVisible: (id) => ["description", "rowTemplate"].includes(id) || state.revealed.has(id),
    view: () => ({ addLinks: [], more: [], expanded: false }),
    reveal: vi.fn((id: AlertSettingId) => {
      state.revealed.add(id);
      onShow(id);
    }),
    conceal: vi.fn(),
    toggle: vi.fn(),
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

  it("lists ranked results under the step's nav name, and More options when folded there", () => {
    const { find } = setup();
    find.query.value = "flapping";
    expect(find.items.value[0]).toEqual({
      id: "keepFiring",
      label: "Keep firing for",
      context: ["Who to tell", "More options"],
    });
    find.query.value = "recovery destination";
    expect(find.items.value[0]?.context).toEqual([
      "Who to tell",
      "More options",
      "Recovery message",
    ]);
    expect(find.countText.value).toMatch(/setting/);
  });

  it("reveals only the hidden setting, then scrolls to and focuses it", async () => {
    const { find, tiers, reveal } = setup();
    await find.select("keepFiring");
    expect(tiers.reveal).toHaveBeenCalledWith("keepFiring");
    expect(tiers.toggle).not.toHaveBeenCalled();
    const control = document.querySelector<HTMLElement>(
      '[data-test="alert-settings-keep-firing-for-input"]',
    );
    expect(reveal).toHaveBeenCalledWith(control);
    expect(document.activeElement).toBe(control?.querySelector("input"));
  });

  it("marks the row it lands on for a moment, so a jump to another step shows where it went", async () => {
    vi.useFakeTimers();
    const { find } = setup();
    const row = document.createElement("div");
    row.setAttribute("data-o-setting-row", "");
    document.body.appendChild(row);
    row.appendChild(mountControl("alert-settings-silence-duration-input"));
    await find.select("cooldown");
    expect(row.hasAttribute("data-landed")).toBe(true);
    vi.advanceTimersByTime(LANDED_MS);
    expect(row.hasAttribute("data-landed")).toBe(false);
    vi.useRealTimers();
  });

  it("lands on a + add link without adding the setting", async () => {
    const { find, tiers, reveal } = setup();
    const link = mountControl("add-alert-add-cron", "");
    await find.select("cron");
    expect(tiers.reveal).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledWith(link);
  });

  it("does not touch the tiers for an always-shown control", async () => {
    const { find, tiers, reveal } = setup();
    const control = mountControl("alert-settings-silence-duration-input");
    await find.select("cooldown");
    expect(tiers.reveal).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledWith(control);
  });

  it("falls back to the section when the control is not on screen", async () => {
    const { find, goToSection, reveal } = setup();
    await find.select("timezone");
    expect(goToSection).toHaveBeenCalledWith("schedule");
    expect(reveal).not.toHaveBeenCalled();
  });

  it("lists a setting another query mode offers, and switching to that mode reaches it", async () => {
    const shown: string[] = [];
    const tiers = fakeTiers((id) => shown.push(id));
    const reveal = vi.fn();
    const find = useAlertSettingFind({
      t,
      available: (id) => id !== "compareWithPast" && id !== "forecast",
      tiers,
      goToSection: vi.fn(),
      reveal,
    });
    const tab = mountControl("query-mode-sql", "");
    tab.addEventListener("click", () =>
      mountControl("multi-time-range-alerts-add-btn", "<button />"),
    );
    find.query.value = "last week";
    expect(find.items.value[0]?.context).toEqual([
      "When to alert",
      "Available in SQL",
      "Switch to SQL",
    ]);
    find.query.value = "forecast";
    expect(find.items.value.map((i) => i.id)).not.toContain("forecast");
    await find.select("compareWithPast");
    expect(tiers.reveal).toHaveBeenCalledWith("compareWithPast");
    const control = document.querySelector('[data-test="multi-time-range-alerts-add-btn"]');
    expect(reveal).toHaveBeenCalledWith(control);
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
