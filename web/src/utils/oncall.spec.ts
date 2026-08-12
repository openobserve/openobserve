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

import type { EscalationLevel, Rotation, TimeWindow } from "@/ts/interfaces/oncall";
import {
  MICROS_PER_DAY,
  MICROS_PER_HOUR,
  MICROS_PER_WEEK,
} from "@/ts/interfaces/oncall";
import {
  isEscalating,
  isUnresolved,
  memberAt,
  nextHandover,
  normalizeDimensionValue,
  ownershipPath,
  priorityLabel,
  priorityTagVariant,
  stateTagVariant,
  upcomingShifts,
  isSnoozed,
  groupBySubject,
  isStaffed,
  describeTarget,
  shiftBands,
  describeRestrictions,
  formatInZone,
  formatMinuteOfDay,
  isRotationValid,
  resolveHolder,
  resolveNextHolder,
  rotationAppliesAt,
  windowContains,
  CHANNEL_WAKES,
  PRIORITY_TONE,
  priorityTone,
  colorIndexFor,
  routingReasonOf,
  resolveLadder,
} from "@/utils/oncall";
import type { TranslateFn } from "@/types/i18n";

const ANCHOR = 1_700_000_000_000_000;

function weekly(members: string[], level: EscalationLevel = "primary"): Rotation {
  return {
    level,
    members,
    shift_micros: MICROS_PER_WEEK,
    anchor_micros: ANCHOR,
  };
}

describe("memberAt", () => {
  it("puts the first member on call from the anchor", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai"]);
    expect(memberAt(r, ANCHOR)).toBe("ana@o2.ai");
    expect(memberAt(r, ANCHOR + MICROS_PER_DAY)).toBe("ana@o2.ai");
  });

  // The handover instant belongs to the INCOMING person. An inclusive bound
  // would leave both of them on call for the same alert.
  it("treats the handover boundary as exclusive", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai"]);
    expect(memberAt(r, ANCHOR + MICROS_PER_WEEK - 1)).toBe("ana@o2.ai");
    expect(memberAt(r, ANCHOR + MICROS_PER_WEEK)).toBe("bob@o2.ai");
  });

  it("wraps around the member list", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"]);
    const expected = ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"];
    for (let week = 0; week < 9; week++) {
      expect(memberAt(r, ANCHOR + week * MICROS_PER_WEEK)).toBe(
        expected[week % 3],
      );
    }
  });

  // JS `%` keeps the dividend's sign, so a pre-anchor index needs an explicit
  // wrap. Without it this returns undefined instead of the right person.
  it("walks backwards for instants before the anchor", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai"]);
    expect(memberAt(r, ANCHOR - 1)).toBe("bob@o2.ai");
    expect(memberAt(r, ANCHOR - MICROS_PER_WEEK)).toBe("bob@o2.ai");
    expect(memberAt(r, ANCHOR - MICROS_PER_WEEK - 1)).toBe("ana@o2.ai");
  });

  it("keeps a single member on call at every instant", () => {
    const r = weekly(["ana@o2.ai"]);
    for (const offset of [-MICROS_PER_WEEK, 0, MICROS_PER_DAY, 99 * MICROS_PER_WEEK]) {
      expect(memberAt(r, ANCHOR + offset)).toBe("ana@o2.ai");
    }
  });

  it("resolves arbitrary shift lengths", () => {
    const r: Rotation = {
      level: "primary",
      members: ["ana@o2.ai", "bob@o2.ai"],
      shift_micros: 8 * MICROS_PER_HOUR,
      anchor_micros: ANCHOR,
    };
    expect(memberAt(r, ANCHOR)).toBe("ana@o2.ai");
    expect(memberAt(r, ANCHOR + 8 * MICROS_PER_HOUR)).toBe("bob@o2.ai");
    expect(memberAt(r, ANCHOR + 16 * MICROS_PER_HOUR)).toBe("ana@o2.ai");
  });

  // An unusable rotation must read as a gap, never as a silently chosen
  // fallback member.
  it("resolves to nobody when the rotation is unusable", () => {
    expect(memberAt(weekly([]), ANCHOR)).toBeNull();
    expect(
      memberAt({ ...weekly(["ana@o2.ai"]), shift_micros: 0 }, ANCHOR),
    ).toBeNull();
    expect(
      memberAt({ ...weekly(["ana@o2.ai"]), shift_micros: -1 }, ANCHOR),
    ).toBeNull();
  });
});

describe("nextHandover", () => {
  it("brackets the instant and hands over to the next member", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai"]);
    const at = ANCHOR + MICROS_PER_DAY;
    const handover = nextHandover(r, at)!;
    expect(handover).toBe(ANCHOR + MICROS_PER_WEEK);
    expect(memberAt(r, handover - 1)).toBe("ana@o2.ai");
    expect(memberAt(r, handover)).toBe("bob@o2.ai");
  });

  it("is null for an unusable rotation", () => {
    expect(nextHandover(weekly([]), ANCHOR)).toBeNull();
  });
});

