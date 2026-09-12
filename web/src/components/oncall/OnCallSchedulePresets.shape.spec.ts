// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import type { PresetDescriptor } from "@/ts/interfaces/oncall";

import { coverageOf, layersOf } from "./OnCallSchedulePresets.shape";

/// Only `id` and the field labels are read here, so the fixtures carry those
/// and nothing else — a full catalogue copy would drift from the server's.
function descriptor(id: string, fields: string[]): PresetDescriptor {
  return {
    id,
    name: id,
    description: "",
    layers: [],
    inputs: fields.map((field) => ({
      field,
      kind: "group",
      label: field,
      description: "",
      required: true,
    })),
  };
}

const MON = 0;
const SAT = 5;

describe("layersOf", () => {
  it("gives every follow-the-sun region its own window and the catch-all the rest", () => {
    const layers = layersOf(descriptor("follow_the_sun", ["groups", "catch_all"]), {
      groups: [
        { name: "APAC", members: ["mei@x.io"], start_minute: 360, end_minute: 840 },
        { name: "EMEA", members: ["priya@x.io"], start_minute: 840, end_minute: 1320 },
      ],
    });

    expect(layers?.map((l) => l.restriction.kind)).toEqual(["window", "window", "always"]);
    expect(layers?.[0]?.tone).not.toBe(layers?.[1]?.tone);
  });

  /// "Leave it out and everybody named above covers them" is the server's
  /// documented default; an empty catch-all here would report a staffing hole
  /// the server would never create.
  it("staffs an un-named catch-all with everybody above it", () => {
    const layers = layersOf(descriptor("follow_the_sun", ["groups", "catch_all"]), {
      groups: [
        { members: ["mei@x.io"], start_minute: 0, end_minute: 720 },
        { members: ["priya@x.io", "mei@x.io"], start_minute: 720, end_minute: 1440 },
      ],
    });

    expect(layers?.at(-1)?.members).toEqual(["mei@x.io", "priya@x.io"]);
  });

  /// A shape this build has never met still renders and applies — it just gets
  /// no picture, rather than a confident wrong one.
  it("declines to guess a shape it has never met", () => {
    expect(layersOf(descriptor("something_new", ["groups"]), {})).toBeNull();
  });
});

describe("coverageOf", () => {
  it("covers every hour of a follow-the-sun week", () => {
    const layers = layersOf(descriptor("follow_the_sun", ["groups", "catch_all"]), {
      groups: [
        { name: "APAC", members: ["mei@x.io"], start_minute: 360, end_minute: 840 },
        { name: "AMER", members: ["diego@x.io"], start_minute: 1320, end_minute: 360 },
      ],
    });
    const coverage = coverageOf(layers ?? []);

    expect(coverage.gapHours).toBe(0);
    expect(coverage.unstaffedHours).toBe(0);
  });

  /// The verdict is the part that is acted on. A layer nobody is in claims its
  /// hours and then pages nobody, so it is counted, not painted as covered.
  it("counts the hours a layer with nobody in it would claim", () => {
    const layers = layersOf(descriptor("weekday_weekend", ["weekdays", "weekend"]), {
      weekdays: { members: [] },
      weekend: { members: ["lena@x.io"] },
    });
    const coverage = coverageOf(layers ?? []);

    expect(coverage.unstaffedHours).toBe(5 * 24);
    expect(coverage.gapHours).toBe(0);
  });

  it("hands the week over at the boundary the form names", () => {
    const layers = layersOf(descriptor("split_the_week", ["first", "second"]), {
      first: { members: ["mei@x.io"] },
      second: { members: ["priya@x.io"] },
      boundary_day: 3,
      boundary_minute: 9 * 60,
    });
    const coverage = coverageOf(layers ?? []);

    // Monday belongs to the first half all day; Saturday to the second.
    expect(coverage.cells[MON]).toEqual([1, 1, 1]);
    expect(coverage.cells[SAT]).toEqual(["rest", "rest", "rest"]);
  });

  /// One uncovered or unstaffed hour inside an eight-hour cell is the whole
  /// reason to look at the picture; averaging it away would hide it behind
  /// seven good hours.
  it("paints a cell by its exception, not by its majority", () => {
    const layers = layersOf(
      descriptor("business_hours_plus_nights", ["business_hours", "after_hours"]),
      {
        business_hours: { members: [] },
        after_hours: { members: ["lena@x.io"] },
        days: [0],
        start_minute: 9 * 60,
        end_minute: 10 * 60,
      },
    );
    const coverage = coverageOf(layers ?? []);

    // 09:00–10:00 is one unstaffed hour inside Monday's 08:00–16:00 cell.
    expect(coverage.cells[MON]?.[1]).toBe("unstaffed");
    expect(coverage.unstaffedHours).toBe(1);
  });
});
