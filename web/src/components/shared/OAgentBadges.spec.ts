// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OAgentBadges from "./OAgentBadges.vue";

// Stub ODimensionChip to a simple element exposing its dim-key + value, so we
// assert the two chips (env / version) render with the right key + value.
const stubs = {
  ODimensionChip: {
    props: ["dimKey", "value"],
    template:
      '<span class="dim-chip" :data-key="dimKey">{{ dimKey }}:{{ value }}</span>',
  },
};

const mountOpts = { global: { stubs } };

describe("OAgentBadges", () => {
  it("renders env and version as key:value dimension chips", () => {
    const w = mount(OAgentBadges, {
      ...mountOpts,
      props: { env: "production", version: "1.2.0" },
    });
    const chips = w.findAll(".dim-chip");
    expect(chips).toHaveLength(2);
    expect(w.text()).toContain("env:production");
    expect(w.text()).toContain("version:1.2.0");
  });

  it("renders only version when env absent", () => {
    const w = mount(OAgentBadges, {
      ...mountOpts,
      props: { env: null, version: "0.1.0" },
    });
    const chips = w.findAll(".dim-chip");
    expect(chips).toHaveLength(1);
    expect(w.text()).toContain("version:0.1.0");
  });

  it("renders nothing when both absent", () => {
    const w = mount(OAgentBadges, {
      ...mountOpts,
      props: { env: null, version: null },
    });
    expect(w.find('[data-test="agent-badges"]').exists()).toBe(false);
  });
});
