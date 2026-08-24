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

import { resolveCalls, resolveDatabaseTime } from "./overlapMetrics";

describe("resolveDatabaseTime", () => {
  it("prefers the database server and converts its seconds to ns", () => {
    const metric = resolveDatabaseTime({
      serverExecTimeS: 2,
      execTimeKind: "execution",
      clientTotalTimeNs: 999,
    });
    expect(metric.value).toBe(2e9);
    expect(metric.source).toBe("server");
    // The trace figure is DROPPED, not demoted to a second line.
    expect(metric.qualifierKey).toBe("serverExecution");
  });

  /**
   * The reported fingerprint's exact case: MySQL `exec_time_kind: "wait"`. The
   * generic "Database time" heading is only safe because this qualifier ships
   * with it — without one a queueing figure reads as execution work.
   */
  it("marks a MySQL wait figure as wait, never execution", () => {
    const metric = resolveDatabaseTime({
      serverExecTimeS: 6918.972319966,
      execTimeKind: "wait",
      engine: "mysql",
    });
    expect(metric.value).toBeCloseTo(6918.972319966e9);
    expect(metric.qualifierKey).toBe("serverWait");
    expect(metric.qualifierKey).not.toBe("serverExecution");
  });

  it("falls back to the trace value when the server has none, and says so", () => {
    const metric = resolveDatabaseTime({ serverExecTimeS: null, clientTotalTimeNs: 4200 });
    expect(metric.value).toBe(4200);
    expect(metric.source).toBe("client");
    expect(metric.qualifierKey).toBe("clientObserved");
  });

  it("stays absent when neither vantage measured it — never a fabricated zero", () => {
    const metric = resolveDatabaseTime({});
    expect(metric.value).toBeNull();
    expect(metric.source).toBeNull();
    expect(metric.qualifierKey).toBeNull();
  });

  it("treats a real server zero as a measurement, not as absence", () => {
    const metric = resolveDatabaseTime({ serverExecTimeS: 0, clientTotalTimeNs: 500 });
    expect(metric.value).toBe(0);
    expect(metric.source).toBe("server");
  });

  it("ignores a non-finite server figure and falls through to the client", () => {
    const metric = resolveDatabaseTime({ serverExecTimeS: Number.NaN, clientTotalTimeNs: 7 });
    expect(metric.value).toBe(7);
    expect(metric.source).toBe("client");
  });
});

describe("resolveCalls", () => {
  it("prefers the server count and attributes it to the engine", () => {
    const metric = resolveCalls({ serverCalls: 139826, clientCalls: 12 });
    expect(metric.value).toBe(139826);
    expect(metric.source).toBe("server");
    expect(metric.qualifierKey).toBe("serverCounted");
  });

  it("falls back to the traced count and labels it client-observed", () => {
    const metric = resolveCalls({ serverCalls: null, clientCalls: 12 });
    expect(metric.value).toBe(12);
    expect(metric.source).toBe("client");
    expect(metric.qualifierKey).toBe("clientObserved");
  });

  it("stays absent when neither vantage counted", () => {
    expect(resolveCalls({}).value).toBeNull();
    expect(resolveCalls({}).qualifierKey).toBeNull();
  });

  /** A count is a count on every engine — never the execution/wait split. */
  it("never uses the exec-time qualifiers for a count", () => {
    const metric = resolveCalls({ serverCalls: 5, execTimeKind: "wait" });
    expect(metric.qualifierKey).toBe("serverCounted");
  });
});

describe("every produced value carries a qualifier", () => {
  /**
   * The invariant Rule B rests on: there is no code path that yields a number
   * with nothing saying whose it is and what it measured.
   */
  it("never returns a value without a qualifier key", () => {
    const cases = [
      { serverExecTimeS: 1, execTimeKind: "wait" as const },
      { serverExecTimeS: 1, execTimeKind: "execution" as const },
      { clientTotalTimeNs: 1 },
      { serverCalls: 1 },
      { clientCalls: 1 },
    ];
    for (const input of cases) {
      for (const metric of [resolveDatabaseTime(input), resolveCalls(input)]) {
        if (metric.value !== null) expect(metric.qualifierKey).not.toBeNull();
        else expect(metric.qualifierKey).toBeNull();
      }
    }
  });
});
