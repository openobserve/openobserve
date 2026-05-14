import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileReportCard from "./MobileReportCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileReportCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileReportCard", () => {
  const baseRow = {
    name: "WeeklyTrafficReport",
    owner: "sre@example.com",
    description: "Aggregate traffic across edge POPs",
    last_triggered_at: "2026-04-15T08:00:00Z",
    enabled: true,
    destinations: ["email"],
    dashboards: [{ report_type: "pdf" }],
  };

  it("renders title", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-report-card__title").text()).toBe(
      "WeeklyTrafficReport",
    );
  });

  it("shows Enabled state when row.enabled is true", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-report-card__state").text()).toBe("Enabled");
    expect(w.find(".mobile-report-card__state").classes()).toContain("is-on");
  });

  it("shows Paused state and applies disabled modifier when row.enabled is false", () => {
    const w = mountCard({ ...baseRow, enabled: false });
    expect(w.find(".mobile-report-card__state").text()).toBe("Paused");
    expect(w.find(".mobile-report-card").classes()).toContain(
      "mobile-report-card--disabled",
    );
  });

  it("renders description when present", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-report-card__desc").text()).toContain(
      "Aggregate traffic",
    );
  });

  it("omits description when empty", () => {
    const w = mountCard({ ...baseRow, description: "" });
    expect(w.find(".mobile-report-card__desc").exists()).toBe(false);
  });

  it("renders meta items when owner and last_triggered_at are present", () => {
    const w = mountCard(baseRow);
    const meta = w.find(".mobile-report-card__meta").text();
    expect(meta).toContain("sre@example.com");
    expect(meta).toContain("2026-04-15T08:00:00Z");
  });

  it("omits last_triggered meta item when value is '-'", () => {
    const w = mountCard({ ...baseRow, last_triggered_at: "-" });
    const items = w.findAll(".mobile-report-card__meta-item");
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("sre@example.com");
  });

  it("shows PNG badge when dashboards[0].report_type is png", () => {
    const w = mountCard({
      ...baseRow,
      dashboards: [{ report_type: "png" }],
    });
    expect(w.find(".mobile-report-card__badge").exists()).toBe(true);
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-report-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-report-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("emits each menu action with the row", async () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["toggle", "edit", "delete"];
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
    const more = w.find(".mobile-report-card__more");
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
});
