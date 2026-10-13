// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
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
    expect(timezoneOptions.value[0]).toMatchObject({ label: "UTC", value: "UTC" });
    expect(new Set(zones.value).size).toBe(zones.value.length);
  });

  it("puts the browser entry first, with an English value and a translated label", () => {
    const { timezoneOptions, browserTz, browserTimeValue } = run({ browserEntry: true });
    expect(browserTimeValue).toBe(`Browser Time (${browserTz})`);
    expect(timezoneOptions.value[0].value).toBe(browserTimeValue);
    expect(timezoneOptions.value[0].label).toContain(browserTz);
    expect(timezoneOptions.value[1].value).toBe("UTC");
  });

  it("lists a zone ICU reports under a legacy name once, under its canonical name", () => {
    const spy = vi
      .spyOn(Intl, "supportedValuesOf")
      .mockReturnValue(["Asia/Calcutta", "Asia/Kolkata", "Europe/Kiev"]);
    const { zones } = run();
    expect(zones.value).toEqual(["UTC", "Asia/Kolkata", "Europe/Kyiv"]);
    spy.mockRestore();
  });

  it("lets a search for the legacy name find the canonical zone", () => {
    const spy = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Asia/Calcutta"]);
    const { timezoneOptions } = run();
    const kolkata = timezoneOptions.value.find((o) => o.value === "Asia/Kolkata");
    expect(kolkata?.searchText?.toLowerCase()).toContain("calcutta");
    spy.mockRestore();
  });

  it("offers the stored zone when the browser cannot list zones", () => {
    const original = Intl.supportedValuesOf;
    Object.defineProperty(Intl, "supportedValuesOf", { value: undefined, configurable: true });
    try {
      const { zones, timezoneOptions } = run({ current: "Asia/Tokyo" });
      expect(zones.value).toEqual(["UTC", "Asia/Tokyo"]);
      expect(timezoneOptions.value.map((o) => o.value)).toContain("Asia/Tokyo");
    } finally {
      Object.defineProperty(Intl, "supportedValuesOf", { value: original, configurable: true });
    }
  });

  it("keeps a stored legacy name as the value of its zone's row, shown under the canonical name", () => {
    const spy = vi
      .spyOn(Intl, "supportedValuesOf")
      .mockReturnValue(["Asia/Calcutta", "Asia/Tokyo"]);
    const current = ref("Asia/Calcutta");
    const { zones, timezoneOptions } = run({ current });
    expect(zones.value).toEqual(["UTC", "Asia/Calcutta", "Asia/Tokyo"]);
    expect(timezoneOptions.value[1]).toMatchObject({
      label: "Asia/Kolkata",
      value: "Asia/Calcutta",
    });
    expect(timezoneOptions.value[1].searchText).toContain("Calcutta");
    current.value = "Asia/Tokyo";
    expect(zones.value).toEqual(["UTC", "Asia/Kolkata", "Asia/Tokyo"]);
    spy.mockRestore();
  });

  it("adds a stored zone the list lacks after UTC and the browser entry", () => {
    const spy = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Asia/Tokyo"]);
    const { zones, browserTimeValue } = run({ browserEntry: true, current: "Mars/Olympus" });
    expect(zones.value).toEqual([browserTimeValue, "UTC", "Mars/Olympus", "Asia/Tokyo"]);
    spy.mockRestore();
  });
});
