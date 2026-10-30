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
import { h } from "vue";
import { z } from "zod";
import OFormTemplateInput from "./OFormTemplateInput.vue";
import OForm from "../Form/OForm.vue";

const SUGGESTIONS = [{ name: "BASE_URL" }, { name: "input" }];

/** The slice of OForm's exposed TanStack `form` these tests read. */
interface ExposedForm {
  handleSubmit: () => Promise<unknown>;
  state: { isValid: boolean; values: Record<string, unknown> };
}

const formOf = (w: VueWrapper): ExposedForm => (w.vm as unknown as { form: ExposedForm }).form;

const driveSubmit = async (w: VueWrapper) => {
  await formOf(w).handleSubmit();
  await flushPromises();
};

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

describe("OFormTemplateInput", () => {
  let wrapper: VueWrapper;
  let restoreLayout: () => void;

  beforeEach(() => {
    restoreLayout = stubLayout();
  });

  afterEach(() => {
    wrapper?.unmount();
    restoreLayout();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { title: "" } },
      slots: {
        default: () => h(OFormTemplateInput, { name: "title", suggestions: SUGGESTIONS }),
      },
      global: { components: { OFormTemplateInput } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(true);
  });

  it("propagates the default value into the input", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { title: "{{service}} deployed" } },
      slots: {
        default: () => h(OFormTemplateInput, { name: "title", suggestions: SUGGESTIONS }),
      },
      global: { components: { OFormTemplateInput } },
    });
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(input.value).toBe("{{service}} deployed");
  });

  it("shows no error before the first submit", () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { title: "" },
        schema: z.object({ title: z.string().min(1, "Title is required") }),
      },
      slots: {
        default: () => h(OFormTemplateInput, { name: "title", suggestions: SUGGESTIONS }),
      },
      global: { components: { OFormTemplateInput } },
    });
    expect(wrapper.text()).not.toContain("Title is required");
  });

  it("shows the schema error after submit when empty, and clears it on change", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { title: "" },
        schema: z.object({ title: z.string().min(1, "Title is required") }),
      },
      slots: {
        default: () => h(OFormTemplateInput, { name: "title", suggestions: SUGGESTIONS }),
      },
      global: { components: { OFormTemplateInput } },
    });
    await driveSubmit(wrapper);
    expect(wrapper.text()).toContain("Title is required");

    await wrapper.find("input").setValue("deploy");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Title is required");
  });

  it("forwards a typed value into the form (drives validity)", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { title: "" },
        schema: z.object({ title: z.string().min(1, "Title is required") }),
      },
      slots: {
        default: () => h(OFormTemplateInput, { name: "title", suggestions: SUGGESTIONS }),
      },
      global: { components: { OFormTemplateInput } },
    });
    const form = formOf(wrapper);
    expect(form.state.isValid).toBe(true); // not validated until submit

    await driveSubmit(wrapper);
    expect(form.state.isValid).toBe(false);

    const input = wrapper.find("input");
    await input.setValue("deploy");
    await flushPromises();
    await driveSubmit(wrapper);
    expect(form.state.isValid).toBe(true);
    expect(form.state.values.title).toBe("deploy");
  });

  it("opens the suggestion list on {{, reaching the rendered input", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { title: "" } },
      slots: {
        default: () =>
          h(OFormTemplateInput, { name: "title", suggestions: SUGGESTIONS, "data-test": "title" }),
      },
      global: { components: { OFormTemplateInput } },
      attachTo: document.body,
    });
    const field = wrapper.get('[data-test="title-field"]').element as HTMLInputElement;
    field.focus();
    field.value = "{{ba";
    field.setSelectionRange(4, 4);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const row = document.body.querySelector('[data-test="title-suggest-item-BASE_URL"]');
    expect(row).not.toBeNull();
  });

  it("with delimiter=single, opens the list on a lone {", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { title: "" } },
      slots: {
        default: () =>
          h(OFormTemplateInput, {
            name: "title",
            suggestions: SUGGESTIONS,
            delimiter: "single",
            "data-test": "title",
          }),
      },
      global: { components: { OFormTemplateInput } },
      attachTo: document.body,
    });
    const field = wrapper.get('[data-test="title-field"]').element as HTMLInputElement;
    field.focus();
    field.value = "{ba";
    field.setSelectionRange(3, 3);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const row = document.body.querySelector('[data-test="title-suggest-item-BASE_URL"]');
    expect(row).not.toBeNull();
    expect(row?.textContent?.trim()).toBe("{BASE_URL}");
  });
});
