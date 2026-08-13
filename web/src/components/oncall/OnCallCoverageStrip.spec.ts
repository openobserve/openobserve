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
    props: ["tracks", "nowOffset"],
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

  it("offers a legend for all three states", () => {
    const text = render([rotation(["ana@o2.ai"])]).text();

    expect(text).toContain("Primary + secondary");
    expect(text).toContain("Primary only");
    expect(text).toContain("Nobody");
  });
});
