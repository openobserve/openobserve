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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { createStore } from "vuex";
import EditorDraftDot from "./EditorDraftDot.vue";

const store = createStore({ state: { timezone: "UTC" } });

describe("EditorDraftDot", () => {
  it("names a row's draft with its time", () => {
    const wrapper = mount(EditorDraftDot, {
      props: { savedAt: Date.UTC(2026, 9, 21, 14, 32), dataTest: "row-dot" },
      global: { plugins: [store] },
    });
    const dot = wrapper.get('[data-test="row-dot"]');
    expect(dot.attributes("role")).toBe("img");
    expect(dot.attributes("aria-label")).toMatch(/^Unsaved draft · .*2026/);
    expect(dot.classes()).toContain("bg-button-pending-bg");
  });

  it("pins a silent dot to a button corner", () => {
    const wrapper = mount(EditorDraftDot, {
      props: { corner: true },
      global: { plugins: [store] },
    });
    const dot = wrapper.get('[data-test="editor-draft-dot"]');
    expect(dot.attributes("aria-hidden")).toBe("true");
    expect(dot.attributes("role")).toBeUndefined();
    expect(dot.classes()).toEqual(expect.arrayContaining(["absolute", "-end-1", "-top-1"]));
  });

  describe("corner dot tooltip on its host button", () => {
    let wrapper: VueWrapper | null = null;

    beforeEach(() => {
      // jsdom has no layout, so a box is faked for every element except one CSS would hide.
      vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
        const hidden = !!this.closest(".hidden");
        return { length: hidden ? 0 : 1, item: () => null } as unknown as DOMRectList;
      });
    });

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const mountOnButton = (dotProps: Record<string, unknown> = {}) => {
      const Host = defineComponent({
        setup: () => () =>
          h(
            OButton,
            { variant: "primary", "data-test": "host-btn", "aria-label": raw("New alert") },
            () => [raw("New alert"), h(EditorDraftDot, { corner: true, ...dotProps })],
          ),
      });
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      return document.body.querySelector<HTMLElement>('[data-test="host-btn"]')!;
    };

    const tooltipText = () =>
      document.body.querySelector('[data-test="o-tooltip-content"]')?.textContent ?? null;

    it("opens on hovering the button, dated, and closes on leave", async () => {
      vi.useFakeTimers();
      const button = mountOnButton({ savedAt: Date.UTC(2026, 9, 21, 14, 32) });
      await flushPromises();
      expect(button.tagName).toBe("BUTTON");

      button.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(tooltipText()).toMatch(/Unsaved draft · .*2026/);

      button.dispatchEvent(new MouseEvent("mouseleave"));
      await flushPromises();
      expect(tooltipText()).toBeNull();
    });

    it("opens on keyboard focus of the button, undated when no time is known", async () => {
      vi.useFakeTimers();
      const button = mountOnButton();
      await flushPromises();
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(tooltipText()).toContain("Unsaved draft");
      expect(tooltipText()).not.toContain("·");
    });

    it("shows nothing for a dot CSS hides, e.g. md:hidden at desktop", async () => {
      vi.useFakeTimers();
      const button = mountOnButton({ class: "hidden" });
      await flushPromises();
      button.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(tooltipText()).toBeNull();
    });

    it("follows a tooltip prop that turns off and back on while mounted", async () => {
      vi.useFakeTimers();
      const on = ref(true);
      const Host = defineComponent({
        setup: () => () =>
          h("button", { "data-test": "toggle-btn" }, [
            h(EditorDraftDot, { corner: true, tooltip: on.value }),
          ]),
      });
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      await flushPromises();
      const button = document.body.querySelector<HTMLElement>('[data-test="toggle-btn"]')!;
      const hover = async () => {
        button.dispatchEvent(new MouseEvent("mouseenter"));
        vi.advanceTimersByTime(800);
        await flushPromises();
      };

      await hover();
      expect(tooltipText()).toContain("Unsaved draft");
      on.value = false;
      await flushPromises();
      expect(tooltipText()).toBeNull();
      await hover();
      expect(tooltipText()).toBeNull();

      button.dispatchEvent(new MouseEvent("mouseleave"));
      on.value = true;
      await flushPromises();
      await hover();
      expect(tooltipText()).toContain("Unsaved draft");
    });

    it("shows nothing with tooltip off, and keeps a single root so host classes apply", async () => {
      vi.useFakeTimers();
      const Host = defineComponent({
        setup: () => () =>
          h("button", { "data-test": "plain-btn" }, [
            h(EditorDraftDot, { corner: true, tooltip: false, class: "md:hidden" }),
          ]),
      });
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      await flushPromises();
      const dot = document.body.querySelector('[data-test="editor-draft-dot"]');
      expect(dot?.classList.contains("md:hidden")).toBe(true);
      const button = document.body.querySelector<HTMLElement>('[data-test="plain-btn"]')!;
      button.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(tooltipText()).toBeNull();
    });
  });
});
