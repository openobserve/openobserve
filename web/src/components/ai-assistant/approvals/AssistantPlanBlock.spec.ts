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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { approvalOf } from "@/composables/assistant/reducer";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantPlanBlock from "./AssistantPlanBlock.vue";

const routes = [{ path: "/alerts/:alert_id", name: "alertDetail", component: {} }];

const batch = (n: number) =>
  approvalOf({
    type: "confirmation_required",
    tool: "o2_delete",
    args: {
      items: Array.from({ length: n }, (_, i) => ({
        resource_type: "alert",
        name: `alert-${i + 1}`,
        id: `a${i + 1}`,
      })),
    },
  });

function mountPlan(n: number, editable = true) {
  const card = batch(n);
  return mount(AssistantPlanBlock, {
    props: { card, editable, selected: card.targets.map((t) => t.id!), org: "default" },
    attachTo: document.body,
    global: { plugins: [fakeRouter(routes)] },
  });
}

describe("AssistantPlanBlock", () => {
  it("says what it will delete, one tick box per item, checked, with the keep hint", () => {
    const wrapper = mountPlan(3);
    expect(wrapper.text()).toContain("I'll delete 3 alerts:");
    expect(wrapper.findAll('[data-test^="assistant-plan-item-a"]')).toHaveLength(3);
    expect(wrapper.text()).toContain("Untick anything you want to keep.");
    const open = wrapper.get('[data-test="assistant-plan-item-open-a1"]');
    expect(open.attributes("target")).toBe("_blank");
    expect(open.attributes("aria-label")).toBe("Open alert-1 (opens in a new tab)");
  });

  it("emits the kept items in their own order when one is unticked", async () => {
    const wrapper = mountPlan(3);
    await wrapper.get('[data-test="assistant-plan-item-a2"] button').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:selected")?.[0]?.[0]).toEqual(["a1", "a3"]);
  });

  it("lists the first 20 of a large batch and the rest on Show all", async () => {
    const wrapper = mountPlan(37);
    expect(wrapper.findAll('[data-test^="assistant-plan-item-a"]')).toHaveLength(20);
    const all = wrapper.get('[data-test="assistant-plan-show-all"]');
    expect(all.text()).toBe("Show all 37");
    await all.trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-test^="assistant-plan-item-a"]')).toHaveLength(37);
    expect(
      wrapper.get('[data-test="assistant-plan-item-a21"]').element.contains(document.activeElement),
    ).toBe(true);
    wrapper.unmount();
  });

  it("is a plain list when it cannot be edited", () => {
    const wrapper = mountPlan(2, false);
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Untick");
  });
});
