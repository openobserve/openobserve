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

import type { EscalationLevel, Rotation, ShiftRule, TimeWindow } from "@/ts/interfaces/oncall";
import {
  MICROS_PER_DAY,
  MICROS_PER_HOUR,
  MICROS_PER_WEEK,
} from "@/ts/interfaces/oncall";
import {
  CHANNEL_WAKES,
  PRIORITY_TONE,
  colorIndexFor,
  compareRulePrecedence,
  ruleClaimsDimensions,
  describeRestrictions,
  describeTarget,
  formatInZone,
  formatMinuteOfDay,
  fromZonedInputValue,
  groupBySubject,
  isEscalating,
  isOnCallUnavailable,
  speakTarget,
  speakTargetsInSentence,
  isRotationValid,
  isShiftRuleValid,
  isSnoozed,
  isStaffed,
  isUnresolved,
  memberAt,
  nextHandover,
  normalizeDimensionValue,
  ownershipPath,
  priorityLabel,
  priorityTagVariant,
  priorityTone,
  parseRoutingReason,
  promoteSeverityFloor,
  promoteSeverityOptions,
  resolveHolder,
  resolveLadder,
  resolveNextHolder,
  resolvePositions,
  ruleAppliesAt,
  routingReasonOf,
  rungProblem,
  shiftBands,
  shortReachReason,
  toZonedInputValue,
  stateTagVariant,
  upcomingShifts,
  windowContains,
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
  const rotation = (members: string[]): Rotation => ({
    id: "rot_primary",
    name: "Primary",
    shift_rules: [
      { name: "Base", members, shift_micros: 604_800_000_000, anchor_micros: 0 },
    ],
  });

  /// The only coverage question left. There used to be six slots to leave
  /// empty, so a correctly configured team warned about four of them forever.
  it("asks only whether a page would reach anybody", () => {
    expect(isStaffed([rotation(["ana@o2.ai"])], 0, "UTC")).toBe(true);
    expect(isStaffed([rotation([])], 0, "UTC")).toBe(false);
    expect(isStaffed([], 0, "UTC")).toBe(false);
  });

  /// A rotation with no shift rules is the one state that looks configured on a
  /// calendar and pages nobody.
  it("reports a rotation with no shift rules as unstaffed", () => {
    expect(isStaffed([{ id: "rot_a", name: "Primary", shift_rules: [] }], 0, "UTC")).toBe(false);
  });

  /// Two rotations are two positions. One with a gap does not make the team
  /// unreachable — the other still pages.
  it("is true when any one rotation is staffed", () => {
    expect(
      isStaffed([rotation([]), rotation(["ana@o2.ai"])], 0, "UTC"),
    ).toBe(true);
  });
});

describe("describeTarget", () => {
  const t = ((k: string, params?: Record<string, unknown>) =>
    params?.rotation ? `${k}:${params.rotation}` : k) as any;

  /// A person target reads as the person; a rotation target NAMES the rotation,
  /// which is the point of the rework — "the secondary" was a role word that two
  /// screens resolved differently and both were right.
  it("names the person for a user target and the rotation for a rotation target", () => {
    expect(describeTarget({ kind: "user", email: "ana@o2.ai" }, t)).toBe("ana@o2.ai");
    expect(describeTarget({ kind: "whole_team" }, t)).toBe("oncall.target_whole_team");
    expect(describeTarget({ kind: "rotation", rotation_id: "rot_a" }, t, "Primary")).toBe(
      "oncall.target_rotation_on_call:Primary",
    );
    expect(
      describeTarget({ kind: "rotation", rotation_id: "rot_a", mode: "all" }, t, "Primary"),
    ).toBe("oncall.target_rotation_all:Primary");
  });

  /// A level pointing at a deleted rotation pages nobody and the ladder skips
  /// it. Saying so beats printing an id nobody can look up.
  it("says a rotation is gone rather than printing its id", () => {
    expect(describeTarget({ kind: "rotation", rotation_id: "rot_gone" }, t, null)).toBe(
      "oncall.target_rotation_deleted",
    );
  });
});