describe("priorityLabel", () => {
  it("renders P1 through P5", () => {
    expect(priorityLabel(1)).toBe("P1");
    expect(priorityLabel(5)).toBe("P5");
  });

  // A priority the UI cannot read must not be shown as a plausible one.
  it("renders an em dash for anything outside the scale", () => {
    for (const bad of [0, 6, -1, 99]) {
      expect(priorityLabel(bad)).toBe("—");
    }
  });
});

describe("tag variants", () => {
  it("gives the most urgent priority the loudest variant", () => {
    expect(priorityTagVariant(1)).toBe("error-soft");
    expect(priorityTagVariant(2)).toBe("orange-soft");
    expect(priorityTagVariant(3)).toBe("amber-soft");
    expect(priorityTagVariant(4)).toBe("blue-soft");
    expect(priorityTagVariant(5)).toBe("default-soft");
  });

  it("maps every lifecycle state to a distinct variant", () => {
    const variants = new Set(
      (["triggered", "triaged", "acknowledged", "resolved"] as const).map(
        stateTagVariant,
      ),
    );
    expect(variants.size).toBe(4);
  });
});

describe("isEscalating / isUnresolved", () => {
  // Triage by the agent is not somebody taking the ball, so it still counts
  // as escalating.
  it("counts triggered and triaged as still escalating", () => {
    expect(isEscalating("triggered")).toBe(true);
    expect(isEscalating("triaged")).toBe(true);
    expect(isEscalating("acknowledged")).toBe(false);
    expect(isEscalating("resolved")).toBe(false);
  });

  /// The two questions are different, and answering the second with the first
  /// is what made an acknowledged page impossible to resolve.
  it("keeps an acknowledged page unresolved even though its ladder stopped", () => {
    expect(isEscalating("acknowledged")).toBe(false);
    expect(isUnresolved("acknowledged")).toBe(true);

    expect(isUnresolved("triggered")).toBe(true);
    expect(isUnresolved("triaged")).toBe(true);
    expect(isUnresolved("resolved")).toBe(false);
  });
});

describe("groupBySubject", () => {
  const rec = (id: string, source: string, at: number, state = "triggered") =>
    ({
      id,
      subject: { subject_type: "alert", source_id: source, firing: 1 },
      state,
      opened_at: at,
    }) as any;

  /// The whole point: a rule firing every minute must not become a wall of
  /// identical rows.
  it("collapses firings of one alert into a single row", () => {
    const groups = groupBySubject([
      rec("a", "al_1", 300),
      rec("b", "al_1", 100),
      rec("c", "al_2", 200),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].firings).toHaveLength(2);
    expect(groups[1].firings).toHaveLength(1);
  });

  /// The row stands for the newest firing, whatever order the server sent.
  it("represents a group by its most recent firing", () => {
    const groups = groupBySubject([
      rec("older", "al_1", 100),
      rec("newest", "al_1", 900),
      rec("middle", "al_1", 500),
    ]);

    expect(groups[0].latest.id).toBe("newest");
    expect(groups[0].firings.map((f) => f.id)).toEqual(["newest", "middle", "older"]);
  });

  /// Acting on the row acts on what can still be acted on, so the count has
  /// to exclude the ones already acknowledged or closed.
  it("counts only the firings still escalating", () => {
    const groups = groupBySubject([
      rec("a", "al_1", 300),
      rec("b", "al_1", 200, "acknowledged"),
      rec("c", "al_1", 100, "resolved"),
    ]);

    expect(groups[0].firings).toHaveLength(3);
    expect(groups[0].escalating.map((r) => r.id)).toEqual(["a"]);
  });

  /// Two subject types can share a source id without being the same thing.
  it("does not merge different subject types", () => {
    const alert = rec("a", "same", 100);
    const incident = { ...rec("b", "same", 200), subject: { subject_type: "incident", source_id: "same", firing: 1 } };

    expect(groupBySubject([alert, incident as any])).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(groupBySubject([])).toEqual([]);
  });
});

describe("isStaffed", () => {
  const rotation = (members: string[]) => ({
    name: "Primary",
    members,
    shift_micros: 604_800_000_000,
    anchor_micros: 0,
  });

  /// The only coverage question left. There used to be six slots to leave
  /// empty, so a correctly configured team warned about four of them forever.
  it("asks only whether a page would reach anybody", () => {
    expect(isStaffed([rotation(["ana@o2.ai"])], 0)).toBe(true);
    expect(isStaffed([rotation([])], 0)).toBe(false);
    expect(isStaffed([], 0)).toBe(false);
  });
});

