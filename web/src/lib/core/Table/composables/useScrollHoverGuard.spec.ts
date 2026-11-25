// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import OTable from "../OTable.vue";
import { SCROLL_IDLE_MS } from "./useScrollHoverGuard";

const columns = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
const SCROLLER = '[data-test="o2-table-scroll-container"]';

let wrapper: VueWrapper<any>;

describe("OTable scroll hover guard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("marks its scroller while it scrolls and clears the mark once scrolling stops", async () => {
    wrapper = mount(OTable, { props: { data: rows, columns: columns as any } });
    const scroller = wrapper.find(SCROLLER);
    expect(scroller.classes()).toContain("data-scrolling:[&_tbody]:pointer-events-none");
    expect(scroller.attributes("data-scrolling")).toBeUndefined();

    scroller.element.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(scroller.attributes("data-scrolling")).toBe("true");

    vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
    scroller.element.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
    await nextTick();
    expect(scroller.attributes("data-scrolling")).toBe("true");

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(scroller.attributes("data-scrolling")).toBeUndefined();
  });

  it("follows a delegated scroll element and stops listening once unmounted", async () => {
    const outer = document.createElement("div");
    const remove = vi.spyOn(outer, "removeEventListener");
    wrapper = mount(OTable, { props: { data: rows, columns: columns as any, scrollEl: outer } });
    await nextTick();
    outer.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(wrapper.find(SCROLLER).attributes("data-scrolling")).toBe("true");

    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
