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

import AssistantComposerPlusMenu, { type ComposerPlusAction } from "./AssistantComposerPlusMenu.vue";

// ODropdown renders its items only when open; the stub renders them in place.
const stubs = {
  ODropdown: {
    name: "ODropdown",
    emits: ["close-auto-focus"],
    template: "<div><slot name='trigger' /><slot /></div>",
  },
  ODropdownItem: {
    emits: ["select"],
    template: "<div role='menuitem' @click=\"$emit('select')\"><slot /></div>",
  },
};

function setup(actions: ComposerPlusAction[], disabled = false) {
  return mount(AssistantComposerPlusMenu, { props: { actions, disabled }, global: { stubs } });
}

describe("AssistantComposerPlusMenu", () => {
  it("is one + button whose menu lists the offered items in a fixed order", () => {
    const wrapper = setup(["recall", "time", "attach", "context"]);
    const plus = wrapper.get('[data-test="assistant-composer-plus"]');
    expect(plus.attributes("aria-label")).toBe("Add to Message");
    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toEqual([
      "Attach Image",
      "Add Context",
      "Time Range",
      "Recent Prompts",
    ]);
    expect(
      wrapper.findAll('[role="menuitem"]').map((item) => item.attributes("data-test")),
    ).toEqual([
      "assistant-attach-image",
      "assistant-composer-add-context",
      "assistant-composer-time-range",
      "assistant-recall-open",
    ]);
  });

  it("lists only what it is given, draws nothing with nothing to offer, and turns off as a whole", () => {
    expect(setup(["context", "time"]).findAll('[role="menuitem"]')).toHaveLength(2);
    expect(setup([]).find('[data-test="assistant-composer-plus"]').exists()).toBe(false);
    expect(
      setup(["time"], true).get('[data-test="assistant-composer-plus"]').attributes("aria-disabled"),
    ).toBe("true");
  });

  it("keeps focus where an item moved it, except Attach Image, which hands it back to the +", async () => {
    const wrapper = setup(["attach", "context", "time", "recall"]);
    const menu = wrapper.findComponent({ name: "ODropdown" });
    const close = () => {
      const event = new Event("focus", { cancelable: true });
      menu.vm.$emit("close-auto-focus", event);
      return event.defaultPrevented;
    };
    const items = wrapper.findAll('[role="menuitem"]');
    for (const [index, kept] of [
      [0, false],
      [1, true],
      [2, true],
      [3, true],
    ] as const) {
      await items[index].trigger("click");
      expect(close()).toBe(kept);
    }
    expect(close()).toBe(false);
    expect(wrapper.emitted("select")).toEqual([["attach"], ["context"], ["time"], ["recall"]]);
  });
});
