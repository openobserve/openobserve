// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref, shallowRef } from "vue";
import OTableOverflowTooltip from "./OTableOverflowTooltip.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableOverflowTooltipState } from "../OTable.types";

function makeState(): OTableOverflowTooltipState {
  return {
    anchor: shallowRef<HTMLElement | null>(null),
    text: ref("select * from big_table"),
    side: ref("top" as const),
    onOpenChange: () => {},
  };
}

const tooltipProps = (wrapper: ReturnType<typeof mount>) => wrapper.findComponent(OTooltip).props();

describe("OTableOverflowTooltip", () => {
  it("opens against the hovered cell element", async () => {
    const state = makeState();
    const cell = document.createElement("div");
    const wrapper = mount(OTableOverflowTooltip, {
      props: { state },
      global: { stubs: { OTooltip: false } },
    });

    state.anchor.value = cell;
    await nextTick();

    expect(tooltipProps(wrapper).open).toBe(true);
    expect(tooltipProps(wrapper).anchor).toBe(cell);
  });

  it("closes without dropping the anchor, so the exit animation does not jump to the top-left", async () => {
    const state = makeState();
    const cell = document.createElement("div");
    const wrapper = mount(OTableOverflowTooltip, {
      props: { state },
      global: { stubs: { OTooltip: false } },
    });

    state.anchor.value = cell;
    await nextTick();
    state.anchor.value = null;
    await nextTick();

    expect(tooltipProps(wrapper).open).toBe(false);
    expect(tooltipProps(wrapper).anchor).toBe(cell);
  });

  it("re-anchors to the next cell after closing", async () => {
    const state = makeState();
    const first = document.createElement("div");
    const second = document.createElement("div");
    const wrapper = mount(OTableOverflowTooltip, {
      props: { state },
      global: { stubs: { OTooltip: false } },
    });

    state.anchor.value = first;
    await nextTick();
    state.anchor.value = null;
    await nextTick();
    state.anchor.value = second;
    await nextTick();

    expect(tooltipProps(wrapper).open).toBe(true);
    expect(tooltipProps(wrapper).anchor).toBe(second);
  });

  it("never mounts with an anchor before the first hover", () => {
    const wrapper = mount(OTableOverflowTooltip, {
      props: { state: makeState() },
      global: { stubs: { OTooltip: false } },
    });

    expect(tooltipProps(wrapper).open).toBe(false);
  });
});