describe("describeTarget", () => {
  const t = ((k: string) => k) as any;

  /// A person target reads as the person; the rest read as their role.
  it("names the person for a user target and the role otherwise", () => {
    expect(describeTarget({ kind: "user", email: "ana@o2.ai" }, t)).toBe("ana@o2.ai");
    expect(describeTarget({ kind: "on_call_now" }, t)).toBe("oncall.target_on_call_now");
    expect(describeTarget({ kind: "next_on_call" }, t)).toBe("oncall.target_next_on_call");
  });
});

describe("shiftBands", () => {
  const DAY = 86_400_000_000;
  const rotation = (members: string[], shift = DAY) => ({
    name: "Primary",
    members,
    shift_micros: shift,
    anchor_micros: 0,
  });

  it("lays shifts across the window as fractions of it", () => {
    const bands = shiftBands(rotation(["ana", "bob"]), 0, 2 * DAY);

    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ user_email: "ana", offset: 0, width: 0.5 });
    expect(bands[1]).toMatchObject({ user_email: "bob", offset: 0.5, width: 0.5 });
  });

  /// A band running past the edge would be drawn wider than the chart and push
  /// everything else off screen.
  it("clips a shift that overruns the window", () => {
    const bands = shiftBands(rotation(["ana"], 7 * DAY), 0, DAY);

    expect(bands).toHaveLength(1);
    expect(bands[0].width).toBe(1);
    expect(bands[0].endMicros).toBe(DAY);
  });

  it("includes a shift that started before the window", () => {
    const bands = shiftBands(rotation(["ana", "bob"]), DAY / 2, DAY);

    expect(bands[0].user_email).toBe("ana");
    expect(bands[0].startMicros).toBe(DAY / 2);
  });

  /// A one-minute shift over a month would otherwise draw tens of thousands of
  /// slivers and lock the page.
  it("bounds how many bands it will draw", () => {
    const bands = shiftBands(rotation(["ana"], 60_000_000), 0, 365 * DAY);
    expect(bands.length).toBeLessThanOrEqual(500);
  });

  it("draws nothing for an unusable rotation", () => {
    expect(shiftBands(rotation([]), 0, DAY)).toEqual([]);
    expect(shiftBands(rotation(["ana"], 0), 0, DAY)).toEqual([]);
    expect(shiftBands(rotation(["ana"]), DAY, DAY)).toEqual([]);
  });
});

describe("colorIndexFor", () => {
  /// A band that changes colour as you page through the calendar is
  /// unreadable, so the colour comes from the person, not their position.
  it("gives one person the same colour every time", () => {
    expect(colorIndexFor("ana@o2.ai")).toBe(colorIndexFor("ana@o2.ai"));
    expect(colorIndexFor("ana@o2.ai")).toBeGreaterThanOrEqual(0);
    expect(colorIndexFor("ana@o2.ai")).toBeLessThan(8);
  });

  it("stays inside the bucket count", () => {
    for (const email of ["a", "bob@o2.ai", "verylongaddress@example.com", ""]) {
      const i = colorIndexFor(email, 5);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(5);
    }
  });
});

describe("isSnoozed", () => {
  const NOW = 1_700_000_000_000_000;

  it("is true only while the snooze is still ahead", () => {
    expect(isSnoozed({ snoozed_until: NOW + 1 }, NOW)).toBe(true);
    expect(isSnoozed({ snoozed_until: NOW }, NOW)).toBe(false);
    expect(isSnoozed({ snoozed_until: NOW - 1 }, NOW)).toBe(false);
  });

  it("treats a record that was never snoozed as awake", () => {
    expect(isSnoozed({}, NOW)).toBe(false);
    expect(isSnoozed({ snoozed_until: null }, NOW)).toBe(false);
  });
});

describe("normalizeDimensionValue", () => {
  // The server lowercases and trims rules to match what the dimension
  // extractor produces. Doing it here too means the value a user reads back
  // is the value that will match, not one that silently changes on save.
  it("lowercases and trims the way the server does", () => {
    expect(normalizeDimensionValue("  PROD ")).toBe("prod");
    expect(normalizeDimensionValue("Payments")).toBe("payments");
    expect(normalizeDimensionValue("us-east-1")).toBe("us-east-1");
  });

  it("is idempotent", () => {
    const once = normalizeDimensionValue(" MiXeD ");
    expect(normalizeDimensionValue(once)).toBe(once);
  });
});

describe("ownershipPath", () => {
  // The unique index dedupes on this string, so it cannot depend on key
  // insertion order.
  it("sorts by dimension name regardless of insertion order", () => {
    const forward = ownershipPath({
      "k8s-cluster": "prod",
      "k8s-namespace": "payments",
    });
    const reverse = ownershipPath({
      "k8s-namespace": "payments",
      "k8s-cluster": "prod",
    });
    expect(forward).toBe("k8s-cluster=prod/k8s-namespace=payments");
    expect(reverse).toBe(forward);
  });

  it("renders a single dimension without a separator", () => {
    expect(ownershipPath({ "k8s-cluster": "prod" })).toBe("k8s-cluster=prod");
  });

  it("is empty for no dimensions", () => {
    expect(ownershipPath({})).toBe("");
  });
});

