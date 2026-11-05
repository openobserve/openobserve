// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import { raw } from "@/types/i18n";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      computed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});

describe("OSelect listLabel and suffix", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  it("shows the short label and a right-aligned suffix in the list, and the full label in the trigger", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        searchable: true,
        modelValue: "Asia/Calcutta",
        options: [
          {
            label: raw("Asia/Calcutta (UTC+05:30)"),
            listLabel: raw("Asia/Calcutta"),
            suffix: raw("UTC+05:30"),
            value: "Asia/Calcutta",
          },
          { label: raw("UTC"), value: "UTC" },
        ],
      },
    });
    expect(wrapper.find("button").text()).toContain("Asia/Calcutta (UTC+05:30)");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    const rows = Array.from(document.body.querySelectorAll("[role='option']"));
    expect(rows[0].textContent).toContain("Asia/Calcutta");
    expect(rows[0].textContent).not.toContain("(UTC+05:30)");
    const suffix = rows[0].querySelector(".ms-auto");
    expect(suffix?.textContent).toBe("UTC+05:30");
    expect(rows[1].querySelector(".ms-auto")).toBeNull();
  });
});
