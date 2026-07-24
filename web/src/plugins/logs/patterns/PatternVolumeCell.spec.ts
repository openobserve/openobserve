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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import PatternVolumeCell from "./PatternVolumeCell.vue";
import { PATTERN_VOLUME_CACHE } from "./usePatternVolume";

const pattern = { pattern_id: "p1", template: "Processing request in auth-service" };

/** Mount with a cache already holding `buckets`, so the cell renders resolved. */
const mountCell = (buckets: number[] | null) =>
  mount(PatternVolumeCell, {
    props: { pattern },
    global: {
      plugins: [i18n],
      provide: {
        [PATTERN_VOLUME_CACHE as symbol]: {
          request: () => Promise.resolve(),
          get: () => ({
            buckets,
            total: buckets ? buckets.reduce((s, v) => s + v, 0) : null,
            intervalSecs: 1680, // 28 minutes
            loading: false,
          }),
        },
      },
    },
  });

describe("PatternVolumeCell peak marker", () => {
  // Bars are scaled to their own max, so shape alone can't convey magnitude —
  // two sparklines look identical while differing by orders of magnitude. The
  // dashed rule plus its label is what makes the height readable.
  it("labels the busiest bucket, not the total", () => {
    const wrapper = mountCell([10, 31_430, 500]);
    const peak = wrapper.find('[data-test="pattern-volume-peak"]');
    expect(peak.exists()).toBe(true);
    // 31,430 is the peak; 41,940 would be the total.
    expect(peak.text()).toBe("31K");
  });

  // "31,430 events" is uninterpretable without knowing whether a bar spans a
  // minute or a day, so the tooltip names the bucket width too.
  it("names the bucket duration alongside the exact peak", () => {
    const wrapper = mountCell([10, 31_430, 500]);
    const title = wrapper.find('[data-test="pattern-volume-peak"]').attributes("title");
    expect(title).toContain("31,430");
    expect(title).toContain("28 minutes");
  });

  it("renders the dashed rule alongside the bars", () => {
    const wrapper = mountCell([5, 9, 2]);
    const rule = wrapper.find('[data-test="pattern-volume-cell"] span[aria-hidden="true"]');
    expect(rule.exists()).toBe(true);
    expect(rule.classes()).toContain("border-dashed");
  });

  it("shows no peak marker when there is no volume", () => {
    const wrapper = mountCell([]);
    expect(wrapper.find('[data-test="pattern-volume-peak"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="pattern-volume-cell"]').exists()).toBe(false);
  });
});
