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
import { problemStatusWord, workloadStatusWord } from "./workloadStatusLabel";

describe("workloadStatusWord", () => {
  it.each([
    ["running", "infra.k8s2.workloadWordHealthy"],
    ["pending", "infra.k8s2.workloadWordDegraded"],
    ["failed", "infra.k8s2.workloadWordUnavailable"],
  ] as const)("a deployment that is %s reads %s", (status, key) => {
    expect(workloadStatusWord("deployment", status)).toBe(key);
    expect(workloadStatusWord("statefulset", status)).toBe(key);
  });

  it("keeps the native wording for Unknown, pods, jobs and cron jobs", () => {
    expect(workloadStatusWord("deployment", "unknown")).toBeNull();
    expect(workloadStatusWord("pod", "running")).toBeNull();
    expect(workloadStatusWord("job", "failed")).toBeNull();
    expect(workloadStatusWord("cronjob", "scheduled")).toBeNull();
  });
});

describe("problemStatusWord", () => {
  it("calls a pending controller Degraded, a failed one Unavailable, and a failed Job Failed", () => {
    expect(problemStatusWord("deployment", "pending")).toBe("infra.k8s2.workloadWordDegraded");
    expect(problemStatusWord("daemonset", "failed")).toBe("infra.k8s2.workloadWordUnavailable");
    expect(problemStatusWord("job", "failed")).toBe("infra.k8s2.workloadsStatusFailedChip");
  });
});
