import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileDestinationCard from "./MobileDestinationCard.vue";

const mountCard = (row: Record<string, any>, typeLabel = "Webhook") =>
  mount(MobileDestinationCard, {
    props: { row, typeLabel },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileDestinationCard", () => {
  const httpRow = {
    name: "slack-webhook",
    type: "http",
    method: "post",
    url: "https://hooks.slack.com/services/ABC/DEF",
  };

  it("renders the destination name", () => {
    const w = mountCard(httpRow);
    expect(w.find(".mobile-destination-card__title").text()).toBe(
      "slack-webhook",
    );
  });

  it("renders the provided type label", () => {
    const w = mountCard(httpRow, "Slack");
    expect(w.find(".mobile-destination-card__badge").text()).toBe("Slack");
  });

  it("omits the badge when typeLabel is empty", () => {
    const w = mountCard(httpRow, "");
    expect(w.find(".mobile-destination-card__badge").exists()).toBe(false);
  });

  it("builds a meta line with method + truncated url", () => {
    const w = mountCard(httpRow);
    const meta = w.find(".mobile-destination-card__meta").text();
    expect(meta).toContain("POST");
    expect(meta).toContain("https://hooks.slack.com");
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(httpRow);
    await w.find(".mobile-destination-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([httpRow]);
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(httpRow);
    const vm = w.vm as any;
    const actions = ["edit", "export", "delete"];
    for (const action of actions) vm.$emit(action, httpRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([httpRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(httpRow);
    const more = w.find(".mobile-destination-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("emits delete when swipe-right handler is invoked", () => {
    const w = mountCard(httpRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeTruthy();
    expect(w.emitted("delete")![0]).toEqual([httpRow]);
    expect(reset).toHaveBeenCalled();
  });
});
