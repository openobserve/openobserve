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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import OTemplateTextarea from "./OTemplateTextarea.vue";

const SUGGESTIONS = [{ name: "BASE_URL" }, { name: "input" }, { name: "Base_Path" }];
const PEEK_DELAY_MS = 300;

// The virtualizer renders nothing in jsdom without a sized scroll box, and measures rows by offsetHeight.
function stubLayout() {
  const realRect = Element.prototype.getBoundingClientRect;
  const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const size = this.hasAttribute("data-index") ? 28 : 200;
    return { top: 0, bottom: size, left: 0, right: 200, width: 200, height: size } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-index") ? 28 : 200;
    },
  });
  Element.prototype.scrollIntoView = vi.fn();
  return () => {
    Element.prototype.getBoundingClientRect = realRect;
    if (realOffsetHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
  };
}

const Host = defineComponent({
  components: { OTemplateTextarea },
  props: {
    initial: { type: String, default: "" },
    suggestions: { type: Array, default: undefined },
    values: { type: Object, default: undefined },
  },
  emits: ["select", "blur"],
  setup(props) {
    const text = ref(props.initial);
    return { text };
  },
  template: `
    <OTemplateTextarea
      v-model="text"
      data-test="msg"
      :suggestions="suggestions"
      :values="values"
      @select="(name) => $emit('select', name)"
      @blur="(event) => $emit('blur', event)"
    />
  `,
});

