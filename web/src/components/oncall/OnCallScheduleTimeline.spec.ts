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
import { nextTick } from "vue";

import OnCallScheduleTimeline from "@/components/oncall/OnCallScheduleTimeline.vue";
import i18n from "@/locales";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  OScheduleTimeline: {
    name: "OScheduleTimeline",
    props: ["tracks", "axisTicks", "nowOffset", "nowLabel", "laneHeaders", "hoverLabel"],
    emits: ["hover"],
    // Mirrors the real primitive's lane mode: a header per track, and the
    // empty slot standing in for a strip with no bands.
    template: `<div>
      <template v-for="tr in tracks" :key="tr.key">
        <slot name="track-header" :track="tr" />
        <slot v-if="!tr.bands.length" name="track-empty" :track="tr" />
      </template>
      <slot name="legend" />
    </div>`,
  },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", template: "<span />" },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OToggleGroup: { name: "OToggleGroup", template: "<div><slot /></div>" },
  OToggleGroupItem: { name: "OToggleGroupItem", template: "<button><slot /></button>" },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template: "<button @click=\"$emit('select')\"><slot /></button>",
  },
};

const DAY = MICROS_PER_DAY;
const start = Math.floor((Date.now() * 1000) / DAY) * DAY;

const rotation = (name: string): Rotation => ({
  name,
  members: ["ana@o2.ai", "bob@o2.ai"],
  shift_micros: MICROS_PER_WEEK,
  anchor_micros: start,
});

const seg = (over: Partial<ResolvedSegment> = {}): ResolvedSegment => ({
  from: start,
  to: start + 3 * DAY,
  user_email: "ana@o2.ai",
  rotation: "Primary",
  ...over,
});

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallScheduleTimeline, {
    props: {
      rotations: [rotation("Primary")],
      segments: [seg()],
      timezone: "UTC",
      window: { from: 0, to: 0 },
      "onUpdate:window": () => {},
      ...over,
    } as any,
    global: { plugins: [i18n], stubs },
  });
}

const tracksOf = (wrapper: any) =>
  wrapper.findComponent({ name: "OScheduleTimeline" }).props("tracks");

