import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileFunctionCard from "./MobileFunctionCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileFunctionCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileFunctionCard", () => {
  const baseRow = {
    name: "redact_ip",
    function: "fn(req) { return req }",
    transType: "1",
  };

  it("renders the function name", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-function-card__title").text()).toBe("redact_ip");
  });

  it("maps transType 1 to 'vrl' in the badge", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-function-card__badge").text()).toBe("vrl");
  });

  it("omits the badge when transType is absent", () => {
    const w = mountCard({ name: "no_type", function: "" });
    expect(w.find(".mobile-function-card__badge").exists()).toBe(false);
  });

  it("renders a preview of the function body", () => {
    const w = mountCard(baseRow);
    const preview = w.find(".mobile-function-card__preview");
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("fn(req)");
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-function-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-function-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["edit", "pipelines", "delete"];
    for (const action of actions) vm.$emit(action, baseRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([baseRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(baseRow);
    const more = w.find(".mobile-function-card__more");
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
