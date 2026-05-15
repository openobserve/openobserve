import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileUserCard from "./MobileUserCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileUserCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileUserCard", () => {
  const baseRow = {
    email: "alice@example.com",
    first_name: "Alice",
    last_name: "Ng",
    role: "Admin",
    status: "active",
    enableEdit: true,
    enableDelete: true,
    token: null,
  };

  it("renders full name and email", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-user-card__title").text()).toBe("Alice Ng");
    expect(w.find(".mobile-user-card__email").text()).toBe(
      "alice@example.com",
    );
  });

  it("falls back to email when first/last name are missing", () => {
    const w = mountCard({ ...baseRow, first_name: "", last_name: "" });
    expect(w.find(".mobile-user-card__title").text()).toBe(
      "alice@example.com",
    );
    expect(w.find(".mobile-user-card__email").exists()).toBe(false);
  });

  it("renders initials from first and last name", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-user-card__avatar").text()).toBe("AN");
  });

  it("renders initial from email when names are missing", () => {
    const w = mountCard({ ...baseRow, first_name: "", last_name: "" });
    expect(w.find(".mobile-user-card__avatar").text()).toBe("A");
  });

  it("renders role pill", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-user-card__role-pill").text()).toBe("Admin");
  });

  it("shows Invited status when row.status is pending", () => {
    const w = mountCard({ ...baseRow, status: "pending", token: "tok-1" });
    expect(w.find(".mobile-user-card__status").text()).toBe("Invited");
    expect(w.find(".mobile-user-card__status").classes()).toContain(
      "is-pending",
    );
  });

  it("emits click with row on card click", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-user-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-user-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("hides the overflow button when no actions are permitted", () => {
    const w = mountCard({
      ...baseRow,
      enableEdit: false,
      enableDelete: false,
    });
    expect(w.find(".mobile-user-card__more").exists()).toBe(false);
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(baseRow);
    const vm = w.vm as any;
    const actions = ["edit", "delete", "revoke"];
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
    const more = w.find(".mobile-user-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("emits delete when swipe-right handler fires on a deletable row", () => {
    const w = mountCard(baseRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeTruthy();
    expect(w.emitted("delete")![0]).toEqual([baseRow]);
    expect(reset).toHaveBeenCalled();
  });

  it("emits revoke on swipe-right when row is a pending invite", () => {
    const row = { ...baseRow, status: "pending", token: "tok-1" };
    const w = mountCard(row);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("revoke")).toBeTruthy();
    expect(w.emitted("revoke")![0]).toEqual([row]);
  });

  it("swipe-right is a no-op when the row is not deletable", () => {
    const w = mountCard({ ...baseRow, enableDelete: false });
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeFalsy();
    expect(w.emitted("revoke")).toBeFalsy();
    expect(reset).toHaveBeenCalled();
  });
});
