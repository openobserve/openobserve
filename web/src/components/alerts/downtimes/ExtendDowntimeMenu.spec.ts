// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ExtendDowntimeMenu from "./ExtendDowntimeMenu.vue";
import MuteMenuItems from "./MuteMenuItems.vue";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DropdownMenuPortal: actual.DropdownMenuContent };
});

const openMenu = (labels: "mute" | "extend", onPreset: (secs: number) => void) =>
  mount(
    defineComponent({
      setup: () => () =>
        h(
          ODropdown,
          { open: true },
          {
            trigger: () => h("button", "open"),
            default: () =>
              h(MuteMenuItems, { labels, dataTestPrefix: "menu", onPreset, onUntil: () => {} }),
          },
        ),
    }),
    { attachTo: document.body },
  );

describe("Extend menu", () => {
  it("offers the quick-mute presets and Until under an Extend by heading", async () => {
    const picked: number[] = [];
    const wrapper = openMenu("extend", (secs) => picked.push(secs));
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Extend by");
    for (const label of ["30 min", "1 h", "2 h", "4 h", "Until…"]) expect(text).toContain(label);
    await wrapper.get('[data-test="menu-2h"]').trigger("click");
    await flushPromises();
    expect(picked).toEqual([7200]);
    wrapper.unmount();
  });

  it("keeps the mute heading for the mute label set", async () => {
    const wrapper = openMenu("mute", () => {});
    await flushPromises();
    expect(wrapper.text()).toContain("Mute notifications");
    expect(wrapper.text()).not.toContain("Extend by");
    wrapper.unmount();
  });

  it("renders a disabled slot when the row cannot be extended", () => {
    const wrapper = mount(ExtendDowntimeMenu, {
      props: { enabled: false, compact: true, dataTest: "row-extend" },
    });
    expect(wrapper.get('[data-test="row-extend"]').attributes("disabled")).toBeDefined();
  });

  it("renders nothing for a header button on a row that cannot be extended", () => {
    const wrapper = mount(ExtendDowntimeMenu, { props: { enabled: false } });
    expect(wrapper.find("button").exists()).toBe(false);
  });
});