describe("upcomingShifts", () => {
  it("starts with the shift containing the given instant", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai"]);
    const shifts = upcomingShifts(r, ANCHOR + MICROS_PER_DAY, 3);

    expect(shifts).toHaveLength(3);
    expect(shifts[0].member).toBe("ana@o2.ai");
    expect(shifts[0].startMicros).toBe(ANCHOR);
    expect(shifts[0].endMicros).toBe(ANCHOR + MICROS_PER_WEEK);
    expect(shifts[1].member).toBe("bob@o2.ai");
    expect(shifts[2].member).toBe("ana@o2.ai");
  });

  // Each shift must end exactly where the next begins, or the preview implies
  // a gap or an overlap that the resolver does not have.
  it("produces contiguous shifts", () => {
    const shifts = upcomingShifts(weekly(["a", "b", "c"]), ANCHOR, 5);
    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i].startMicros).toBe(shifts[i - 1].endMicros);
    }
  });

  // The preview and the resolver must not disagree — that is the whole point
  // of showing it.
  it("agrees with memberAt at every boundary", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"]);
    for (const shift of upcomingShifts(r, ANCHOR - MICROS_PER_WEEK, 8)) {
      expect(memberAt(r, shift.startMicros)).toBe(shift.member);
      expect(memberAt(r, shift.endMicros - 1)).toBe(shift.member);
    }
  });

  it("works for instants before the anchor", () => {
    const r = weekly(["ana@o2.ai", "bob@o2.ai"]);
    const shifts = upcomingShifts(r, ANCHOR - 1, 2);
    expect(shifts[0].member).toBe("bob@o2.ai");
    expect(shifts[0].endMicros).toBe(ANCHOR);
    expect(shifts[1].member).toBe("ana@o2.ai");
  });

  it("returns nothing for an unusable rotation or a non-positive count", () => {
    expect(upcomingShifts(weekly([]), ANCHOR, 3)).toEqual([]);
    expect(upcomingShifts({ ...weekly(["a"]), shift_micros: 0 }, ANCHOR, 3)).toEqual([]);
    expect(upcomingShifts(weekly(["a"]), ANCHOR, 0)).toEqual([]);
  });
});

// ── Layers: the shared resolver ────────────────────────────────────────────
//
// These cases are PORTED from the Rust engine's own tests
// (`src/config/src/meta/oncall/rotation.rs`, `mod tests` → "Layers"), because
// the calendar and the engine disagreeing about who is on call is the single
// most damaging thing this feature can do. Same fixtures, same instants, same
// expectations, so the two implementations are pinned together.
//
// Not ported, and why: `test_layer_round_trips_through_json` and
// `test_round_trips_through_json` test serde, which has no TS counterpart;
// `everyone_on_schedule` has no UI consumer yet, so no TS function exists to
// test.

const IST = "Asia/Kolkata";
const NY = "America/New_York";

/** Offset of `tz` from UTC, in ms, at `date`. */
function tzOffsetMs(tz: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

/** Micros for a local wall-clock instant in `tz` — the Rust tests' `local()`. */
function local(tz: string, y: number, m: number, d: number, h: number, min: number): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = tzOffsetMs(tz, new Date(guess));
  let ms = guess - first;
  // One refinement pass so a DST boundary resolves to the right side.
  const second = tzOffsetMs(tz, new Date(ms));
  if (second !== first) ms = guess - second;
  return ms * 1000;
}

function window(days: number[], start: number, end: number): TimeWindow {
  return { days, start_minute: start, end_minute: end };
}

function layer(
  name: string,
  members: string[],
  priority: number,
  restrictions: TimeWindow[],
): Rotation {
  return {
    name,
    members,
    shift_micros: MICROS_PER_WEEK,
    anchor_micros: ANCHOR,
    priority,
    restrictions,
  };
}

