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
    for (const label of ["30 min", "1 h", "4 h", "24 h", "Until…"]) expect(text).toContain(label);
    expect(text).not.toContain("2 h");
    await wrapper.get('[data-test="menu-24h"]').trigger("click");
    await flushPromises();
    expect(picked).toEqual([86400]);
    wrapper.unmount();
  });

  it("keeps the mute heading for the mute label set", async () => {
    const wrapper = openMenu("mute", () => {});
    await flushPromises();
    expect(wrapper.text()).toContain("Mute notifications");
    expect(wrapper.text()).not.toContain("Extend by");
    wrapper.unmount();
  });

  it("offers Until it clears only on an alert's own mute, and forwards the pick", async () => {
    const plain = mount(ExtendDowntimeMenu, {
      props: { enabled: true, dataTest: "ext" },
      attachTo: document.body,
    });
    await plain.get('[data-test="ext"]').trigger("click");
    await flushPromises();
    expect(document.querySelector('[data-test="ext-until-clear"]')).toBeNull();
    plain.unmount();

    const alertMute = mount(ExtendDowntimeMenu, {
      props: { enabled: true, untilClear: true, dataTest: "ext" },
      attachTo: document.body,
    });
    await alertMute.get('[data-test="ext"]').trigger("click");
    await flushPromises();
    const item = document.querySelector<HTMLElement>('[data-test="ext-until-clear"]');
    expect(item?.textContent).toContain("Until it clears");
    item?.click();
    await flushPromises();
    expect(alertMute.emitted("untilClear")).toHaveLength(1);
    alertMute.unmount();
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
