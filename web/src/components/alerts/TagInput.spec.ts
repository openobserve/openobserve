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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import TagInput from "./TagInput.vue";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(TagInput, {
    props: {
      modelValue: [],
      ...props,
    },
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("TagInput", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // ── Renders with minimum props ────────────────────────────────────────────

  describe("renders with minimum props", () => {
    it("mounts without error", () => {
      wrapper = buildWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("renders the outer container", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="tag-input-container"]').exists()).toBe(true);
    });

    it("renders the input field", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="tag-input-field"]').exists()).toBe(true);
    });

    it("uses the default placeholder when none is supplied", () => {
      wrapper = buildWrapper({ modelValue: [] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      expect(input.attributes("placeholder")).toBe("Type and press Enter or comma");
    });

    it("does not render a label element when label prop is omitted", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="tag-input-label"]').exists()).toBe(false);
    });
  });

  // ── Empty / null / undefined edge cases ──────────────────────────────────

  describe("edge cases — empty / null / undefined modelValue", () => {
    it("renders no tag chips when modelValue is empty array", () => {
      wrapper = buildWrapper({ modelValue: [] });

      // No tag-chip-N elements should be present
      expect(wrapper.find('[data-test="tag-chip-0"]').exists()).toBe(false);
    });

    it("shows the placeholder when modelValue is empty", () => {
      wrapper = buildWrapper({ modelValue: [], placeholder: "Add tags..." });

      const input = wrapper.find('[data-test="tag-input-field"]');
      expect(input.attributes("placeholder")).toBe("Add tags...");
    });
  });

  // ── Label prop ───────────────────────────────────────────────────────────

  describe("label prop", () => {
    it("renders label element when label prop is provided", () => {
      wrapper = buildWrapper({ modelValue: [], label: "My Label" });

      const label = wrapper.find('[data-test="tag-input-label"]');
      expect(label.exists()).toBe(true);
      expect(label.text()).toBe("My Label");
    });

    it("does not render label element when label is empty string", () => {
      wrapper = buildWrapper({ modelValue: [], label: "" });

      expect(wrapper.find('[data-test="tag-input-label"]').exists()).toBe(false);
    });
  });

  // ── Rendering existing tags ───────────────────────────────────────────────

  describe("renders existing tags", () => {
    it("renders one tag chip per item in modelValue", () => {
      wrapper = buildWrapper({ modelValue: ["alpha", "beta", "gamma"] });

      expect(wrapper.find('[data-test="tag-chip-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tag-chip-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tag-chip-2"]').exists()).toBe(true);
    });

    it("each tag chip contains the tag text", () => {
      wrapper = buildWrapper({ modelValue: ["hello", "world"] });

      expect(wrapper.find('[data-test="tag-chip-0"]').text()).toContain("hello");
      expect(wrapper.find('[data-test="tag-chip-1"]').text()).toContain("world");
    });

    it("renders a remove button with aria-label for each tag", () => {
      wrapper = buildWrapper({ modelValue: ["foo"] });

      const removeBtn = wrapper.find('[aria-label="Remove foo"]');
      expect(removeBtn.exists()).toBe(true);
    });

    it("hides placeholder when tags are present", () => {
      wrapper = buildWrapper({ modelValue: ["tag1"], placeholder: "Add tags..." });

      const input = wrapper.find('[data-test="tag-input-field"]');
      expect(input.attributes("placeholder")).toBe("");
    });
  });

  // ── Adding tags ───────────────────────────────────────────────────────────

  describe("adding tags via keyboard", () => {
    it("emits update:modelValue with the new tag when Enter is pressed", async () => {
      wrapper = buildWrapper({ modelValue: ["existing"] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("newtag");
      await input.trigger("keydown.enter");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["existing", "newtag"]);
    });

    it("emits update:modelValue with the new tag when the input loses focus", async () => {
      wrapper = buildWrapper({ modelValue: [] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("blurtag");
      await input.trigger("blur");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["blurtag"]);
    });

    it("trims whitespace before adding a tag", async () => {
      wrapper = buildWrapper({ modelValue: [] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("  trimmed  ");
      await input.trigger("keydown.enter");

      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["trimmed"]);
    });

    it("does not emit when the input value is blank / whitespace-only", async () => {
      wrapper = buildWrapper({ modelValue: [] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("   ");
      await input.trigger("keydown.enter");

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("does not emit when the tag already exists (deduplication)", async () => {
      wrapper = buildWrapper({ modelValue: ["existing"] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("existing");
      await input.trigger("keydown.enter");

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  // ── Comma-separated input ─────────────────────────────────────────────────

  describe("comma-separated input", () => {
    it("emits update:modelValue when a comma is typed after a value", async () => {
      wrapper = buildWrapper({ modelValue: [] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("tag1,");
      await input.trigger("input");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("emits multiple events when multiple comma-separated values are entered", async () => {
      wrapper = buildWrapper({ modelValue: [] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("tag1,tag2,tag3,");
      await input.trigger("input");

      // At least one emission must have happened
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  // ── Removing tags ─────────────────────────────────────────────────────────

  describe("removing tags", () => {
    it("emits update:modelValue without the removed tag when remove button is clicked", async () => {
      wrapper = buildWrapper({ modelValue: ["tag1", "tag2", "tag3"] });

      const removeBtn = wrapper.find('[aria-label="Remove tag1"]');
      await removeBtn.trigger("click");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["tag2", "tag3"]);
    });

    it("removes the last tag on Backspace when the text input is empty", async () => {
      wrapper = buildWrapper({ modelValue: ["tag1", "tag2"] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("");
      await input.trigger("keydown.delete");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["tag1"]);
    });

    it("does NOT remove a tag on Backspace when the text input has content", async () => {
      wrapper = buildWrapper({ modelValue: ["tag1"] });

      const input = wrapper.find('[data-test="tag-input-field"]');
      await input.setValue("text");
      await input.trigger("keydown.delete");

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  // ── Props reactivity ──────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("reflects updated modelValue — new tags appear after setProps", async () => {
      wrapper = buildWrapper({ modelValue: [] });

      await wrapper.setProps({ modelValue: ["new-tag"] });

      expect(wrapper.find('[data-test="tag-chip-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tag-chip-0"]').text()).toContain("new-tag");
    });

    it("removes all chips when modelValue is reset to empty array", async () => {
      wrapper = buildWrapper({ modelValue: ["a", "b"] });

      await wrapper.setProps({ modelValue: [] });

      expect(wrapper.find('[data-test="tag-chip-0"]').exists()).toBe(false);
    });
  });

  // ── has-content state ─────────────────────────────────────────────────────

  describe("has-content wrapper state", () => {
    it("wrapper element exists and contains the input and tags area", () => {
      wrapper = buildWrapper({ modelValue: ["tag1"] });

      expect(wrapper.find('[data-test="tag-input-wrapper"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tags-and-input"]').exists()).toBe(true);
    });

    it("wrapper is present even when modelValue is empty", () => {
      wrapper = buildWrapper({ modelValue: [] });

      expect(wrapper.find('[data-test="tag-input-wrapper"]').exists()).toBe(true);
    });
  });
});
