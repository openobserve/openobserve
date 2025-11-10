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

import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import TagInput from "./TagInput.vue";

installQuasar();

describe("TagInput", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: [],
        placeholder: "Type and press Enter",
        label: "Tags",
      },
    });
  });

  it("renders correctly with empty tags", () => {
    expect(wrapper.find(".tag-input-container").exists()).toBe(true);
    expect(wrapper.find(".tag-input").exists()).toBe(true);
    expect(wrapper.findAll(".tag-chip")).toHaveLength(0);
  });

  it("displays label when provided", () => {
    expect(wrapper.find(".tag-input-label").text()).toBe("Tags");
  });

  it("displays existing tags", () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2", "tag3"],
      },
    });
    expect(wrapper.findAll(".tag-chip")).toHaveLength(3);
  });

  it("adds tag on Enter key", async () => {
    const input = wrapper.find(".tag-input");
    await input.setValue("newtag");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")[0]).toEqual([["newtag"]]);
  });

  it("trims whitespace when adding tags", async () => {
    const input = wrapper.find(".tag-input");
    await input.setValue("  spaced  ");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")[0]).toEqual([["spaced"]]);
  });

  it("does not add empty tags", async () => {
    const input = wrapper.find(".tag-input");
    await input.setValue("   ");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("does not add duplicate tags", async () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["existing"],
      },
    });

    const input = wrapper.find(".tag-input");
    await input.setValue("existing");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("handles comma-separated input", async () => {
    const input = wrapper.find(".tag-input");
    await input.setValue("tag1,tag2,tag3");

    // The handleInput function should process commas
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    // Multiple emissions due to processing each comma
    const emissions = wrapper.emitted("update:modelValue");
    expect(emissions.length).toBeGreaterThan(0);
  });

  it("removes tag when remove button clicked", async () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2"],
      },
    });

    const removeButton = wrapper.find(".q-chip__icon--remove");
    await removeButton.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")[0]).toEqual([["tag2"]]);
  });

  it("removes last tag on backspace when input is empty", async () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2"],
      },
    });

    const input = wrapper.find(".tag-input");
    await input.setValue("");
    await input.trigger("keydown.delete");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")[0]).toEqual([["tag1"]]);
  });

  it("does not remove tags on backspace when input has text", async () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1"],
      },
    });

    const input = wrapper.find(".tag-input");
    await input.setValue("sometext");
    await input.trigger("keydown.delete");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("uses default placeholder when not provided", () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: [],
      },
    });

    const input = wrapper.find(".tag-input");
    expect(input.attributes("placeholder")).toBe("Type and press Enter or comma");
  });

  it("applies has-content class when tags exist", () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1"],
      },
    });

    expect(wrapper.find(".tag-input-wrapper").classes()).toContain("has-content");
  });

  it("applies has-content class when input has text", async () => {
    const input = wrapper.find(".tag-input");
    await input.setValue("typing");

    expect(wrapper.find(".tag-input-wrapper").classes()).toContain("has-content");
  });

  it("renders input element with correct type", () => {
    const input = wrapper.find(".tag-input");
    expect(input.element.tagName).toBe("INPUT");
    expect(input.attributes("type")).toBe("text");
  });

  it("displays all existing tags as chips", () => {
    wrapper = mount(TagInput, {
      props: {
        modelValue: ["tag1", "tag2", "tag3"],
      },
    });

    const chips = wrapper.findAll(".q-chip");
    expect(chips).toHaveLength(3);
  });

  it("renders tags-and-input container", () => {
    expect(wrapper.find(".tags-and-input").exists()).toBe(true);
  });

  it("renders tag-input-wrapper", () => {
    expect(wrapper.find(".tag-input-wrapper").exists()).toBe(true);
  });
});
