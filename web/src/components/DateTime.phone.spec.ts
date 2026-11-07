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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { getManager, resetManager } from "@/lib/vue-shortcut-manager";

vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({
    isMobile: computed(() => true),
    isTablet: computed(() => false),
    isDesktop: computed(() => false),
    mdUp: computed(() => false),
    lgUp: computed(() => false),
  }),
}));

describe("DateTime below the md breakpoint", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const openMenu = async () => {
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
    wrapper!.vm.onPopoverOpenAutoFocus(new Event("focus", { cancelable: true }));
    await flushPromises();
  };
  const menu = () => document.getElementById("date-time-menu")!;
  const custom = () => document.querySelector<HTMLElement>('[data-test="date-time-custom-range"]')!;

  beforeEach(() => {
    store.state.timezone = "Asia/Calcutta";
    store.state.savedViewFlag = false;
    wrapper = mount(DateTime, {
      props: { autoApply: true, calendarPresets: true },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    resetManager();
  });

  it("focuses the panel, not the field, so Esc stays inside the picker and discards a draft", async () => {
    await openMenu();
    expect(document.activeElement).toBe(menu());

    const pageEscape = vi.fn();
    getManager()!.register({ key: "escape", handler: pageEscape, allowInInput: true });
    const before = (wrapper!.emitted("on:date-change") ?? []).length;
    wrapper!.vm.onDraftEdge("start", { date: "2026-11-04", time: "09:00:00", offset: "" });
    await flushPromises();
    menu().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();

    expect(wrapper!.vm.menuOpen).toBe(false);
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(before);
    expect(pageEscape).not.toHaveBeenCalled();
  });

  it("names the folded Custom range section and moves the name to its heading when unfolded", async () => {
    await openMenu();
    expect(custom().getAttribute("aria-labelledby")).toBeNull();
    expect(custom().getAttribute("aria-label")).toBe("Custom range");

    document.querySelector<HTMLElement>('[data-test="date-time-custom-toggle"]')!.click();
    await flushPromises();
    const headingId = custom().getAttribute("aria-labelledby")!;
    expect(document.getElementById(headingId)?.textContent?.trim()).toBe("Custom range");
    expect(custom().getAttribute("aria-label")).toBeNull();
  });
});
