// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useTimezoneOptions } from "./useTimezoneOptions";

const run = (config?: Parameters<typeof useTimezoneOptions>[0]) => {
  let result!: ReturnType<typeof useTimezoneOptions>;
  mount(
    defineComponent({
      setup() {
        result = useTimezoneOptions(config);
        return () => h("div");
      },
    }),
  );
  return result;
};

describe("useTimezoneOptions", () => {
  it("leads with UTC and lists each zone once", () => {
    const { timezoneOptions, zones } = run();
    expect(timezoneOptions.value[0]).toEqual({ label: "UTC", value: "UTC" });
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("puts the browser entry first, with an English value and a translated label", () => {
    const { timezoneOptions, browserTz, browserTimeValue } = run({ browserEntry: true });
    expect(browserTimeValue).toBe(`Browser Time (${browserTz})`);
    expect(timezoneOptions.value[0].value).toBe(browserTimeValue);
    expect(timezoneOptions.value[0].label).toContain(browserTz);
    expect(timezoneOptions.value[1].value).toBe("UTC");
  });
});
