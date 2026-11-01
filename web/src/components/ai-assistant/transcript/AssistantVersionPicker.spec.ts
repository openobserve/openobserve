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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AssistantVersionPicker from "./AssistantVersionPicker.vue";

describe("AssistantVersionPicker", () => {
  it("renders nothing for a single attempt", () => {
    expect(mount(AssistantVersionPicker, { props: { current: 1, count: 1 } }).html()).toBe(
      "<!--v-if-->",
    );
  });

  it("is two named buttons with the count as text, named version n of count (EB-09 AC 11-12)", async () => {
    const wrapper = mount(AssistantVersionPicker, { props: { current: 2, count: 2 } });
    const group = wrapper.get('[data-test="assistant-version-picker"]');
    expect(group.attributes("role")).toBe("group");
    expect(group.attributes("aria-label")).toBe("Version 2 of 2");
    expect(wrapper.get('[data-test="assistant-version-count"]').text()).toBe("2 of 2");
    expect(wrapper.get('[data-test="assistant-version-prev"]').attributes("aria-label")).toBe(
      "Previous version",
    );
    expect(wrapper.get('[data-test="assistant-version-next"]').attributes("aria-disabled")).toBe(
      "true",
    );
    await wrapper.get('[data-test="assistant-version-prev"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([[1]]);
    await wrapper.get('[data-test="assistant-version-next"]').trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("keeps the end buttons focusable with a reason, so focus never drops (EB-09 AC 12)", () => {
    const wrapper = mount(AssistantVersionPicker, { props: { current: 1, count: 2 } });
    const prev = wrapper.get('[data-test="assistant-version-prev"]');
    expect(prev.attributes("disabled")).toBeUndefined();
    expect(prev.attributes("aria-disabled")).toBe("true");
    expect(wrapper.text()).toContain("This is the first version");
  });
});