describe("windowContains", () => {
  // 2026-08-10 is a Monday; 2026-08-15 a Saturday.
  const weekdayOffice = window([0, 1, 2, 3, 4], 9 * 60, 17 * 60);

  it.each([
    ["Monday 10:00, inside", local(IST, 2026, 8, 10, 10, 0), true],
    ["Monday 08:59, before", local(IST, 2026, 8, 10, 8, 59), false],
    ["Monday 17:00, end is exclusive", local(IST, 2026, 8, 10, 17, 0), false],
    ["Saturday 10:00, wrong day", local(IST, 2026, 8, 15, 10, 0), false],
  ])("matches local days and hours: %s", (_name, at, expected) => {
    expect(windowContains(weekdayOffice, at, IST)).toBe(expected);
  });

  // The window is local wall time, so the same INSTANT matches or not depending
  // on the schedule's zone. That is the entire point of follow-the-sun.
  it("is evaluated in the schedule's timezone, not the browser's", () => {
    const office = window([], 9 * 60, 17 * 60);
    const at = local(IST, 2026, 8, 10, 10, 0); // 10:00 IST == 04:30 UTC
    expect(windowContains(office, at, IST)).toBe(true);
    expect(windowContains(office, at, "UTC")).toBe(false);
  });

  // A 22:00–06:00 night shift is ONE window. Splitting it would make the common
  // case the awkward one.
  it.each([
    ["Mon 23:30", local(IST, 2026, 8, 10, 23, 30), true],
    ["Tue 02:00", local(IST, 2026, 8, 11, 2, 0), true],
    ["Tue 07:00", local(IST, 2026, 8, 11, 7, 0), false],
  ])("wraps midnight: %s", (_name, at, expected) => {
    expect(windowContains(window([], 22 * 60, 6 * 60), at, IST)).toBe(expected);
  });

  // Somebody covering "Friday nights" is still on at 02:00 on Saturday.
  it.each([
    ["Fri 23:00", local(IST, 2026, 8, 14, 23, 0), true],
    ["Sat 02:00 is Friday's shift", local(IST, 2026, 8, 15, 2, 0), true],
    ["Sat 23:00 is not", local(IST, 2026, 8, 15, 23, 0), false],
  ])("counts a wrapped window against the shift's starting day: %s", (_n, at, expected) => {
    expect(windowContains(window([4], 22 * 60, 6 * 60), at, IST)).toBe(expected);
  });

  // New York moves its clock; a 09:00-local window must stay 09:00 local on both
  // sides of the transition rather than drifting an hour in UTC.
  it.each([
    ["before DST", local(NY, 2026, 3, 7, 10, 0), true],
    ["after DST", local(NY, 2026, 3, 9, 10, 0), true],
    ["after DST, 08:00 is outside", local(NY, 2026, 3, 9, 8, 0), false],
  ])("follows local time across DST: %s", (_name, at, expected) => {
    expect(windowContains(window([], 9 * 60, 17 * 60), at, NY)).toBe(expected);
  });
});