/// The read-only ladder printed the engine's rendering and the editor printed
/// i18n for the same enum, one click apart, so a rung read as two concepts.
describe("speakTarget", () => {
  const t = ((k: string, params?: Record<string, unknown>) =>
    params?.rotation ? `${k}:${params.rotation}` : k) as any;

  it("says the engine's current wording in the product's keys", () => {
    expect(speakTarget("whoever is on call in Primary", t)).toBe(
      "oncall.target_rotation_on_call:Primary",
    );
    expect(speakTarget("everyone on Database", t)).toBe("oncall.target_rotation_all:Database");
    expect(speakTarget("the whole team", t)).toBe("oncall.target_whole_team");
    expect(speakTarget("a rotation that no longer exists", t)).toBe(
      "oncall.target_rotation_deleted",
    );
  });

  /// An engine older than this bundle still sends the slot-era phrasing, and a
  /// mixed-version deployment would otherwise put both vocabularies on one tab.
  /// None of them can be said any more precisely, because the derivation they
  /// named no longer exists to point at.
  it("maps the retired slot wording onto one honest key", () => {
    expect(speakTarget("the on-call", t)).toBe("oncall.target_rotation_legacy");
    expect(speakTarget("the secondary", t)).toBe("oncall.target_rotation_legacy");
    expect(speakTarget("the next on-call", t)).toBe("oncall.target_rotation_legacy");
    expect(speakTarget("everyone on the rotation", t)).toBe("oncall.target_rotation_legacy");
  });

  /// A rotation name is free text and may contain anything, including the words
  /// the fixed table matches on.
  it("carries a multi-word rotation name through", () => {
    expect(speakTarget("whoever is on call in Platform 24/7", t)).toBe(
      "oncall.target_rotation_on_call:Platform 24/7",
    );
  });

  /// An email is a target too, and a phrasing added later must survive rather
  /// than be guessed at.
  it("passes anything it does not recognise straight through", () => {
    expect(speakTarget("ana@o2.ai", t)).toBe("ana@o2.ai");
    expect(speakTarget("the duty architect", t)).toBe("the duty architect");
    expect(speakTarget("whoever answers", t)).toBe("whoever answers");
  });

  /// `config-risks` quotes the term in backticks, so it renders as an
  /// identifier the reader is expected to already know.
  it("unquotes the term inside a sentence the engine wrote", () => {
    expect(
      speakTargetsInSentence("rotation `Primary` has one member, so `the whole team` resolves", t),
    ).toBe("rotation `Primary` has one member, so oncall.target_whole_team resolves");
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

/**
 * One layer of a rotation. This used to build a whole `Rotation`, which is
 * precisely the confusion the rework removed: layering happens *inside* a
 * position, and two positions never compete.
 */
function layer(
  name: string,
  members: string[],
  priority: number,
  restrictions: TimeWindow[],
): ShiftRule {
  return {
    name,
    members,
    shift_micros: MICROS_PER_WEEK,
    anchor_micros: ANCHOR,
    priority,
    restrictions,
  };
}

/** One named position holding the given rules. Follow-the-sun is ONE of these. */
function rota(name: string, rules: ShiftRule[]): Rotation {
  return { id: `rot_${name.toLowerCase()}`, name, shift_rules: rules };
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

describe("ruleAppliesAt", () => {
  it("applies always when there are no restrictions", () => {
    const r = layer("Base", ["ana@o2.ai"], 0, []);
    expect(ruleAppliesAt(r, local(IST, 2026, 8, 15, 3, 0), IST)).toBe(true);
  });

  // A rule carrying neither field must read as unrestricted rather than as
  // never applying.
  it("treats absent priority/restrictions as the unrestricted catch-all", () => {
    const bare: ShiftRule = {
      name: "Base",
      members: ["ana@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      anchor_micros: ANCHOR,
    };
    expect(ruleAppliesAt(bare, ANCHOR, IST)).toBe(true);
    expect(resolveHolder(rota("Primary", [bare]), ANCHOR, IST).member).toBe("ana@o2.ai");
  });

  // A retired rule is out of force without being deleted, which is how the
  // record of who covered those hours survives.
  it("respects a validity window", () => {
    const retired: ShiftRule = { ...layer("Base", ["ana@o2.ai"], 0, []), ends_at: ANCHOR };
    expect(ruleAppliesAt(retired, ANCHOR - 1, IST)).toBe(true);
    expect(ruleAppliesAt(retired, ANCHOR, IST)).toBe(false);
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
    expect(ruleAppliesAt(r, at, IST)).toBe(expected);
  });
});

describe("isShiftRuleValid", () => {
  const base = () => layer("Base", ["ana@o2.ai", "bob@o2.ai"], 0, []);

  it.each([
    ["a usable rule", base(), true],
    ["no members", { ...base(), members: [] }, false],
    ["a zero shift", { ...base(), shift_micros: 0 }, false],
    ["a negative shift", { ...base(), shift_micros: -1 }, false],
    ["a blank name", { ...base(), name: "  " }, false],
    ["a case-insensitive duplicate member", { ...base(), members: ["ana@o2.ai", "ANA@o2.ai"] }, false],
    ["a validity window that ends before it starts", { ...base(), starts_at: 2, ends_at: 1 }, false],
  ])("%s → %s", (_name, rule, expected) => {
    expect(isShiftRuleValid(rule as ShiftRule)).toBe(expected);
  });
});

describe("isRotationValid", () => {
  it("needs an id, a name and at least one rule", () => {
    const rule = layer("Base", ["ana@o2.ai"], 0, []);
    expect(isRotationValid(rota("Primary", [rule]))).toBe(true);
    expect(isRotationValid({ id: "", name: "Primary", shift_rules: [rule] })).toBe(false);
    expect(isRotationValid({ id: "rot_a", name: " ", shift_rules: [rule] })).toBe(false);
  });

  // The one state that looks configured on a calendar and pages nobody.
  it("rejects a rotation with no shift rules", () => {
    expect(isRotationValid({ id: "rot_a", name: "Primary", shift_rules: [] })).toBe(false);
  });
});

describe("resolveHolder", () => {
  // Follow-the-sun: several rules in ONE rotation. A restricted rule covers its
  // hours, the unrestricted catch-all covers everything nobody claimed. Two
  // rotations would be two people on call at once, which is a different thing.
  it.each([
    ["office hours", local(IST, 2026, 8, 10, 11, 0), "india@o2.ai"],
    ["the middle of the night", local(IST, 2026, 8, 10, 23, 0), "catchall@o2.ai"],
  ])("a restricted rule wins inside its window and yields outside: %s", (_n, at, expected) => {
    const rotation = rota("Primary", [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("India", ["india@o2.ai"], 10, [window([0, 1, 2, 3, 4], 9 * 60, 17 * 60)]),
    ]);
    expect(resolveHolder(rotation, at, IST).member).toBe(expected);
  });

  it.each([
    [8, "apac@o2.ai"],
    [16, "emea@o2.ai"],
    [23, "amer@o2.ai"],
    [3, "amer@o2.ai"],
  ])("three restricted rules over one catch-all resolve at %ih to %s", (hour, expected) => {
    const rotation = rota("Platform", [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("APAC", ["apac@o2.ai"], 10, [window([], 6 * 60, 14 * 60)]),
      layer("EMEA", ["emea@o2.ai"], 10, [window([], 14 * 60, 22 * 60)]),
      layer("AMER", ["amer@o2.ai"], 10, [window([], 22 * 60, 6 * 60)]),
    ]);
    expect(resolveHolder(rotation, local(IST, 2026, 8, 10, hour, 0), IST).member).toBe(expected);
  });

  // Priority is explicit, not positional. Reordering the list — which the old
  // "last one wins" calendar was entirely at the mercy of — must not change who
  // is paged.
  it("lets priority decide, not list order", () => {
    const low = layer("Low", ["low@o2.ai"], 1, [window([], 0, 1440)]);
    const high = layer("High", ["high@o2.ai"], 5, [window([], 0, 1440)]);
    const at = local(IST, 2026, 8, 10, 12, 0);

    expect(resolveHolder(rota("P", [low, high]), at, IST).member).toBe("high@o2.ai");
    expect(resolveHolder(rota("P", [high, low]), at, IST).member).toBe("high@o2.ai");
  });

  // At equal priority the MORE SPECIFIC rule wins, so a catch-all never shadows
  // a layer somebody deliberately restricted.
  it("breaks an equal-priority tie toward the restricted rule", () => {
    const rules = [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("Office", ["office@o2.ai"], 0, [window([], 9 * 60, 17 * 60)]),
    ];
    const at = local(IST, 2026, 8, 10, 12, 0);
    expect(resolveHolder(rota("P", rules), at, IST).member).toBe("office@o2.ai");
    expect(resolveHolder(rota("P", [...rules].reverse()), at, IST).member).toBe("office@o2.ai");
  });

  /// **The defect that started the rework.** A rotation restricted to weekdays
  /// has NOBODY at the weekend. It used to silently revert to a derived holder
  /// — a different person from the one the ladder named, and both were right.
  it("leaves a gap at the weekend rather than conjuring a stand-in", () => {
    const rotation = rota("Secondary", [
      layer("Weekdays", ["office@o2.ai"], 0, [window([0, 1, 2, 3, 4], 9 * 60, 17 * 60)]),
    ]);
    const saturday = local(IST, 2026, 8, 15, 12, 0);
    expect(resolveHolder(rotation, saturday, IST)).toEqual({ member: null, rule: null });
  });

  // An unusable rule must staff nobody rather than defaulting to members[0],
  // which would page a person the schedule never selected.
  it.each([
    ["no members", layer("Base", [], 0, [])],
    ["a zero shift", { ...layer("Base", ["ana@o2.ai"], 0, []), shift_micros: 0 }],
    ["a blank name", { ...layer("Base", ["ana@o2.ai"], 0, []), name: "" }],
  ])("a broken rule (%s) staffs nobody", (_name, rule) => {
    expect(resolveHolder(rota("P", [rule as ShiftRule]), ANCHOR, IST).member).toBeNull();
  });

  it("names the rule that decided, so the UI can say why", () => {
    const rotation = rota("Primary", [
      layer("Base", ["catchall@o2.ai"], 0, []),
      layer("Office", ["office@o2.ai"], 0, [window([], 9 * 60, 17 * 60)]),
    ]);
    const resolved = resolveHolder(rotation, local(IST, 2026, 8, 10, 12, 0), IST);
    expect(resolved.rule?.name).toBe("Office");
  });

  it("walks the winning rule's own handover order", () => {
    const rotation = rota("Primary", [layer("Base", ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], 0, [])]);
    expect(resolveHolder(rotation, ANCHOR, IST).member).toBe("ana@o2.ai");
    expect(resolveHolder(rotation, ANCHOR + MICROS_PER_WEEK, IST).member).toBe("bob@o2.ai");
  });
});

describe("resolvePositions", () => {
  const roster = ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"];

  /// The default that replaced the derived-secondary hack: two ordinary
  /// rotations, same roster, the second anchored one shift behind. They cannot
  /// resolve to the same person, and that is *data* rather than a hidden rule.
  it("gives one entry per rotation, and the pair never collides", () => {
    const primary = rota("Primary", [layer("Base", roster, 0, [])]);
    const secondary: Rotation = {
      id: "rot_secondary",
      name: "Secondary",
      shift_rules: [{ ...layer("Base", roster, 0, []), anchor_micros: ANCHOR - MICROS_PER_WEEK }],
    };

    const positions = resolvePositions([primary, secondary], ANCHOR, IST);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({ rotation_name: "Primary", user_email: "ana@o2.ai" });
    expect(positions[1]).toMatchObject({ rotation_name: "Secondary", user_email: "bob@o2.ai" });
  });

  /// A rotation that resolves to nobody is ABSENT, not present with a null
  /// holder — which is what makes a coverage gap visible instead of rendering
  /// as an empty row that reads like an unnamed person.
  it("omits a rotation that resolves to nobody", () => {
    const staffed = rota("Primary", [layer("Base", ["ana@o2.ai"], 0, [])]);
    const empty = rota("Secondary", [
      layer("Weekdays", ["office@o2.ai"], 0, [window([0, 1, 2, 3, 4], 9 * 60, 17 * 60)]),
    ]);
    const saturday = local(IST, 2026, 8, 15, 12, 0);

    const positions = resolvePositions([staffed, empty], saturday, IST);
    expect(positions.map((p) => p.rotation_name)).toEqual(["Primary"]);
  });

  it("answers nothing for a team with no rotations", () => {
    expect(resolvePositions([], ANCHOR, IST)).toEqual([]);
  });
});

describe("resolveNextHolder", () => {
  it("is the winning rule's next member", () => {
    const rotation = rota("Primary", [layer("Base", ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], 0, [])]);
    expect(resolveNextHolder(rotation, ANCHOR, IST)).toBe("bob@o2.ai");
    expect(resolveNextHolder(rotation, ANCHOR + MICROS_PER_WEEK, IST)).toBe("cara@o2.ai");
  });

  it("wraps, so the last member hands back to the first", () => {
    const rotation = rota("Primary", [layer("Base", ["ana@o2.ai", "bob@o2.ai"], 0, [])]);
    expect(resolveNextHolder(rotation, ANCHOR + MICROS_PER_WEEK, IST)).toBe("ana@o2.ai");
  });

  // Returning the same person would page them twice and call the second one an
  // escalation.
  it("is null for a one-person rotation", () => {
    expect(resolveNextHolder(rota("P", [layer("Base", ["ana@o2.ai"], 0, [])]), ANCHOR, IST)).toBeNull();
  });

  it("is null when nobody is on call", () => {
    expect(resolveNextHolder(rota("P", []), ANCHOR, IST)).toBeNull();
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

  /// The decision is prefixed with everything routing passed over, so the
  /// sentence does not start with "routed to" on exactly the records whose
  /// routing was worth explaining.
  it("finds the decision behind the notes routing wrote ahead of it", () => {
    const body =
      "the alert names team `paymnets`, which names no team in this org; " +
      "routed to tm_pay by ownership rule service=search";
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

describe("parseRoutingReason", () => {
  // Every sentence below is `RoutingDecision::reason()` verbatim; they are the
  // contract this parser is written against.
  it("reads the winning rule back into the dimensions it was built from", () => {
    const parsed = parseRoutingReason(
      "routed to tm_9 by ownership rule k8s-cluster=introspection/service=search",
    );
    expect(parsed?.mechanism).toBe("ownership");
    expect(parsed?.teamId).toBe("tm_9");
    expect(parsed?.dimensions).toEqual({ "k8s-cluster": "introspection", service: "search" });
  });

  it("keeps a value that contains its own equals sign whole", () => {
    expect(
      parseRoutingReason("routed to tm_9 by ownership rule label=env=prod")?.dimensions,
    ).toEqual({ label: "env=prod" });
  });

  it("separates the notes routing passed over from the decision it made", () => {
    const parsed = parseRoutingReason(
      "the alert names team `paymnets`, which names no team in this org; " +
        "routed to tm_9 by ownership rule service=search",
    );
    expect(parsed?.notes).toEqual([
      "the alert names team `paymnets`, which names no team in this org",
    ]);
    expect(parsed?.mechanism).toBe("ownership");
  });

  it.each([
    ["routed to tm_9 by the alert's own setting", "explicit"],
    ["no ownership rule matched, so it went to the default team tm_9", "default"],
    [
      "no ownership rule matches this signal and no default team is set, so no team was paged",
      "unrouted",
    ],
  ] as const)("names the mechanism behind %s", (sentence, mechanism) => {
    expect(parseRoutingReason(sentence)?.mechanism).toBe(mechanism);
  });

  it("carries the team the context attribute asked for", () => {
    const parsed = parseRoutingReason(
      "routed to tm_9 by the alert's context attribute team=`Payments`",
    );
    expect(parsed?.mechanism).toBe("context");
    expect(parsed?.namedTeam).toBe("Payments");
  });

  /// Drift must return null so the caller prints the server's sentence rather
  /// than a half-read one.
  it("returns null when the wording is not one it knows", () => {
    expect(parseRoutingReason("matched ownership rule namespace = envoy")).toBeNull();
    expect(parseRoutingReason(null)).toBeNull();
  });
});

describe("resolveLadder", () => {
  const positions = [
    {
      rotation_id: "rot_primary",
      rotation_name: "Primary",
      rule: "Weekdays",
      user_email: "ana@o2.ai",
      next_user_email: "bob@o2.ai",
    },
  ] as any[];
  const rotations = [
    { id: "rot_primary", name: "Primary", shift_rules: [] },
    { id: "rot_secondary", name: "Secondary", shift_rules: [] },
  ] as any[];
  const rung = (targets: any[], after = 0) =>
    ({ priority: 1, channels: [], steps: [{ after_micros: after, targets }] }) as any;

  it("names who is on call in the rotation the level points at", () => {
    expect(
      resolveLadder(rung([{ kind: "rotation", rotation_id: "rot_primary" }]), positions)[0].people,
    ).toEqual(["ana@o2.ai"]);
  });

  /// A rotation that resolves to nobody is ABSENT from `on-call`, so a level
  /// naming it reaches nobody — the failure worth catching before a save.
  it("resolves to nobody when that rotation has a coverage gap", () => {
    expect(
      resolveLadder(rung([{ kind: "rotation", rotation_id: "rot_secondary" }]), positions)[0]
        .people,
    ).toEqual([]);
  });

  /// Two rotations named on one step fire together — the only way a level pages
  /// more than one person now.
  it("pages both when a step names two rotations", () => {
    const two = [
      ...positions,
      {
        rotation_id: "rot_secondary",
        rotation_name: "Secondary",
        rule: "Weekdays",
        user_email: "cy@o2.ai",
        next_user_email: "dee@o2.ai",
      },
    ] as any[];
    expect(
      resolveLadder(
        rung([
          { kind: "rotation", rotation_id: "rot_primary" },
          { kind: "rotation", rotation_id: "rot_secondary" },
        ]),
        two,
      )[0].people,
    ).toEqual(["ana@o2.ai", "cy@o2.ai"]);
  });

  /// `mode: "all"` is a group: a rotation's full roster spans every shift rule,
  /// and only one of them is on shift. Naming one person would read as "pages
  /// one person".
  it("keeps mode all as a group named after the rotation", () => {
    const step = resolveLadder(
      rung([{ kind: "rotation", rotation_id: "rot_primary", mode: "all" }]),
      positions,
      rotations,
    )[0];
    expect(step.pools).toEqual(["Primary"]);
    expect(step.people).toEqual([]);
  });

  /// **`next_user_email` is display-only.** It used to double as the secondary,
  /// which is exactly how one team got two different people both correctly
  /// labelled "the secondary". Nothing in a ladder may reach it.
  it("never pages the up-next person", () => {
    const step = resolveLadder(
      rung([{ kind: "rotation", rotation_id: "rot_primary" }]),
      positions,
    )[0];
    expect(step.people).not.toContain("bob@o2.ai");
  });

  /// A level pointing at a deleted rotation advanced in silence. It is reported
  /// rather than resolving to an empty rung that merely looks uncovered.
  it("reports a level naming a rotation the team does not have", () => {
    const step = resolveLadder(
      rung([{ kind: "rotation", rotation_id: "rot_gone" }]),
      positions,
      rotations,
    )[0];
    expect(step.missingRotations).toEqual(["rot_gone"]);
    expect(step.people).toEqual([]);
  });

  it("keeps the whole team as a group rather than a list", () => {
    const step = resolveLadder(rung([{ kind: "whole_team" }]), positions)[0];
    expect(step.wholeTeam).toBe(true);
    expect(step.people).toEqual([]);
  });

  // Paging one person twice for one rung is noise, and the engine dedupes too.
  it("names somebody once even when two targets both reach them", () => {
    const step = resolveLadder(
      rung([
        { kind: "rotation", rotation_id: "rot_primary" },
        { kind: "user", email: "ana@o2.ai" },
      ]),
      positions,
    )[0];
    expect(step.people).toEqual(["ana@o2.ai"]);
  });

  // Runs during render, so a malformed rung must not take the editor down.
  it("survives a step with no targets at all", () => {
    const r = { priority: 1, channels: [], steps: [{ after_micros: 0 }] } as any;
    expect(resolveLadder(r, positions)[0]).toMatchObject({ people: [], wholeTeam: false });
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
    expect(resolveLadder(r, positions).map((s) => s.afterMicros)).toEqual([0, 600]);
  });
});

describe("ruleClaimsDimensions", () => {
  /// Replaying a draft rule before it is saved. A rule pins a SUBSET: the
  /// signal is free to carry more, which is exactly why a one-condition rule
  /// is the broad one.
  it("claims a signal carrying more than the rule pins", () => {
    expect(
      ruleClaimsDimensions(
        { "k8s-namespace": "risk" },
        { "k8s-namespace": "risk", service: "fraud-scorer" },
      ),
    ).toBe(true);
  });

  it("does not claim a signal missing a pinned dimension", () => {
    expect(ruleClaimsDimensions({ service: "api", host: "db-01" }, { service: "api" })).toBe(false);
  });

  it("matches a wildcard value by its literal prefix", () => {
    expect(ruleClaimsDimensions({ host: "db-*" }, { host: "db-prod-01" })).toBe(true);
    expect(ruleClaimsDimensions({ host: "db-*" }, { host: "web-01" })).toBe(false);
  });

  /// A rule with no conditions would claim everything, which is what the
  /// catch-all row is for — never a rule.
  it("claims nothing when the rule pins nothing", () => {
    expect(ruleClaimsDimensions({}, { service: "api" })).toBe(false);
  });
});

describe("compareRulePrecedence", () => {
  const rule = (dimensions: Record<string, string>) => ({ dimensions });
  const order = (...rules: { dimensions: Record<string, string> }[]) =>
    [...rules].sort(compareRulePrecedence).map((r) => ownershipPath(r.dimensions));

  /// The bug this exists to prevent: `k8s-namespace=payments` is the longer
  /// STRING, so sorting on rendered text ranks it first — but the server
  /// resolves the service rule as the winner, on literal characters.
  it("ranks by pinned literal characters, not by rendered path length", () => {
    expect(
      order(rule({ "k8s-namespace": "payments" }), rule({ service: "payments-api" })),
    ).toEqual(["service=payments-api", "k8s-namespace=payments"]);
  });

  it("puts the deeper rule first, however short its values", () => {
    expect(
      order(
        rule({ service: "payments-api-gateway" }),
        rule({ service: "a", "k8s-namespace": "b" }),
      )[0],
    ).toBe("k8s-namespace=b/service=a");
  });

  // `host=db-01` is a statement about one host, `host=db-*` about a family,
  // and the narrower claim is the one whose author meant it.
  it("puts an exact match ahead of a wildcard at the same depth", () => {
    expect(order(rule({ host: "db-*" }), rule({ host: "db-01" }))).toEqual([
      "host=db-01",
      "host=db-*",
    ]);
  });

  it("prefers the longer prefix between two wildcards", () => {
    expect(order(rule({ host: "db-*" }), rule({ host: "db-prod-*" }))).toEqual([
      "host=db-prod-*",
      "host=db-*",
    ]);
  });

  /// Equally specific rules must not reorder between renders.
  it("breaks a dead tie on the path, so the order is stable", () => {
    expect(order(rule({ service: "beta" }), rule({ service: "alpha" }))).toEqual([
      "service=alpha",
      "service=beta",
    ]);
  });
});

/// D5. The promote handler states "a promotion may raise the severity but must
/// never lower what already woke somebody" and then takes whatever severity it
/// is sent — so the picker is the only place the invariant can hold.
describe("promoteSeverityFloor / promoteSeverityOptions", () => {
  it("derives the same severity the server would from the priority", () => {
    expect(promoteSeverityFloor(1)).toBe("P1");
    expect(promoteSeverityFloor(2)).toBe("P2");
    expect(promoteSeverityFloor(3)).toBe("P3");
    expect(promoteSeverityFloor(4)).toBe("P4");
  });

  /// The incident scale has no P5, which is why the server folds 4 and 5 into
  /// the same severity rather than rejecting a P5 record.
  it("folds a P5 page into P4, the lowest severity an incident has", () => {
    expect(promoteSeverityFloor(5)).toBe("P4");
  });

  it("offers nothing below the record's own severity", () => {
    expect(promoteSeverityOptions(2)).toEqual(["P1", "P2"]);
    expect(promoteSeverityOptions(1)).toEqual(["P1"]);
    expect(promoteSeverityOptions(5)).toEqual(["P1", "P2", "P3", "P4"]);
  });
});

/// §G.8.1: the entry fetch is the capability probe, and only two shapes mean
/// "not available here". Everything else must stay an error, or a permission
/// denial and a dead server would silently render as a calm "not available".
describe("isOnCallUnavailable", () => {
  const http = (status: number, message?: string) => ({
    response: { status, data: message ? { message } : {} },
  });

  it("reads a bare 404 as the feature flag being off", () => {
    expect(isOnCallUnavailable(http(404))).toBe(true);
  });

  it("reads 403 'Not Supported' as an OSS build", () => {
    expect(isOnCallUnavailable(http(403, "Not Supported"))).toBe(true);
  });

  /// G.8.2's permission failure uses the same status with a different message.
  /// Conflating them would tell a viewer without the grant that the product
  /// does not exist.
  it("keeps 403 'Forbidden' a permission denial, not an absence", () => {
    expect(isOnCallUnavailable(http(403, "Forbidden"))).toBe(false);
    expect(isOnCallUnavailable(http(403))).toBe(false);
  });

  it("keeps server failures and network errors as errors", () => {
    expect(isOnCallUnavailable(http(500, "boom"))).toBe(false);
    expect(isOnCallUnavailable(new Error("network down"))).toBe(false);
    expect(isOnCallUnavailable(undefined)).toBe(false);
  });
});

/// A finished sentence is a paragraph on a rail. The badge is four words and
/// the sentence stays on hover — but only where the cause is one we know.
describe("shortReachReason", () => {
  const t = ((k: string) => k) as any;

  it("shortens each reason the engine writes", () => {
    expect(
      shortReachReason(
        "this deployment has no SMTP transport configured, so no email page can be sent",
        t,
      ),
    ).toBe("oncall.reachShortNoSmtp");
    expect(shortReachReason("`ana@o2.ai` is not a user of this organization", t)).toBe(
      "oncall.reachShortNoAddress",
    );
    expect(shortReachReason("`root@example` is a login, not a mailbox", t)).toBe(
      "oncall.reachShortNotMailbox",
    );
    expect(
      shortReachReason("`a@example.com` uses a domain reserved for documentation", t),
    ).toBe("oncall.reachShortUnroutable");
  });

  /// Guessing a short word for a cause we have never seen is how a UI tells
  /// somebody to fix the wrong thing.
  it("gives up on a reason it does not recognise", () => {
    expect(shortReachReason("the moon is in the way", t)).toBeNull();
    expect(shortReachReason(null, t)).toBeNull();
  });
});

/// One rung, one finding — shared by the pulse strip and the escalation rail,
/// which used to say the same thing two different ways.
describe("rungProblem", () => {
  const t = ((k: string, params?: Record<string, unknown>) =>
    params ? `${k}:${JSON.stringify(params)}` : k) as any;
  const person = (over: Record<string, unknown> = {}) => ({
    user_email: "ana@o2.ai",
    reason: "on call now",
    would_a_page_land: true,
    deliverable_channels: [],
    ...over,
  });
  const rung = (recipients: unknown[], nobody = false) =>
    ({
      after_micros: 0,
      targets: ["the on-call"],
      recipients,
      resolves_to_nobody: nobody,
    }) as any;

  it("says nothing about a rung that would reach everybody on it", () => {
    expect(rungProblem(rung([person()]), t)).toBeNull();
  });

  /// A rung that fires and reaches nobody is worse than a slow one.
  it("calls out a rung that resolves to nobody", () => {
    expect(rungProblem(rung([], true), t)?.label).toBe("oncall.ladderReachesNobody");
  });

  /// The reason for one of six says nothing about the other five.
  it("counts the unreachable on a crowd rung instead of quoting one reason", () => {
    const problem = rungProblem(
      rung([person(), person({ user_email: "b@o2.ai", would_a_page_land: false })]),
      t,
    );

    expect(problem?.label).toContain("oncall.ladderUnreachableCount");
    expect(problem?.tip).toBeNull();
  });

  it("badges a lone unreachable person and keeps the sentence behind it", () => {
    const problem = rungProblem(
      rung([
        person({
          would_a_page_land: false,
          why_not: "this deployment has no SMTP transport configured",
        }),
      ]),
      t,
    );

    expect(problem?.label).toBe("oncall.reachShortNoSmtp");
    expect(problem?.tip).toBe("this deployment has no SMTP transport configured");
  });
});

/// **A `datetime-local` in somebody else's timezone.**
///
/// The input has no zone of its own: it reads and writes bare wall time, and
/// the browser's zone is the only one the platform applies. Every on-call
/// instant belongs to the TEAM's zone instead — that is what "handover at
/// 10:00" means, and the fields say so on their labels. Reading with
/// `getHours()` and writing with `Date.parse()` answered in the reader's zone
/// while the label promised the team's, so an operator in Berlin editing an
/// Asia/Kolkata team saw the handover three and a half hours from where it was
/// and moved it there by saving.
describe("toZonedInputValue / fromZonedInputValue", () => {
  /// The instant Asia/Kolkata calls 2026-08-17 10:00 — UTC+05:30.
  const KOLKATA_10AM = Date.UTC(2026, 7, 17, 4, 30) * 1000;

  it("renders an instant as the team's wall clock, not the reader's", () => {
    expect(toZonedInputValue(KOLKATA_10AM, "Asia/Kolkata")).toBe("2026-08-17T10:00");
    expect(toZonedInputValue(KOLKATA_10AM, "UTC")).toBe("2026-08-17T04:30");
    expect(toZonedInputValue(KOLKATA_10AM, "America/New_York")).toBe("2026-08-17T00:30");
  });

  it("reads a wall time as the instant that team means by it", () => {
    expect(fromZonedInputValue("2026-08-17T10:00", "Asia/Kolkata")).toBe(KOLKATA_10AM);
    expect(fromZonedInputValue("2026-08-17T04:30", "UTC")).toBe(KOLKATA_10AM);
  });

  it("round-trips through both directions", () => {
    for (const zone of ["UTC", "Asia/Kolkata", "America/New_York", "Australia/Eucla"]) {
      const back = fromZonedInputValue(toZonedInputValue(KOLKATA_10AM, zone), zone);
      expect(back, zone).toBe(KOLKATA_10AM);
    }
  });

  /// A handover is wall-clock anchored, so 09:00 stays 09:00 across a DST
  /// change — which means the two sides of a transition are different offsets
  /// and the naive single-pass conversion is an hour out on one of them.
  it("uses the offset in force on each side of a DST change", () => {
    // US spring forward 2026: 2026-03-08.
    expect(fromZonedInputValue("2026-03-07T09:00", "America/New_York")).toBe(
      Date.UTC(2026, 2, 7, 14, 0) * 1000,
    );
    expect(fromZonedInputValue("2026-03-09T09:00", "America/New_York")).toBe(
      Date.UTC(2026, 2, 9, 13, 0) * 1000,
    );
  });

  /// The hour a spring-forward skips is a wall time that does not exist. It
  /// resolves to the instant the clock jumps to, which is what the platform
  /// does — and never to NaN, which would blank the preview.
  it("resolves a wall time the clock skips rather than failing", () => {
    const skipped = fromZonedInputValue("2026-03-08T02:30", "America/New_York");
    expect(skipped).not.toBeNull();
    expect(Number.isFinite(skipped!)).toBe(true);
  });

  /// Half-typed input is the normal state of a field somebody is editing.
  /// Returning null lets the caller keep the previous instant instead of
  /// writing NaN.
  it("refuses an incomplete value instead of inventing one", () => {
    for (const partial of ["", "2026", "2026-08", "2026-08-17", "not a date"]) {
      expect(fromZonedInputValue(partial, "UTC"), partial).toBeNull();
    }
  });

  it("falls back rather than throwing on a zone the runtime cannot resolve", () => {
    expect(toZonedInputValue(KOLKATA_10AM, "Mars/Olympus")).toBe("2026-08-17T04:30");
    expect(fromZonedInputValue("2026-08-17T04:30", "Mars/Olympus")).toBe(KOLKATA_10AM);
  });

  it("answers empty for an instant that is not one", () => {
    expect(toZonedInputValue(Number.NaN, "UTC")).toBe("");
  });
});
