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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallCoverageStrip from "@/components/oncall/OnCallCoverageStrip.vue";
import i18n from "@/locales";
import type { Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

const stubs = {
  OScheduleTimeline: {
    name: "OScheduleTimeline",
    // Mirrors the primitive's real prop list: a stub that omits `axisTicks`
    // silently returns undefined for it, and every assertion about the axis
    // passes without an axis existing.
    props: ["tracks", "nowOffset", "axisTicks", "dayColumns"],
    template: "<div><slot name='legend' /></div>",
  },
};

const FROM = 1_700_000_000_000_000;

const rotation = (members: string[], over: Partial<Rotation> = {}): Rotation => ({
  name: "Primary",
  members,
  shift_micros: MICROS_PER_WEEK,
  anchor_micros: FROM,
  ...over,
});

function bandsOf(wrapper: any) {
  const tracks = wrapper.findComponent({ name: "OScheduleTimeline" }).props("tracks");
  return tracks[0]?.bands ?? [];
}

function render(rotations: Rotation[]) {
  return mount(OnCallCoverageStrip, {
    props: { rotations, timezone: "UTC", days: 14, fromMicros: FROM },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallCoverageStrip", () => {
  /// A covered fortnight is ONE band, not 336 hourly slivers the browser has to
  /// lay out.
  it("merges an unbroken stretch of cover into a single band", () => {
    const bands = bandsOf(render([rotation(["ana@o2.ai", "bob@o2.ai"])]));

    expect(bands).toHaveLength(1);
    expect(bands[0].width).toBeCloseTo(1, 5);
  });

  /// A two-person rotation has a next; a one-person rotation does not, and the
  /// difference is exactly "is anybody behind them".
  it("distinguishes primary-only cover from primary plus secondary", () => {
    const both = bandsOf(render([rotation(["ana@o2.ai", "bob@o2.ai"])]));
    const alone = bandsOf(render([rotation(["ana@o2.ai"])]));

    expect(both[0].tone).not.toBe(alone[0].tone);
    expect(both[0].tone).not.toBe("gap");
    expect(alone[0].tone).not.toBe("gap");
  });

  /// The gap is the whole point of the strip.
  it("marks an unstaffed schedule as a gap", () => {
    const bands = bandsOf(render([]));

    expect(bands).toHaveLength(1);
    expect(bands[0].tone).toBe("gap");
  });

  /// Only the empty band carries text: a fortnight of cover labelled fourteen
  /// times is noise, and the band a reader hunts for is the empty one.
  it("labels only the gap bands", () => {
    expect(bandsOf(render([]))[0].label).toBeTruthy();
    expect(bandsOf(render([rotation(["ana@o2.ai"])]))[0].label).toBe("");
  });

  /// A band is role="img"; a schedule a screen reader cannot read is not a
  /// schedule.
  it("gives every band an accessible name naming its span", () => {
    for (const band of bandsOf(render([rotation(["ana@o2.ai"])]))) {
      expect(band.ariaLabel).toContain("from");
      expect(band.ariaLabel).toContain("to");
    }
  });

  /// I10: the strip was one unbroken bar with no dates under it, so a gap
  /// tomorrow and a gap a fortnight out looked identical. The marks sit on real
  /// local midnights — an even fraction of the window would put "Mon 18" at
  /// half past two on the Monday.
  describe("the time axis", () => {
    function axisOf(wrapper: any) {
      return wrapper.findComponent({ name: "OScheduleTimeline" }).props("axisTicks") ?? [];
    }

    it("labels the strip with dates a reader can count days along", () => {
      const ticks = axisOf(render([rotation(["ana@o2.ai"])]));

      expect(ticks.length).toBeGreaterThan(1);
      // Thinned, never one per day: fourteen labels collide at this zoom.
      expect(ticks.length).toBeLessThanOrEqual(8);
      for (const tick of ticks) {
        expect(tick.offset).toBeGreaterThanOrEqual(0);
        expect(tick.offset).toBeLessThanOrEqual(1);
        expect(String(tick.label)).toMatch(/\d/);
      }
    });

    /// FROM is 14 Nov 2023 22:13 UTC, so the first boundary is under two hours
    /// in — the axis must start where the day starts, not where the strip does.
    it("puts the first mark on the next local midnight, not on the window edge", () => {
      const [first] = axisOf(render([rotation(["ana@o2.ai"])]));
      const dayShare = 1 / 14;

      expect(first.offset).toBeGreaterThan(0);
      expect(first.offset).toBeLessThan(dayShare);
    });
  });

  /// E5: `Covered` is a binary that answers the wrong question. What somebody
  /// acts on is WHEN cover next drops — read off the same runs the bands are
  /// drawn from, so the sentence can never disagree with the picture above it.
  describe("the summary sentence", () => {
    const summaryOf = (wrapper: any) =>
      wrapper.find('[data-test="oncall-coverage-summary"]').text();

    it("says how long there is before cover drops, and for how long", () => {
      // A weekday-only rotation: FROM is a Tuesday evening, so the first hole
      // opens at Saturday midnight — three days out, and two days wide.
      const rotations = [
        rotation(["ana@o2.ai", "bob@o2.ai"], {
          restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 0, end_minute: 1439 }],
        }),
      ];
      const text = summaryOf(render(rotations));

      expect(text).toContain("Cover drops in");
      expect(text).toContain("3d");
      expect(text).toContain("for 2d");
    });

    /// A hole that is already open is not a thing that will happen.
    it("says nobody is on call when the gap has already started", () => {
      expect(summaryOf(render([]))).toContain("Nobody is on call");
    });

    /// Cover "returning" at the edge of what we drew would be a shift we
    /// invented — the window ending is not a rota starting.
    it("does not promise cover returns at the edge of the window", () => {
      const text = summaryOf(render([]));
      expect(text).toContain("nobody is scheduled in the next 14 days");
      expect(text).not.toContain("cover returns");
    });

    it("stays calm when the whole window is covered", () => {
      expect(summaryOf(render([rotation(["ana@o2.ai", "bob@o2.ai"])]))).toContain(
        "the whole of the next 14 days",
      );
    });
  });

  it("offers a legend for all three states", () => {
    const text = render([rotation(["ana@o2.ai"])]).text();

    expect(text).toContain("Primary + secondary");
    expect(text).toContain("Primary only");
    expect(text).toContain("Nobody");
  });
});
