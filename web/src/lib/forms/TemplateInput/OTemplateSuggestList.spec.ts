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
import { h } from "vue";
import OTemplateSuggestList from "./OTemplateSuggestList.vue";
import type { TemplateSuggestion } from "./OTemplateInput.types";

interface RichSuggestion extends TemplateSuggestion {
  secret: boolean;
}

const MATCHES: RichSuggestion[] = [
  { name: "BASE_URL", secret: false },
  { name: "TOKEN", secret: true },
  { name: "input", secret: false },
];

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

// The first portalled popover mount in a worker is slow, and slower still under a loaded parallel run.
describe("OTemplateSuggestList", { timeout: 20_000 }, () => {
  let wrapper: VueWrapper;
  let boundary: HTMLDivElement;
  let field: HTMLInputElement;
  let restoreLayout: () => void;

  beforeEach(() => {
    restoreLayout = stubLayout();
    boundary = document.createElement("div");
    field = document.createElement("input");
    boundary.appendChild(field);
    document.body.appendChild(boundary);
    field.focus();
  });

  afterEach(() => {
    wrapper?.unmount();
    boundary.remove();
    restoreLayout();
  });

  async function mountList(
    options: {
      highlightedIndex?: number;
      slot?: (props: { suggestion: RichSuggestion; active: boolean }) => unknown;
    } = {},
  ) {
    wrapper = mount(OTemplateSuggestList, {
      attachTo: document.body,
      props: {
        open: true,
        reference: field,
        boundary,
        matches: MATCHES,
        highlightedIndex: options.highlightedIndex ?? 0,
        dataTest: "msg",
      },
      slots: options.slot ? { suggestion: options.slot } : undefined,
    });
    await flushPromises();
    return wrapper;
  }

  const rows = () => Array.from(document.body.querySelectorAll('[role="option"]'));

  // reka registers its outside-pointerdown listener on a macrotask after the popover opens.
  async function settleOutsideListener() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("renders {{name}} in each row by default", async () => {
    await mountList();
    expect(rows().map((row) => row.textContent?.trim())).toEqual([
      "{{BASE_URL}}",
      "{{TOKEN}}",
      "{{input}}",
    ]);
  });

  it("hands the whole suggestion and the active flag to the suggestion slot", async () => {
    await mountList({
      highlightedIndex: 1,
      slot: ({ suggestion, active }) =>
        h("span", `${suggestion.name}:${suggestion.secret ? "secret" : "plain"}:${active}`),
    });
    expect(rows().map((row) => row.textContent?.trim())).toEqual([
      "BASE_URL:plain:false",
      "TOKEN:secret:true",
      "input:plain:false",
    ]);
  });

  it("is a named listbox with option rows", async () => {
    await mountList();
    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox?.getAttribute("aria-label")).toBe("Variable suggestions");
    expect(listbox?.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(document.body.querySelector('[data-test="msg-suggest"]')).not.toBeNull();
    expect(document.body.querySelector('[data-test="msg-suggest-item-TOKEN"]')).not.toBeNull();
  });

  it("emits select on a row click and leaves focus on the field", async () => {
    await mountList();
    const row = document.body.querySelector('[data-test="msg-suggest-item-TOKEN"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["TOKEN"]]);
    expect(document.activeElement).toBe(field);
  });

  it("emits highlight when the pointer moves over a row", async () => {
    await mountList();
    const row = document.body.querySelector('[data-test="msg-suggest-item-input"]') as HTMLElement;
    row.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(wrapper.emitted("highlight")).toEqual([[2]]);
  });

  it("positions rows through a virtual spacer and per-row transforms", async () => {
    await mountList();
    const spacer = document.body.querySelector('[role="listbox"] [style*="height"]') as HTMLElement;
    expect(spacer.style.height).toBe("84px");
    const transforms = Array.from(spacer.children).map(
      (row) => (row as HTMLElement).style.transform,
    );
    expect(transforms).toEqual(["translateY(0px)", "translateY(28px)", "translateY(56px)"]);
  });

  it("asks to close when a pointerdown lands outside the boundary", async () => {
    await mountList();
    await settleOutsideListener();
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("does not ask to close on a pointerdown inside the boundary", async () => {
    await mountList();
    await settleOutsideListener();
    field.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("renders nothing while closed", async () => {
    await mountList();
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.body.querySelector('[data-test="msg-suggest"]')).toBeNull();
  });
});
