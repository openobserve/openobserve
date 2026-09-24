// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import MutedChip from "./MutedChip.vue";

const NOW = Date.parse("2026-09-17T14:10:00Z");

describe("MutedChip", () => {
  afterEach(() => vi.useRealTimers());

  it("says how long the mute has left, rounded up to the minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const wrapper = mount(MutedChip, {
      props: {
        downtime: { id: "d1", name: "INC-231", ends_at: (NOW + 72 * 60_000 - 30_000) * 1000 },
      },
    });
    expect(wrapper.text()).toContain("Muted · ends in 1 h 12 min");
  });

  it("renders nothing once the mute has ended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const wrapper = mount(MutedChip, {
      props: { downtime: { id: "d1", name: "INC-231", ends_at: (NOW - 1000) * 1000 } },
    });
    expect(wrapper.find('[data-test="muted-chip"]').exists()).toBe(false);
  });
});
