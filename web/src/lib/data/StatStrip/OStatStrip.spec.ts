// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OStatStrip from "./OStatStrip.vue";
import { raw } from "@/types/i18n";

const items = [
  { key: "a", label: raw("All"), value: 128 },
  { key: "b", label: raw("Regressed"), value: 93 },
];

function basisOf(compact: boolean) {
  const wrapper = mount(OStatStrip, {
    props: { items, compact },
    global: { stubs: { OStatCard: { template: '<div v-bind="$attrs" />' } } },
  });
  return wrapper.findAll("[class]")[1]?.classes() ?? [];
}

describe("OStatStrip", () => {
  // A five-tile filter strip wraps to two rows at the default basis, which is
  // sized for long labels.
  it("narrows the wrap threshold when compact", () => {
    expect(basisOf(false)).toContain("basis-52");
    expect(basisOf(true)).toContain("basis-36");
  });

  it("keeps the tiles growing to fill the strip either way", () => {
    expect(basisOf(false)).toContain("grow");
    expect(basisOf(true)).toContain("grow");
  });
});
