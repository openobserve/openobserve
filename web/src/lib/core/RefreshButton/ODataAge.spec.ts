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
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/stores";
import ODataAge from "./ODataAge.vue";

const stubs = {
  OTooltip: { props: ["content"], template: '<span data-test="tooltip">{{ content }}</span>' },
};
const at = Date.UTC(2026, 10, 1, 5, 12, 7);
const failedAt = Date.UTC(2026, 10, 1, 5, 17, 2);
const zone = "Asia/Calcutta";

const mountAge = (props: Record<string, unknown>) =>
  mount(ODataAge, { props: { timeZone: zone, ...props }, global: { stubs } });

describe("ODataAge", () => {
  it("renders nothing before the first load", () => {
    expect(mountAge({}).find('[data-test="data-age"]').exists()).toBe(false);
  });

  it("shows Updated hh:mm with the zone in its tooltip and hidden text, and is not a live region", () => {
    const wrapper = mountAge({ at, dataTest: "metrics-detail-data-age" });
    const label = wrapper.find('[data-test="metrics-detail-data-age"]');
    expect(label.attributes("data-state")).toBe("age");
    expect(label.find('[aria-hidden="true"]').text()).toBe("Updated 10:42");
    expect(label.find(".sr-only").text()).toBe("Updated 10:42:07 · Asia/Calcutta");
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe("Updated 10:42:07 · Asia/Calcutta");
    expect(wrapper.find("[aria-live]").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("turns into the red failed-refresh sentence with Retry and no Updated stamp", async () => {
    const wrapper = mountAge({ at, failedAt, dataTest: "metrics-detail-refresh-failed" });
    const notice = wrapper.find('[data-test="metrics-detail-refresh-failed"]');
    expect(notice.attributes("data-state")).toBe("failed");
    expect(notice.classes()).toEqual(
      expect.arrayContaining(["bg-status-error-bg", "text-status-error-text"]),
    );
    expect(notice.text()).toContain("Refresh failed at 10:47 · showing data from 10:42");
    expect(notice.text()).not.toContain("Updated");
    const retry = wrapper.find('[data-test="metrics-detail-refresh-failed-retry"]');
    expect(retry.element.tagName).toBe("BUTTON");
    expect(retry.text()).toBe("Retry");
    await retry.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("shows a short marker whose tooltip holds the full sentence where space is tight", () => {
    const wrapper = mountAge({
      at,
      failedAt,
      short: true,
      dataTest: "metrics-explorer-card-refresh-failed",
    });
    const marker = wrapper.find('[data-test="metrics-explorer-card-refresh-failed"]');
    expect(marker.attributes("tabindex")).toBe("0");
    expect(marker.classes()).toEqual(
      expect.arrayContaining(["rounded-default", "focus-visible:outline-offset-2"]),
    );
    const visible = marker.findAll('[aria-hidden="true"]').map((el) => el.text());
    expect(visible.filter(Boolean)).toEqual(["Refresh failed"]);
    expect(marker.find(".sr-only").text()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("draws the short marker as its icon alone when asked, keeping the sentence in the tooltip and hidden text", () => {
    const wrapper = mountAge({ at, failedAt, short: true, iconOnly: true });
    const marker = wrapper.find('[data-test="data-age"]');
    expect(marker.attributes("data-state")).toBe("failed");
    expect(marker.findAll('[aria-hidden="true"]').filter((el) => el.text()).length).toBe(0);
    expect(marker.find(".sr-only").text()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
  });

  it("draws the age as a focusable clock icon when asked, with Updated in the tooltip and hidden text", () => {
    const wrapper = mountAge({ at, iconOnly: true });
    const label = wrapper.find('[data-test="data-age"]');
    expect(label.attributes("data-state")).toBe("age");
    expect(label.attributes("tabindex")).toBe("0");
    expect(label.findAll('[aria-hidden="true"]').filter((el) => el.text())).toHaveLength(0);
    expect(label.find(".sr-only").text()).toBe("Updated 10:42:07 · Asia/Calcutta");
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe("Updated 10:42:07 · Asia/Calcutta");
  });

  it("makes the short marker a button carrying the failure's own words when given them, and stays a plain marker without", async () => {
    const wrapper = mountAge({ at, failedAt, short: true, detail: "Forbidden\n\nClick to copy" });
    const marker = wrapper.find('[data-test="data-age"]');
    expect(marker.element.tagName).toBe("BUTTON");
    expect(marker.attributes("type")).toBe("button");
    expect(marker.find(".sr-only").text()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42\n\nForbidden\n\nClick to copy",
    );
    await marker.trigger("click");
    expect(wrapper.emitted("activate")).toHaveLength(1);

    const plain = mountAge({ at, failedAt, short: true }).find('[data-test="data-age"]');
    expect(plain.element.tagName).toBe("SPAN");
    expect(plain.attributes("tabindex")).toBe("0");
  });

  it("keeps Retry in a compact failed pill and moves the sentence to its tooltip (N1)", async () => {
    const wrapper = mountAge({ at, failedAt, failedCount: 3, failedTotal: 8, compact: true });
    const pill = wrapper.find('[data-test="data-age"]');
    expect(pill.classes()).toContain("bg-status-error-bg");
    const words = pill
      .findAll('[aria-hidden="true"]')
      .map((el) => el.text())
      .filter(Boolean);
    expect(words).toEqual(["Refresh failed"]);
    expect(pill.find(".sr-only").text()).toBe(
      "Refresh failed at 10:47 for 3 of 8 charts · showing data from 10:42",
    );
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe(
      "Refresh failed at 10:47 for 3 of 8 charts · showing data from 10:42",
    );
    await wrapper.find('[data-test="data-age-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("summarises several failed charts once for the page", () => {
    const wrapper = mountAge({ at, failedAt, failedCount: 3, failedTotal: 8 });
    expect(wrapper.text()).toContain(
      "Refresh failed at 10:47 for 3 of 8 charts · showing data from 10:42",
    );
  });

  it("never advances the stamp when a refresh fails with a 4xx", async () => {
    const Host = defineComponent({
      setup() {
        const lastOk = ref<number | null>(at);
        const failed = ref<number | null>(null);
        const refresh = () =>
          Promise.reject({ response: { status: 429 } }).catch(() => {
            failed.value = failedAt;
          });
        return () =>
          h(ODataAge, {
            at: lastOk.value,
            failedAt: failed.value,
            timeZone: zone,
            onRetry: refresh,
          });
      },
    });
    const wrapper = mount(Host, { global: { stubs } });
    wrapper.findComponent(ODataAge).vm.$emit("retry", new MouseEvent("click"));
    await flushPromises();
    expect(wrapper.text()).toContain("showing data from 10:42");
    expect(wrapper.text()).not.toMatch(/Updated 10:4[3-9]/);
  });
});

describe("ODataAge defaults (L-36)", () => {
  it("keeps every opt-in prop off by default", () => {
    expect(mountAge({ at }).props()).toMatchObject({
      short: false,
      iconOnly: false,
      detail: undefined,
      compact: false,
      dataTest: "data-age",
    });
  });

  it("draws a failed refresh as the shared pill with the full sentence and Retry unless compact is set", () => {
    const pill = mountAge({ at, failedAt }).findComponent({ name: "OFailedPill" });
    expect(pill.props()).toMatchObject({
      sentence: "Refresh failed at 10:47 · showing data from 10:42",
      marker: undefined,
      retry: true,
      dataTest: "data-age",
    });
    expect(pill.attributes("data-state")).toBe("failed");
    expect(pill.find('[tabindex="0"]').exists()).toBe(false);
    expect(
      mountAge({ at, failedAt, compact: true })
        .findComponent({ name: "OFailedPill" })
        .props("marker"),
    ).toBe("Refresh failed");
  });

  it("keeps the short marker a plain focusable span without detail, outside the pill", () => {
    const wrapper = mountAge({ at, failedAt, short: true });
    expect(wrapper.findComponent({ name: "OFailedPill" }).exists()).toBe(false);
    expect(wrapper.get('[data-test="data-age"]').element.tagName).toBe("SPAN");
  });
});

describe("ODataAge tooltips (real OTooltip)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const bubble = () =>
    document.body.querySelector('[data-test="o-tooltip-content"]')?.textContent ?? null;

  async function open(el: HTMLElement, how: "focus" | "hover") {
    if (how === "focus") el.focus();
    else el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1000);
    await nextTick();
    await nextTick();
  }

  it.each(["focus", "hover"] as const)(
    "opens the short marker's full sentence on %s",
    async (how) => {
      const wrapper = mount(ODataAge, {
        props: { at, failedAt, short: true, timeZone: zone },
        attachTo: document.body,
      });
      const marker = wrapper.find<HTMLElement>('[data-test="data-age"]');
      expect(marker.attributes("data-o-tooltip-trigger")).toBeDefined();
      await open(marker.element, how);
      expect(bubble()).toContain("Refresh failed at 10:47 · showing data from 10:42");
      wrapper.unmount();
    },
  );

  it("opens the age label's zone on hover", async () => {
    const wrapper = mount(ODataAge, { props: { at, timeZone: zone }, attachTo: document.body });
    const label = wrapper.find<HTMLElement>('[data-test="data-age"]');
    expect(label.attributes("data-o-tooltip-trigger")).toBeDefined();
    await open(label.element, "hover");
    expect(bubble()).toContain("Updated 10:42:07 · Asia/Calcutta");
    wrapper.unmount();
  });
});

describe("ODataAge zone", () => {
  const before = store.state.timezone;
  afterEach(() => store.commit("setTimezone", before));

  it("follows the app's selected timezone when no zone is passed, and updates when it changes", async () => {
    store.commit("setTimezone", "Asia/Calcutta");
    const wrapper = mount(ODataAge, { props: { at }, global: { stubs } });
    expect(wrapper.find(".sr-only").text()).toBe("Updated 10:42:07 · Asia/Calcutta");
    store.commit("setTimezone", "UTC");
    await nextTick();
    expect(wrapper.find(".sr-only").text()).toBe("Updated 05:12:07 · UTC");
  });
});
