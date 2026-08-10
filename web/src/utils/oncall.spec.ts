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
  coverageGaps,
  formatMicrosDuration,
  isOpen,
  levelOrder,
  levelsUsedByPolicy,
  memberAt,
  nextHandover,
  normalizeDimensionValue,
  ownershipPath,
  priorityLabel,
  priorityTagVariant,
  sortByLevel,
  stateTagVariant,
  upcomingShifts,
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

describe("levelOrder", () => {
  it("orders the ladder the way it fires", () => {
    const levels: EscalationLevel[] = [
      "l4",
      "primary",
      "l2",
      "secondary",
      "l0",
      "l3",
      "l1",
    ];
    expect([...levels].sort((a, b) => levelOrder(a) - levelOrder(b))).toEqual([
      "l0",
      "primary",
      "secondary",
      "l1",
      "l2",
      "l3",
      "l4",
    ]);
  });

  it("sorts slots without mutating the input", () => {
    const slots = [
      { level: "l2" as EscalationLevel, user_email: "eve@o2.ai" },
      { level: "primary" as EscalationLevel, user_email: "ana@o2.ai" },
    ];
    const sorted = sortByLevel(slots);
    expect(sorted.map((s) => s.level)).toEqual(["primary", "l2"]);
    expect(slots[0].level).toBe("l2");
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

describe("isOpen", () => {
  // Triage by the agent is not somebody taking the ball, so it still counts
  // as open and the ladder keeps escalating.
  it("counts triggered and triaged as still escalating", () => {
    expect(isOpen("triggered")).toBe(true);
    expect(isOpen("triaged")).toBe(true);
    expect(isOpen("acknowledged")).toBe(false);
    expect(isOpen("resolved")).toBe(false);
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

describe("coverageGaps", () => {
  it("names the levels no rotation staffs", () => {
    const rotations = [weekly(["ana@o2.ai"], "primary")];
    expect(
      coverageGaps(["primary", "secondary", "l1"], rotations, ANCHOR),
    ).toEqual(["secondary", "l1"]);
  });

  it("is empty when every wanted level is staffed", () => {
    const rotations = [
      weekly(["ana@o2.ai"], "primary"),
      weekly(["bob@o2.ai"], "secondary"),
    ];
    expect(coverageGaps(["primary", "secondary"], rotations, ANCHOR)).toEqual([]);
  });

  // A rotation that exists but staffs nobody is still a gap — the level is
  // present in the editor yet nobody would be paged.
  it("counts an empty rotation as a gap", () => {
    expect(coverageGaps(["primary"], [weekly([])], ANCHOR)).toEqual(["primary"]);
  });
});

describe("levelsUsedByPolicy", () => {
  it("dedupes across rungs and returns ladder order", () => {
    const rungs = [
      { steps: [{ level: "l1" as EscalationLevel }, { level: "primary" as EscalationLevel }] },
      { steps: [{ level: "primary" as EscalationLevel }, { level: "secondary" as EscalationLevel }] },
    ];
    expect(levelsUsedByPolicy(rungs)).toEqual(["primary", "secondary", "l1"]);
  });

  it("is empty for a policy that pages nobody", () => {
    expect(levelsUsedByPolicy([{ steps: [] }])).toEqual([]);
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
