import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OScheduleTimeline from "./OScheduleTimeline.vue";
import OScheduleBand from "./OScheduleBand.vue";
import { raw } from "@/types/i18n";
import type { ScheduleBand, ScheduleTrack } from "./OScheduleTimeline.types";

function band(over: Partial<ScheduleBand> = {}): ScheduleBand {
  return {
    key: "b1",
    offset: 0.25,
    width: 0.5,
    label: raw("Devi"),
    ariaLabel: raw("Devi · Base rotation · Mon 09:00 to Mon 17:00"),
    tone: 1,
    ...over,
  };
}

function track(over: Partial<ScheduleTrack> = {}): ScheduleTrack {
  return { key: "t1", label: raw("Base rotation"), bands: [band()], ...over };
}

describe("OScheduleBand", () => {
  it("positions itself from offset/width as percentages", () => {
    const w = mount(OScheduleBand, { props: { band: band() } });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("25%");
    expect(style).toContain("50%");
  });

  // A band computed from a rotation longer than the window would otherwise run
  // past the track and push everything else off screen.
  it.each([
    ["negative offset", { offset: -1, width: 0.5 }, "0%", "50%"],
    ["over-wide band", { offset: 0.5, width: 4 }, "50%", "100%"],
    ["non-finite values", { offset: Number.NaN, width: Number.NaN }, "0%", "0%"],
  ])("clamps %s into the window", (_name, geom, expectedStart, expectedWidth) => {
    const w = mount(OScheduleBand, { props: { band: band(geom) } });
    const style = w.attributes("style") ?? "";
    expect(style).toContain(`inset-inline-start: ${expectedStart}`);
    expect(style).toContain(`width: ${expectedWidth}`);
  });

  it("is focusable and carries an accessible name", () => {
    const w = mount(OScheduleBand, { props: { band: band() } });
    expect(w.attributes("role")).toBe("img");
    expect(w.attributes("tabindex")).toBe("0");
    expect(w.attributes("aria-label")).toContain("Devi");
  });

  it.each([
    [1, "bg-schedule-band-1-bg"],
    [6, "bg-schedule-band-6-bg"],
    ["gap", "bg-schedule-gap-bg"],
  ] as const)("paints tone %s from its own token", (tone, expected) => {
    const w = mount(OScheduleBand, { props: { band: band({ tone }) } });
    expect(w.classes().join(" ")).toContain(expected);
  });
});

