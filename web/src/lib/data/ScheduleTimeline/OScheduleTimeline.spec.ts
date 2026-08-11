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
});
