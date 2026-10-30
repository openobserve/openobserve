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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";

import ODialog from "./Dialog/ODialog.vue";
import OPopover from "./Popover/OPopover.vue";
import OSheet from "./Sheet/OSheet.vue";
import { provideOverlayScope } from "./overlayScope";

enableAutoUnmount(afterEach);

// Mounts the overlay under a parent that provides (or not) the scope attribute.
function under(scoped: boolean, render: () => ReturnType<typeof h>) {
  const Host = defineComponent({
    setup() {
      if (scoped) provideOverlayScope({ "data-test-scope": "" });
      return render;
    },
  });
  return mount(Host, { attachTo: document.body });
}

const popover = (inner?: () => ReturnType<typeof h>) =>
  h(
    OPopover,
    { open: true },
    {
      trigger: () => h("button", "open"),
      default: () => h("div", { "data-testid": "outer" }, inner ? [inner()] : "body"),
    },
  );

describe("overlay scope", () => {
  it("puts the provided attributes on teleported popover content, nested popovers included", async () => {
    under(true, () => popover(() => popover()));
    await flushPromises();
    const contents = document.body.querySelectorAll("[data-o-popover-content]");
    expect(contents.length).toBe(2);
    contents.forEach((content) => expect(content.hasAttribute("data-test-scope")).toBe(true));
  });

  it("leaves overlays outside a scope untouched", async () => {
    under(false, () => popover());
    await flushPromises();
    const content = document.body.querySelector("[data-o-popover-content]")!;
    expect(content.hasAttribute("data-test-scope")).toBe(false);
  });

  it("reaches dialog and sheet content too", async () => {
    under(true, () =>
      h("div", [
        h(ODialog, { open: true, title: "t" }, { default: () => "dialog" }),
        h(OSheet, { open: true, ariaLabel: "s" }, { default: () => "sheet" }),
      ]),
    );
    await flushPromises();
    expect(document.body.querySelector("[data-o2-dialog]")?.hasAttribute("data-test-scope")).toBe(
      true,
    );
    expect(
      document.body
        .querySelector('[role="dialog"][aria-modal="false"]')
        ?.hasAttribute("data-test-scope"),
    ).toBe(true);
  });
});