describe("OScheduleTimeline", () => {
  it("renders one row per track and one band per band", () => {
    const w = mount(OScheduleTimeline, {
      props: {
        tracks: [
          track({ key: "a", bands: [band({ key: "a1" }), band({ key: "a2", offset: 0.8 })] }),
          track({ key: "b", bands: [] }),
        ],
      },
    });
    expect(w.findAll("[data-test^='o2-schedule-track-']")).toHaveLength(2);
    expect(w.findAllComponents(OScheduleBand)).toHaveLength(2);
  });

  it("renders the track label in the gutter", () => {
    const w = mount(OScheduleTimeline, { props: { tracks: [track()] } });
    expect(w.text()).toContain("Base rotation");
  });

  it("renders axis ticks only when supplied", () => {
    const without = mount(OScheduleTimeline, { props: { tracks: [track()] } });
    expect(without.text()).not.toContain("Mon");

    const with_ = mount(OScheduleTimeline, {
      props: { tracks: [track()], axisTicks: [{ offset: 0, label: raw("Mon") }] },
    });
    expect(with_.text()).toContain("Mon");
  });

  it("draws one guide per dayColumn", () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()], dayColumns: [0, 0.5, 1] },
    });
    expect(w.findAll("[aria-hidden='true']")).toHaveLength(3);
  });

  // Paging forward through a calendar must not pin "now" to an edge and imply
  // the present is inside a window it is not in.
  it.each([
    [null, false],
    [0.5, true],
  ] as const)("renders the now marker for nowOffset=%s → %s", (nowOffset, expected) => {
    const w = mount(OScheduleTimeline, { props: { tracks: [track()], nowOffset } });
    expect(w.find("[data-test='o2-schedule-timeline-now']").exists()).toBe(expected);
  });

  it("lets a caller replace a band through the #band slot", () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()] },
      slots: { band: '<span class="wrapped">wrapped</span>' },
    });
    expect(w.findComponent(OScheduleBand).exists()).toBe(false);
    expect(w.find(".wrapped").exists()).toBe(true);
  });
  // ── Lane mode ─────────────────────────────────────────────────────────
  //
  // Lane mode turns the track row from a ROW (label beside strip) into a
  // COLUMN (header above strip). Both bugs below shipped past a green suite,
  // because the only spec that draws a real schedule stubs this component out.
  // They are asserted on classes rather than on geometry because jsdom does no
  // layout — a collapsed strip and a correct one look identical to a query.

  it("draws a full-width header above each strip and drops the gutter", () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()], laneHeaders: true },
      slots: { "track-header": '<div class="lane-head">head</div>' },
    });
    expect(w.find(".lane-head").exists()).toBe(true);
    expect(w.find("[data-test='o2-schedule-track-t1']").classes()).toContain("flex-col");
  });

  /// `flex-1` is `flex: 1 1 0%`. Along a COLUMN that is a height of zero, so
  /// every strip — and every band inside it — collapsed to nothing while the
  /// lane header above it kept rendering the shift it was hiding.
  it("does not let the strip take its height from flex-basis in lane mode", () => {
    const lane = mount(OScheduleTimeline, {
      props: { tracks: [track()], laneHeaders: true },
    });
    const strip = lane.find("[data-test='o2-schedule-track-t1'] > div:last-child");
    expect(strip.classes()).toContain("w-full");
    expect(strip.classes()).not.toContain("flex-1");

    // The row layout still sizes itself along the main axis, which is width.
    const row = mount(OScheduleTimeline, { props: { tracks: [track()] } });
    expect(row.find("[data-test='o2-schedule-track-t1'] > div:last-child").classes()).toContain(
      "flex-1",
    );
  });

  /// A centred tick needs a gutter to hang its left half over. Without one the
  /// first label loses half its characters off the edge of the chart.
  it("anchors axis ticks to their boundary when there is no gutter", () => {
    const props = { tracks: [track()], axisTicks: [{ offset: 0, label: raw("18") }] };
    const lane = mount(OScheduleTimeline, { props: { ...props, laneHeaders: true } });
    expect(lane.find(".absolute.bottom-0").classes()).not.toContain("-translate-x-1/2");

    const row = mount(OScheduleTimeline, { props });
    expect(row.find(".absolute.bottom-0").classes()).toContain("-translate-x-1/2");
  });

  it("stacks a tick's sublabel under it and marks the emphasised one", () => {
    const w = mount(OScheduleTimeline, {
      props: {
        tracks: [track()],
        laneHeaders: true,
        axisTicks: [{ offset: 0, label: raw("18"), sublabel: raw("Tue"), emphasis: true }],
      },
    });
    const tick = w.find(".absolute.bottom-0");
    expect(tick.text()).toContain("18");
    expect(tick.text()).toContain("Tue");
    expect(tick.classes()).toContain("text-status-error-text");
  });

  /// An empty strip reads as "nobody, all window". A caller with something to
  /// say about that says it INSTEAD of the strip, not inside a blank one.
  it("swaps an empty strip for the track-empty slot", () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track({ bands: [] })], laneHeaders: true },
      slots: { "track-empty": '<div class="lane-empty">nobody</div>' },
    });
    expect(w.find(".lane-empty").exists()).toBe(true);
    expect(w.find(".bg-surface-subtle").exists()).toBe(false);
  });

  it("keeps the strip when the track has bands", () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()], laneHeaders: true },
      slots: { "track-empty": '<div class="lane-empty">nobody</div>' },
    });
    expect(w.find(".lane-empty").exists()).toBe(false);
    expect(w.findComponent(OScheduleBand).exists()).toBe(true);
  });
  // ── Markers ───────────────────────────────────────────────────────────

  /// Every instant on the chart is read relative to now, so the line is not
  /// something to switch on — it is present whenever the window contains it.
  it("draws the now line and its stamp over the whole plot in lane mode", () => {
    const w = mount(OScheduleTimeline, {
      props: {
        tracks: [track(), track({ key: "t2" })],
        laneHeaders: true,
        nowOffset: 0.25,
        nowLabel: raw("18 Aug, 09:59"),
      },
    });
    // ONE line for the chart, not one per track — two would read as two
    // different instants.
    expect(w.findAll("[data-test='o2-schedule-timeline-now']")).toHaveLength(1);
    expect(w.find("[data-test='o2-schedule-timeline-now-label']").text()).toBe("18 Aug, 09:59");
  });

  /// Paging forward must not pin the marker to an edge and imply the present
  /// is inside a window it is not in.
  it("drops the now line, and its stamp, when the window has moved off it", () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()], laneHeaders: true, nowOffset: null, nowLabel: raw("09:59") },
    });
    expect(w.find("[data-test='o2-schedule-timeline-now']").exists()).toBe(false);
    expect(w.find("[data-test='o2-schedule-timeline-now-label']").exists()).toBe(false);
  });

  /// The component knows WHERE the pointer is; only the caller knows what that
  /// share means. So the share goes out and the sentence comes back.
  it("reports the pointer as a share of the window, and clears it on leave", async () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()], laneHeaders: true },
      attachTo: document.body,
    });
    const plot = w.find("[data-test='o2-schedule-timeline'] > div");
    plot.element.getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200 }) as DOMRect;

    await plot.trigger("mousemove", { clientX: 50 });
    expect(w.emitted("hover")!.at(-1)).toEqual([0.25]);

    await plot.trigger("mouseleave");
    expect(w.emitted("hover")!.at(-1)).toEqual([null]);
    w.unmount();
  });

  it("draws the hovered instant where the pointer is", async () => {
    const w = mount(OScheduleTimeline, {
      props: { tracks: [track()], laneHeaders: true, hoverLabel: raw("20 Aug, 14:00") },
      attachTo: document.body,
    });
    expect(w.find("[data-test='o2-schedule-timeline-hover']").exists()).toBe(false);

    const plot = w.find("[data-test='o2-schedule-timeline'] > div");
    plot.element.getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200 }) as DOMRect;
    await plot.trigger("mousemove", { clientX: 100 });

    expect(w.find("[data-test='o2-schedule-timeline-hover']").exists()).toBe(true);
    expect(w.find("[data-test='o2-schedule-timeline-hover-label']").text()).toBe("20 Aug, 14:00");
    w.unmount();
  });

  /// Gutter mode measures across a label column the share knows nothing about,
  /// so every instant it reported would be wrong by the width of that column.
  it("does not track the pointer without lane headers", async () => {
    const w = mount(OScheduleTimeline, { props: { tracks: [track()] }, attachTo: document.body });
    await w.find("[data-test='o2-schedule-timeline'] > div").trigger("mousemove", { clientX: 50 });
    expect(w.emitted("hover")).toBeUndefined();
    w.unmount();
  });

  /// A pill centred on its line loses half of itself at the window edges — the
  /// same clipping the axis ticks had — so it sits beside the line and flips
  /// once there is no room left on the right.
  it.each([
    [0.1, "ms-1.5", "-translate-x-full"],
    [0.95, "-translate-x-full", "ms-1.5"],
  ])("keeps the stamp on screen at offset %s", async (offset, present, absent) => {
    const w = mount(OScheduleTimeline, {
      props: {
        tracks: [track()],
        laneHeaders: true,
        nowOffset: offset as number,
        nowLabel: raw("09:59"),
      },
    });
    const pill = w.find("[data-test='o2-schedule-timeline-now-label']");
    expect(pill.classes()).toContain(present as string);
    expect(pill.classes()).not.toContain(absent as string);
  });
});
