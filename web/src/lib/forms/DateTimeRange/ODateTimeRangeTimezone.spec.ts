// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ODateTimeRangeTimezone from "./ODateTimeRangeTimezone.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import i18n from "@/locales";

let wrapper: VueWrapper;

function mountTz(props: Record<string, unknown> = {}) {
  wrapper = mount(ODateTimeRangeTimezone, {
    props: { modelValue: "UTC", options: ["", "UTC", "Asia/Kolkata"], ...props },
    global: { plugins: [i18n] },
  });
  return wrapper;
}

const rows = () => wrapper.findAll("button[aria-pressed]");

describe("ODateTimeRangeTimezone", () => {
  afterEach(() => wrapper?.unmount());

  it("opens the list from the trigger with a search row", async () => {
    mountTz();
    expect(wrapper.find('[data-test="datetimerange-timezone-search"]').exists()).toBe(false);
    await wrapper.get('[data-test="datetimerange-timezone-trigger"]').trigger("click");
    expect(wrapper.find('[data-test="datetimerange-timezone-search"]').exists()).toBe(true);
    expect(rows()).toHaveLength(3);
  });

  it("marks the selected zone with the tint and a check, not solid primary", async () => {
    mountTz();
    await wrapper.get('[data-test="datetimerange-timezone-trigger"]').trigger("click");
    const selected = rows()[1];
    expect(selected.classes()).toEqual(
      expect.arrayContaining(["bg-select-item-selected-bg", "min-h-7", "text-compact"]),
    );
    expect(selected.findComponent(OIcon).props("name")).toBe("check");
    expect(rows()[0].findComponent(OIcon).exists()).toBe(false);
  });

  it("filters by the search term and shows the empty state", async () => {
    mountTz();
    await wrapper.get('[data-test="datetimerange-timezone-trigger"]').trigger("click");
    await wrapper.get('[data-test="datetimerange-timezone-search"]').setValue("kolkata");
    expect(rows()).toHaveLength(1);
    await wrapper.get('[data-test="datetimerange-timezone-search"]').setValue("nowhere");
    expect(rows()).toHaveLength(0);
    expect(wrapper.text()).toContain("No timezones found");
  });

  it("emits the picked zone and closes", async () => {
    mountTz();
    await wrapper.get('[data-test="datetimerange-timezone-trigger"]').trigger("click");
    await rows()[2].trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["Asia/Kolkata"]);
    expect(wrapper.find('[data-test="datetimerange-timezone-search"]').exists()).toBe(false);
  });

  it("does not open when disabled", async () => {
    mountTz({ disabled: true });
    await wrapper.get('[data-test="datetimerange-timezone-trigger"]').trigger("click");
    expect(wrapper.find('[data-test="datetimerange-timezone-search"]').exists()).toBe(false);
  });
});
