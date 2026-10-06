// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DowntimeCountdown from "./DowntimeCountdown.vue";

const NOW = Date.parse("2026-09-17T14:00:00Z");

describe("DowntimeCountdown", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down live against the given clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const wrapper = mount(DowntimeCountdown, {
      props: { endsAt: (NOW + 2 * 60_000 + 5_000) * 1000, now: () => Date.now() + 60_000 },
    });
    expect(wrapper.text()).toBe("ends in 1 minute");
    vi.advanceTimersByTime(5_100);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe("ends in less than a minute");
    wrapper.unmount();
  });
});
