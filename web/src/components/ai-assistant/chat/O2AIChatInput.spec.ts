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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import O2AIChatInput from "./O2AIChatInput.vue";

const RichTextInputStub = {
  name: "RichTextInput",
  template: '<div data-test="rich-text-input" />',
  props: ["modelValue", "placeholder", "disabled", "theme", "references", "borderless"],
  emits: ["update:modelValue", "keydown", "submit", "update:references"],
  methods: { focusInput() {} },
};

function mountInput(extra: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  return mount(O2AIChatInput, {
    global: { plugins: [i18n], stubs: { RichTextInput: RichTextInputStub } },
    props: {
      modelValue: "",
      autoNavigation: true,
      pendingImages: [],
      placeholder: "Write your prompt" as any,
      isLoading: false,
      theme: "light",
      references: [],
      ...extra,
    },
    attrs,
  });
}

describe("O2AIChatInput", () => {
  it("forwards the RichTextInput instance on mount and null on unmount", () => {
    const w = mountInput();
    const rich = w.findComponent({ name: "RichTextInput" });
    const first = w.emitted("input-ref")?.[0][0] as any;
    expect(first.$el).toBe(rich.element);
    expect(typeof first.focusInput).toBe("function");

    w.unmount();
    expect(w.emitted("input-ref")?.at(-1)).toEqual([null]);
  });

  it("relays RichTextInput model, references, keydown and submit", () => {
    const w = mountInput();
    const rich = w.findComponent({ name: "RichTextInput" });
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    rich.vm.$emit("update:modelValue", "typed");
    rich.vm.$emit("update:references", [{ id: "r" }]);
    rich.vm.$emit("keydown", event);
    rich.vm.$emit("submit");
    expect(w.emitted("update:modelValue")).toEqual([["typed"]]);
    expect(w.emitted("update:references")).toEqual([[[{ id: "r" }]]]);
    expect(w.emitted("keydown")?.[0][0]).toBe(event);
    expect(w.emitted("send")).toEqual([[]]);
    expect(w.emitted("keydown")).toHaveLength(1);
  });

  it("disables send until there is text or an image", async () => {
    const empty = mountInput();
    expect(empty.find(".send-button").attributes("disabled")).toBeDefined();
    const withText = mountInput({ modelValue: "  hi " });
    expect(withText.find(".send-button").attributes("disabled")).toBeUndefined();
    const withImage = mountInput({
      pendingImages: [{ filename: "a.png", mimeType: "image/png", data: "A", size: 2048 }],
    });
    expect(withImage.find(".send-button").attributes("disabled")).toBeUndefined();
    await withImage.find(".image-remove-btn").trigger("click");
    expect(withImage.emitted("remove-image")).toEqual([[0]]);
  });

  it("swaps send for stop while loading and emits cancel", async () => {
    const w = mountInput({ isLoading: true });
    expect(w.find(".send-button").exists()).toBe(false);
    expect(w.find(".image-upload-btn").exists()).toBe(false);
    await w.find(".stop-button").trigger("click");
    expect(w.emitted("cancel")).toEqual([[]]);
  });

  it("toggles auto navigation through v-model and emits image upload", async () => {
    const w = mountInput({ autoNavigation: false });
    await w.find(".auto-nav-toggle-btn").trigger("click");
    expect(w.emitted("update:autoNavigation")).toEqual([[true]]);
    await w.find(".image-upload-btn").trigger("click");
    expect(w.emitted("trigger-image-upload")).toEqual([[]]);
  });

  it("lets dragover, drop and paste listeners fall through to the root element", () => {
    let dragged = 0;
    const w = mountInput({}, { onDragover: () => dragged++ });
    w.find(".unified-input-box").element.dispatchEvent(new Event("dragover", { bubbles: true }));
    expect(dragged).toBe(1);
  });
});
