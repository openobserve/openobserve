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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

const fetchActivity = vi.fn();

vi.mock("@/composables/useSessionActivity", () => ({
  default: () => ({ fetchActivity }),
}));

import SessionActivitySparkline from "./SessionActivitySparkline.vue";

const LOADING = '[data-test="rum-session-activity-loading"]';
const EMPTY = '[data-test="rum-session-activity-empty"]';
const SPARKLINE = '[data-test="rum-session-activity-sparkline"]';
const EVENTS_TEXT = '[data-test="rum-session-activity-events-text"]';

const activity = {
  buckets: [{ index: 0, events: 3, errors: 0, frustrations: 0 }],
  maxEvents: 3,
  totalEvents: 3,
  totalErrors: 0,
  totalFrustrations: 0,
};

const mountCell = (props: Record<string, unknown>) =>
  mount(SessionActivitySparkline, {
    props: { sessionId: "s-1", ...props },
    global: { plugins: [i18n] },
  });

describe("SessionActivitySparkline", () => {
  let observer: ReturnType<typeof installFakeIntersectionObserver>;

  beforeEach(() => {
    fetchActivity.mockReset();
    fetchActivity.mockResolvedValue(activity);
    observer = installFakeIntersectionObserver({ autoVisible: true });
  });

  afterEach(() => {
    observer.restore();
  });

  it("shows the empty state, never a skeleton, for a row that has no session bounds", async () => {
    const wrapper = mountCell({ isBounce: false });
    await flushPromises();

    expect(wrapper.find(LOADING).exists()).toBe(false);
    expect(wrapper.find(EMPTY).exists()).toBe(true);
    expect(fetchActivity).not.toHaveBeenCalled();
  });

  it("loads the sparkline once the row receives its bounds after mount", async () => {
    const wrapper = mountCell({ isBounce: false });
    await flushPromises();

    await wrapper.setProps({ startTime: 1_672_531_200_000, endTime: 1_672_531_260_000 });
    await flushPromises();

    expect(fetchActivity).toHaveBeenCalledWith("s-1", 1_672_531_200_000, 1_672_531_260_000, false);
    expect(wrapper.find(SPARKLINE).exists()).toBe(true);
    expect(wrapper.find(LOADING).exists()).toBe(false);
  });

  it("re-queries with the replay window once it replaces the _rumdata bounds", async () => {
    const wrapper = mountCell({
      isBounce: false,
      startTime: 1_672_531_200_000,
      endTime: 1_672_531_260_000,
    });
    await flushPromises();
    expect(fetchActivity).toHaveBeenCalledTimes(1);

    fetchActivity.mockResolvedValueOnce({ ...activity, totalEvents: 9 });
    await wrapper.setProps({ startTime: 1_672_531_201_500, endTime: 1_672_531_290_000 });
    await flushPromises();

    expect(fetchActivity).toHaveBeenCalledTimes(2);
    expect(fetchActivity).toHaveBeenLastCalledWith(
      "s-1",
      1_672_531_201_500,
      1_672_531_290_000,
      false,
    );
    expect(wrapper.find(EVENTS_TEXT).text()).toContain("9");
  });

  it("keeps the newer window's activity when the older query answers last", async () => {
    let answerFirst: (value: unknown) => void = () => {};
    fetchActivity.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    const wrapper = mountCell({
      isBounce: false,
      startTime: 1_672_531_200_000,
      endTime: 1_672_531_260_000,
    });
    await flushPromises();

    fetchActivity.mockResolvedValueOnce({ ...activity, totalEvents: 9 });
    await wrapper.setProps({ startTime: 1_672_531_201_500, endTime: 1_672_531_290_000 });
    await flushPromises();
    answerFirst({ ...activity, totalEvents: 4 });
    await flushPromises();

    expect(wrapper.find(EVENTS_TEXT).text()).toContain("9");
    expect(wrapper.find(LOADING).exists()).toBe(false);
  });
});
