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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TagInput from "./TagInput.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

describe("TagInput", () => {
  it("should render the component", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render tag input container", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const container = wrapper.find('[data-test="tag-input-container"]');
    expect(container.exists()).toBe(true);
  });

  it("should render input field", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    expect(input.exists()).toBe(true);
  });

  it("should display label when provided", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
        label: "Test Label",
      },
    });

    const label = wrapper.find('[data-test="tag-input-label"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe("Test Label");
  });

  it("should display placeholder when no tags", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
        placeholder: "Add tags...",
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    expect(input.attributes("placeholder")).toBe("Add tags...");
  });

  it("should render existing tags as chips", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2", "tag3"],
      },
    });

    const chips = wrapper.findAll(".tag-chip");
    expect(chips).toHaveLength(3);
  });

  it("should emit update:modelValue when adding a tag with Enter", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["existing"],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("newtag");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(emittedValue).toEqual(["existing", "newtag"]);
  });

  it("should add tag when input loses focus", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("blurtag");
    await input.trigger("blur");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(emittedValue).toEqual(["blurtag"]);
  });

  it("should add tag when comma is typed", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("tag1,");
    await input.trigger("input");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should not add empty tags", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("   ");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should not add duplicate tags", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["existing"],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("existing");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should remove tag when chip is removed", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2", "tag3"],
      },
    });

    // Find the first QChip component and trigger its remove event
    const chips = wrapper.findAllComponents({ name: "QChip" });
    await chips[0].vm.$emit("remove");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(emittedValue).toEqual(["tag2", "tag3"]);
  });

  it("should remove last tag on backspace when input is empty", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2"],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("");
    await input.trigger("keydown.delete");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(emittedValue).toEqual(["tag1"]);
  });

  it("should not remove tags on backspace when input has content", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1"],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("text");
    await input.trigger("keydown.delete");

    // Should not emit since input has content
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should handle multiple comma-separated values", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("tag1,tag2,tag3,");
    await input.trigger("input");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should trim whitespace from tags", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find('[data-test="tag-input-field"]');
    await input.setValue("  trimmed  ");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(emittedValue).toEqual(["trimmed"]);
  });

  it("should have has-content class when tags exist", async () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1"],
      },
    });

    const tagWrapper = wrapper.find('[data-test="tag-input-wrapper"]');
    expect(tagWrapper.classes()).toContain("has-content");
  });

  it("should not have has-content class when no tags and no input", () => {
    const wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const tagWrapper = wrapper.find('[data-test="tag-input-wrapper"]');
    expect(tagWrapper.classes()).not.toContain("has-content");
  });
});
