import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileTemplateCard from "./MobileTemplateCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileTemplateCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileTemplateCard", () => {
  const baseRow = {
    name: "WebhookJson",
    type: "Webhook",
  };

  it("renders title", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-template-card__title").text()).toBe("WebhookJson");
  });

  it("renders lowercased type badge when type is present", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-template-card__badge").text()).toBe("webhook");
  });

  it("omits the badge when type is absent", () => {
    const w = mountCard({ name: "NoType" });
    expect(w.find(".mobile-template-card__badge").exists()).toBe(false);
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-template-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-template-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["edit", "export", "delete"];
    for (const action of actions) vm.$emit(action, baseRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([baseRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(baseRow);
    const more = w.find(".mobile-template-card__more");
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
