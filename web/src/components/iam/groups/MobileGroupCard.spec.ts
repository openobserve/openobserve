import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileGroupCard from "./MobileGroupCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileGroupCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileGroupCard", () => {
  const baseRow = { group_name: "admins" };

  it("renders the group name", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-group-card__title").text()).toBe("admins");
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-group-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-group-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["edit", "delete"];
    for (const action of actions) vm.$emit(action, baseRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([baseRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(baseRow);
    const more = w.find(".mobile-group-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
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
