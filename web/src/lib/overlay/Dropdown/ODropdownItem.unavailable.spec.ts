// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ODropdown from "./ODropdown.vue";
import ODropdownItem from "./ODropdownItem.vue";
import { raw } from "@/types/i18n";

let wrapper: ReturnType<typeof mount> | undefined;
afterEach(() => wrapper?.unmount());

describe("ODropdownItem focusable unavailable opt-in", () => {
  it("includes unavailable items in arrow focus, associates a visible reason and blocks every activation", async () => {
    const select = vi.fn();
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () => [
          h(ODropdownItem, { "data-test": "first" }, () => "First"),
          h(ODropdownItem, { disabled: true, "data-test": "ordinary" }, () => "Ordinary"),
          h(
            ODropdownItem,
            {
              disabled: true,
              focusableUnavailable: true,
              description: raw("Run first"),
              "data-test": "blocked",
              onSelect: select,
            },
            () => "Blocked",
          ),
          h(ODropdownItem, { "data-test": "last" }, () => "Last"),
        ],
      },
    });
    await flushPromises();
    const first = document.querySelector<HTMLElement>('[data-test="first"]')!;
    const blocked = document.querySelector<HTMLElement>('[data-test="blocked"]')!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement).toBe(blocked));
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(blocked.hasAttribute("data-disabled")).toBe(false);
    expect(blocked.getAttribute("aria-describedby")).toBe("blocked-reason");
    expect(document.getElementById("blocked-reason")?.textContent).toBe("Run first");
    for (const key of ["Enter", " "])
      blocked.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    blocked.click();
    await flushPromises();
    expect(select).not.toHaveBeenCalled();
    expect(document.querySelector('[data-test="blocked"]')).not.toBeNull();
    blocked.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('[data-test="last"]')),
    );
    expect(document.querySelector('[data-test="ordinary"]')?.hasAttribute("data-disabled")).toBe(
      true,
    );
  });

  it("emits enabled selections without changing existing behavior", async () => {
    const select = vi.fn();
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () =>
          h(ODropdownItem, { "data-test": "available", onSelect: select }, () => "Available"),
      },
    });
    await flushPromises();
    document.querySelector<HTMLElement>('[data-test="available"]')!.click();
    await flushPromises();
    expect(select).toHaveBeenCalledTimes(1);
  });
});
