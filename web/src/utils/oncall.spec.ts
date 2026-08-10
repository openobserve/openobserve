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

import type { EscalationLevel, Rotation } from "@/ts/interfaces/oncall";
import {
  MICROS_PER_DAY,
  MICROS_PER_HOUR,
  MICROS_PER_WEEK,
} from "@/ts/interfaces/oncall";
import {
  formatMicrosDuration,
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
} from "@/utils/oncall";

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

describe("formatMicrosDuration", () => {
  it("drops empty leading units", () => {
    expect(formatMicrosDuration(45 * 1_000_000)).toBe("45s");
    expect(formatMicrosDuration(4 * 60 * 1_000_000)).toBe("4m");
    expect(formatMicrosDuration((4 * 60 + 12) * 1_000_000)).toBe("4m 12s");
    expect(formatMicrosDuration(2 * 3600 * 1_000_000)).toBe("2h");
    expect(formatMicrosDuration((2 * 3600 + 30 * 60) * 1_000_000)).toBe("2h 30m");
    expect(formatMicrosDuration(3 * 86400 * 1_000_000)).toBe("3d");
    expect(formatMicrosDuration((3 * 86400 + 3600) * 1_000_000)).toBe("3d 1h");
  });

  it("renders zero as zero seconds, not an em dash", () => {
    expect(formatMicrosDuration(0)).toBe("0s");
  });

  // Clock skew across nodes can produce a negative span; showing "-3s" would
  // read as a real measurement.
  it("renders an em dash for negative or non-finite spans", () => {
    expect(formatMicrosDuration(-1)).toBe("—");
    expect(formatMicrosDuration(Number.NaN)).toBe("—");
    expect(formatMicrosDuration(Number.POSITIVE_INFINITY)).toBe("—");
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
