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
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { linkOverLimit } from "@/composables/useTimeRangeLimits";

vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));

const HOUR_US = 3_600_000_000;
const NOW = new Date("2026-11-16T10:00:00Z");

describe("over-limit links (R2)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("names the asked range and what the stream allows", () => {
    const asked = { startUs: 0, endUs: 168 * HOUR_US };
    expect(linkOverLimit(asked, 24)).toEqual({ asked, allowed: "1d", period: "24h" });
    expect(linkOverLimit(asked, 5)).toEqual({ asked, allowed: "5h", period: "5h" });
  });

  it("has nothing to say for a range inside the limit, or no limit", () => {
    expect(linkOverLimit({ startUs: 0, endUs: 24 * HOUR_US }, 24)).toBeNull();
    expect(linkOverLimit({ startUs: 0, endUs: 168 * HOUR_US }, 0)).toBeNull();
  });

  it("keeps a refused live range as asked and does not toast or clamp it", async () => {
    const wrapper = mount(DateTime, {
      props: { defaultRelativeTime: "7d", queryRangeRestrictionInHour: 24, limitRefused: true },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    await wrapper.setProps({ queryRangeRestrictionInHour: 12 });
    await flushPromises();
    expect(wrapper.vm.getConsumableDateTime().relativeTimePeriod).toBe("7d");
    expect(document.querySelector("[data-test='date-time-trigger-lock']")).not.toBeNull();
    wrapper.unmount();
  });
});
