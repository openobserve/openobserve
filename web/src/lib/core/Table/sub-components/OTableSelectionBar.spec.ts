// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { flushPromises, mount, VueWrapper, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { h, Teleport } from "vue";
import OTableSelectionBar from "./OTableSelectionBar.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      components: {
        select: { clearSelection: "Clear selection" },
        table: {
          selectedOfTotal: "{selected} of {total} selected",
          selectedCount: "{selected} selected",
        },
      },
    },
  },
});

beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

const COUNT = '[data-test="o2-table-selected-count"]';
const ACTIONS = '[data-test="o2-table-selection-actions"]';

let wrapper: VueWrapper<any>;

function mountBar(props: Record<string, unknown> = {}, slot?: () => any) {
  wrapper = mount(OTableSelectionBar, {
    props: { selectedCount: 2, totalCount: 30, ...props },
    slots: { default: slot ?? (() => h("button", { "data-test": "bulk" }, "Delete")) },
    attachTo: document.body,
  });
  return wrapper;
}

afterEach(() => wrapper?.unmount());

describe("OTableSelectionBar", () => {
  it("announces the count of the total beside the actions", () => {
    mountBar();
    expect(wrapper.find(COUNT).text()).toBe("2 of 30 selected");
    expect(wrapper.find(COUNT).attributes("role")).toBe("status");
    expect(wrapper.find(ACTIONS).find('[data-test="bulk"]').exists()).toBe(true);
  });

  it("drops the total when the selection outnumbers it and marks a lower bound", async () => {
    mountBar({ selectedCount: 5, totalCount: 3 });
    expect(wrapper.find(COUNT).text()).toBe("5 selected");
    await wrapper.setProps({ selectedCount: 2, totalCount: 40, totalCountExact: false });
    expect(wrapper.find(COUNT).text()).toBe("2 of 40+ selected");
  });

  it("takes the accent tint so a selection is noticed", () => {
    mountBar();
    const root = wrapper.find('[data-test="o2-table-selection-bar"]').classes();
    expect(root).toEqual(expect.arrayContaining(["bg-selected-bg", "text-selected-fg"]));
  });

  it("emits clear from its clear action", async () => {
    mountBar();
    await wrapper.find('[data-test="o2-table-selection-clear"]').trigger("click");
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  it("keeps its count while stale, with its actions inactive", () => {
    mountBar({ stale: true });
    expect(wrapper.find(COUNT).exists()).toBe(true);
    expect(wrapper.find(ACTIONS).attributes("aria-disabled")).toBe("true");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.find('[data-test="bulk"]').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("closes a bulk-action menu opened before the rows went stale and blocks its items", async () => {
    const onSelect = vi.fn();
    mountBar({}, () =>
      h(ODropdown, null, {
        trigger: () => h("button", { "data-test": "bulk-menu" }, "Snooze"),
        default: () => h(ODropdownItem, { onSelect, "data-test": "bulk-item" }, () => "1 hour"),
      }),
    );
    const trigger = wrapper.find('[data-test="bulk-menu"]');
    await trigger.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    const item = document.querySelector('[data-test="bulk-item"]')!;
    await wrapper.setProps({ stale: true });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("blocks the items of a portaled bulk menu that stays open while stale, and frees them after", async () => {
    const onItem = vi.fn();
    const onEscape = vi.fn();
    mountBar({}, () => [
      h("button", { id: "bulk-trigger", "aria-expanded": "true" }, "More"),
      h(Teleport, { to: "body" }, [
        h("div", { "aria-labelledby": "bulk-trigger", onKeydown: onEscape }, [
          h("button", { "data-test": "kept-item", onClick: onItem }, "Archive"),
        ]),
      ]),
    ]);
    const item = document.querySelector<HTMLElement>('[data-test="kept-item"]')!;
    await wrapper.setProps({ stale: true });
    expect(onEscape.mock.calls.map(([event]) => event.key)).toEqual(["Escape"]);
    item.click();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    item.dispatchEvent(enter);
    expect(onItem).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    await wrapper.setProps({ stale: false });
    item.click();
    expect(onItem).toHaveBeenCalledTimes(1);
  });
});
