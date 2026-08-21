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
    props: ["iconLeft"],
    emits: ["click"],
    // `aria-label` and `data-test` fall through; `icon-left` is a prop, so the
    // stub has to publish it for a test to tell a labelled button from one
    // carrying only an icon.
    template: "<button :data-icon=\"iconLeft\" @click=\"$emit('click')\"><slot /></button>",
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
  OEmptyState: {
    name: "OEmptyState",
    props: ["actionLabel", "secondaryActionLabel"],
    emits: ["action", "secondaryAction"],
    template: "<div />",
  },
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

/// A rotation id derived from the name, so a fixture can name one place and
/// the segment that answers for it in another without threading a variable.
const rid = (name: string) => `rot_${name.toLowerCase()}`;

const rotation = (name: string, rules?: Rotation["shift_rules"]): Rotation => ({
  id: rid(name),
  name,
  shift_rules: rules ?? [
    {
      name,
      members: ["ana@o2.ai", "bob@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      anchor_micros: start,
    },
  ],
});

const seg = (over: Partial<ResolvedSegment> = {}): ResolvedSegment => ({
  from: start,
  to: start + 3 * DAY,
  user_email: "ana@o2.ai",
  rotation_id: rid("Primary"),
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
      segments: [seg(), seg({ rotation_id: rid("Secondary"), rotation: "Secondary", user_email: "bob@o2.ai" })],
    });
    // Keyed on the ROTATION ID. A name is renameable and two rotations may
    // share one, so it cannot key a lane.
    expect(tracksOf(wrapper).map((t: any) => t.key)).toEqual([rid("Primary"), rid("Secondary")]);
    expect(tracksOf(wrapper).map((t: any) => t.label)).toEqual(["Primary", "Secondary"]);
  });

  /// A layer nobody is on all week still has to appear — an absent lane reads
  /// as "no such rotation" rather than "this rotation covers nothing".
  it("keeps a lane for a rotation with no segments", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg()],
    });
    const weekends = tracksOf(wrapper).find((t: any) => t.key === rid("Weekends"));
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
      segments: [seg(), seg({ rotation_id: rid("Secondary"), rotation: "Secondary", user_email: "bob@o2.ai" })],
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

    expect(track.key).toBe(rid("Primary"));
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
    expect(text).toContain("Cover");
    expect(text).toContain("No one on call");
    expect(text).not.toContain("A colour per person");
  });

  it("hands the caller the gap it offered to fill", async () => {
    const wrapper = render({ segments: [seg({ user_email: null })] });
    await wrapper.find('[data-test="oncall-timeline-fill-gap"]').trigger("click");

    expect(wrapper.emitted("fill-gap")?.[0]?.[0]).toMatchObject({ rotation_id: rid("Primary") });
  });

  /// A team with no schedule resolves to one long gap the engine owns to no
  /// rotation. Falling back to the segments drew that as a nameless lane whose
  /// Edit pointed at a rotation that does not exist and did nothing.
  it("draws no lane for a gap no rotation owns", () => {
    const wrapper = render({
      rotations: [],
      segments: [seg({ rotation: null, user_email: null })],
    });

    expect(wrapper.findComponent({ name: "OScheduleTimeline" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-timeline-empty"]').exists()).toBe(true);
  });

  /// A rotation's own gap is still its lane: the position exists and has
  /// nobody in it, which is the finding. Only a team with no rotations at all
  /// draws nothing — and the endpoint answers `[]` for one, so there is no
  /// nameless lane left to invent.
  it("keeps the lane of a rotation whose window is a gap", () => {
    const wrapper = render({
      rotations: [rotation("Primary")],
      segments: [seg({ user_email: null })],
    });
    expect(tracksOf(wrapper).map((t: any) => t.key)).toEqual([rid("Primary")]);
    expect(tracksOf(wrapper)[0].bands[0].tone).toBe("gap");
  });

  /// A week-long hole printed as `Wed 05:30–05:30` reads as one of zero length,
  /// and an unowned gap left the sentence with a hole where a name should be.
  it("dates both ends of a gap that crosses a day, and names no rotation it has none of", () => {
    const wrapper = render({
      segments: [
        seg({ to: start + DAY }),
        seg({ rotation: null, user_email: null, from: start + DAY, to: start + 5 * DAY }),
      ],
    });
    const gap = wrapper.find('[data-test="oncall-timeline-gap"]').text();

    expect(gap).toContain("nobody is on call");
    // Two weekday names — the end carries its own day.
    expect(gap.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/g)).toHaveLength(2);
  });

  /// Filling a gap hands a window to a PERSON, so on a team with an empty
  /// roster the button opens a picker with nothing in it.
  it("does not offer to fill a gap when there is nobody to hand it to", () => {
    const wrapper = render({ segments: [seg({ user_email: null })], canCover: false });

    expect(wrapper.find('[data-test="oncall-timeline-gap"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-timeline-fill-gap"]').exists()).toBe(false);
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
    const header = render().find('[data-test="oncall-lane-cadence-rot_primary"]').text();
    expect(header).toContain("weekly");
    expect(header).toContain("hands over");
    expect(header).toContain("2 people");
  });

  /// The loudest answer on the chart was a blank strip. It has to name the
  /// consequence and offer the one act that ends it.
  it("says what an unstaffed rotation costs, and offers to staff it", async () => {
    const empty = rotation("Secondary", [
      { name: "Base", members: [], shift_micros: MICROS_PER_WEEK, anchor_micros: start },
    ]);
    const wrapper = render({ rotations: [rotation("Primary"), empty], segments: [seg()] });

    expect(wrapper.find('[data-test="oncall-lane-not-paging-rot_secondary"]').exists()).toBe(true);
    const state = wrapper.find('[data-test="oncall-lane-empty-rot_secondary"]');
    expect(state.text()).toContain("pages nobody");

    await wrapper.find('[data-test="oncall-lane-assign-rot_secondary"]').trigger("click");
    expect(wrapper.emitted("assign-people")?.[0]).toEqual([rid("Secondary")]);
  });

  /// **A blank lane has three different causes and they are not interchangeable.**
  /// This one is "nothing asked": the parent fetches one call per rotation, so a
  /// rotation with no segments was never resolved — saying "nobody is on call"
  /// there would be a claim this view has not earned.
  it("says a lane is blank because nothing asked, not because nobody is on", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg()],
    });
    const state = wrapper.find('[data-test="oncall-lane-empty-rot_weekends"]');
    expect(state.text()).toContain("did not resolve");
    expect(state.text()).toContain("Weekends");
    // Offering "Assign people" would be wrong advice: the rotation is staffed,
    // it simply was not asked about.
    expect(wrapper.find('[data-test="oncall-lane-assign-rot_weekends"]').exists()).toBe(false);
  });

  /// A rotation that WAS asked about and resolves to nobody draws gap bands
  /// rather than an empty lane. The endpoint tiles the window exactly, so the
  /// gap is a segment — which is the whole reason to ask the server rather than
  /// resolve the rotation on this side.
  it("draws a resolved-but-unstaffed rotation as gaps, not as a blank lane", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg(), seg({ rotation_id: rid("Weekends"), rotation: null, user_email: null })],
    });
    const weekends = tracksOf(wrapper).find((t: any) => t.key === rid("Weekends"));
    expect(weekends.bands).toHaveLength(1);
    expect(weekends.bands[0].tone).toBe("gap");
    expect(wrapper.find('[data-test="oncall-lane-empty-rot_weekends"]').exists()).toBe(false);
  });

  /// Every act on a rotation reaches the parent by ID — the parent owns the one
  /// drawer they all open, and a renameable name cannot say which row was meant.
  it("identifies the rotation each lane action was asked for", async () => {
    const wrapper = render();

    await wrapper.find('[data-test="oncall-lane-edit-rot_primary"]').trigger("click");
    expect(wrapper.emitted("edit")?.[0]).toEqual([rid("Primary")]);

    await wrapper.find('[data-test="oncall-lane-duplicate-rot_primary"]').trigger("click");
    expect(wrapper.emitted("duplicate")?.[0]).toEqual([rid("Primary")]);

    await wrapper.find('[data-test="oncall-lane-delete-rot_primary"]').trigger("click");
    expect(wrapper.emitted("delete")?.[0]).toEqual([rid("Primary")]);

    await wrapper.find('[data-test="oncall-lane-override-rot_primary"]').trigger("click");
    expect(wrapper.emitted("override")?.[0]).toEqual([rid("Primary")]);
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

  /// P1: the four schedule presets — follow-the-sun among them — were reached
  /// only through an unlabelled 32px caret whose one-item menu repeated the
  /// caret's own accessible name. Nothing on the screen said the shapes
  /// existed, so the fastest route to a correct rota was found by accident or
  /// not at all. The entry is now a button that says what it opens.
  describe("the way in to the presets", () => {
    it("names the presets on the button rather than hiding them behind a caret", async () => {
      const wrapper = render();
      const entry = wrapper.find('[data-test="oncall-timeline-presets"]');

      expect(entry.exists()).toBe(true);
      // VISIBLE text, not an aria-label on an icon: the stub renders slots
      // only, so a passing assertion here means a reader can see the words.
      expect(entry.text()).toBe("Start from a preset");

      await entry.trigger("click");
      expect(wrapper.emitted("presets")).toHaveLength(1);
    });

    /// The menu had one item and that item was its trigger's label, so opening
    /// it bought the reader a second click and no new information.
    it("keeps no one-item menu between the reader and the presets", () => {
      const wrapper = render();

      expect(wrapper.find('[data-test="oncall-timeline-add-menu"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-timeline-presets"]').element.tagName).toBe("BUTTON");
    });

    /// Beside Add rotation, at the same weight: the two are alternative ways
    /// to build the same schedule, and the preset is the shorter one.
    it("stands beside Add rotation and carries its own icon", () => {
      const wrapper = render();
      const add = wrapper.find('[data-test="oncall-timeline-add"]');
      const presets = wrapper.find('[data-test="oncall-timeline-presets"]');

      expect(add.text()).toBe("Add rotation");
      expect(presets.attributes("data-icon")).toBe("auto-awesome");
      // Adjacent in the DOM, so they read as one pair of choices.
      expect(add.element.nextElementSibling).toBe(presets.element);
    });

    /// A team with no rotations is the reader the presets were written for,
    /// and it is the one screen where the header's buttons are not the first
    /// thing looked at.
    it("offers the presets from the empty schedule as well", async () => {
      const wrapper = render({ rotations: [], segments: [] });
      const empty = wrapper.findComponent({ name: "OEmptyState" });

      expect(empty.exists()).toBe(true);
      expect(String(empty.props("actionLabel"))).toBe("Add rotation");
      expect(String(empty.props("secondaryActionLabel"))).toBe("Start from a preset");

      empty.vm.$emit("secondaryAction");
      await nextTick();
      expect(wrapper.emitted("presets")).toHaveLength(1);
    });
  });

  /// A cover is an exception to the weeks drawn below, so it belongs with the
  /// controls that change them. It used to sit in a strip of its own above the
  /// chart, a row away from every other act on the same schedule.
  describe("writing a cover from the toolbar", () => {
    it("offers it after the presets and asks the parent to open the dialog", async () => {
      const wrapper = render();
      const presets = wrapper.find('[data-test="oncall-timeline-presets"]');
      const cover = wrapper.find('[data-test="oncall-timeline-request-cover"]');

      expect(cover.text()).toBe("Request cover");
      expect(presets.element.nextElementSibling).toBe(cover.element);

      await cover.trigger("click");
      expect(wrapper.emitted("request-cover")).toHaveLength(1);
    });

    /// A cover assigns a window to a PERSON, so on an empty roster it opens a
    /// picker with no options — the same reason Fill gap is withheld.
    it("is withheld when there is nobody to hand it to", () => {
      expect(
        render({ canCover: false }).find('[data-test="oncall-timeline-request-cover"]').exists(),
      ).toBe(false);
    });
  });
});
