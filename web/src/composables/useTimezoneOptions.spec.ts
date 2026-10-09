// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
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
    expect(timezoneOptions.value[0]).toMatchObject({ label: "UTC", value: "UTC" });
    expect(new Set(zones).size).toBe(zones.length);
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
    expect(zones).toEqual(["UTC", "Asia/Kolkata", "Europe/Kyiv"]);
    spy.mockRestore();
  });

  it("lets a search for the legacy name find the canonical zone", () => {
    const spy = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Asia/Calcutta"]);
    const { timezoneOptions } = run();
    const kolkata = timezoneOptions.value.find((o) => o.value === "Asia/Kolkata");
    expect(kolkata?.searchText?.toLowerCase()).toContain("calcutta");
    spy.mockRestore();
  });
});
