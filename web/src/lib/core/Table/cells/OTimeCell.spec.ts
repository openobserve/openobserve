// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTimeCell from "./OTimeCell.vue";

const US = 1_792_575_542_000_000;

const TooltipStub = {
  name: "OTooltip",
  template: `<i class="tip"><slot name="content" /></i>`,
};

const mountCell = (props: Record<string, unknown>) =>
  mount(OTimeCell, {
    props: { value: US, unit: "us", mode: "absolute", timezone: "UTC", ...props },
    global: { stubs: { OTooltip: TooltipStub } },
  });

describe("OTimeCell", () => {
  it("absolute mode shows the full datetime and no tooltip", () => {
    const w = mountCell({});
    expect(w.find("span").text()).toBe("2026-10-21 09:39:02");
    expect(w.find(".tip").exists()).toBe(false);
  });

  it("a format pattern shortens the absolute display and offers the full datetime on hover", () => {
    const w = mountCell({ format: "MMM d, HH:mm" });
    expect(w.find("span").text()).toBe("Oct 21, 09:39");
    expect(w.find(".tip").text()).toBe("2026-10-21 09:39:02");
  });

  it("an empty value still shows the empty label with a format", () => {
    const w = mountCell({ value: null, format: "MMM d, HH:mm" });
    expect(w.text()).toBe("—");
  });
});