describe("rotationAppliesAt", () => {
  it("applies always when there are no restrictions", () => {
    const r = layer("Base", ["ana@o2.ai"], 0, []);
    expect(rotationAppliesAt(r, local(IST, 2026, 8, 15, 3, 0), IST)).toBe(true);
  });

  // A rotation stored before the layers feature carries neither field; it must
  // read as unrestricted rather than as never applying.
  it("treats absent priority/restrictions as the unrestricted catch-all", () => {
    const legacy: Rotation = {
      name: "Base",
      members: ["ana@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      anchor_micros: ANCHOR,
    };
    expect(rotationAppliesAt(legacy, ANCHOR, IST)).toBe(true);
    expect(resolveHolder([legacy], ANCHOR, IST).member).toBe("ana@o2.ai");
  });

  // "Weekday mornings or weekend afternoons" is two windows; matching either is
  // enough.
  it.each([
    ["weekday morning", local(IST, 2026, 8, 10, 10, 0), true],
    ["weekend afternoon", local(IST, 2026, 8, 15, 14, 0), true],
    ["weekday afternoon", local(IST, 2026, 8, 10, 14, 0), false],
  ])("ORs multiple windows: %s", (_name, at, expected) => {
    const r = layer("Base", ["ana@o2.ai"], 0, [
      window([0, 1, 2, 3, 4], 9 * 60, 12 * 60),
      window([5, 6], 13 * 60, 18 * 60),
    ]);
    expect(rotationAppliesAt(r, at, IST)).toBe(expected);
  });
});

describe("isRotationValid", () => {
  const base = () => layer("Base", ["ana@o2.ai", "bob@o2.ai"], 0, []);

  it.each([
    ["a usable rotation", base(), true],
    ["no members", { ...base(), members: [] }, false],
    ["a zero shift", { ...base(), shift_micros: 0 }, false],
    ["a negative shift", { ...base(), shift_micros: -1 }, false],
    ["a blank name", { ...base(), name: "  " }, false],
    ["a case-insensitive duplicate member", { ...base(), members: ["ana@o2.ai", "ANA@o2.ai"] }, false],
  ])("%s → %s", (_name, rotation, expected) => {
    expect(isRotationValid(rotation as Rotation)).toBe(expected);
  });
});

describe("resolveHolder", () => {
  // Follow-the-sun: a restricted layer covers its hours, the unrestricted
  // catch-all covers everything nobody claimed.
  it.each([
    ["office hours", local(IST, 2026, 8, 10, 11, 0), "india@o2.ai"],
    ["the middle of the night", local(IST, 2026, 8, 10, 23, 0), "catchall@o2.ai"],
  ])("a restricted layer wins inside its window and yields outside: %s", (_n, at, expected) => {
    const rotations = [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("India", ["india@o2.ai"], 10, [window([0, 1, 2, 3, 4], 9 * 60, 17 * 60)]),
    ];
    expect(resolveHolder(rotations, at, IST).member).toBe(expected);
  });

  it.each([
    [8, "apac@o2.ai"],
    [16, "emea@o2.ai"],
    [23, "amer@o2.ai"],
    [3, "amer@o2.ai"],
  ])("three restricted layers over one catch-all resolve at %ih to %s", (hour, expected) => {
    const rotations = [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("APAC", ["apac@o2.ai"], 10, [window([], 6 * 60, 14 * 60)]),
      layer("EMEA", ["emea@o2.ai"], 10, [window([], 14 * 60, 22 * 60)]),
      layer("AMER", ["amer@o2.ai"], 10, [window([], 22 * 60, 6 * 60)]),
    ];
    expect(resolveHolder(rotations, local(IST, 2026, 8, 10, hour, 0), IST).member).toBe(expected);
  });

  // Priority is explicit, not positional. Reordering the list — which the old
  // "last one wins" calendar was entirely at the mercy of — must not change who
  // is paged.
  it("lets priority decide, not list order", () => {
    const low = layer("Low", ["low@o2.ai"], 1, [window([], 0, 1440)]);
    const high = layer("High", ["high@o2.ai"], 5, [window([], 0, 1440)]);
    const at = local(IST, 2026, 8, 10, 12, 0);

    expect(resolveHolder([low, high], at, IST).member).toBe("high@o2.ai");
    expect(resolveHolder([high, low], at, IST).member).toBe("high@o2.ai");
  });

  // At equal priority the MORE SPECIFIC rotation wins, so a catch-all never
  // shadows a layer somebody deliberately restricted.
  it("breaks an equal-priority tie toward the restricted layer", () => {
    const rotations = [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("Office", ["office@o2.ai"], 0, [window([], 9 * 60, 17 * 60)]),
    ];
    const at = local(IST, 2026, 8, 10, 12, 0);
    expect(resolveHolder(rotations, at, IST).member).toBe("office@o2.ai");
    expect(resolveHolder([...rotations].reverse(), at, IST).member).toBe("office@o2.ai");
  });

  // A moment no layer covers is a coverage GAP, not a silent fallback to
  // somebody else's rotation.
  it("resolves to nobody when no layer applies", () => {
    const rotations = [
      layer("Office", ["office@o2.ai"], 0, [window([0, 1, 2, 3, 4], 9 * 60, 17 * 60)]),
    ];
    const saturday = local(IST, 2026, 8, 15, 12, 0);
    expect(resolveHolder(rotations, saturday, IST)).toEqual({ member: null, rotation: null });
  });

  // An unusable rotation must staff nobody rather than defaulting to members[0],
  // which would page a person the schedule never selected.
  it.each([
    ["no members", layer("Base", [], 0, [])],
    ["a zero shift", { ...layer("Base", ["ana@o2.ai"], 0, []), shift_micros: 0 }],
    ["a blank name", { ...layer("Base", ["ana@o2.ai"], 0, []), name: "" }],
  ])("a broken rotation (%s) staffs nobody", (_name, rotation) => {
    expect(resolveHolder([rotation as Rotation], ANCHOR, IST).member).toBeNull();
  });

  it("names the rotation that decided, so the UI can say why", () => {
    const office = layer("Office", ["office@o2.ai"], 0, [window([], 9 * 60, 17 * 60)]);
    const rotations = [layer("Base", ["catchall@o2.ai"], 0, []), office];
    const resolved = resolveHolder(rotations, local(IST, 2026, 8, 10, 12, 0), IST);
    expect(resolved.rotation?.name).toBe("Office");
  });

  it("walks the winning rotation's own handover order", () => {
    const rotations = [layer("Base", ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], 0, [])];
    expect(resolveHolder(rotations, ANCHOR, IST).member).toBe("ana@o2.ai");
    expect(resolveHolder(rotations, ANCHOR + MICROS_PER_WEEK, IST).member).toBe("bob@o2.ai");
  });
});

