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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { useAutoRefreshTimer } from "./useAutoRefreshTimer";

const seconds = ref(0);
const tick = vi.fn();
const mounted: VueWrapper[] = [];
const track = <T extends VueWrapper>(wrapper: T): T => {
  mounted.push(wrapper);
  return wrapper;
};

const Host = defineComponent({
  setup() {
    useAutoRefreshTimer(() => seconds.value, tick);
    return () => h("div");
  },
});

describe("useAutoRefreshTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seconds.value = 0;
    tick.mockReset();
  });
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.useRealTimers();
  });

  it("does nothing while the interval is off", () => {
    track(mount(Host));
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("starts on mount when an interval is already set, as from a shared URL", () => {
    seconds.value = 10;
    track(mount(Host));
    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("restarts on a new interval and stops on Off", async () => {
    track(mount(Host));
    seconds.value = 5;
    await nextTick();
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(2);
    seconds.value = 0;
    await nextTick();
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("stops when the component unmounts", () => {
    seconds.value = 5;
    const wrapper = mount(Host);
    wrapper.unmount();
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("pauses while a kept-alive view is away", async () => {
    seconds.value = 5;
    const shown = ref(true);
    const Shell = defineComponent({
      setup: () => () => h(KeepAlive, null, [shown.value ? h(Host) : h("span")]),
    });
    track(mount(Shell));
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(1);
    shown.value = false;
    await nextTick();
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    shown.value = true;
    await nextTick();
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
