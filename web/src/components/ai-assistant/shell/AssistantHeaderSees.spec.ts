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
import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";

import AssistantHeaderSees from "./AssistantHeaderSees.vue";

const { chips, read } = vi.hoisted(() => ({
  chips: { value: [] as unknown[] },
  read: vi.fn(),
}));

vi.mock("@/composables/assistant", async () => {
  const { computed, reactive } = await import("vue");
  const live = reactive(chips);
  return {
    useAssistantStore: () => ({}),
    useAssistantContext: (sid: () => string | null) => {
      read(sid());
      return { chips: computed(() => live.value) };
    },
  };
});
vi.mock("@/components/ai-assistant/context/AssistantContextSeesPopover.vue", () => ({
  default: {
    name: "AssistantContextSeesPopover",
    props: ["sid", "placement"],
    template: '<button data-test="sees-stub" :data-sid="sid" :data-placement="placement" />',
  },
}));

describe("AssistantHeaderSees", () => {
  it("holds the ⓘ in the header only while the composer has no chip to sit beside", async () => {
    chips.value = [];
    const wrapper = mount(AssistantHeaderSees, { props: { sid: "s1" } });
    expect(read).toHaveBeenCalledWith("s1");
    const sees = wrapper.get('[data-test="assistant-shell-sees"]');
    expect(sees.attributes("data-sid")).toBe("s1");
    expect(sees.attributes("data-placement")).toBe("bottom");
    reactive(chips).value = [{ id: "time" }];
    await nextTick();
    expect(wrapper.find('[data-test="assistant-shell-sees"]').exists()).toBe(false);
  });

  it("counts a missing time chip as no chip", () => {
    chips.value = [null];
    const wrapper = mount(AssistantHeaderSees, { props: { sid: null } });
    expect(wrapper.find('[data-test="assistant-shell-sees"]').exists()).toBe(true);
  });
});
