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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import OnCallScheduleTimeline from "@/components/oncall/OnCallScheduleTimeline.vue";
import type {
  ScheduleAxisTick,
  ScheduleTrack,
} from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import i18n from "@/locales";
import usersService from "@/services/users";
import { ok } from "@/test/unit/helpers/mockService";
import store from "@/test/unit/helpers/store";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { toZonedInputValue } from "@/utils/oncall";

vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn() } }));

// Mutable per case, so the phone tests can switch while every other test stays desktop.
const mockViewport = vi.hoisted(() => ({ mdUp: true, lgUp: true }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !mockViewport.mdUp),
      isTablet: computed(() => mockViewport.mdUp && !mockViewport.lgUp),
      isDesktop: computed(() => mockViewport.lgUp),
      mdUp: computed(() => mockViewport.mdUp),
      lgUp: computed(() => mockViewport.lgUp),
    }),
  };
});

type TimelineProps = InstanceType<typeof OnCallScheduleTimeline>["$props"];

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
    template: '<button :data-icon="iconLeft" @click="$emit(\'click\')"><slot /></button>',
  },
  OScheduleTimeline: {
    name: "OScheduleTimeline",
    props: [
      "tracks",
      "axisTicks",
      "nowOffset",
      "nowLabel",
      "laneHeaders",
      "hoverLabel",
      "hideHover",
    ],
    emits: ["hover"],
    // Mirrors the real primitive's lane mode: a header per track, and the
    // empty slot standing in for a strip with no bands.
    template: `<div>
      <template v-for="tr in tracks" :key="tr.key">
        <slot name="track-header" :track="tr" />
        <slot v-if="!tr.bands.length" name="track-empty" :track="tr" />
        <template v-for="b in tr.bands" :key="b.key">
          <slot name="band" :band="b" :track="tr" />
        </template>
      </template>
      <slot name="legend" />
    </div>`,
  },
  OScheduleBand: {
    name: "OScheduleBand",
    props: ["band"],
    template: "<span data-test='band' :data-key='band.key'>{{ band.label }}</span>",
  },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", template: "<span><slot /></span>" },
  OEmptyState: {
    name: "OEmptyState",
    props: ["preset"],
    emits: ["action"],
    template: "<div />",
  },
  OToggleGroup: { name: "OToggleGroup", template: "<div><slot /></div>" },
  OToggleGroupItem: { name: "OToggleGroupItem", template: "<button><slot /></button>" },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    props: ["description", "iconLeft"],
    template:
      "<button :data-icon='iconLeft' @click=\"$emit('select')\"><slot />{{ description }}</button>",
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