describe("OnCallScheduleTimeline", () => {
  it("draws one lane per rotation", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Secondary")],
      segments: [seg(), seg({ rotation: "Secondary", user_email: "bob@o2.ai" })],
    });
    expect(tracksOf(wrapper).map((t: any) => t.key)).toEqual(["Primary", "Secondary"]);
  });

  /// A layer nobody is on all week still has to appear — an absent lane reads
  /// as "no such rotation" rather than "this rotation covers nothing".
  it("keeps a lane for a rotation with no segments", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg()],
    });
    const weekends = tracksOf(wrapper).find((t: any) => t.key === "Weekends");
    expect(weekends).toBeDefined();
    expect(weekends.bands).toHaveLength(0);
  });

  /// The whole reason to ask the server: a span with nobody in it arrives as a
  /// segment, so a gap is drawn rather than inferred from a hole.
  it("draws an uncovered span as a gap band", () => {
    const wrapper = render({ segments: [seg({ user_email: null })] });
    expect(tracksOf(wrapper)[0].bands[0].tone).toBe("gap");
  });

  /// Hue is the ROTATION, not the person. Two people taking turns on one layer
  /// are the same lane doing its job, and painting them differently answered a
  /// question nobody asks of this chart while making two lanes look alike.
  it("paints one rotation in one colour, whoever is on it", () => {
    const wrapper = render({
      segments: [
        seg({ user_email: "ana@o2.ai" }),
        seg({ from: start + 3 * DAY, to: start + 6 * DAY, user_email: "bob@o2.ai" }),
      ],
    });
    const [first, second] = tracksOf(wrapper)[0].bands;
    expect(first.tone).toBe(second.tone);
    expect(first.tone).not.toBe("gap");
  });

  it("gives two rotations two different colours", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Secondary")],
      segments: [seg(), seg({ rotation: "Secondary", user_email: "bob@o2.ai" })],
    });
    const [primary, secondary] = tracksOf(wrapper);
    expect(primary.bands[0].tone).not.toBe(secondary.bands[0].tone);
  });

  /// A cover keeps the lane's hue — it is still that rotation's time — but is
  /// drawn hollow, because the roster did not produce it.
  it("draws a cover hollow and an ordinary shift solid", () => {
    const solid = tracksOf(render())[0].bands[0];
    expect(solid.variant).toBe("solid");

    const covered = tracksOf(render({ segments: [seg({ override_id: "ov_1" })] }))[0].bands[0];
    expect(covered.variant).toBe("outline");
    expect(covered.tone).toBe(solid.tone);
  });

  /// A band is role="img"; a schedule a screen reader cannot read is not a
  /// schedule.
  it("gives every band an accessible name", () => {
    const band = tracksOf(render())[0].bands[0];
    expect(band.ariaLabel).toContain("ana@o2.ai");
    expect(band.ariaLabel).toContain("Primary");
  });

  /// A cover is "Sam is covering Tuesday", never "the rotation changed" — the
  /// displaced layer is still the lane it belongs to.
  it("marks a covered span without moving it out of its rotation", () => {
    const wrapper = render({ segments: [seg({ override_id: "ov_1" })] });
    const track = tracksOf(wrapper)[0];

    expect(track.key).toBe("Primary");
    expect(track.bands[0].ariaLabel).toContain("covering");
  });

  it("offers to fill the first gap, and stays quiet when there is none", () => {
    expect(render().find('[data-test="oncall-timeline-fill-gap"]').exists()).toBe(false);

    const withGap = render({ segments: [seg({ user_email: null })] });
    expect(withGap.find('[data-test="oncall-timeline-gap"]').exists()).toBe(true);
  });

  /// The old key spent its one line explaining that the ramp meant nothing on
  /// its own, which is an argument for a different ramp rather than a longer
  /// caption. Every entry now names a fill the reader can act on.
  it("gives the legend three entries that all carry meaning", () => {
    const text = render().text();
    expect(text).toContain("On shift");
    expect(text).toContain("Override");
    expect(text).toContain("No one on call");
    expect(text).not.toContain("A colour per person");
  });

  it("hands the caller the gap it offered to fill", async () => {
    const wrapper = render({ segments: [seg({ user_email: null })] });
    await wrapper.find('[data-test="oncall-timeline-fill-gap"]').trigger("click");

    expect(wrapper.emitted("fill-gap")?.[0]?.[0]).toMatchObject({ rotation: "Primary" });
  });

  /// The parent owns the fetch, so the window has to be published rather than
  /// kept private — otherwise the range buttons change nothing.
  it("publishes the window it wants fetched", () => {
    const wrapper = render();
    const emitted = wrapper.emitted("update:window");
    expect(emitted?.length).toBeTruthy();
    const [{ from, to }] = emitted!.at(-1) as [{ from: number; to: number }];
    expect(to - from).toBe(7 * DAY);
  });

  /// Changing the range must move the window, or the control is decoration.
  it("asks for a different window when the range changes", async () => {
    const wrapper = render();
    wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "day");
    await nextTick();

    const [{ from, to }] = wrapper.emitted("update:window")!.at(-1) as [
      { from: number; to: number },
    ];
    expect(to - from).toBe(DAY);
  });

  /// reka-ui clears a single-select group when the active item is re-pressed.
  /// A schedule cannot be shown over no window at all, so the empty value is
  /// ignored rather than collapsing the chart.
  it("keeps its range when the toggle group reports no selection", async () => {
    const wrapper = render();
    const before = wrapper.emitted("update:window")!.at(-1) as [{ from: number; to: number }];

    wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", undefined);
    await nextTick();

    const after = wrapper.emitted("update:window")!.at(-1) as [{ from: number; to: number }];
    expect(after[0].to - after[0].from).toBe(before[0].to - before[0].from);
  });
  /// What the rail's card used to say, on the row it describes. The header
  /// carries the cadence; the band carries who and for how long.
  it("states each rotation's cadence, handover and size on its lane header", () => {
    const header = render().find('[data-test="oncall-lane-cadence-Primary"]').text();
    expect(header).toContain("weekly");
    expect(header).toContain("hands over");
    expect(header).toContain("2 people");
  });

  /// The loudest answer on the chart was a blank strip. It has to name the
  /// consequence and offer the one act that ends it.
  it("says what an unstaffed rotation costs, and offers to staff it", async () => {
    const empty = { ...rotation("Secondary"), members: [] };
    const wrapper = render({ rotations: [rotation("Primary"), empty], segments: [seg()] });

    expect(wrapper.find('[data-test="oncall-lane-not-paging-Secondary"]').exists()).toBe(true);
    const state = wrapper.find('[data-test="oncall-lane-empty-Secondary"]');
    expect(state.text()).toContain("pages nobody");

    await wrapper.find('[data-test="oncall-lane-assign-Secondary"]').trigger("click");
    expect(wrapper.emitted("assign-people")?.[0]).toEqual(["Secondary"]);
  });

  /// A rotation the resolver never puts anybody on is a finding, not an
  /// unstaffed one — and offering "Assign people" for it would be wrong advice.
  it("distinguishes a rotation that never wins from one with nobody in it", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg()],
    });
    const state = wrapper.find('[data-test="oncall-lane-empty-Weekends"]');
    expect(state.text()).toContain("Never wins");
    expect(wrapper.find('[data-test="oncall-lane-assign-Weekends"]').exists()).toBe(false);
  });

  /// Every act on a rotation reaches the parent by name — the parent owns the
  /// one drawer they all open.
  it("names the rotation each lane action was asked for", async () => {
    const wrapper = render();

    await wrapper.find('[data-test="oncall-lane-edit-Primary"]').trigger("click");
    expect(wrapper.emitted("edit")?.[0]).toEqual(["Primary"]);

    await wrapper.find('[data-test="oncall-lane-duplicate-Primary"]').trigger("click");
    expect(wrapper.emitted("duplicate")?.[0]).toEqual(["Primary"]);

    await wrapper.find('[data-test="oncall-lane-delete-Primary"]').trigger("click");
    expect(wrapper.emitted("delete")?.[0]).toEqual(["Primary"]);

    await wrapper.find('[data-test="oncall-lane-override-Primary"]').trigger("click");
    expect(wrapper.emitted("override")?.[0]).toEqual(["Primary"]);
  });

  /// Paging the window is the thing done most often on this tab, so it is two
  /// buttons rather than a range somebody retypes.
  it("moves the fetched window a whole range at a time", async () => {
    const wrapper = render();
    const first = wrapper.emitted("update:window")!.at(-1)![0] as { from: number; to: number };

    await wrapper.find('[data-test="oncall-timeline-next"]').trigger("click");
    const next = wrapper.emitted("update:window")!.at(-1)![0] as { from: number; to: number };

    expect(next.from).toBe(first.to);
  });
  /// The hour alone does not say WHICH column the line is standing in, and on
  /// a fortnight view that is the only thing the marker is there to answer.
  it("stamps the now marker with a date as well as a time", () => {
    const label = String(
      render().findComponent({ name: "OScheduleTimeline" }).props("nowLabel"),
    );
    expect(label).toMatch(/\d/);
    // A month name, not just "09:59".
    expect(label).toMatch(/[A-Za-z]{3}/);
  });

  /// The chart owns the geometry and reports a share; turning that share into
  /// an instant needs the window, which only this side has.
  it("turns the hovered share of the window into a real instant", async () => {
    const wrapper = render();
    const chart = wrapper.findComponent({ name: "OScheduleTimeline" });
    expect(chart.props("hoverLabel")).toBeUndefined();

    chart.vm.$emit("hover", 0.5);
    await nextTick();

    const [{ from, to }] = wrapper.emitted("update:window")!.at(-1) as [
      { from: number; to: number },
    ];
    const midpoint = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date((from + (to - from) / 2) / 1000));
    expect(String(chart.props("hoverLabel"))).toContain(midpoint);

    chart.vm.$emit("hover", null);
    await nextTick();
    expect(chart.props("hoverLabel")).toBeUndefined();
  });
});
