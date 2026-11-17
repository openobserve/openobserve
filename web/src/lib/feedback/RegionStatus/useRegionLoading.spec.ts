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
import { defineComponent, h, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { LOADER_DELAY_MS, LONG_WAIT_MS, STILL_LOADING_REPEAT_MS } from "@/lib/styles/motion";
import { gt, type I18nText } from "@/types/i18n";
import { formatRefreshFailed } from "@/utils/formatters";
import { announcePolite, clearAnnouncements } from "./announcer";
import { isPartial, loadingText, resultText, type Partitions, type RegionNoun } from "./regionText";
import { useRegionLoading, type RegionLoading } from "./useRegionLoading";

const GAP_MS = 50;
const polite = () => document.querySelector('[data-test="region-announcer"]')?.textContent ?? "";
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent);

interface Harness {
  busy: ReturnType<typeof ref<boolean>>;
  noun: ReturnType<typeof ref<RegionNoun>>;
  error: ReturnType<typeof ref<I18nText | null>>;
  partitions: ReturnType<typeof ref<Partitions | null>>;
  count: ReturnType<typeof ref<number>>;
  loading: RegionLoading;
}

function mountRegion(): { wrapper: VueWrapper; state: Harness } {
  const state = {} as Harness;
  const Host = defineComponent({
    setup() {
      state.busy = ref(false);
      state.noun = ref<RegionNoun>("traces");
      state.error = ref<I18nText | null>(null);
      state.partitions = ref<Partitions | null>(null);
      state.count = ref(0);
      state.loading = useRegionLoading({
        busy: () => !!state.busy.value,
        noun: () => state.noun.value!,
        partitions: () => state.partitions.value,
        error: () => state.error.value,
        result: () =>
          resultText(gt, {
            count: state.count.value!,
            noun: state.noun.value!,
            partitions: state.partitions.value,
          }),
      });
      return () =>
        h("div", { "data-test": "region", ...state.loading.regionAttrs.value }, [
          h("button", { "data-test": "run" }, "Run"),
        ]);
    },
  });
  return { wrapper: mount(Host, { attachTo: document.body }), state };
}

async function run(state: Harness, on: boolean) {
  state.busy.value = on;
  await nextTick();
}

