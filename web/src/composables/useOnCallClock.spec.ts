// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import {
  onCallClockRunning,
  onCallClockSubscribers,
  useOnCallClock,
} from "./useOnCallClock";

/** A component whose only job is to hold a subscription for a while. */
const Consumer = defineComponent({
  setup() {
    const nowMicros = useOnCallClock();
    return () => h("span", String(nowMicros.value));
  },
});

describe("useOnCallClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T09:41:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The bug: `Date.now()` inside a computed is not a reactive dependency, so
  // "Escalates in 4m" freezes at first render while the ladder actually fires.
  it("ticks, so a countdown built on it recomputes", async () => {
    const wrapper = mount(Consumer);
    const first = Number(wrapper.text());

    vi.advanceTimersByTime(1_000);
    await wrapper.vm.$nextTick();
    expect(Number(wrapper.text())).toBe(first + 1_000_000);

    vi.advanceTimersByTime(3_000);
    await wrapper.vm.$nextTick();
    expect(Number(wrapper.text())).toBe(first + 4_000_000);

    wrapper.unmount();
  });

  // Microseconds, matching every timestamp the on-call API returns. Milliseconds
  // here would make every countdown a thousand times too short.
  it("reads in microseconds", () => {
    const wrapper = mount(Consumer);
    expect(Number(wrapper.text())).toBe(Date.now() * 1000);
    wrapper.unmount();
  });

  it("releases the interval when the last consumer unmounts", () => {
    const a = mount(Consumer);
    const b = mount(Consumer);
    expect(onCallClockSubscribers()).toBe(2);
    expect(onCallClockRunning()).toBe(true);

    a.unmount();
    expect(onCallClockSubscribers()).toBe(1);
    expect(onCallClockRunning()).toBe(true);

    b.unmount();
    expect(onCallClockSubscribers()).toBe(0);
    expect(onCallClockRunning()).toBe(false);
  });

  // A page detail holds half a dozen countdowns; six independent intervals means
  // two tiles on one screen showing different seconds.
  it("shares one ticker across every consumer", async () => {
    const a = mount(Consumer);
    const b = mount(Consumer);

    vi.advanceTimersByTime(1_000);
    await a.vm.$nextTick();
    expect(a.text()).toBe(b.text());

    a.unmount();
    b.unmount();
  });

  it("restarts cleanly after every consumer has gone", async () => {
    mount(Consumer).unmount();
    expect(onCallClockRunning()).toBe(false);

    const again = mount(Consumer);
    expect(onCallClockRunning()).toBe(true);
    vi.advanceTimersByTime(1_000);
    await again.vm.$nextTick();
    expect(Number(again.text())).toBe(Date.now() * 1000);
    again.unmount();
  });

  // Called outside a component (a plain util reaching for "now") it must hand
  // back a freshly-read ref and start NOTHING — there is no unmount to stop it.
  it("starts no timer outside a component scope", () => {
    const now = useOnCallClock();
    expect(now.value).toBe(Date.now() * 1000);
    expect(onCallClockSubscribers()).toBe(0);
    expect(onCallClockRunning()).toBe(false);
  });
});
