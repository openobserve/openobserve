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

import { describe, it, expect } from "vitest";
import { rollUpStatus, tallyStatuses } from "./rollUpStatus";
import type { ExecutionStatus } from "./rollUpStatus";

describe("rollUpStatus", () => {
  it("should report all-pass only when every execution passed", () => {
    expect(rollUpStatus(["pass"])).toBe("all-pass");
    expect(rollUpStatus(["pass", "pass", "pass"])).toBe("all-pass");
  });

  /**
   * The reported bug: the runs table badged a run "Warning" while the timeline
   * segment for that same run was green.
   *
   * The old rule tested `every(s === "pass" || s === "warning")` for "all
   * passed", so a run was orange only when EVERY execution warned. One warning
   * among passes — the ordinary case, one location degrading — rolled up green
   * and the timeline hid it.
   */
  it("should report all-warning when any execution warned but none failed", () => {
    expect(rollUpStatus(["pass", "pass", "warning"])).toBe("all-warning");
    expect(rollUpStatus(["warning", "pass"])).toBe("all-warning");
    expect(rollUpStatus(["warning"])).toBe("all-warning");
    expect(rollUpStatus(["warning", "warning"])).toBe("all-warning");
  });

  it("should report all-fail when every execution failed or errored", () => {
    expect(rollUpStatus(["fail"])).toBe("all-fail");
    expect(rollUpStatus(["fail", "error"])).toBe("all-fail");
    expect(rollUpStatus(["error", "error"])).toBe("all-fail");
  });

  it("should report mixed when healthy and failed executions coexist", () => {
    expect(rollUpStatus(["pass", "fail"])).toBe("mixed");
    expect(rollUpStatus(["warning", "fail"])).toBe("mixed");
    expect(rollUpStatus(["pass", "warning", "error"])).toBe("mixed");
  });

  it("should not throw on an empty set", () => {
    expect(rollUpStatus([])).toBe("all-pass");
  });
});

describe("tallyStatuses", () => {
  /**
   * The parent counted `failed = total - passed` (errors counted as failed)
   * while the tooltip filtered `status === "fail"` (errors counted as neither),
   * so a run of [pass, fail, error] was summarised "1 passed · 1 failed" and one
   * execution vanished. One definition; the buckets must always sum.
   */
  it("should place every execution in exactly one bucket", () => {
    const statuses: ExecutionStatus[] = ["pass", "fail", "error"];
    const tally = tallyStatuses(statuses);
    expect(tally).toEqual({ passed: 1, warning: 0, failed: 2, total: 3 });
    expect(tally.passed + tally.warning + tally.failed).toBe(tally.total);
  });

  it("should count warning separately from passed", () => {
    const tally = tallyStatuses(["pass", "warning", "warning"]);
    expect(tally).toEqual({ passed: 1, warning: 2, failed: 0, total: 3 });
  });

  it.each([
    [["pass", "pass", "warning", "fail", "error"] as ExecutionStatus[]],
    [["warning"] as ExecutionStatus[]],
    [[] as ExecutionStatus[]],
  ])("should always sum to the total for %j", (statuses) => {
    const tally = tallyStatuses(statuses);
    expect(tally.passed + tally.warning + tally.failed).toBe(statuses.length);
  });
});
