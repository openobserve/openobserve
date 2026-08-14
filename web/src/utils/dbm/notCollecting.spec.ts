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

import type { DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import { raw, type TranslateFn } from "@/types/i18n";

import { buildDbmNotCollectingChecks } from "./notCollecting";

/**
 * A `t` that echoes its key (with params appended) so the assertions read
 * against the keys the real locale file carries.
 */
const t: TranslateFn = ((key: string, arg?: unknown) =>
  arg === undefined ? key : `${key}|${JSON.stringify(arg)}`) as unknown as TranslateFn;

const signals = (overrides: Partial<Parameters<typeof buildDbmNotCollectingChecks>[1]> = {}) => ({
  queryCount: 12,
  databaseCount: 3,
  dbmEnabled: true,
  ...overrides,
});

describe("buildDbmNotCollectingChecks", () => {
  it("phrases the shared pair in the page's own namespace", () => {
    const checks = buildDbmNotCollectingChecks("deadlocks", signals(), t, []);
    expect(checks[0].id).toBe("queries");
    expect(checks[0].title).toContain("dbm.deadlocks.notCollecting.checks.queries.ok");
    expect(checks[1].id).toBe("enabled");
    expect(checks[1].title).toContain("dbm.deadlocks.notCollecting.checks.enabled.ok");
  });

  it("passes when the rest of DBM is answering, and says how much", () => {
    const [queries] = buildDbmNotCollectingChecks("activity", signals(), t, []);
    expect(queries.status).toBe("ok");
    // The detail names the working feeds — the evidence that the problem is
    // this page's feed and not the whole pipeline.
    expect(queries.detail).toContain("dbm.activity.notCollecting.checks.queries.okDetail");
    expect(queries.detail).toContain("dbm.queries.queryCount|12");
    expect(queries.detail).toContain("dbm.databases.databaseCount|3");
  });

  it("fails the queries check when nothing else answers", () => {
    const [queries] = buildDbmNotCollectingChecks("blocked", signals({ queryCount: 0 }), t, []);
    expect(queries.status).toBe("fail");
    expect(queries.title).toContain("dbm.blocked.notCollecting.checks.queries.no");
  });

  /**
   * `null` is a read that never landed, and unknown is not "answering" — a ✓
   * on the strength of a failed read would be exactly the assumed-as-observed
   * claim this checklist exists to prevent.
   */
  it("treats an unknown query count as no", () => {
    const [queries] = buildDbmNotCollectingChecks("activity", signals({ queryCount: null }), t, []);
    expect(queries.status).toBe("fail");
  });

  it("fails the flag check when the feature is off", () => {
    const checks = buildDbmNotCollectingChecks("activity", signals({ dbmEnabled: false }), t, []);
    expect(checks[1].status).toBe("fail");
    expect(checks[1].title).toContain("dbm.activity.notCollecting.checks.enabled.no");
  });

  /** The page's own prerequisite entries follow the shared pair, in order. */
  it("appends the page's own checks after the shared pair", () => {
    const extras: DbmLockCheck[] = [
      { id: "sampling", status: "fail", title: raw("no sampler"), detail: raw("") },
      { id: "settings", status: "note", title: raw("check settings"), detail: raw("") },
    ];
    const checks = buildDbmNotCollectingChecks("blocked", signals(), t, extras);
    expect(checks.map((check) => check.id)).toEqual(["queries", "enabled", "sampling", "settings"]);
  });
});