describe("useRegionLoading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearAnnouncements();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("announces only the result for a load faster than the loader delay", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    vi.advanceTimersByTime(LOADER_DELAY_MS - 1);
    state.count.value = 3;
    await run(state, false);
    vi.advanceTimersByTime(LOADER_DELAY_MS + GAP_MS);
    expect(polite()).toBe("3 traces found");
    wrapper.unmount();
  });

  it("announces the loading text after the loader delay through one polite region", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading traces…");
    const regions = document.querySelectorAll('[aria-live="polite"][data-test="region-announcer"]');
    expect(regions).toHaveLength(1);
    expect(regions[0].getAttribute("aria-atomic")).toBe("true");
    wrapper.unmount();
  });

  it("speaks a run's own loading words instead of the generic noun when given", async () => {
    const said = ref<string | null>("Showing last 1 hour, loading last 6 hours");
    const Host = defineComponent({
      setup() {
        const busy = ref(true);
        useRegionLoading({ busy: () => busy.value, noun: "charts", loading: () => said.value });
        return () => h("div");
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Showing last 1 hour, loading last 6 hours");
    wrapper.unmount();
  });

  it("falls back to Loading {noun}… when the run has no words of its own", async () => {
    const Host = defineComponent({
      setup() {
        const busy = ref(true);
        useRegionLoading({ busy: () => busy.value, noun: "charts", loading: () => null });
        return () => h("div");
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading charts…");
    wrapper.unmount();
  });

  it("sets aria-busy on the region only while it is busy", async () => {
    const { wrapper, state } = mountRegion();
    const region = () => wrapper.find('[data-test="region"]');
    expect(region().attributes("aria-busy")).toBeUndefined();
    await run(state, true);
    expect(region().attributes("aria-busy")).toBe("true");
    await run(state, false);
    expect(region().attributes("aria-busy")).toBeUndefined();
    wrapper.unmount();
  });

  it("ticks elapsed seconds and says a long wait at 10 s, then at most every 30 s", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    vi.advanceTimersByTime(LONG_WAIT_MS - 1000);
    expect(state.loading.elapsedSeconds.value).toBe(9);
    expect(state.loading.longWait.value).toBe(false);
    vi.advanceTimersByTime(1000 + GAP_MS);
    expect(state.loading.longWait.value).toBe(true);
    expect(polite()).toBe("Still loading traces, 10 seconds");
    announcePolite("something else");
    vi.advanceTimersByTime(STILL_LOADING_REPEAT_MS - 1000 - GAP_MS);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("something else");
    vi.advanceTimersByTime(1000 + GAP_MS);
    expect(polite()).toBe("Still loading traces, 40 seconds");
    await run(state, false);
    expect(state.loading.elapsedSeconds.value).toBe(0);
    expect(state.loading.longWait.value).toBe(false);
    wrapper.unmount();
  });

  it("names the current noun when the user switches Spans and Traces", async () => {
    const { wrapper, state } = mountRegion();
    state.noun.value = "spans";
    await run(state, true);
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading spans…");
    wrapper.unmount();
  });

  it("sends a failed run (a forced 403) to role=alert, not the polite region, and keeps focus", async () => {
    const { wrapper, state } = mountRegion();
    const button = wrapper.find<HTMLButtonElement>('[data-test="run"]').element;
    button.focus();
    const dataFrom = Date.UTC(2026, 10, 1, 10, 42);
    const failedAt = Date.UTC(2026, 10, 1, 10, 47);
    await run(state, true);
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading traces…");
    const request = () => Promise.reject({ response: { status: 403 } });
    await request().catch(() => {
      state.error.value = formatRefreshFailed(gt, { failedAt, dataFrom, timeZone: "UTC" });
    });
    await run(state, false);
    vi.advanceTimersByTime(GAP_MS);
    expect(alerts()).toEqual(["Refresh failed at 10:47 · showing data from 10:42"]);
    expect(polite()).toBe("");
    expect(document.activeElement).toBe(button);
    wrapper.unmount();
  });

  it("withdraws a still-pending loading text when the run ends inside the gap", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    state.error.value = gt("dataAge.refreshFailedShort");
    await run(state, false);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("");
    wrapper.unmount();
  });

  it("leaves another speaker's newer text alone when it withdraws its own", () => {
    const withdraw = announcePolite("Loading traces…");
    vi.advanceTimersByTime(GAP_MS);
    announcePolite("Copied");
    vi.advanceTimersByTime(GAP_MS);
    withdraw();
    expect(polite()).toBe("Copied");
  });

  it("withdraws its alert when the next run starts, so a repeat failure is read again", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    state.error.value = gt("dataAge.refreshFailedShort");
    await run(state, false);
    expect(alerts()).toHaveLength(1);
    state.error.value = null;
    await run(state, true);
    expect(alerts()).toHaveLength(0);
    wrapper.unmount();
  });

  it("announces a partial result with its partitions", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    state.partitions.value = { done: 10, total: 12 };
    expect(state.loading.partitions.value).toEqual({ done: 10, total: 12 });
    state.count.value = 18402;
    await run(state, false);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("18,402 traces found, partial: 10 of 12 partitions");
    wrapper.unmount();
  });

  it("stops ticking and withdraws its alert when the region unmounts", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    state.error.value = gt("dataAge.refreshFailedShort");
    await run(state, false);
    expect(alerts()).toHaveLength(1);
    wrapper.unmount();
    expect(alerts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useRegionLoading withdrawal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearAnnouncements();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const slowRun = async (state: Harness) => {
    await run(state, true);
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
  };

  it("publishes nothing when the region unmounts inside the gap after its loading text", async () => {
    const { wrapper, state } = mountRegion();
    await slowRun(state);
    wrapper.unmount();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("");
  });

  it("clears its published loading text when it unmounts", async () => {
    const { wrapper, state } = mountRegion();
    await slowRun(state);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading traces…");
    wrapper.unmount();
    expect(polite()).toBe("");
  });

  it("publishes no long-wait text after an unmount inside the gap", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    vi.advanceTimersByTime(LONG_WAIT_MS);
    wrapper.unmount();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("");
  });

  it("withdraws its result when it unmounts, pending or published", async () => {
    const first = mountRegion();
    await run(first.state, true);
    first.state.count.value = 3;
    await run(first.state, false);
    first.wrapper.unmount();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("");
    const second = mountRegion();
    await run(second.state, true);
    second.state.count.value = 4;
    await run(second.state, false);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("4 traces found");
    second.wrapper.unmount();
    expect(polite()).toBe("");
  });

  it("withdraws the previous result when the next run starts", async () => {
    const { wrapper, state } = mountRegion();
    await run(state, true);
    state.count.value = 3;
    await run(state, false);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("3 traces found");
    await run(state, true);
    expect(polite()).toBe("");
    wrapper.unmount();
  });

  it("leaves another region's equal loading text when it is disposed", async () => {
    const a = mountRegion();
    const b = mountRegion();
    await slowRun(a.state);
    await slowRun(b.state);
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading traces…");
    a.wrapper.unmount();
    expect(polite()).toBe("Loading traces…");
    b.wrapper.unmount();
    expect(polite()).toBe("");
  });
});

describe("announcer ownership", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearAnnouncements();
    vi.useRealTimers();
  });

  it("does not cancel a newer equal text that is still in the gap", () => {
    const olderWithdraw = announcePolite("Loading charts…");
    announcePolite("Loading charts…");
    olderWithdraw();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("Loading charts…");
  });

  it("does not clear a newer equal text that is already published", () => {
    const olderWithdraw = announcePolite("Loading charts…");
    vi.advanceTimersByTime(GAP_MS);
    const newerWithdraw = announcePolite("Loading charts…");
    vi.advanceTimersByTime(GAP_MS);
    olderWithdraw();
    expect(polite()).toBe("Loading charts…");
    newerWithdraw();
    expect(polite()).toBe("");
  });

  it("cancels its own pending text", () => {
    const withdraw = announcePolite("Loading charts…");
    withdraw();
    vi.advanceTimersByTime(GAP_MS);
    expect(polite()).toBe("");
  });
});

describe("regionText", () => {
  it("builds loading text from the one shared key and noun list", () => {
    expect(loadingText(gt, "spans")).toBe("Loading spans…");
    expect(loadingText(gt, "charts")).toBe("Loading charts…");
  });

  it("flags only a search that stopped before its last partition", () => {
    expect(isPartial({ done: 10, total: 12 })).toBe(true);
    expect(isPartial({ done: 12, total: 12 })).toBe(false);
    expect(isPartial({ done: 0, total: 0 })).toBe(false);
    expect(isPartial(null)).toBe(false);
  });
});
