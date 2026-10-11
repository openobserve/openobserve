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
import type { ReportRunHit } from "@/services/reports";
import { BADGE_GROUPS } from "@/lib/core/Badge/badgeGroups";
import {
  MANUAL_RUN_TTL_MS,
  OVERDUE_GRACE_MS,
  isCachedReport,
  isOverdue,
  lastRunChip,
  pendingManualRuns,
  rememberManualRun,
  runChip,
  runKey,
  runRailTone,
} from "./reportRun";

const NOW = 1_760_000_000_000_000;
const MIN = 60_000_000;

const hit = (over: Partial<ReportRunHit> = {}): ReportRunHit => ({
  timestamp: 1,
  report_id: "r1",
  report_name: "Weekly",
  status: "succeeded",
  is_cached: false,
  trigger_source: "scheduled",
  triggered_by: null,
  scheduled_for: null,
  finished_at: null,
  duration_ms: null,
  is_partial: false,
  delay_in_secs: null,
  time_in_queue_ms: null,
  retries: 0,
  recipient_count: 2,
  attachment_type: "pdf",
  dashboard_count: 1,
  error: null,
  source_node: null,
  scheduler_trace_id: null,
  next_run_at: null,
  ...over,
});

describe("isOverdue", () => {
  it("is false inside the grace window and true after it", () => {
    const due = NOW - OVERDUE_GRACE_MS * 1000;
    expect(isOverdue({ enabled: true, next_run_at: due + MIN }, NOW)).toBe(false);
    expect(isOverdue({ enabled: true, next_run_at: due - MIN }, NOW)).toBe(true);
  });

  it("is never true for a paused report or one without a next run", () => {
    expect(isOverdue({ enabled: false, next_run_at: NOW - 60 * MIN }, NOW)).toBe(false);
    expect(isOverdue({ enabled: true, next_run_at: null }, NOW)).toBe(false);
  });

  it("lets a failed run win: the scheduler keeps the old due time while it retries", () => {
    expect(
      isOverdue({ enabled: true, next_run_at: NOW - 60 * MIN, last_run_status: "error" }, NOW),
    ).toBe(false);
  });
});

describe("lastRunChip", () => {
  it("names each stored outcome", () => {
    expect(lastRunChip({ last_run_status: "succeeded" }, false, NOW)).toBe("succeeded");
    expect(lastRunChip({ last_run_status: "error" }, false, NOW)).toBe("error");
    expect(lastRunChip({ last_run_status: "skipped" }, false, NOW)).toBe("skipped");
    expect(lastRunChip({ last_run_status: null }, false, NOW)).toBe("never");
  });

  it("reads a successful cache-only report as Cached, not Sent", () => {
    expect(lastRunChip({ last_run_status: "succeeded" }, true, NOW)).toBe("cached");
  });

  it("shows Overdue over the last outcome", () => {
    const report = { enabled: true, next_run_at: NOW - 30 * MIN, last_run_status: "succeeded" };
    expect(lastRunChip(report, false, NOW)).toBe("overdue");
  });
});

describe("runChip and runRailTone", () => {
  it("splits a successful run into sent, partial and cached", () => {
    expect(runChip(hit())).toBe("succeeded");
    expect(runChip(hit({ is_partial: true }))).toBe("partial");
    expect(runChip(hit({ is_cached: true }))).toBe("cached");
    expect(runChip(hit({ status: "error" }))).toBe("error");
  });

  it("rails failed red, skipped amber, sent green and cached neutral", () => {
    expect(runRailTone(hit({ status: "error" }))).toBe("error");
    expect(runRailTone(hit({ status: "skipped" }))).toBe("warning");
    expect(runRailTone(hit())).toBe("success");
    expect(runRailTone(hit({ is_cached: true }))).toBe("neutral");
  });

  it("has a badge for every chip value the UI can produce", () => {
    const values = BADGE_GROUPS.reportRunStatus.values as Record<string, unknown>;
    for (const v of [
      "succeeded",
      "partial",
      "cached",
      "error",
      "skipped",
      "overdue",
      "never",
      "paused",
    ]) {
      expect(values[v], v).toBeTruthy();
    }
  });
});

describe("manual runs", () => {
  it("shows a remembered run until the server returns the same run", () => {
    const run = hit({ report_id: "pending-1", timestamp: 42, trigger_source: "manual" });
    rememberManualRun("org1", run, 1_000);
    expect(pendingManualRuns("org1", "pending-1", [], 2_000)).toEqual([run]);
    expect(pendingManualRuns("org1", "other", [], 2_000)).toEqual([]);
    expect(pendingManualRuns("org1", "pending-1", [run], 2_000)).toEqual([]);
  });

  it("drops a run from another org and one older than the TTL", () => {
    const run = hit({ report_id: "pending-2", timestamp: 43 });
    rememberManualRun("org1", run, 1_000);
    expect(pendingManualRuns("org2", "pending-2", [], 2_000)).toEqual([]);
    expect(pendingManualRuns("org1", "pending-2", [], 1_000 + MANUAL_RUN_TTL_MS)).toEqual([]);
  });
});

describe("isCachedReport", () => {
  it("prefers the list's is_cached flag over destinations", () => {
    expect(isCachedReport({ is_cached: false })).toBe(false);
    expect(isCachedReport({ is_cached: true, destinations: [{}] })).toBe(true);
    expect(isCachedReport({ destinations: [] })).toBe(true);
    expect(isCachedReport({ destinations: [{ email: "a@b.c" }] })).toBe(false);
  });
});

describe("runKey", () => {
  it("adds the retry count only when there is one", () => {
    expect(runKey({ timestamp: 5, retries: 0 })).toBe("5");
    expect(runKey({ timestamp: 5, retries: 2 })).toBe("5-2");
  });
});
