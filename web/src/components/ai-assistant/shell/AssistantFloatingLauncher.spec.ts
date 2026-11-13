// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import AssistantFloatingLauncher, { previewTitle } from "./AssistantFloatingLauncher.vue";
import type { ThreadPill } from "./threadsBar";

const pill = (n: number, signal: ThreadPill["signal"] = "idle"): ThreadPill => ({
  sid: `s${n}`,
  title: `Chat number ${n}`,
  signal,
});

const mountLauncher = (count: number, expanded = false) =>
  mount(AssistantFloatingLauncher, {
    props: { items: Array.from({ length: count }, (_, i) => pill(i + 1)), expanded },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });

const hover = async (wrapper: ReturnType<typeof mountLauncher>) =>
  wrapper.get('[data-test="assistant-launcher"]').trigger("pointerenter");

describe("AssistantFloatingLauncher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("counts every listed chat in the badge", () => {
    const wrapper = mountLauncher(5);
    expect(wrapper.get('[data-test="assistant-launcher-badge"]').text()).toBe("5");
  });

  it("shows no badge and no previews when nothing is listed", async () => {
    const wrapper = mountLauncher(0);
    await hover(wrapper);
    expect(wrapper.find('[data-test="assistant-launcher-badge"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-launcher-previews"]').exists()).toBe(false);
  });

  it("keeps previews hidden until hover", async () => {
    const wrapper = mountLauncher(2);
    expect(wrapper.find('[data-test="assistant-launcher-previews"]').exists()).toBe(false);
    await hover(wrapper);
    expect(wrapper.findAll('[data-test="assistant-launcher-preview"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="assistant-launcher-more"]').exists()).toBe(false);
  });

  it("opens on keyboard focus", async () => {
    const wrapper = mountLauncher(1);
    await wrapper.get('[data-test="assistant-launcher"]').trigger("focusin");
    expect(wrapper.findAll('[data-test="assistant-launcher-preview"]')).toHaveLength(1);
  });

  it("shows two previews and a +N item past two", async () => {
    const wrapper = mountLauncher(5);
    await hover(wrapper);
    expect(wrapper.findAll('[data-test="assistant-launcher-preview"]')).toHaveLength(2);
    expect(wrapper.get('[data-test="assistant-launcher-more"]').text()).toBe("+3");
  });

  it("keeps the previews through a short pointer gap and closes after the grace", async () => {
    const wrapper = mountLauncher(2);
    const root = wrapper.get('[data-test="assistant-launcher"]');
    await hover(wrapper);
    await root.trigger("pointerleave");
    vi.advanceTimersByTime(100);
    await root.trigger("pointerenter");
    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="assistant-launcher-previews"]').exists()).toBe(true);
    await root.trigger("pointerleave");
    vi.advanceTimersByTime(200);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="assistant-launcher-previews"]').exists()).toBe(false);
  });

  it("closes on Escape", async () => {
    const wrapper = mountLauncher(2);
    await hover(wrapper);
    await wrapper.get('[data-test="assistant-launcher"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-test="assistant-launcher-previews"]').exists()).toBe(false);
  });

  it("hides the previews while the Threads panel is open", async () => {
    const wrapper = mountLauncher(2, true);
    await hover(wrapper);
    expect(wrapper.find('[data-test="assistant-launcher-previews"]').exists()).toBe(false);
  });

  it("restores the clicked chat", async () => {
    const wrapper = mountLauncher(3);
    await hover(wrapper);
    await wrapper.findAll('[data-test="assistant-launcher-preview"]')[1].trigger("click");
    expect(wrapper.emitted("restore")).toEqual([["s2"]]);
  });

  it("toggles the Threads list from the icon and from +N", async () => {
    const wrapper = mountLauncher(5);
    await wrapper.get('[data-test="assistant-launcher-toggle"]').trigger("click");
    await hover(wrapper);
    await wrapper.get('[data-test="assistant-launcher-more"]').trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(2);
  });

  it("places previews above and left of the icon", async () => {
    const wrapper = mountLauncher(3);
    await hover(wrapper);
    const slots = wrapper.findAll('[data-test="assistant-launcher-slot"]');
    expect(slots.map((x) => x.attributes("data-slot"))).toEqual(["above", "left"]);
    expect(slots[0].classes()).toContain("md:bottom-full");
    expect(slots[1].classes()).toContain("md:end-full");
    expect(slots).toHaveLength(2);
    expect(wrapper.get('[data-test="assistant-launcher-previews"]').classes()).toContain(
      "flex-col-reverse",
    );
  });

  it("puts the +N chip above the first preview", async () => {
    const wrapper = mountLauncher(5);
    await hover(wrapper);
    const third = wrapper.findAll('[data-test="assistant-launcher-slot"]')[0];
    expect(third.find('[data-test="assistant-launcher-more"]').exists()).toBe(true);
  });

  it("animates and announces when a chat is answering", () => {
    const wrapper = mount(AssistantFloatingLauncher, {
      props: { items: [pill(1, "running"), pill(2, "running"), pill(3)], expanded: false },
      global: { plugins: [i18n, store] },
    });
    expect(wrapper.find('[data-test="assistant-launcher-spinner"]').exists()).toBe(false);
    const dots = wrapper.get('[data-test="assistant-launcher-working-dot"]');
    expect(dots.findAll("span")).toHaveLength(3);
    expect(dots.find("span").classes()).toContain("motion-safe:animate-pulse");
    expect(wrapper.get('[data-test="assistant-launcher-live"]').text()).toBe("2 chats answering");
    expect(wrapper.get('[data-test="assistant-launcher-toggle"]').attributes("aria-label")).toBe(
      "Threads, 2 chats answering",
    );
  });

  it("keeps the badge small at the top-right corner", () => {
    const badge = mountLauncher(2).get('[data-test="assistant-launcher-badge"]');
    for (const c of ["h-6!", "text-xs", "-top-2", "-end-2", "ring-2", "ring-surface-base"])
      expect(badge.classes()).toContain(c);
  });

  it("stays calm with no chat answering and flags needs-you on the badge", () => {
    const wrapper = mount(AssistantFloatingLauncher, {
      props: { items: [pill(1, "approval")], expanded: false },
      global: { plugins: [i18n, store] },
    });
    expect(wrapper.find('[data-test="assistant-launcher-spinner"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-launcher-badge"]').attributes("data-state")).toBe(
      "needsYou",
    );
  });

  it("cuts a title to 26 characters with an ellipsis", () => {
    expect(previewTitle("Short")).toBe("Short");
    expect(previewTitle("Why is checkout-api failing after the deploy")).toBe(
      "Why is checkout-api failin…",
    );
    expect(previewTitle("Exactly twenty six chars!!")).toBe("Exactly twenty six chars!!");
  });
});
