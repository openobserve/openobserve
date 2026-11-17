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
import { ALERT_PREFILL_VERSION, type AlertEditHandoff } from "@/ts/interfaces/alertPrefill";
import { isValidPatch, liveValueOf, planEditHandoff } from "./alertEditHandoff";

const alert = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "a1",
  name: "ops_cpu",
  is_real_time: false,
  pending_period_sec: 60,
  keep_firing_for: 0,
  trigger_condition: { silence: 10 },
  destinations: ["ops-pager"],
  ...overrides,
});

const handoff = (overrides: Partial<AlertEditHandoff> = {}): AlertEditHandoff => ({
  version: ALERT_PREFILL_VERSION,
  source: "calibration",
  target: { alertId: "a1", findingId: "f1" },
  focus: "pending_period",
  patch: { pendingPeriodSecs: { from: 60, to: 120 } },
  ...overrides,
});

describe("planEditHandoff", () => {
  it("applies a fresh patch and focuses its first field", () => {
    const plan = planEditHandoff(
      handoff({
        focus: undefined,
        patch: {
          silenceMinutes: { from: 10, to: 45 },
          pendingPeriodSecs: { from: 60, to: 120 },
        },
      }),
      alert(),
      [],
    );
    expect(plan.status).toBe("apply");
    expect(plan.focusField).toBe("silence");
    expect(plan.fields.map((f) => [f.key, f.live, f.to])).toEqual([
      ["silenceMinutes", 10, 45],
      ["pendingPeriodSecs", 60, 120],
    ]);
  });

  it("is invalid for another alert, a bad shape or an unknown field", () => {
    expect(planEditHandoff(handoff(), alert({ id: "a2" }), []).status).toBe("invalid");
    expect(planEditHandoff({ ...handoff(), version: 9 }, alert(), []).status).toBe("invalid");
    expect(planEditHandoff({ ...handoff(), extra: 1 }, alert(), []).status).toBe("invalid");
    expect(
      planEditHandoff(
        handoff({ patch: { pendingPeriodSecs: { from: 60, to: 120 }, query: {} } as never }),
        alert(),
        [],
      ).status,
    ).toBe("invalid");
    expect(planEditHandoff(handoff({ patch: {} }), alert(), []).status).toBe("invalid");
    expect(planEditHandoff(handoff({ focus: "name" as never }), alert(), []).status).toBe(
      "invalid",
    );
    expect(planEditHandoff(null, alert(), []).status).toBe("invalid");
  });

  it("is unsupported on a real-time or composite alert, before any stale check", () => {
    expect(planEditHandoff(handoff(), alert({ is_real_time: true }), []).status).toBe(
      "unsupported",
    );
    expect(
      planEditHandoff(
        handoff({ patch: { keepFiringForSecs: { from: 0, to: 300 } } }),
        alert({ alert_type: "composite", pending_period_sec: 999 }),
        [],
      ).status,
    ).toBe("unsupported");
  });

  it("is stale when any live value moved off the analysed one", () => {
    const plan = planEditHandoff(handoff(), alert({ pending_period_sec: 300 }), []);
    expect(plan.status).toBe("stale");
    expect(plan.fields[0].live).toBe(300);
  });

  it("compares destinations as a set and names the ones that no longer exist", () => {
    const patch = { destinations: { from: ["b", "a"], to: ["ops-pager", "gone"] } };
    expect(
      planEditHandoff(handoff({ patch }), alert({ destinations: ["a", "b"] }), ["ops-pager"]),
    ).toMatchObject({ status: "missing_destination", missingDestinations: ["gone"] });
    expect(
      planEditHandoff(handoff({ patch }), alert({ destinations: ["a", "b"] }), [
        "ops-pager",
        "gone",
      ]).status,
    ).toBe("apply");
  });

  it("is a review when the handoff has no patch, on any alert type", () => {
    expect(
      planEditHandoff(
        handoff({ patch: undefined, focus: "query" }),
        alert({ is_real_time: true }),
        [],
      ),
    ).toMatchObject({ status: "review", focusField: "query", fields: [] });
  });
});

describe("isValidPatch", () => {
  it("holds each value to its type and limit", () => {
    expect(isValidPatch({ pendingPeriodSecs: { from: 60, to: 90 } })).toBe(false);
    expect(isValidPatch({ pendingPeriodSecs: { from: 60, to: 86_460 } })).toBe(false);
    expect(isValidPatch({ keepFiringForSecs: { from: 0, to: 86_400 } })).toBe(true);
    expect(isValidPatch({ keepFiringForSecs: { from: 0, to: 90_000 } })).toBe(false);
    expect(isValidPatch({ silenceMinutes: { from: 10, to: -1 } })).toBe(false);
    expect(isValidPatch({ silenceMinutes: { from: 10, to: 1.5 } })).toBe(false);
    expect(isValidPatch({ silenceMinutes: { from: 10, to: 10 } })).toBe(false);
    expect(isValidPatch({ silenceMinutes: { to: 10 } })).toBe(false);
    expect(isValidPatch({ destinations: { from: [], to: "ops" } })).toBe(false);
    expect(isValidPatch({ destinations: { from: [], to: [] } })).toBe(false);
    expect(isValidPatch({ destinations: { from: [], to: [""] } })).toBe(false);
    expect(isValidPatch({ destinations: { from: ["a"], to: ["a"] } })).toBe(false);
    expect(
      isValidPatch({
        destinations: { from: [], to: Array.from({ length: 21 }, (_, i) => `d${i}`) },
      }),
    ).toBe(false);
    expect(isValidPatch({ destinations: { from: [], to: ["ops-pager"] } })).toBe(true);
  });
});

describe("liveValueOf", () => {
  it("reads wire units and treats a missing field as 0 or none", () => {
    expect(liveValueOf("pendingPeriodSecs", {})).toBe(0);
    expect(liveValueOf("silenceMinutes", { trigger_condition: { silence: 5 } })).toBe(5);
    expect(liveValueOf("keepFiringForSecs", { keep_firing_for: 30 })).toBe(30);
    expect(liveValueOf("destinations", {})).toEqual([]);
  });
});
