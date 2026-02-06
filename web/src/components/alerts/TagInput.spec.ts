// Copyright 2025 OpenObserve Inc.
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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import TagInput from "./TagInput.vue";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates mock props for TagInput
 */
function createMockProps(overrides = {}) {
  return {
    modelValue: [],
    placeholder: "Type and press Enter or comma",
    label: "",
    ...overrides,
  };
}

/**
 * Creates an array of sample tags
 */
function createSampleTags(count = 3) {
  return Array.from({ length: count }, (_, i) => `tag-${i + 1}`);
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Finds an element by data-test attribute
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Checks if an element exists by data-test id
 */
function existsByTestId(wrapper: VueWrapper, testId: string): boolean {
  return findByTestId(wrapper, testId).exists();
}

/**
 * Gets the input element
 */
function getInput(wrapper: VueWrapper) {
  return findByTestId(wrapper, "tag-input-field");
}

/**
 * Types text into the input field
 */
async function typeIntoInput(wrapper: VueWrapper, text: string) {
  const input = getInput(wrapper);
  await input.setValue(text);
  await flushPromises();
}

/**
 * Presses Enter key in input
 */
async function pressEnter(wrapper: VueWrapper) {
  const input = getInput(wrapper);
  await input.trigger("keydown.enter");
  await flushPromises();
}

/**
 * Presses Backspace key in input
 */
async function pressBackspace(wrapper: VueWrapper) {
  const input = getInput(wrapper);
  await input.trigger("keydown.delete");
  await flushPromises();
}

/**
 * Triggers blur event on input
 */
async function blurInput(wrapper: VueWrapper) {
  const input = getInput(wrapper);
  await input.trigger("blur");
  await flushPromises();
}

/**
 * Clicks remove button on a tag chip
 */
async function removeTagChip(wrapper: VueWrapper, index: number) {
  const chip = findByTestId(wrapper, `tag-chip-${index}`);
  // Find the remove button within the chip
  const removeBtn = chip.find(".q-chip__icon--remove");
  if (removeBtn.exists()) {
    await removeBtn.trigger("click");
    await flushPromises();
  }
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(props = {}) {
  const defaultProps = createMockProps(props);
  return mount(TagInput, {
    props: defaultProps,
  });
}

// ==================== TESTS ====================

describe("TagInput", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "tag-input-container")).toBe(true);
    });

    it("should render input field", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "tag-input-field")).toBe(true);
    });

    it("should display placeholder when no tags", () => {
      wrapper = mountComponent({ placeholder: "Enter tags" });
      const input = getInput(wrapper);
      expect(input.attributes("placeholder")).toBe("Enter tags");
    });

    it("should hide placeholder when tags exist", () => {
      wrapper = mountComponent({
        modelValue: ["tag1"],
        placeholder: "Enter tags",
      });
      const input = getInput(wrapper);
      expect(input.attributes("placeholder")).toBe("");
    });

    it("should render label when provided", () => {
      wrapper = mountComponent({ label: "Tags" });
      expect(existsByTestId(wrapper, "tag-input-label")).toBe(true);
      expect(findByTestId(wrapper, "tag-input-label").text()).toBe("Tags");
    });

    it("should not render label when not provided", () => {
      wrapper = mountComponent({ label: "" });
      expect(existsByTestId(wrapper, "tag-input-label")).toBe(false);
    });
  });

  describe("Tag Display", () => {
    it("should display existing tags as chips", () => {
      const tags = ["tag1", "tag2", "tag3"];
      wrapper = mountComponent({ modelValue: tags });

      expect(existsByTestId(wrapper, "tag-chip-0")).toBe(true);
      expect(existsByTestId(wrapper, "tag-chip-1")).toBe(true);
      expect(existsByTestId(wrapper, "tag-chip-2")).toBe(true);
    });

    it("should display correct tag text", () => {
      wrapper = mountComponent({ modelValue: ["Frontend", "Backend"] });
      const chip0 = findByTestId(wrapper, "tag-chip-0");
      const chip1 = findByTestId(wrapper, "tag-chip-1");

      expect(chip0.text()).toBe("Frontend");
      expect(chip1.text()).toBe("Backend");
    });

    it("should display no chips when modelValue is empty", () => {
      wrapper = mountComponent({ modelValue: [] });
      expect(existsByTestId(wrapper, "tag-chip-0")).toBe(false);
    });
  });

  describe("Adding Tags - Enter Key", () => {
    it("should add tag when pressing Enter", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "newtag");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["newtag"]]);
    });

    it("should clear input after adding tag", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "newtag");
      await pressEnter(wrapper);

      const input = getInput(wrapper);
      expect((input.element as HTMLInputElement).value).toBe("");
    });

    it("should trim whitespace from tags", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "  spacetag  ");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["spacetag"]]);
    });

    it("should not add empty tag", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "   ");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("should not add duplicate tag", async () => {
      wrapper = mountComponent({ modelValue: ["existing"] });
      await typeIntoInput(wrapper, "existing");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("should add multiple tags sequentially", async () => {
      wrapper = mountComponent();

      await typeIntoInput(wrapper, "tag1");
      await pressEnter(wrapper);
      await wrapper.setProps({ modelValue: ["tag1"] });

      await typeIntoInput(wrapper, "tag2");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.length).toBe(2);
    });
  });

  describe("Adding Tags - Comma Separator", () => {
    it("should add tag when typing comma", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "tag1,");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["tag1"]]);
    });

    it("should add multiple tags with single comma input", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "tag1,tag2,");

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted?.length).toBeGreaterThanOrEqual(1);
    });

    it("should keep text after last comma in input", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "tag1,incomplete");

      const input = getInput(wrapper);
      expect((input.element as HTMLInputElement).value).toBe("incomplete");
    });

    it("should handle comma without preceding text", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, ",");

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("should trim whitespace around commas", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, " tag1 , tag2 ,");

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
    });
  });

  describe("Adding Tags - Blur Event", () => {
    it("should add tag when input loses focus", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "blurtag");
      await blurInput(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["blurtag"]]);
    });

    it("should not add empty tag on blur", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "   ");
      await blurInput(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  describe("Removing Tags - Click", () => {
    it("should emit update when tag is removed", async () => {
      wrapper = mountComponent({ modelValue: ["tag1", "tag2"] });

      // Simulate remove by emitting the event
      const chip = findByTestId(wrapper, "tag-chip-0");
      await chip.trigger("remove");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["tag2"]]);
    });

    it("should remove correct tag by index", async () => {
      wrapper = mountComponent({ modelValue: ["tag1", "tag2", "tag3"] });

      const chip = findByTestId(wrapper, "tag-chip-1");
      await chip.trigger("remove");

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([
        ["tag1", "tag3"],
      ]);
    });

    it("should remove last tag", async () => {
      wrapper = mountComponent({ modelValue: ["only-tag"] });

      const chip = findByTestId(wrapper, "tag-chip-0");
      await chip.trigger("remove");

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([[]]);
    });
  });

  describe("Removing Tags - Backspace", () => {
    it("should remove last tag when pressing backspace on empty input", async () => {
      wrapper = mountComponent({ modelValue: ["tag1", "tag2"] });
      const input = getInput(wrapper);
      await input.setValue("");
      await pressBackspace(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["tag1"]]);
    });

    it("should not remove tag when input has text", async () => {
      wrapper = mountComponent({ modelValue: ["tag1"] });
      await typeIntoInput(wrapper, "some text");
      await pressBackspace(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("should not remove when no tags exist", async () => {
      wrapper = mountComponent({ modelValue: [] });
      await pressBackspace(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long tag names", async () => {
      const longTag = "a".repeat(200);
      wrapper = mountComponent();
      await typeIntoInput(wrapper, longTag);
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([[longTag]]);
    });

    it("should handle special characters in tags", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "tag@#$%");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["tag@#$%"]]);
    });

    it("should handle tags with spaces", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "multi word tag");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([
        ["multi word tag"],
      ]);
    });

    it("should handle tags with unicode characters", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "🔥emoji tag");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([
        ["🔥emoji tag"],
      ]);
    });

    it("should handle rapid tag additions", async () => {
      wrapper = mountComponent();

      await typeIntoInput(wrapper, "tag1");
      await pressEnter(wrapper);

      await typeIntoInput(wrapper, "tag2");
      await pressEnter(wrapper);

      await typeIntoInput(wrapper, "tag3");
      await pressEnter(wrapper);

      expect(wrapper.emitted("update:modelValue")?.length).toBe(3);
    });

    it("should handle multiple commas in succession", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "tag1,,,tag2,,");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should handle tags with only whitespace and comma", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "   ,   ");

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  describe("Label and Styling", () => {
    it("should apply has-content class when tags exist", () => {
      wrapper = mountComponent({ modelValue: ["tag1"] });
      const wrapperEl = findByTestId(wrapper, "tag-input-wrapper");
      expect(wrapperEl.classes()).toContain("has-content");
    });

    it("should apply has-content class when input has text", async () => {
      wrapper = mountComponent();
      await typeIntoInput(wrapper, "text");

      const wrapperEl = findByTestId(wrapper, "tag-input-wrapper");
      expect(wrapperEl.classes()).toContain("has-content");
    });

    it("should not apply has-content class when empty", () => {
      wrapper = mountComponent({ modelValue: [] });
      const wrapperEl = findByTestId(wrapper, "tag-input-wrapper");
      expect(wrapperEl.classes()).not.toContain("has-content");
    });

    it("should render label with correct text", () => {
      wrapper = mountComponent({ label: "Email Recipients" });
      const label = findByTestId(wrapper, "tag-input-label");
      expect(label.text()).toBe("Email Recipients");
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete user workflow", async () => {
      wrapper = mountComponent({ label: "Tags" });

      // Add first tag
      await typeIntoInput(wrapper, "frontend");
      await pressEnter(wrapper);
      await wrapper.setProps({ modelValue: ["frontend"] });

      // Add second tag with comma
      await typeIntoInput(wrapper, "backend,");
      await wrapper.setProps({ modelValue: ["frontend", "backend"] });

      // Add third tag on blur
      await typeIntoInput(wrapper, "devops");
      await blurInput(wrapper);
      await wrapper.setProps({ modelValue: ["frontend", "backend", "devops"] });

      // Try to add duplicate
      await typeIntoInput(wrapper, "frontend");
      await pressEnter(wrapper);

      // Remove middle tag
      const chip = findByTestId(wrapper, "tag-chip-1");
      await chip.trigger("remove");

      expect(wrapper.emitted("update:modelValue")?.length).toBeGreaterThan(0);
    });

    it("should handle tag limit scenario", async () => {
      const manyTags = createSampleTags(10);
      wrapper = mountComponent({ modelValue: manyTags });

      // All chips should render
      manyTags.forEach((_, index) => {
        expect(existsByTestId(wrapper, `tag-chip-${index}`)).toBe(true);
      });
    });

    it("should handle clear all tags", async () => {
      wrapper = mountComponent({ modelValue: ["tag1", "tag2", "tag3"] });

      // Remove all tags via backspace
      await pressBackspace(wrapper);
      await wrapper.setProps({ modelValue: ["tag1", "tag2"] });

      await pressBackspace(wrapper);
      await wrapper.setProps({ modelValue: ["tag1"] });

      await pressBackspace(wrapper);

      expect(wrapper.emitted("update:modelValue")?.length).toBe(3);
    });
  });

  describe("Performance", () => {
    it("should handle large number of existing tags", () => {
      const manyTags = createSampleTags(50);
      wrapper = mountComponent({ modelValue: manyTags });

      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "tag-input-field")).toBe(true);
    });

    it("should handle rapid input changes", async () => {
      wrapper = mountComponent();

      for (let i = 0; i < 10; i++) {
        await typeIntoInput(wrapper, `tag${i}`);
      }

      expect(wrapper.exists()).toBe(true);
    });
  });
});
