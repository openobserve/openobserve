import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileAlertCard from "./MobileAlertCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileAlertCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileAlertCard", () => {
  const baseRow = {
    alert_id: "a-1",
    name: "HighErrorRate",
    owner: "ops@example.com",
    period: "5m",
    frequency: "1m",
    stream_name: "prod_logs",
    type: "scheduled",
    enabled: true,
  };

  it("renders title and subtitle", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-alert-card__title").text()).toBe("HighErrorRate");
    expect(w.find(".mobile-alert-card__subtitle").text()).toContain("prod_logs");
    expect(w.find(".mobile-alert-card__subtitle").text()).toContain("scheduled");
  });

  it("shows Enabled state when row.enabled is true", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-alert-card__state").text()).toBe("Enabled");
    expect(w.find(".mobile-alert-card__state").classes()).toContain("is-on");
  });

  it("shows Paused state and applies disabled modifier when row.enabled is false", () => {
    const w = mountCard({ ...baseRow, enabled: false });
    expect(w.find(".mobile-alert-card__state").text()).toBe("Paused");
    expect(w.find(".mobile-alert-card").classes()).toContain(
      "mobile-alert-card--disabled",
    );
  });

  it("renders meta items when present", () => {
    const w = mountCard(baseRow);
    const meta = w.find(".mobile-alert-card__meta").text();
    expect(meta).toContain("ops@example.com");
    expect(meta).toContain("5m");
    expect(meta).toContain("1m");
  });

  it("emits click with row on card click", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-alert-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-alert-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("omits subtitle when stream_name and type are absent", () => {
    const w = mountCard({ ...baseRow, stream_name: undefined, type: undefined });
    expect(w.find(".mobile-alert-card__subtitle").exists()).toBe(false);
  });

  it("skips em-dash / double-dash placeholders in subtitle", () => {
    const emDash = mountCard({ ...baseRow, stream_name: "—" });
    expect(emDash.find(".mobile-alert-card__subtitle").text()).toBe("scheduled");
    const dashes = mountCard({ ...baseRow, stream_name: "--", type: "--" });
    expect(dashes.find(".mobile-alert-card__subtitle").exists()).toBe(false);
  });

  it("formats numeric period as human-readable minutes/hours", () => {
    const short = mountCard({ ...baseRow, period: 5 });
    expect(short.find(".mobile-alert-card__meta").text()).toContain("5 Mins");
    const exact = mountCard({ ...baseRow, period: 120 });
    expect(exact.find(".mobile-alert-card__meta").text()).toContain("2 Hours");
    const mixed = mountCard({ ...baseRow, period: 90 });
    expect(mixed.find(".mobile-alert-card__meta").text()).toContain(
      "1 Hours 30 Mins",
    );
  });

  it("formats frequency based on frequency_type", () => {
    const mins = mountCard({ ...baseRow, frequency: 10, frequency_type: "minutes" });
    expect(mins.find(".mobile-alert-card__meta").text()).toContain("10 Mins");
    const cron = mountCard({
      ...baseRow,
      frequency: "*/5 * * * *",
      frequency_type: "cron",
    });
    const metaText = cron.find(".mobile-alert-card__meta").text();
    expect(metaText).toContain("*/5 * * * *");
    expect(metaText).not.toContain("Mins");
  });

  it("emits each menu action with the row", async () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["toggle", "edit", "clone", "move", "trigger", "delete"];
    for (const action of actions) {
      vm.$emit(action, baseRow);
    }
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([baseRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(baseRow);
    const more = w.find(".mobile-alert-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("emits toggle when swipe-left handler is invoked", () => {
    const w = mountCard(baseRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeLeft({ reset });
    expect(w.emitted("toggle")).toBeTruthy();
    expect(w.emitted("toggle")![0]).toEqual([baseRow]);
    expect(reset).toHaveBeenCalled();
  });

  it("emits delete when swipe-right handler is invoked", () => {
    const w = mountCard(baseRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeTruthy();
    expect(w.emitted("delete")![0]).toEqual([baseRow]);
    expect(reset).toHaveBeenCalled();
  });

  // One representative haptics assertion — all 12 mobile cards share the
  // useHaptics() wiring, so exercising it once is enough to prove the swipe
  // handlers route `selection` → toggle and `impact` → delete as intended.
  describe("haptics", () => {
    const originalVibrate = (globalThis.navigator as any).vibrate;
    const vibrateSpy = vi.fn();

    beforeEach(() => {
      vibrateSpy.mockReset();
      (globalThis.navigator as any).vibrate = vibrateSpy;
    });

    afterEach(() => {
      (globalThis.navigator as any).vibrate = originalVibrate;
    });

    it("fires selection haptic (8ms) on swipe-left toggle", () => {
      const w = mountCard(baseRow);
      (w.vm as any).onSwipeLeft({ reset: vi.fn() });
      expect(vibrateSpy).toHaveBeenCalledWith(8);
    });

    it("fires impact haptic (14ms) on swipe-right delete", () => {
      const w = mountCard(baseRow);
      (w.vm as any).onSwipeRight({ reset: vi.fn() });
      expect(vibrateSpy).toHaveBeenCalledWith(14);
    });
  });
});
