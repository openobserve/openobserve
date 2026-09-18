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

import { makeSloAlertSchema } from "./SloAlertForm.schema";

const t = ((key: string) => key) as any;
const schema = makeSloAlertSchema(t);

const paths = (form: unknown): string[] => {
  const result = schema.safeParse(form);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

const burnRate = (over: Record<string, unknown> = {}) => ({
  name: "checkout-burn-fast",
  frequencyMinutes: 5,
  silenceMinutes: 10,
  destinations: ["email"],
  workflows: [],
  condition: {
    kind: "burn_rate",
    operator: ">",
    critical: 14.4,
    long_window_secs: 3600,
    short_window_secs: 300,
  },
  ...over,
});

describe("SloAlertForm.schema — identity and delivery", () => {
  it("accepts a complete burn-rate alert", () => {
    expect(paths(burnRate())).toEqual([]);
  });

  it("requires a name", () => {
    expect(paths(burnRate({ name: "" }))).toContain("name");
  });

  it("rejects the characters the generic alert form rejects", () => {
    expect(paths(burnRate({ name: "bad name" }))).toContain("name");
    expect(paths(burnRate({ name: "bad/name" }))).toContain("name");
  });

  // Either channel satisfies the server, so this is a rule about the PAIR.
  it("requires a destination or a workflow, not both", () => {
    expect(paths(burnRate({ destinations: [], workflows: [] }))).toContain("destinations");
    expect(paths(burnRate({ destinations: [], workflows: ["wf"] }))).toEqual([]);
  });
});

describe("SloAlertForm.schema — cadence", () => {
  it("requires a frequency of at least a minute", () => {
    expect(paths(burnRate({ frequencyMinutes: "" }))).toContain("frequencyMinutes");
    expect(paths(burnRate({ frequencyMinutes: 0 }))).toContain("frequencyMinutes");
  });

  // Zero silence means "re-notify every evaluation", which is a real choice —
  // so a single `> 0` rule would wrongly reject it.
  it("accepts a silence of zero but not a negative one", () => {
    expect(paths(burnRate({ silenceMinutes: 0 }))).toEqual([]);
    expect(paths(burnRate({ silenceMinutes: -1 }))).toContain("silenceMinutes");
    expect(paths(burnRate({ silenceMinutes: "" }))).toContain("silenceMinutes");
  });
});

describe("SloAlertForm.schema — burn-rate condition", () => {
  it("requires a positive threshold", () => {
    expect(paths(burnRate({ condition: { kind: "burn_rate", critical: 0 } }))).toContain(
      "condition.critical",
    );
  });

  it("requires both windows", () => {
    const flagged = paths(burnRate({ condition: { kind: "burn_rate", critical: 14.4 } }));
    expect(flagged).toEqual(
      expect.arrayContaining(["condition.long_window_secs", "condition.short_window_secs"]),
    );
  });

  it("refuses a short window that is not shorter than the long one", () => {
    const equal = burnRate({
      condition: {
        kind: "burn_rate",
        critical: 14.4,
        long_window_secs: 3600,
        short_window_secs: 3600,
      },
    });
    expect(paths(equal)).toContain("condition.short_window_secs");
  });
});

describe("SloAlertForm.schema — error-budget condition", () => {
  const budget = (over: Record<string, unknown> = {}) =>
    burnRate({
      condition: {
        kind: "error_budget",
        operator: ">",
        critical: 75,
        long_window_secs: null,
        short_window_secs: null,
        ...over,
      },
    });

  // The kind watcher NULLS both windows on purpose, so a blanket "windows are
  // required" rule would make this kind unsubmittable.
  it("accepts null windows", () => {
    expect(paths(budget())).toEqual([]);
  });

  it("caps the consumed budget at 100%", () => {
    expect(paths(budget({ critical: 101 }))).toContain("condition.critical");
    expect(paths(budget({ critical: 100 }))).toEqual([]);
  });

  // A burn MULTIPLE above 100 is ordinary, so the cap must not leak.
  it("does not cap a burn-rate threshold at 100", () => {
    expect(
      paths(
        burnRate({
          condition: {
            kind: "burn_rate",
            critical: 200,
            long_window_secs: 3600,
            short_window_secs: 300,
          },
        }),
      ),
    ).toEqual([]);
  });
});
