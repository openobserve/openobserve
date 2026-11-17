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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import MenuLink from "@/components/MenuLink.vue";
import store from "@/test/unit/helpers/store";

const src = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(src, path), "utf8");

function reducedMotionCss(css: string): string {
  const blocks: string[] = [];
  let at = css.indexOf("prefers-reduced-motion: reduce");
  while (at !== -1) {
    const open = css.indexOf("{", at);
    let depth = 1;
    let end = open + 1;
    while (depth > 0 && end < css.length) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
      end++;
    }
    blocks.push(css.slice(open, end));
    at = css.indexOf("prefers-reduced-motion: reduce", end);
  }
  return blocks.join("\n");
}

const CONTROLS = [
  "lib/core/Button/OButton.vue",
  "lib/core/ToggleGroup/OToggleGroupItem.vue",
  "lib/navigation/Tabs/OTab.vue",
  "lib/overlay/Dropdown/ODropdownItem.vue",
  "lib/overlay/Dropdown/ODropdownSub.vue",
  "lib/overlay/ContextMenu/OContextMenuItem.vue",
  "lib/forms/Select/OSelectItem.vue",
];

const MENUS = [
  "lib/overlay/Dropdown/ODropdown.vue",
  "lib/forms/Select/OSelect.vue",
  "lib/forms/Combobox/OCombobox.vue",
  "lib/overlay/Popover/OPopover.vue",
  "lib/overlay/ContextMenu/OContextMenu.vue",
];

const PANELS = ["lib/overlay/Dialog/ODialog.vue", "lib/overlay/Drawer/ODrawer.vue"];

describe("one set of motion timings (item 9)", () => {
  it("declares the shared control and panel timings as tokens", () => {
    const semantic = read("lib/styles/tokens/semantic.css");
    expect(semantic).toMatch(/--duration-control:\s*120ms/);
    expect(semantic).toMatch(/--ease-control:/);
    expect(semantic).toMatch(/--duration-dialog-in:\s*200ms/);
    expect(semantic).toMatch(/--duration-dialog-out:\s*150ms/);
  });

  it.each(CONTROLS)("colours %s with the shared control timing", (file) => {
    const code = read(file);
    expect(code).toContain("duration-(--duration-control)");
    expect(code).toContain("ease-(--ease-control)");
    expect(code).not.toContain("transition-all");
    expect(code).not.toContain("--duration-hover-");
  });

  it.each(MENUS)("opens and closes %s on the overlay timing tokens", (file) => {
    const code = read(file);
    expect(code).toContain("var(--duration-overlay-in)");
    expect(code).toContain("var(--duration-overlay-out)");
    expect(code).not.toMatch(/o2-reveal-[a-z]+-(in|out)_\d+ms/);
  });

  it.each(PANELS)("moves %s on the dialog timing tokens", (file) => {
    const code = read(file);
    expect(code).toContain("duration-(--duration-dialog-in)");
    expect(code).toContain("duration-(--duration-dialog-out)");
    expect(code).not.toMatch(/ease-\[cubic-bezier/);
    expect(code).not.toMatch(/data-\[state=(open|closed)\]:duration-\d/);
  });

  it("stops pulse, shimmer and bounce under reduced motion", () => {
    const reduced = reducedMotionCss(read("styles/tailwind.css"));
    for (const selector of [".animate-pulse", ".animate-bounce", ".skeleton-wave::after"]) {
      expect(reduced, selector).toContain(selector);
    }
    expect(reduced).toContain("o2-skel-shimmer");
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("pulses the nav-rail notification badge a finite number of times", () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    const wrapper = mount(MenuLink, {
      props: { title: "Alerts", caption: "", icon: "", link: "/", mini: false, badge: 3 },
      global: { plugins: [router], provide: { store } },
    });
    const badge = wrapper.find(".menu-badge");
    expect(badge.classes()).toContain("animate-pulse");
    expect(badge.classes().some((name) => /^\[animation-iteration-count:\d+\]$/.test(name))).toBe(
      true,
    );
    wrapper.unmount();
  });
});
