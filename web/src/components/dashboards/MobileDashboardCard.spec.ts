import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileDashboardCard from "./MobileDashboardCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileDashboardCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileDashboardCard", () => {
  const baseRow = {
    id: "d-1",
    name: "Production Overview",
    description: "Traffic, errors, saturation across prod clusters",
    owner: "sre@example.com",
    created: "2026-04-10",
  };

  it("renders title and description", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-dashboard-card__title").text()).toBe(
      "Production Overview",
    );
    expect(w.find(".mobile-dashboard-card__desc").text()).toContain(
      "Traffic, errors",
    );
  });

  it("renders meta items when present", () => {
    const w = mountCard(baseRow);
    const meta = w.find(".mobile-dashboard-card__meta").text();
    expect(meta).toContain("sre@example.com");
    expect(meta).toContain("2026-04-10");
  });

  it("omits description when empty", () => {
    const w = mountCard({ ...baseRow, description: "" });
    expect(w.find(".mobile-dashboard-card__desc").exists()).toBe(false);
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-dashboard-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-dashboard-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("emits each menu action with the row", async () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["open", "clone", "move", "delete"];
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
    const more = w.find(".mobile-dashboard-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("omits meta row items when owner and created are absent", () => {
    const w = mountCard({ ...baseRow, owner: "", created: "" });
    expect(w.findAll(".mobile-dashboard-card__meta-item")).toHaveLength(0);
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
