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

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import MuteMenuItems from "./MuteMenuItems.vue";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DropdownMenuPortal: actual.DropdownMenuContent };
});

const openMenu = (props: Record<string, unknown>) =>
  mount(
    defineComponent({
      setup: () => () =>
        h(
          ODropdown,
          { open: true },
          {
            trigger: () => h("button", "open"),
            default: () => h(MuteMenuItems, { dataTestPrefix: "menu", ...props }),
          },
        ),
    }),
    { attachTo: document.body },
  );

const itemTests = () =>
  [...document.querySelectorAll<HTMLElement>('[data-test^="menu-"]')].map((el) => el.dataset.test);

describe("Mute menu items", () => {
  it("lists the shared presets and Until… with no Until it clears by default", async () => {
    const wrapper = openMenu({});
    await flushPromises();
    expect(itemTests()).toEqual(["menu-30m", "menu-1h", "menu-4h", "menu-24h", "menu-until"]);
    expect(wrapper.text()).not.toContain("Until it clears");
    wrapper.unmount();
  });

  it("puts Until it clears first when one alert is in scope, and emits it", async () => {
    const onUntilClear = vi.fn();
    const onPreset = vi.fn();
    const wrapper = openMenu({ untilClear: true, onUntilClear, onPreset });
    await flushPromises();
    expect(itemTests()[0]).toBe("menu-until-clear");
    const first = document.querySelector<HTMLElement>('[data-test="menu-until-clear"]');
    expect(first?.textContent).toContain("Until it clears");
    first?.click();
    await flushPromises();
    expect(onUntilClear).toHaveBeenCalledTimes(1);
    expect(onPreset).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("emits the preset length in seconds", async () => {
    const onPreset = vi.fn();
    const wrapper = openMenu({ untilClear: true, onPreset });
    await flushPromises();
    document.querySelector<HTMLElement>('[data-test="menu-4h"]')?.click();
    await flushPromises();
    expect(onPreset).toHaveBeenCalledWith(14400);
    wrapper.unmount();
  });
});
