// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import { ONCALL_POLL_INTERVAL_MS, useOnCallPolling } from "./useOnCallPolling";

/// The composable owns a timer and an unmount hook, so it has to be exercised
/// inside a real component rather than called bare.
function host(poll: () => void | Promise<void>, isPaused: () => boolean, interval?: number) {
  const Host = defineComponent({
    setup() {
      const polling = useOnCallPolling(poll, isPaused, interval);
      return () => h("div", String(polling.polling.value));
    },
  });
  return mount(Host);
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("useOnCallPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  /// B7: a page arriving while somebody is looking at the list was invisible
  /// until they pressed refresh.
  it("refreshes on its own once an interval has passed", async () => {
    const poll = vi.fn();
    const wrapper = host(poll, () => false);

    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  /// Nobody is reading a hidden tab, and a laptop lid closed overnight should
  /// not have issued 1,800 requests.
  it("does not poll while the tab is hidden", async () => {
    const poll = vi.fn();
    setVisibility("hidden");
    const wrapper = host(poll, () => false);

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS * 3);
    expect(poll).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  /// A tab hidden for ten minutes is stale the instant it comes back; waiting
  /// for the next tick is the same bug again.
  it("refreshes immediately when the tab becomes visible", async () => {
    const poll = vi.fn();
    setVisibility("hidden");
    const wrapper = host(poll, () => false);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();

    expect(poll).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  /// The list must not reshuffle under a selection somebody is about to act on.
  it("skips a tick while the caller says it is paused", async () => {
    const poll = vi.fn();
    let paused = true;
    const wrapper = host(poll, () => paused);

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).not.toHaveBeenCalled();

    paused = false;
    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  /// A slow refresh must not have a second one stacked on top of it.
  it("does not start a second poll while one is in flight", async () => {
    let release: (() => void) | undefined;
    const poll = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const wrapper = host(poll, () => false);

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    release?.();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  /// `polling` is separate from the view's own `loading` precisely so a silent
  /// refresh renders a banner instead of blanking the table.
  it("reports that a silent refresh is in flight", async () => {
    let release: (() => void) | undefined;
    const poll = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const wrapper = host(poll, () => false);

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS);
    expect(wrapper.text()).toBe("true");

    release?.();
    await flushPromises();
    expect(wrapper.text()).toBe("false");
    wrapper.unmount();
  });

  it("stops polling once the view is gone", async () => {
    const poll = vi.fn();
    const wrapper = host(poll, () => false);
    wrapper.unmount();

    await vi.advanceTimersByTimeAsync(ONCALL_POLL_INTERVAL_MS * 3);
    expect(poll).not.toHaveBeenCalled();

    // …and the visibility listener went with it.
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(poll).not.toHaveBeenCalled();
  });
});