function render(over: Partial<TimelineProps> = {}) {
  return mount(OnCallScheduleTimeline, {
    props: {
      rotations: [rotation("Primary")],
      segments: [seg()],
      timezone: "UTC",
      window: { from: 0, to: 0 },
      "onUpdate:window": () => {},
      ...over,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

const tracksOf = (wrapper: VueWrapper) =>
  wrapper.findComponent({ name: "OScheduleTimeline" }).props("tracks") as ScheduleTrack[];

describe("OnCallScheduleTimeline", () => {
  afterEach(() => {
    mockViewport.mdUp = true;
    mockViewport.lgUp = true;
  });

  /// A phone's day column is narrower than "Wed · today", which ran into the next day's label.
  it("labels today with the bare weekday on a phone, and keeps it emphasised", () => {
    const todayOf = (wrapper: VueWrapper) =>
      (
        wrapper
          .findComponent({ name: "OScheduleTimeline" })
          .props("axisTicks") as ScheduleAxisTick[]
      ).find((tick) => tick.emphasis);

    expect(String(todayOf(render())!.sublabel)).toContain("today");
    mockViewport.mdUp = false;
    expect(String(todayOf(render())!.sublabel)).not.toContain("today");
  });

  /// One "Cover a shift" lives in the team header, and templates replace a schedule, so neither sits in the toolbar.
  it("labels Add rotation with a leading icon", () => {
    const wrapper = render();

    const add = wrapper.find('[data-test="oncall-timeline-add"]');
    expect(add.text()).toBe("Add rotation");
    expect(add.attributes("data-icon")).toBe("add");
  });

  // A staffed team still finds the templates where it adds a rotation, not only in the first lane's menu.
  it("offers a template or scratch from Add rotation, with or without rotations", async () => {
    const empty = render({ rotations: [], segments: [] });
    expect(empty.find('[data-test="oncall-timeline-add"]').text()).toBe("Add rotation");
    expect(empty.find('[data-test="oncall-timeline-add-template"]').text()).toBe("From a template");
    await empty.find('[data-test="oncall-timeline-add-template"]').trigger("click");
    expect(empty.emitted("presets")).toHaveLength(1);
    await empty.find('[data-test="oncall-timeline-add-scratch"]').trigger("click");
    expect(empty.emitted("add")).toHaveLength(1);

    const staffed = render();
    const template = staffed.find('[data-test="oncall-timeline-add-template"]');
    expect(template.text()).toBe("From a template");
    await template.trigger("click");
    // No rotation id: from Add rotation the template builds a new rotation.
    expect(staffed.emitted("presets")).toEqual([[]]);
    await staffed.find('[data-test="oncall-timeline-add-scratch"]').trigger("click");
    expect(staffed.emitted("add")).toHaveLength(1);
    expect(staffed.find('[data-test^="oncall-lane-presets-"]').exists()).toBe(true);
  });

  // An open shift or lane menu holds the pointer, so the hover line would freeze under it.
  it("hides the hover line while a shift or lane menu is open", async () => {
    const wrapper = render();
    const chart = wrapper.findComponent({ name: "OScheduleTimeline" });
    // The first is the toolbar's Add rotation menu, which sits off the chart.
    const menus = wrapper.findAllComponents({ name: "ODropdown" }).slice(1);
    expect(chart.props("hideHover")).toBe(false);

    menus[0].vm.$emit("update:open", true);
    await nextTick();
    expect(chart.props("hideHover")).toBe(true);
    menus.at(-1)!.vm.$emit("update:open", true);
    menus[0].vm.$emit("update:open", false);
    await nextTick();
    expect(chart.props("hideHover")).toBe(true);
    menus.at(-1)!.vm.$emit("update:open", false);
    await nextTick();
    expect(chart.props("hideHover")).toBe(false);
  });

  // The band only has room for a name; two people can share one, so the email rides the tooltip.
  it("gives a shift band a tooltip with the person's name, email and window", () => {
    const wrapper = mount(OnCallScheduleTimeline, {
      props: {
        rotations: [rotation("Primary")],
        segments: [seg()],
        timezone: "UTC",
        window: { from: 0, to: 0 },
        "onUpdate:window": () => {},
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ...stubs,
          OTooltip: { name: "OTooltip", props: ["content"], template: "<i><slot /></i>" },
        },
      },
    });
    const band = tracksOf(wrapper)[0].bands[0];
    const tip = wrapper
      .findAllComponents({ name: "OTooltip" })
      .find((one) => one.attributes("data-test") === `oncall-shift-tip-${band.key}`);
    expect(String(tip!.props("content"))).toMatch(/^ana@o2\.ai · Primary · .+ – .+ \(UTC\)$/);
  });

  it("draws one lane per rotation", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Secondary")],
      segments: [
        seg(),
        seg({ rotation_id: rid("Secondary"), rotation: "Secondary", user_email: "bob@o2.ai" }),
      ],
    });
    // Keyed on the ROTATION ID. A name is renameable and two rotations may
    // share one, so it cannot key a lane.
    expect(tracksOf(wrapper).map((t) => t.key)).toEqual([rid("Primary"), rid("Secondary")]);
    expect(tracksOf(wrapper).map((t) => t.label)).toEqual(["Primary", "Secondary"]);
  });

  /// A layer nobody is on all week still has to appear — an absent lane reads
  /// as "no such rotation" rather than "this rotation covers nothing".
  it("keeps a lane for a rotation with no segments", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg()],
    });
    const weekends = tracksOf(wrapper).find((t) => t.key === rid("Weekends"))!;
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
  describe("gap or off (D3)", () => {
    const rot = (id: string) => ({ kind: "rotation" as const, rotation_id: id });
    const policy = (...steps: ReturnType<typeof rot>[][]) => ({
      id: "p",
      org_id: "default",
      team_id: "t",
      rungs: [
        {
          priority: 1 as const,
          channels: [],
          steps: steps.map((targets, i) => ({ after_micros: i, targets })),
        },
      ],
    });
    const twoLanes = (over: Partial<TimelineProps> = {}) =>
      render({
        rotations: [
          rotation("Primary"),
          rotation("Secondary", [
            {
              name: "Working hours",
              members: ["bob@o2.ai"],
              shift_micros: MICROS_PER_WEEK,
              anchor_micros: start,
              restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }],
            },
          ]),
        ],
        segments: [seg(), seg({ rotation_id: rid("Secondary"), rotation: null, user_email: null })],
        ...over,
      });

    it("draws an empty stretch as Off when no level pages that rotation alone", () => {
      const wrapper = twoLanes({ policy: policy([rot(rid("Primary")), rot(rid("Secondary"))]) });
      const [band] = tracksOf(wrapper)[1].bands;
      expect(band.tone).toBe("off");
      expect(String(band.label)).toBe("Off");
      expect(wrapper.find('[data-test="oncall-timeline-gap"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-timeline-fill-gap"]').exists()).toBe(false);
    });

    it("tips an Off band with the hours its rules hold", () => {
      const wrapper = mount(OnCallScheduleTimeline, {
        props: {
          rotations: [
            rotation("Secondary", [
              {
                name: "Working hours",
                members: ["bob@o2.ai"],
                shift_micros: MICROS_PER_WEEK,
                anchor_micros: start,
                restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }],
              },
            ]),
          ],
          segments: [seg({ rotation_id: rid("Secondary"), rotation: null, user_email: null })],
          policy: policy([rot(rid("Secondary")), rot("rot_other")]),
          timezone: "UTC",
          window: { from: 0, to: 0 },
          "onUpdate:window": () => {},
        },
        global: {
          plugins: [i18n, store],
          stubs: {
            ...stubs,
            OTooltip: { name: "OTooltip", props: ["content"], template: "<i />" },
          },
        },
      });
      const band = tracksOf(wrapper)[0].bands[0];
      const tip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((one) => one.attributes("data-test") === `oncall-shift-tip-${band.key}`);
      expect(String(tip!.props("content"))).toBe("Off · outside Mon–Fri, 09:00–17:00");
    });

    // An empty stretch inside a rule's hours (its only person away) is a real hole, whatever the policy.
    it("keeps an empty stretch inside a rule's hours red", () => {
      const wrapper = twoLanes({
        policy: policy([rot(rid("Primary")), rot(rid("Secondary"))]),
        segments: [
          seg(),
          seg({ rotation_id: rid("Secondary"), rotation: "Working hours", user_email: null }),
        ],
      });
      expect(tracksOf(wrapper)[1].bands[0].tone).toBe("gap");
      expect(wrapper.find('[data-test="oncall-timeline-gap"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-timeline-legend-off"]').exists()).toBe(false);
    });

    it("offers no cover on an Off band, and keys Off in the legend", () => {
      const wrapper = twoLanes({ policy: policy([rot(rid("Primary")), rot(rid("Secondary"))]) });
      // Only the Primary shift offers a cover; the Off stretch offers nothing.
      expect(wrapper.findAll('[data-test="oncall-shift-menu-cover"]')).toHaveLength(1);
      expect(wrapper.find('[data-test="oncall-timeline-legend-off"]').text()).toBe("Off");
    });

    it("keeps the gap red when a level pages that rotation alone", () => {
      const wrapper = twoLanes({ policy: policy([rot(rid("Primary"))], [rot(rid("Secondary"))]) });
      expect(tracksOf(wrapper)[1].bands[0].tone).toBe("gap");
      expect(wrapper.find('[data-test="oncall-timeline-gap"]').exists()).toBe(true);
    });

    // B2: a rotation no step names pages nobody, however healthy its bars look.
    it("warns on a lane no escalation step pages, only once a policy is loaded", () => {
      const wrapper = twoLanes({ policy: policy([rot(rid("Primary"))]) });
      expect(wrapper.find('[data-test="oncall-lane-no-escalation-rot_secondary"]').text()).toBe(
        "Not paged by any escalation step",
      );
      expect(wrapper.find('[data-test="oncall-lane-no-escalation-rot_primary"]').exists()).toBe(
        false,
      );
      expect(twoLanes().find('[data-test^="oncall-lane-no-escalation-"]').exists()).toBe(false);
    });

    it("says a later lane is paged alongside the first, only when a level pages both", () => {
      const together = twoLanes({ policy: policy([rot(rid("Primary")), rot(rid("Secondary"))]) });
      expect(together.find('[data-test="oncall-lane-alongside-rot_secondary"]').text()).toBe(
        "paged alongside Primary",
      );
      expect(together.find('[data-test="oncall-lane-alongside-rot_primary"]').exists()).toBe(false);

      const apart = twoLanes({ policy: policy([rot(rid("Primary"))], [rot(rid("Secondary"))]) });
      expect(apart.find('[data-test="oncall-lane-alongside-rot_secondary"]').exists()).toBe(false);
      expect(twoLanes().find('[data-test="oncall-lane-alongside-rot_secondary"]').exists()).toBe(
        false,
      );
    });
  });

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
      segments: [
        seg(),
        seg({ rotation_id: rid("Secondary"), rotation: "Secondary", user_email: "bob@o2.ai" }),
      ],
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
    expect(tracksOf(wrapper).map((t) => t.key)).toEqual([rid("Primary")]);
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

  // A4: days are the team's, so a Kolkata team's columns begin at its midnight, not UTC's.
  it("starts the window and every day column at the team's midnight", () => {
    const wrapper = render({ timezone: "Asia/Kolkata" });
    const [{ from }] = wrapper.emitted("update:window")!.at(-1) as [{ from: number; to: number }];
    const now = Date.now() * 1000;
    expect(from <= now && now < from + DAY).toBe(true);
    const ticks = wrapper
      .findComponent({ name: "OScheduleTimeline" })
      .props("axisTicks") as ScheduleAxisTick[];
    const span = 7 * DAY;
    for (const tick of ticks) {
      expect(toZonedInputValue(from + tick.offset * span, "Asia/Kolkata")).toMatch(/T00:00$/);
    }
  });

  // A4: a segment running past the fetched window was cut there, so its end is not a handover.
  it("says no end on a band the window cut off", () => {
    const wrapper = render({ segments: [seg({ from: start - DAY, to: start + 30 * DAY })] });
    const [band] = tracksOf(wrapper)[0].bands;
    expect(String(band.label)).toContain("on now");
    expect(String(band.label)).not.toContain("until");
  });

  // U13: a cover or an absence ends the bar early, and the header still names the rule's handover.
  it("takes the handover from the shift rules, never from the bar", () => {
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(start / 1000));
    const wrapper = render({
      segments: [
        seg({ from: start, to: start + DAY }),
        seg({ from: start + DAY, to: start + 2 * DAY, user_email: "bob@o2.ai", override_id: "o1" }),
      ],
      absences: [
        {
          id: "u1",
          org_id: "default",
          user_email: "ana@o2.ai",
          start_at: start + 2 * DAY,
          end_at: start + 3 * DAY,
          created_by: "ana@o2.ai",
          created_at: start,
        },
      ],
    });
    expect(wrapper.find('[data-test="oncall-lane-cadence-rot_primary"]').text()).toContain(
      `hands over weekly, ${weekday} 00:00`,
    );
  });

  // Unnamed rules keep their place in the full list, as the editor numbers them, even past a stopped one.
  it("numbers an unnamed rule by its place among all the rotation's rules", () => {
    const unnamed = (over: Partial<Rotation["shift_rules"][number]> = {}) => ({
      name: "",
      members: ["ana@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      anchor_micros: start,
      ...over,
    });
    const wrapper = render({
      rotations: [
        rotation("Primary", [
          unnamed({ ends_at: start - DAY }),
          unnamed({ priority: 1 }),
          unnamed({ priority: 2 }),
        ]),
      ],
    });
    expect(wrapper.find('[data-test="oncall-lane-cadence-rot_primary"]').text()).toMatch(
      /^Rule 2 · Rule 3 · /,
    );
  });

  it("names a rotation's shift rules, its handover and its size on the lane header", () => {
    const wrapper = render({
      rotations: [
        rotation("Primary", [
          {
            name: "Weekdays",
            members: ["ana@o2.ai", "bob@o2.ai"],
            shift_micros: MICROS_PER_WEEK,
            anchor_micros: start,
            priority: 1,
            restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 0, end_minute: 1440 }],
          },
          {
            name: "Weekend",
            members: ["cy@o2.ai", "di@o2.ai"],
            shift_micros: MICROS_PER_WEEK,
            anchor_micros: start,
          },
        ]),
      ],
    });
    expect(wrapper.find('[data-test="oncall-lane-cadence-rot_primary"]').text()).toMatch(
      /^Weekdays · Weekend · hands over .+ · 4 people$/,
    );
  });

  it("tips a cut band with its whole shift, not the window's edges", () => {
    const cut = seg({ from: start, to: start + 7 * DAY });
    const whole = { from: start - 2 * DAY, to: start + 9 * DAY };
    const wrapper = mount(OnCallScheduleTimeline, {
      props: {
        rotations: [rotation("Primary")],
        segments: [cut],
        shiftSpans: { [`${cut.rotation_id}:${cut.from}:${cut.to}`]: whole },
        timezone: "UTC",
        window: { from: 0, to: 0 },
        "onUpdate:window": () => {},
      },
      global: {
        plugins: [i18n, store],
        stubs: { ...stubs, OTooltip: { name: "OTooltip", props: ["content"], template: "<i />" } },
      },
    });
    const band = tracksOf(wrapper)[0].bands[0];
    const tip = wrapper
      .findAllComponents({ name: "OTooltip" })
      .find((one) => one.attributes("data-test") === `oncall-shift-tip-${band.key}`);
    const day = (micros: number) => String(new Date(micros / 1000).getUTCDate());
    const [from, to] = String(tip!.props("content")).split(" · ")[2].split(" – ");
    expect(from).toContain(day(whole.from));
    expect(to).toContain(day(whole.to));
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

  /// A restriction spanning the whole day (0 -> 1440) used to collapse to
  /// "00:00 / 00:00" — indistinguishable from a zero-length window that never
  /// matches. It has to read as covering everything, not as covering nothing.
  it("says 'All day' for a 0 -> 1440 restriction rather than 00:00 / 00:00", () => {
    const wrapper = render({
      rotations: [
        rotation("Weekend", [
          {
            name: "Weekend",
            members: ["ana@o2.ai"],
            shift_micros: 7 * MICROS_PER_DAY,
            anchor_micros: start,
            restrictions: [{ days: [5, 6], start_minute: 0, end_minute: 1440 }],
          },
        ]),
      ],
      segments: [seg({ rotation_id: rid("Weekend"), rotation: "Weekend" })],
    });
    const header = wrapper.find('[data-test="oncall-lane-cadence-rot_weekend"]').text();
    expect(header).toContain("Sat–Sun · all day");
    expect(header).not.toContain("00:00 / 00:00");
  });

  // R11-1 sweep: weekday names come from fixed UTC dates, so a browser west of UTC must not shift them a day.
  it("names restriction days the same in a browser west of UTC", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const wrapper = render({
        rotations: [
          rotation("Weekend", [
            {
              name: "Weekend",
              members: ["ana@o2.ai"],
              shift_micros: 7 * MICROS_PER_DAY,
              anchor_micros: start,
              restrictions: [{ days: [5, 6], start_minute: 0, end_minute: 1440 }],
            },
          ]),
        ],
        segments: [seg({ rotation_id: rid("Weekend"), rotation: "Weekend" })],
      });
      expect(wrapper.find('[data-test="oncall-lane-cadence-rot_weekend"]').text()).toContain(
        "Sat–Sun",
      );
    } finally {
      process.env.TZ = before;
    }
  });

  /// A restriction ending exactly at end-of-day (`end_minute: 1440`) is not
  /// the same thing as one that wraps past midnight (`end_minute: 0`) — the
  /// two must not render identically as "00:00".
  it("renders a restriction ending at end-of-day as 24:00, not 00:00", () => {
    const wrapper = render({
      rotations: [
        rotation("AMER", [
          {
            name: "AMER",
            members: ["ana@o2.ai"],
            shift_micros: 7 * MICROS_PER_DAY,
            anchor_micros: start,
            restrictions: [{ days: [], start_minute: 16 * 60, end_minute: 1440 }],
          },
        ]),
      ],
      segments: [seg({ rotation_id: rid("AMER"), rotation: "AMER" })],
    });
    const header = wrapper.find('[data-test="oncall-lane-cadence-rot_amer"]').text();
    expect(header).toContain("16:00–24:00");
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
    const weekends = tracksOf(wrapper).find((t) => t.key === rid("Weekends"))!;
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
    const label = String(render().findComponent({ name: "OScheduleTimeline" }).props("nowLabel"));
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

  describe("the way in to templates", () => {
    it("offers a template and building it yourself from the empty schedule", async () => {
      const wrapper = render({ rotations: [], segments: [] });
      const empty = wrapper.findComponent({ name: "OEmptyState" });

      expect(empty.props("preset")).toBe("no-oncall-schedule");
      empty.vm.$emit("action", "presets");
      await nextTick();
      expect(wrapper.emitted("presets")).toHaveLength(1);
      empty.vm.$emit("action", "add");
      await nextTick();
      expect(wrapper.emitted("add")).toHaveLength(1);
    });

    /// U2: any lane's rules can be replaced from a template, and the drawer opens on that lane.
    it("offers replacing its rules with a template on every lane", async () => {
      const wrapper = render({
        rotations: [rotation("Primary"), rotation("Secondary")],
        segments: [seg(), seg({ rotation_id: rid("Secondary") })],
      });
      for (const name of ["Primary", "Secondary"]) {
        const item = wrapper.find(`[data-test="oncall-lane-presets-${rid(name)}"]`);
        expect(item.text()).toBe("Replace its rules with a template");
        expect(item.attributes("data-icon")).toBe("restart-alt");
        await item.trigger("click");
      }
      expect(wrapper.emitted("presets")).toEqual([[rid("Primary")], [rid("Secondary")]]);
    });

    it("gives every lane menu item a leading icon", () => {
      const wrapper = render();
      const items = wrapper.findAll(`[data-test^="oncall-lane-"][data-test$="${rid("Primary")}"]`);
      const menu = items.filter((item) =>
        ["presets", "override", "duplicate", "delete"].some((id) =>
          item.attributes("data-test")?.startsWith(`oncall-lane-${id}-`),
        ),
      );
      expect(menu).toHaveLength(4);
      for (const item of menu) expect(item.attributes("data-icon")).toBeTruthy();
    });
  });

  describe("the shift menu", () => {
    const menuIds = (wrapper: VueWrapper) =>
      wrapper.findAll('[data-test^="oncall-shift-menu-"]').map((b) => b.attributes("data-test"));

    it("offers cover, swap and away on a shift, and hands the parent the segment", async () => {
      const wrapper = render({ swapRotations: [rid("Primary")] });

      expect(menuIds(wrapper)).toEqual([
        "oncall-shift-menu-cover",
        "oncall-shift-menu-swap",
        "oncall-shift-menu-away",
      ]);
      expect(wrapper.find('[data-test="oncall-shift-menu-away"]').text()).toContain(
        "Mark ana@o2.ai away",
      );

      await wrapper.find('[data-test="oncall-shift-menu-swap"]').trigger("click");
      const [action, segment] = wrapper.emitted("shift-action")![0] as [string, ResolvedSegment];
      expect(action).toBe("swap");
      expect(segment).toMatchObject({ rotation_id: rid("Primary"), user_email: "ana@o2.ai" });
    });

    it("offers no swap for a rotation with no upcoming shifts to trade", () => {
      expect(menuIds(render({ swapRotations: [] }))).toEqual([
        "oncall-shift-menu-cover",
        "oncall-shift-menu-away",
      ]);
    });

    /// A reader without the configuration grant may still book their own absence, and nothing else.
    it("offers only self-away to a reader who cannot configure", () => {
      const own = render({ canCover: false, canMarkAway: false, selfEmail: "ana@o2.ai" });
      expect(menuIds(own)).toEqual(["oncall-shift-menu-away"]);

      const other = render({ canCover: false, canMarkAway: false, selfEmail: "bob@o2.ai" });
      expect(menuIds(other)).toEqual([]);
      expect(other.find('[data-test="band"]').exists()).toBe(true);
    });

    it("offers nothing on a shift that is already over", () => {
      const past = seg({ from: start - 7 * DAY, to: start - 6 * DAY });
      expect(menuIds(render({ segments: [past] }))).toEqual([]);
    });

    it("offers a cover, but no person's actions, on a gap", () => {
      expect(menuIds(render({ segments: [seg({ user_email: null })] }))).toEqual([
        "oncall-shift-menu-cover",
      ]);
    });

    it("offers no swap on a cover's span, which is not the roster's shift", () => {
      const cover = seg({ override_id: "ov1" });
      expect(menuIds(render({ segments: [cover], swapRotations: [rid("Primary")] }))).toEqual([
        "oncall-shift-menu-cover",
        "oncall-shift-menu-away",
      ]);
    });

    /// Two rotations may share a name; a band keyed by name acted on the other one's person.
    it("keys bands by rotation id, so same-named rotations act on their own shifts", async () => {
      const first: Rotation = { ...rotation("Secondary"), id: "rot_a" };
      const second: Rotation = { ...rotation("Secondary"), id: "rot_b" };
      const wrapper = render({
        rotations: [first, second],
        segments: [
          seg({ rotation_id: "rot_a", user_email: "raj@o2.ai" }),
          seg({ rotation_id: "rot_b", user_email: "sam@o2.ai" }),
        ],
      });
      const [a, b] = tracksOf(wrapper).map((track) => track.bands[0].key);
      expect(a).not.toBe(b);

      const away = wrapper.findAll('[data-test="oncall-shift-menu-away"]');
      expect(away.map((item) => item.text())).toEqual([
        "Mark raj@o2.ai away",
        "Mark sam@o2.ai away",
      ]);
      await wrapper.findAll('[data-test="oncall-shift-menu-cover"]')[0].trigger("click");
      const [, segment] = wrapper.emitted("shift-action")![0] as [string, ResolvedSegment];
      expect(segment).toMatchObject({ rotation_id: "rot_a", user_email: "raj@o2.ai" });
    });
  });

  describe("the day view", () => {
    const toDay = async (wrapper: VueWrapper) => {
      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "day");
      await nextTick();
    };

    it("labels the axis with hours, not one date", async () => {
      const wrapper = render();
      await toDay(wrapper);
      const ticks = wrapper
        .findComponent({ name: "OScheduleTimeline" })
        .props("axisTicks") as ScheduleAxisTick[];
      expect(ticks.map((tick) => String(tick.label))).toEqual([
        "00:00",
        "03:00",
        "06:00",
        "09:00",
        "12:00",
        "15:00",
        "18:00",
        "21:00",
      ]);
    });

    it("thins the hour ticks on a phone", async () => {
      mockViewport.mdUp = false;
      const wrapper = render();
      await toDay(wrapper);
      const ticks = wrapper
        .findComponent({ name: "OScheduleTimeline" })
        .props("axisTicks") as ScheduleAxisTick[];
      expect(ticks).toHaveLength(4);
    });

    it("names a single day once, with its weekday and year", async () => {
      const wrapper = render();
      await toDay(wrapper);
      const label = wrapper.find('[data-test="oncall-timeline-range"]').text();
      expect(label).not.toContain("–");
      expect(label).toMatch(/\d{4}/);
      expect(label).toContain(
        new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
          new Date(start / 1000),
        ),
      );
    });
  });

  describe("the away lane", () => {
    const absence = (over: Record<string, unknown> = {}) => ({
      id: "u1",
      org_id: "default",
      user_email: "ana@o2.ai",
      start_at: start + DAY,
      end_at: start + 2 * DAY,
      created_by: "ana@o2.ai",
      created_at: start,
      ...over,
    });

    it("draws absences in the window as a lane of their own, with a legend entry", () => {
      const wrapper = render({ absences: [absence()] });
      const away = tracksOf(wrapper).find((t) => t.key === "__away")!;

      expect(String(away.label)).toBe("Away");
      expect(away.bands).toHaveLength(1);
      expect(String(away.bands[0].label)).toBe("ana@o2.ai away");
      expect(wrapper.find('[data-test="oncall-lane-header-away"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-timeline-legend-away"]').exists()).toBe(true);
    });

    // An absence is not a schedule, so a team with one and no rotation still gets the road to its first rotation.
    it("keeps the no-schedule empty state when the only lane would be Away", () => {
      const wrapper = render({ rotations: [], segments: [], absences: [absence()] });

      expect(wrapper.find('[data-test="oncall-timeline-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-timeline-chart"]').exists()).toBe(false);
    });

    // U15: an absence is undone where it is drawn, by whoever could have marked it.
    it("clears an absence from its band, for those who may mark it", async () => {
      const wrapper = render({ absences: [absence({ start_at: start + 2 * DAY })] });
      const items = wrapper.findAll('[data-test="oncall-shift-menu-clear-away"]');
      expect(items.map((item) => item.text())).toEqual(["Clear away"]);

      await items[0].trigger("click");
      expect(wrapper.emitted("clear-away")).toEqual([["u1"]]);

      const own = render({ absences: [absence()], canMarkAway: false, selfEmail: "ana@o2.ai" });
      expect(own.find('[data-test="oncall-shift-menu-clear-away"]').exists()).toBe(true);
      const other = render({ absences: [absence()], canMarkAway: false, selfEmail: "bo@o2.ai" });
      expect(other.find('[data-test="oncall-shift-menu-clear-away"]').exists()).toBe(false);
    });

    it("draws no away lane when nobody is away in the window", () => {
      const wrapper = render({
        absences: [absence({ start_at: start + 30 * DAY, end_at: start + 31 * DAY })],
      });

      expect(tracksOf(wrapper).some((t) => t.key === "__away")).toBe(false);
      expect(wrapper.find('[data-test="oncall-timeline-legend-away"]').exists()).toBe(false);
    });
  });

  // The org's users are the IAM list's own cache entry, so a revisit of the Schedule tab costs nothing.
  it("serves the org's users to a remount from the cache", async () => {
    vi.mocked(usersService.orgUsers).mockClear();
    vi.mocked(usersService.orgUsers).mockResolvedValue(
      ok({ data: [{ email: "ana@o2.ai", first_name: "Ana" }] }),
    );
    const renderWithOrg = () =>
      mount(OnCallScheduleTimeline, {
        props: {
          rotations: [rotation("Primary")],
          segments: [seg()],
          timezone: "UTC",
          window: { from: 0, to: 0 },
          "onUpdate:window": () => {},
        },
        global: { plugins: [i18n, store], stubs },
      });

    renderWithOrg().unmount();
    await flushPromises();
    renderWithOrg();
    await flushPromises();

    expect(usersService.orgUsers).toHaveBeenCalledTimes(1);
  });

  // The zone is a small chip, and only for a reader on another clock (specs pin UTC).
  it("names the team's zone as a chip only when it differs from the reader's", () => {
    expect(render({ timezone: "UTC" }).find('[data-test="oncall-timeline-zone"]').exists()).toBe(
      false,
    );
    const chip = render({ timezone: "Asia/Kolkata" }).find('[data-test="oncall-timeline-zone"]');
    expect(chip.text()).toContain("Asia/Kolkata");
    expect(chip.text()).not.toContain("times in");
  });

  it("opens the zone tip from the whole chip, which takes keyboard focus", () => {
    const wrapper = mount(OnCallScheduleTimeline, {
      props: {
        rotations: [rotation("Primary")],
        segments: [seg()],
        timezone: "Asia/Kolkata",
        window: { from: 0, to: 0 },
        "onUpdate:window": () => {},
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ...stubs,
          OTooltip: { name: "OTooltip", props: ["content"], template: "<i><slot /></i>" },
        },
      },
    });
    const tip = wrapper
      .findAllComponents({ name: "OTooltip" })
      .find((one) => one.find('[data-test="oncall-timeline-zone"]').exists());
    expect(String(tip!.props("content"))).toContain("times in Asia/Kolkata");
    expect(wrapper.find('[data-test="oncall-timeline-zone"]').attributes("tabindex")).toBe("0");
  });
});
