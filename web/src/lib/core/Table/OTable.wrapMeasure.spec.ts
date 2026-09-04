// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { mount, config, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { ref } from "vue";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

// jsdom has no layout, so the real virtualizer yields 0 virtual items and the
// measurement wiring never renders — stub it with a fixed window of rows.
const measureSpy = vi.fn();
const measureElementSpy = vi.fn();
const virtualizerMock = {
  getVirtualItems: () =>
    Array.from({ length: 5 }, (_, i) => ({
      index: i,
      key: i,
      start: i * 20,
      end: (i + 1) * 20,
      size: 20,
      lane: 0,
    })),
  getTotalSize: () => 100,
  measure: measureSpy,
  measureElement: measureElementSpy,
  scrollToIndex: vi.fn(),
  shouldAdjustScrollPositionOnItemSizeChange: undefined as
    ((...args: any[]) => boolean) | undefined,
};

vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: () => ref(virtualizerMock),
}));

import OTable from "./OTable.vue";
import type { OTableColumnDef } from "./OTable.types";

const columns: OTableColumnDef<any>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "value", accessorKey: "value", header: "Value", meta: { autoWidth: true } },
];

const data = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  name: `row-${i}`,
  value: "long value ".repeat(30),
}));

function mountTable(props: Record<string, unknown> = {}) {
  return mount(OTable, {
    props: {
      data,
      columns,
      rowKey: "id",
      virtualScroll: true,
      rowHeight: 20,
      pagination: "none",
      sorting: "none",
      ...props,
    },
  });
}

describe("OTable virtual measurement", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    measureSpy.mockClear();
    measureElementSpy.mockClear();
    virtualizerMock.shouldAdjustScrollPositionOnItemSizeChange = undefined;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should not call the global measure() when wrap makes rows variable-height", () => {
    // Wiping the size cache per row mount re-renders the body, which mounts more
    // rows — the loop that froze the logs page.
    wrapper = mountTable({ wrap: true, expansion: "multiple" });
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it("should measure each wrapped row individually", () => {
    wrapper = mountTable({ wrap: true, expansion: "multiple" });
    expect(measureElementSpy).toHaveBeenCalled();
  });

  it("should stamp data-index on wrapped rows so the virtualizer can measure them", () => {
    wrapper = mountTable({ wrap: true });
    const rows = wrapper.findAll("tbody tr[data-index]");
    expect(rows.length).toBe(5);
  });

  it("should still call the global measure() for expandable rows when wrap is off", () => {
    wrapper = mountTable({ wrap: false, expansion: "multiple" });
    expect(measureSpy).toHaveBeenCalled();
  });

  it("should not call the global measure() for fixed-height rows", () => {
    wrapper = mountTable({ wrap: false, expansion: "none" });
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it("should keep a delegated scroller stable after wrap is enabled", async () => {
    wrapper = mountTable({
      wrap: false,
      scrollEl: document.createElement("div"),
    });
    expect(virtualizerMock.shouldAdjustScrollPositionOnItemSizeChange).toBeUndefined();

    await wrapper.setProps({ wrap: true });

    const shouldAdjust = virtualizerMock.shouldAdjustScrollPositionOnItemSizeChange;
    expect(shouldAdjust).toBeTypeOf("function");
    expect(shouldAdjust?.()).toBe(false);
  });

  it("should retain the virtualizer's default anchoring for an internal scroller", () => {
    wrapper = mountTable({ wrap: true });
    expect(virtualizerMock.shouldAdjustScrollPositionOnItemSizeChange).toBeUndefined();
  });
});
