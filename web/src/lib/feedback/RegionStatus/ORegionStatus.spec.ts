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
import { mount } from "@vue/test-utils";
import ORegionStatus from "./ORegionStatus.vue";
import OPartialTag from "./OPartialTag.vue";
import { clearAnnouncements } from "./announcer";
import { useRegionLoading } from "./useRegionLoading";

const bubble = () =>
  document.body.querySelector('[data-test="o-tooltip-content"]')?.textContent?.trim() ?? null;

async function open(el: HTMLElement, how: "focus" | "hover") {
  if (how === "focus") el.focus();
  else el.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(1000);
  await nextTick();
  await nextTick();
}

const speaking = () =>
  [
    ...document.querySelectorAll(
      '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]',
    ),
  ].filter((el) => !el.closest('[aria-hidden="true"]'));

describe("ORegionStatus", () => {
  it("renders nothing before the long-wait threshold", () => {
    const wrapper = mount(ORegionStatus, { props: { noun: "traces", elapsedSeconds: 9 } });
    expect(wrapper.find('[data-test="region-status"]').exists()).toBe(false);
  });

  it("names the work and the elapsed time from 10 s, as text only, never a live region", () => {
    const wrapper = mount(ORegionStatus, {
      props: { noun: "traces", elapsedSeconds: 10, dataTest: "traces-search-result-long-wait" },
    });
    const status = wrapper.find('[data-test="traces-search-result-long-wait"]');
    expect(status.attributes("role")).toBeUndefined();
    expect(status.attributes("aria-live")).toBeUndefined();
    const visible = status.findAll('[aria-hidden="true"]').map((el) => el.text());
    expect(visible.filter(Boolean)).toEqual(["Loading traces… 10 s"]);
    expect(status.find(".sr-only").text()).toBe("Loading traces…");
  });

  it("shows a run's own words at once, without spinner or seconds, and is not a live region", () => {
    const wrapper = mount(ORegionStatus, {
      props: {
        noun: "charts",
        elapsedSeconds: 0,
        message: "Showing last 1 h · loading last 6 h",
        dataTest: "metrics-explorer-range-status",
      },
    });
    const status = wrapper.find('[data-test="metrics-explorer-range-status"]');
    expect(status.text()).toBe("Showing last 1 h · loading last 6 h");
    expect(status.attributes("role")).toBeUndefined();
    expect(status.attributes("aria-live")).toBeUndefined();
    expect(status.find("svg").exists()).toBe(false);
  });

  it("keeps the long-wait gate when no message is given", () => {
    const wrapper = mount(ORegionStatus, { props: { noun: "charts", elapsedSeconds: 3 } });
    expect(wrapper.find('[data-test="region-status"]').exists()).toBe(false);
  });

  it("names the partitions once the server reports them", () => {
    const wrapper = mount(ORegionStatus, {
      props: { noun: "traces", elapsedSeconds: 12, partitions: { done: 4, total: 12 } },
    });
    expect(wrapper.text()).toContain("Searching 4 of 12 partitions · 12 s");
  });

  it("keeps its one spinner out of the accessibility tree", () => {
    const wrapper = mount(ORegionStatus, { props: { noun: "spans", elapsedSeconds: 30 } });
    expect(
      wrapper.find('[data-test="region-status"] [role="status"]').attributes("aria-hidden"),
    ).toBe("true");
  });
});

describe("ORegionStatus with useRegionLoading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearAnnouncements();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("leaves the shared announcer as the only live region through a long wait and a noun switch", async () => {
    const busy = ref(false);
    const noun = ref<"spans" | "traces">("traces");
    const Host = defineComponent({
      setup() {
        const live = useRegionLoading({ busy: () => busy.value, noun: () => noun.value });
        return () =>
          h("div", live.regionAttrs.value, [
            h(ORegionStatus, { noun: noun.value, elapsedSeconds: live.elapsedSeconds.value }),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    busy.value = true;
    await nextTick();
    vi.advanceTimersByTime(11_000);
    await nextTick();
    expect(document.querySelector('[data-test="region-status"]')).not.toBeNull();
    noun.value = "spans";
    await nextTick();
    const live = speaking();
    expect(live).toHaveLength(1);
    expect(live[0].getAttribute("data-test")).toBe("region-announcer");
    wrapper.unmount();
  });
});

describe("OPartialTag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const tooltip =
    "The search stopped after 10 of 12 partitions, so the count and rows cover only those. Narrow the time range to search everything.";

  it("flags a partial result in amber", () => {
    const wrapper = mount(OPartialTag, {
      props: { partitions: { done: 10, total: 12 }, dataTest: "traces-count-partial" },
    });
    const tag = wrapper.find('[data-test="traces-count-partial"]');
    expect(tag.text()).toContain("10 of 12 partitions");
    expect(tag.find('[class*="warning"]').exists()).toBe(true);
    expect(tag.attributes("tabindex")).toBe("0");
    expect(tag.classes()).toEqual(
      expect.arrayContaining(["rounded-full", "outline-none", "focus-visible:outline-offset-2"]),
    );
  });

  it.each(["focus", "hover"] as const)(
    "opens the reason on %s with the real tooltip",
    async (how) => {
      const wrapper = mount(OPartialTag, {
        props: { partitions: { done: 10, total: 12 } },
        attachTo: document.body,
      });
      expect(bubble()).toBeNull();
      await open(wrapper.find<HTMLElement>('[data-test="partial-result"]').element, how);
      expect(bubble()).toContain(tooltip);
      wrapper.unmount();
    },
  );

  it("renders nothing when every partition was searched", () => {
    const wrapper = mount(OPartialTag, { props: { partitions: { done: 12, total: 12 } } });
    expect(wrapper.find('[data-test="partial-result"]').exists()).toBe(false);
  });
});
