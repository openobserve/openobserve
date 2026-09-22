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
import OTemplateInput from "./OTemplateInput.vue";

const SUGGESTIONS = [{ name: "BASE_URL" }, { name: "input" }];

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
  components: { OTemplateInput },
  props: {
    initial: { type: String, default: "" },
    suggestions: { type: Array, default: undefined },
  },
  emits: ["select", "blur", "keydown"],
  setup(props) {
    const text = ref(props.initial);
    return { text };
  },
  template: `
    <OTemplateInput
      v-model="text"
      data-test="url"
      type="url"
      label="Starting URL"
      :suggestions="suggestions"
      @select="(name) => $emit('select', name)"
      @blur="(event) => $emit('blur', event)"
      @keydown="(event) => $emit('keydown', event)"
    >
      <template #prefix><span data-test="link-icon">link</span></template>
      <template #tooltip><span>Substituted at run time</span></template>
    </OTemplateInput>
  `,
});

// The first portalled popover mount in a worker is slow, and slower still under a loaded parallel run.
describe("OTemplateInput", { timeout: 20_000 }, () => {
  let wrapper: VueWrapper;
  let field: HTMLInputElement;
  let restoreLayout: () => void;

  beforeEach(() => {
    restoreLayout = stubLayout();
  });

  afterEach(() => {
    wrapper?.unmount();
    restoreLayout();
  });

  function mountHost(props: Record<string, unknown> = {}) {
    wrapper = mount(Host, {
      props: { suggestions: SUGGESTIONS, ...props },
      attachTo: document.body,
    });
    field = wrapper.get('[data-test="url-field"]').element as HTMLInputElement;
    return wrapper;
  }

  function hostText() {
    return (wrapper.vm as unknown as { text: string }).text;
  }

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

  const list = () => document.body.querySelector('[data-test="url-suggest"]');

  // reka registers its outside-pointerdown listener on a macrotask after the popover opens.
  async function settleOutsideListener() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("opens the list on {{ and inserts the pick at the caret", async () => {
    mountHost();
    await type("https://{{ba/path", 12);
    expect(list()).not.toBeNull();
    press("Enter");
    await flushPromises();
    expect(hostText()).toBe("https://{{BASE_URL}}/path");
    expect(wrapper.emitted("select")).toEqual([["BASE_URL"]]);
    expect(list()).toBeNull();
  });

  it("renders the forwarded prefix and tooltip slots", () => {
    mountHost();
    expect(wrapper.find('[data-test="link-icon"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="url-info"]').exists()).toBe(true);
  });

  it("re-emits blur and keydown to the caller", async () => {
    mountHost();
    await type("plain");
    press("a");
    field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    expect(wrapper.emitted("keydown")).toHaveLength(1);
    expect(wrapper.emitted("blur")).toHaveLength(1);
  });

  it("puts the consumer's data-test on the field root once and -field on the native input", () => {
    mountHost();
    const roots = wrapper.findAll('[data-test="url"]');
    expect(roots).toHaveLength(1);
    expect(roots[0].element).not.toBe(wrapper.element);
    expect(field.tagName).toBe("INPUT");
    expect(field.type).toBe("url");
  });

  it("keeps the list open on a pointerdown inside the wrapper", async () => {
    mountHost();
    await type("{{");
    expect(list()).not.toBeNull();
    await settleOutsideListener();
    field.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(list()).not.toBeNull();
  });

  it("closes the list on a pointerdown outside the wrapper", async () => {
    mountHost();
    await type("{{");
    expect(list()).not.toBeNull();
    await settleOutsideListener();
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(list()).toBeNull();
  });

  it("closes the list when a click moves the caret before the {{", async () => {
    mountHost();
    await type("abc {{");
    expect(list()).not.toBeNull();
    await placeCaret(1);
    expect(list()).toBeNull();
  });

  it("is a plain field without suggestions", async () => {
    mountHost({ suggestions: [] });
    await type("{{");
    expect(list()).toBeNull();
    expect(press("Enter").defaultPrevented).toBe(false);
  });
});