describe("resolveNextHolder", () => {
  it("is the winning rotation's next member", () => {
    const rotations = [layer("Base", ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], 0, [])];
    expect(resolveNextHolder(rotations, ANCHOR, IST)).toBe("bob@o2.ai");
    expect(resolveNextHolder(rotations, ANCHOR + MICROS_PER_WEEK, IST)).toBe("cara@o2.ai");
  });

  it("wraps, so the last member hands back to the first", () => {
    const rotations = [layer("Base", ["ana@o2.ai", "bob@o2.ai"], 0, [])];
    expect(resolveNextHolder(rotations, ANCHOR + MICROS_PER_WEEK, IST)).toBe("ana@o2.ai");
  });

  // Returning the same person would page them twice and call the second one an
  // escalation.
  it("is null for a one-person rotation", () => {
    expect(resolveNextHolder([layer("Base", ["ana@o2.ai"], 0, [])], ANCHOR, IST)).toBeNull();
  });

  it("is null when nobody is on call", () => {
    expect(resolveNextHolder([], ANCHOR, IST)).toBeNull();
  });
});

describe("formatInZone", () => {
  // 04:30 UTC is 10:00 in Kolkata. The team's zone decides, never the browser's.
  const AT = Date.UTC(2026, 7, 10, 4, 30) * 1000;
  const HHMM: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };

  it.each([
    ["Asia/Kolkata", "10:00"],
    ["UTC", "04:30"],
    ["America/New_York", "00:30"],
  ])("renders the same instant as %s local time: %s", (timezone, expected) => {
    expect(formatInZone(AT, timezone, HHMM, "en-US")).toBe(expected);
  });

  it("renders a date and a time by default", () => {
    expect(formatInZone(AT, "UTC", undefined, "en-US")).toContain("2026");
  });

  // A bad zone must not take the schedule down with it.
  it("falls back to UTC for an unknown timezone", () => {
    expect(formatInZone(AT, "Mars/Olympus_Mons", HHMM, "en-US")).toBe("04:30");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "renders an em dash rather than Invalid Date for %s",
    (micros) => {
      expect(formatInZone(micros, "UTC", HHMM, "en-US")).toBe("—");
    },
  );
});

describe("formatMinuteOfDay", () => {
  it.each([
    [0, "00:00"],
    [540, "09:00"],
    [1020, "17:00"],
    [1439, "23:59"],
    [1440, "00:00"],
  ])("%i minutes past midnight is %s", (minute, expected) => {
    expect(formatMinuteOfDay(minute)).toBe(expected);
  });
});

describe("describeRestrictions", () => {
  // The identity translator: the assertion is the SHAPE of the sentence, not
  // the English, so this does not break when copy changes.
  const t = ((key: string, params?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "oncall.restrictionAlways": "the rest of the time",
      "oncall.restrictionEveryDay": "every day",
      "oncall.restrictionDayRange": "{from}–{to}",
      "oncall.restrictionWindow": "{days} {from}–{to}",
      "oncall.restrictionList": "{windows}",
      "oncall.day_mon": "Mon",
      "oncall.day_tue": "Tue",
      "oncall.day_wed": "Wed",
      "oncall.day_thu": "Thu",
      "oncall.day_fri": "Fri",
      "oncall.day_sat": "Sat",
      "oncall.day_sun": "Sun",
    };
    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) =>
      String(params?.[name] ?? ""),
    );
  }) as unknown as TranslateFn;

  // "always" would read as "the layers above this never fire". It is the
  // fallback UNDER them.
  it.each([
    ["no windows", [], "the rest of the time"],
    ["no days", [window([], 0, 8 * 60)], "every day 00:00–08:00"],
    ["a contiguous run", [window([0, 1, 2, 3, 4], 9 * 60, 17 * 60)], "Mon–Fri 09:00–17:00"],
    ["a weekend pair", [window([5, 6], 13 * 60, 18 * 60)], "Sat, Sun 13:00–18:00"],
    ["a scattered set", [window([0, 2, 4], 9 * 60, 12 * 60)], "Mon, Wed, Fri 09:00–12:00"],
    ["all seven days", [window([0, 1, 2, 3, 4, 5, 6], 0, 1440)], "every day 00:00–00:00"],
    ["a midnight wrap", [window([4], 22 * 60, 6 * 60)], "Fri 22:00–06:00"],
  ])("describes %s", (_name, windows, expected) => {
    expect(describeRestrictions(windows, t)).toBe(expected);
  });

  it("joins several windows", () => {
    expect(
      describeRestrictions([window([0, 1, 2, 3, 4], 540, 720), window([5, 6], 780, 1080)], t),
    ).toBe("Mon–Fri 09:00–12:00 · Sat, Sun 13:00–18:00");
  });

  it("treats an absent list as unrestricted", () => {
    expect(describeRestrictions(undefined, t)).toBe("the rest of the time");
  });
});

describe("PRIORITY_TONE / priorityTone", () => {
  // The rail and the chip must be the same colour for the same priority, which
  // is only true while both come from one map.
  it.each([
    [1, "p1"],
    [2, "p2"],
    [3, "p3"],
    [4, "p4"],
    [5, "p5"],
  ] as const)("P%i rails as %s", (priority, expected) => {
    expect(PRIORITY_TONE[priority]).toBe(expected);
    expect(priorityTone(priority)).toBe(expected);
  });

  // A priority the UI cannot read must not be shown as a plausible severity.
  it.each([0, 6, Number.NaN])("rails an out-of-range priority (%s) as neutral", (priority) => {
    expect(priorityTone(priority)).toBe("neutral");
  });
});