// The first portalled popover mount in a worker is slow, and slower still under a loaded parallel run.
describe("OTemplateTextarea", { timeout: 20_000 }, () => {
  let wrapper: VueWrapper;
  let field: HTMLTextAreaElement;
  let restoreLayout: () => void;

  beforeEach(() => {
    restoreLayout = stubLayout();
  });

  afterEach(() => {
    wrapper?.unmount();
    restoreLayout();
    vi.useRealTimers();
  });

  function mountHost(props: Record<string, unknown> = {}) {
    wrapper = mount(Host, {
      props: { suggestions: SUGGESTIONS, ...props },
      attachTo: document.body,
    });
    field = wrapper.get('[data-test="msg-field"]').element as HTMLTextAreaElement;
    return wrapper;
  }

  function hostText() {
    return (wrapper.vm as unknown as { text: string }).text;
  }

  // Types the way a user does: the native value and caret change, then `input` fires.
  async function type(text: string, caret = text.length) {
    field.focus();
    field.value = text;
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  }

  async function placeCaret(at: number) {
    field.focus();
    field.setSelectionRange(at, at);
    field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
  }

  function press(key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return event;
  }

  const list = () => document.body.querySelector('[data-test="msg-suggest"]');
  const rowNames = () =>
    Array.from(document.body.querySelectorAll('[role="option"]')).map((row) =>
      row.getAttribute("data-test")?.replace("msg-suggest-item-", ""),
    );
  const activeRow = () => {
    const rows = document.body.querySelectorAll('[data-active] [role="option"]');
    expect(rows).toHaveLength(1);
    return rows[0].textContent?.trim();
  };
  const peek = () => wrapper.find('[data-test="msg-peek"]');

  async function nextFrame() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  describe("opening", () => {
    it("opens with every name on a bare {{", async () => {
      mountHost();
      await type("Hello {{");
      expect(list()).not.toBeNull();
      expect(rowNames()).toEqual(["BASE_URL", "input", "Base_Path"]);
    });

    it("filters case-insensitively as the user keeps typing after {{", async () => {
      mountHost();
      await type("{{ba");
      expect(rowNames()).toEqual(["BASE_URL", "Base_Path"]);
    });

    it("keeps the list open with a space after the braces", async () => {
      mountHost();
      await type("{{ ba");
      expect(rowNames()).toEqual(["BASE_URL", "Base_Path"]);
    });

    it("stays closed on a closed token", async () => {
      mountHost();
      await type("{{BASE_URL}}");
      expect(list()).toBeNull();
    });

    it("stays closed when nothing matches", async () => {
      mountHost();
      await type("{{zzz");
      expect(list()).toBeNull();
    });

    it("behaves as a plain field without suggestions", async () => {
      mountHost({ suggestions: undefined });
      await type("{{");
      expect(list()).toBeNull();
      expect(press("Enter").defaultPrevented).toBe(false);
    });

    it("does not open on focus or click alone", async () => {
      mountHost({ initial: "{{" });
      await placeCaret(2);
      expect(list()).toBeNull();
    });
  });

  describe("caret movement", () => {
    it("closes when a click moves the caret before the braces", async () => {
      mountHost();
      await type("abc {{ba");
      expect(list()).not.toBeNull();
      await placeCaret(2);
      expect(list()).toBeNull();
    });

    it("closes when an arrow key moves the caret before the braces", async () => {
      mountHost();
      await type("abc {{ba");
      field.setSelectionRange(1, 1);
      field.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
      await flushPromises();
      expect(list()).toBeNull();
    });
  });

  describe("keys", () => {
    it("moves the highlight with ArrowDown and ArrowUp, wrapping at both ends", async () => {
      mountHost();
      await type("{{");
      expect(activeRow()).toBe("{{BASE_URL}}");
      press("ArrowUp");
      await flushPromises();
      expect(activeRow()).toBe("{{Base_Path}}");
      press("ArrowDown");
      press("ArrowDown");
      await flushPromises();
      expect(activeRow()).toBe("{{input}}");
      press("ArrowDown");
      press("ArrowDown");
      await flushPromises();
      expect(activeRow()).toBe("{{BASE_URL}}");
    });

    it("inserts the highlighted name at the caret, not at the end, and reports the pick", async () => {
      mountHost();
      await type("see {{ba and more", 8);
      const enter = press("Enter");
      await flushPromises();
      expect(enter.defaultPrevented).toBe(true);
      expect(hostText()).toBe("see {{BASE_URL}} and more");
      expect(wrapper.emitted("select")).toEqual([["BASE_URL"]]);
      expect(list()).toBeNull();
    });

    it("places the caret right after the inserted token", async () => {
      mountHost();
      await type("see {{in and more", 8);
      press("Tab");
      await flushPromises();
      await nextFrame();
      expect(hostText()).toBe("see {{input}} and more");
      expect(field.selectionStart).toBe("see {{input}}".length);
      expect(document.activeElement).toBe(field);
    });

    it("inserts the stored spelling, not the typed case", async () => {
      mountHost();
      await type("{{base_p");
      press("Enter");
      await flushPromises();
      expect(hostText()).toBe("{{Base_Path}}");
    });

    it("does not intercept Enter, Tab or Escape while closed", async () => {
      mountHost();
      await type("plain");
      expect(press("Enter").defaultPrevented).toBe(false);
      expect(press("Tab").defaultPrevented).toBe(false);
      expect(press("Escape").defaultPrevented).toBe(false);
    });

    it("closes on Escape and swallows that keystroke", async () => {
      mountHost();
      await type("{{");
      const escape = press("Escape");
      await flushPromises();
      expect(escape.defaultPrevented).toBe(true);
      expect(list()).toBeNull();
    });

    it("closes on blur", async () => {
      mountHost();
      await type("{{");
      field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await flushPromises();
      expect(list()).toBeNull();
    });
  });

  describe("wiring", () => {
    it("re-emits blur to the caller", async () => {
      mountHost();
      field.focus();
      field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      expect(wrapper.emitted("blur")).toHaveLength(1);
    });

    it("emits every keystroke to the caller", async () => {
      mountHost();
      await type("hi");
      expect(hostText()).toBe("hi");
    });

    it("removes its native listeners on unmount", async () => {
      mountHost();
      field.focus();
      const removed = vi.spyOn(field, "removeEventListener");
      wrapper.unmount();
      const kinds = removed.mock.calls.map(([kind]) => kind);
      expect(kinds).toContain("click");
      expect(kinds).toContain("keyup");
    });
  });

  describe("peek", () => {
    it("does not show the value immediately, only after the hover delay", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "Hello {{input}}!", values: { input: "What is p99 latency?" } });
      await placeCaret(10);
      expect(peek().exists()).toBe(false);

      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().text()).toContain("What is p99 latency?");
    });

    it("shows nothing while the caret sits outside any token", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "Hello {{input}}!", values: { input: "value" } });
      await placeCaret(2);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(false);
    });

    it("shows nothing for a token that is not a known variable, even after the delay", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "Hello {{typo}}!", values: {} });
      await placeCaret(10);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(false);
    });

    it("shows a dash for a known variable with an empty value", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "{{input}}", values: { input: "" } });
      await placeCaret(3);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().text()).toContain("—");
    });

    it("clears once focus leaves the field", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "{{input}}", values: { input: "value" } });
      await placeCaret(3);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(true);

      field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(false);
    });

    it("cancels a pending show if the caret leaves the token before the delay elapses", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "Hello {{input}}!", values: { input: "value" } });
      await placeCaret(10);
      await placeCaret(2);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(false);
    });

    it("clears its pending timer on unmount", async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      mountHost({ initial: "{{input}}", values: { input: "value" } });
      await placeCaret(3);
      wrapper.unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("stays while the caret moves inside the same token", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "Hello {{input}}!", values: { input: "value" } });
      await placeCaret(9);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(true);

      await placeCaret(12);
      expect(peek().exists()).toBe(true);
    });

    it("never renders without values", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "{{input}}" });
      await placeCaret(3);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(false);
    });

    it("hides while the list is open", async () => {
      vi.useFakeTimers();
      mountHost({ initial: "{{input}} ", values: { input: "value" } });
      await placeCaret(3);
      vi.advanceTimersByTime(PEEK_DELAY_MS);
      await wrapper.vm.$nextTick();
      expect(peek().exists()).toBe(true);

      await type("{{input}} {{in");
      await wrapper.vm.$nextTick();
      expect(list()).not.toBeNull();
      expect(peek().exists()).toBe(false);
    });
  });
});
