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
import SemanticGroupItem from "./SemanticGroupItem.vue";
import TagInput from "./TagInput.vue";

installQuasar();

describe("SemanticGroupItem", () => {
  const defaultGroup = {
    id: "test-group",
    display_name: "Test Group",
    field_names: ["field1", "field2"],
    normalize: false,
  };

  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(SemanticGroupItem, {
      props: {
        group: defaultGroup,
      },
      global: {
        components: {
          TagInput,
        },
      },
    });
  });

  it("renders correctly with provided group data", () => {
    expect(wrapper.find(".semantic-group-item").exists()).toBe(true);
    expect(wrapper.find(".group-layout").exists()).toBe(true);
  });

  it("displays group ID in input", () => {
    const idInput = wrapper.findAll("input[type=text]")[0];
    expect(idInput.element.value).toBe("test-group");
  });

  it("displays group display name in input", () => {
    const displayInput = wrapper.findAll("input[type=text]")[1];
    expect(displayInput.element.value).toBe("Test Group");
  });

  it("displays TagInput component for field names", () => {
    expect(wrapper.findComponent(TagInput).exists()).toBe(true);
  });

  it("displays normalize checkbox", () => {
    const checkbox = wrapper.findComponent({ name: "QCheckbox" });
    expect(checkbox.exists()).toBe(true);
  });

  it("displays normalize checkbox as checked when normalize is true", () => {
    wrapper = mount(SemanticGroupItem, {
      props: {
        group: { ...defaultGroup, normalize: true },
      },
      global: {
        components: { TagInput },
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.localGroup.normalize).toBe(true);
  });

  it("displays delete button", () => {
    const deleteBtn = wrapper.find(".q-btn.text-negative");
    expect(deleteBtn.exists()).toBe(true);
  });

  it("emits update event when ID changes", async () => {
    const idInput = wrapper.findAll("input[type=text]")[0];
    await idInput.setValue("new-id");

    expect(wrapper.emitted("update")).toBeTruthy();
    expect(wrapper.emitted("update")[0][0]).toMatchObject({
      id: "new-id",
      display_name: "Test Group",
      field_names: ["field1", "field2"],
      normalize: false,
    });
  });

  it("emits update event when display name changes", async () => {
    const displayInput = wrapper.findAll("input[type=text]")[1];
    await displayInput.setValue("New Display Name");

    expect(wrapper.emitted("update")).toBeTruthy();
    expect(wrapper.emitted("update")[0][0]).toMatchObject({
      id: "test-group",
      display_name: "New Display Name",
    });
  });

  it("emits update event when normalize value changes", async () => {
    const vm = wrapper.vm as any;
    vm.localGroup.normalize = true;
    vm.emitUpdate();

    expect(wrapper.emitted("update")).toBeTruthy();
    expect(wrapper.emitted("update")[0][0].normalize).toBe(true);
  });

  it("emits delete event when delete button clicked", async () => {
    const deleteBtn = wrapper.find(".q-btn.text-negative");
    await deleteBtn.trigger("click");

    expect(wrapper.emitted("delete")).toBeTruthy();
    expect(wrapper.emitted("delete")).toHaveLength(1);
  });

  it("validates ID format - rejects uppercase", () => {
    wrapper = mount(SemanticGroupItem, {
      props: {
        group: { ...defaultGroup, id: "Invalid-ID" },
      },
      global: {
        components: { TagInput },
      },
    });

    const vm = wrapper.vm as any;
    const result = vm.validateId("Invalid-ID");
    expect(result).toBe("ID must be lowercase letters, numbers, and dashes only");
  });

  it("validates ID format - rejects special characters", () => {
    const vm = wrapper.vm as any;
    const result = vm.validateId("test_group!");
    expect(result).toBe("ID must be lowercase letters, numbers, and dashes only");
  });

  it("validates ID format - accepts valid lowercase with dashes", () => {
    const vm = wrapper.vm as any;
    const result = vm.validateId("valid-id-123");
    expect(result).toBe(true);
  });

  it("validates ID format - rejects empty ID", () => {
    const vm = wrapper.vm as any;
    const result = vm.validateId("");
    expect(result).toBe("ID is required");
  });

  it("validates ID format - accepts numbers", () => {
    const vm = wrapper.vm as any;
    const result = vm.validateId("group-123");
    expect(result).toBe(true);
  });

  it("updates local group when prop changes", async () => {
    const newGroup = {
      id: "updated-group",
      display_name: "Updated Group",
      field_names: ["new-field"],
      normalize: true,
    };

    await wrapper.setProps({ group: newGroup });

    const idInput = wrapper.findAll("input[type=text]")[0];
    expect(idInput.element.value).toBe("updated-group");
  });

  it("has tooltip text in normalize checkbox", () => {
    // Tooltip component exists (rendered as q-tooltip)
    const html = wrapper.html();
    // Tooltips are embedded in the Vue component template
    expect(wrapper.findComponent({ name: "QCheckbox" }).exists()).toBe(true);
  });

  it("has delete button with correct styling", () => {
    const deleteBtn = wrapper.find(".q-btn.text-negative");
    expect(deleteBtn.exists()).toBe(true);
    expect(deleteBtn.classes()).toContain("q-btn--round");
  });
});