describe("CHANNEL_WAKES", () => {
  // The policy editor's "reaches a locked phone" column. Getting this wrong is
  // how a team discovers at 3 a.m. that their P1 only ever sent an email.
  it.each([
    ["email", false],
    ["chat", false],
    ["webhook", false],
    ["in_app", false],
    ["push", true],
    ["sms", true],
    ["voice", true],
  ] as const)("%s wakes a locked phone: %s", (channel, expected) => {
    expect(CHANNEL_WAKES[channel]).toBe(expected);
  });
});

describe("routingReasonOf", () => {
  const ev = (kind: string, body: string) => ({ kind, body }) as any;

  // Both sentences below are produced by RoutingDecision::reason() on the
  // server; they are the contract this matcher is written against.
  it("finds the ownership sentence past the opening line beside it", () => {
    expect(
      routingReasonOf([
        ev("sys", "opened for alert al_ckt: checkout_error_ratio"),
        ev("sys", "routed to tm_pay by ownership rule k8s-namespace=payments"),
      ]),
    ).toBe("routed to tm_pay by ownership rule k8s-namespace=payments");
  });

  it("finds the explicit-team sentence", () => {
    expect(
      routingReasonOf([ev("sys", "routed to tm_pay by the alert's own setting")]),
    ).toBe("routed to tm_pay by the alert's own setting");
  });

  it("finds the unrouted sentence", () => {
    const body = "no ownership rule matches this signal, so no team was paged";
    expect(routingReasonOf([ev("sys", body)])).toBe(body);
  });

  it("ignores a note that merely quotes the wording", () => {
    expect(routingReasonOf([ev("note", "routed to the wrong team again")])).toBeNull();
  });

  // Wording drift must drop the row, never render the wrong event as the
  // routing decision.
  it("returns null when nothing matches", () => {
    expect(routingReasonOf([ev("sys", "opened for alert al_ckt: x")])).toBeNull();
  });
});

describe("resolveLadder", () => {
  const slots = [
    { rotation: "Weekdays", user_email: "ana@o2.ai", next_user_email: "bob@o2.ai" },
  ] as any[];
  const rung = (targets: any[], after = 0) =>
    ({ priority: 1, channels: [], steps: [{ after_micros: after, targets }] }) as any;

  it("names who is on call now", () => {
    expect(resolveLadder(rung([{ kind: "on_call_now" }]), slots)[0].people).toEqual([
      "ana@o2.ai",
    ]);
  });

  it("names who the rotation hands over to", () => {
    expect(resolveLadder(rung([{ kind: "next_on_call" }]), slots)[0].people).toEqual([
      "bob@o2.ai",
    ]);
  });

  /// The failure worth catching before a save: a `next_on_call` rung on a
  /// one-person rotation wakes nobody, and the editor showed it as configured.
  it("resolves to nobody when the rotation has no next person", () => {
    const solo = [{ rotation: "Solo", user_email: "ana@o2.ai", next_user_email: null }] as any[];
    expect(resolveLadder(rung([{ kind: "next_on_call" }]), solo)[0].people).toEqual([]);
  });

  it("keeps the whole team as a group rather than a list", () => {
    const step = resolveLadder(rung([{ kind: "whole_team" }]), slots)[0];
    expect(step.wholeTeam).toBe(true);
    expect(step.people).toEqual([]);
  });

  // Paging one person twice for one rung is noise, and the engine dedupes too.
  it("names somebody once even when two targets both reach them", () => {
    const step = resolveLadder(
      rung([{ kind: "on_call_now" }, { kind: "user", email: "ana@o2.ai" }]),
      slots,
    )[0];
    expect(step.people).toEqual(["ana@o2.ai"]);
  });

  // Runs during render, so a malformed rung must not take the editor down.
  it("survives a step with no targets at all", () => {
    const r = { priority: 1, channels: [], steps: [{ after_micros: 0 }] } as any;
    expect(resolveLadder(r, slots)[0]).toMatchObject({ people: [], wholeTeam: false });
  });

  // The ladder is read top to bottom, so it must be ordered by delay whatever
  // order the rungs were built in.
  it("orders the rungs by delay", () => {
    const r = {
      priority: 1,
      channels: [],
      steps: [
        { after_micros: 600, targets: [{ kind: "whole_team" }] },
        { after_micros: 0, targets: [{ kind: "on_call_now" }] },
      ],
    } as any;
    expect(resolveLadder(r, slots).map((s) => s.afterMicros)).toEqual([0, 600]);
  });
});

