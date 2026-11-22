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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AnomalyPointPopover from "@/components/alerts/AnomalyPointPopover.vue";
import type { AnomalyBandRow } from "@/utils/alerts/anomalyBandChart";

const TS = Date.parse("2026-11-16T18:45:00Z");

const row: AnomalyBandRow = {
  tsMs: TS,
  value: 208,
  flagged: 208,
  expected: 138.8,
  lower: 120.4,
  upper: 157.2,
  event: null,
  threshold: 3,
  modelVersion: 7,
};

let wrapper: ReturnType<typeof mount> | null = null;

const mountPopover = () => {
  wrapper = mount(AnomalyPointPopover, {
    props: { open: true, anchor: null, row, bucketMs: 15 * 60_000, current: true, loading: false },
    global: {
      plugins: [i18n],
      stubs: {
        OPopover: { template: "<div><slot /></div>" },
        OTooltip: { props: ["content"], template: '<span data-test="tip" :data-tip="content" />' },
      },
    },
  });
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe("AnomalyPointPopover", () => {
  it("shows the bucket range in the chart axis zone, with UTC only in the tooltip (AC1.26)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TS + 30 * 60_000));
    const range = mountPopover().find('[data-test="alerts-anomalypointpopover-range"]');
    expect(range.text()).toBe("18:45 – 19:00");
    expect(range.find('[data-test="tip"]').attributes("data-tip")).toBe(
      "2026-11-16 18:45 – 19:00 UTC",
    );
  });

  it("adds the date to a bucket of another day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TS + 26 * 3_600_000));
    const range = mountPopover().find('[data-test="alerts-anomalypointpopover-range"]');
    expect(range.text()).toMatch(/16,? 18:45 – 19:00$/);
  });
});
