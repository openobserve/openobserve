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
import { nextTick } from "vue";

import { raw } from "@/types/i18n";

import AssistantStatusRegion from "./AssistantStatusRegion.vue";

describe("AssistantStatusRegion", () => {
  it("is a visually hidden polite atomic status region", () => {
    const region = mount(AssistantStatusRegion).get('[data-test="assistant-status-region"]');
    expect(region.attributes()).toMatchObject({
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    });
    expect(region.classes()).toContain("sr-only");
    expect(region.text()).toBe("");
  });

  it("takes its data-test from the caller", () => {
    const wrapper = mount(AssistantStatusRegion, {
      props: { dataTest: "assistant-composer-status" },
    });
    expect(wrapper.find('[data-test="assistant-composer-status"]').exists()).toBe(true);
  });

  it("announces a sentence and drops an identical consecutive one", async () => {
    const wrapper = mount(AssistantStatusRegion);
    const vm = wrapper.vm as unknown as { announce: (text: string) => void };
    const region = () => wrapper.get('[data-test="assistant-status-region"]').element;
    const mutations: string[] = [];
    const observer = new MutationObserver(() => mutations.push(region().textContent ?? ""));
    observer.observe(region(), { childList: true, characterData: true, subtree: true });

    vm.announce(raw("Thinking."));
    await nextTick();
    vm.announce(raw("Thinking."));
    await nextTick();
    vm.announce(raw("Done."));
    await nextTick();
    vm.announce(raw("Thinking."));
    await nextTick();
    await Promise.resolve();
    observer.disconnect();

    expect(region().textContent?.trim()).toBe("Thinking.");
    expect(mutations.map((m) => m.trim()).filter(Boolean)).toEqual([
      "Thinking.",
      "Done.",
      "Thinking.",
    ]);
  });
});
