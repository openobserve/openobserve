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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import OTooltip from "./OTooltip.vue";

// The real portal puts the bubble outside the trigger, which is what the move-away fallback must allow for.
describe("OTooltip hoverable bubble", () => {
  it("stays open when mouseleave is lost and the pointer moves into its own bubble", async () => {
    vi.useFakeTimers();
    const host = mount(
      {
        render: () =>
          h("button", { "data-test": "trigger" }, [
            h(OTooltip, { content: "Detailed failure", delay: 0, hoverable: true }),
          ]),
      },
      { attachTo: document.body },
    );
    try {
      host.get('[data-test="trigger"]').element.dispatchEvent(new MouseEvent("mouseenter"));
      await nextTick();
      await nextTick();
      const content = document.querySelector('[data-test="o-tooltip-content"]')!;
      expect(content).not.toBeNull();

      content.dispatchEvent(new MouseEvent("mouseenter"));
      content.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.advanceTimersByTime(121);
      await nextTick();

      expect(host.getComponent(OTooltip).findComponent({ name: "TooltipRoot" }).props("open")).toBe(
        true,
      );
    } finally {
      host.unmount();
      vi.useRealTimers();
    }
  });
});
