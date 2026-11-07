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

import {
  INCIDENT_PAGE,
  INCIDENT_PILLS,
  isLive,
  liveIncidentPills,
  threadPills,
} from "./threadsBar";

const incident = (id: string, created_at: number, state?: string, stale = false) =>
  ({ id, created_at, rca: state ? { state, stale } : null }) as any;

describe("threadsBar pills", () => {
  it("keeps the newest live runs, then counts the rest", () => {
    const page = [
      ...Array.from({ length: INCIDENT_PILLS + 2 }, (_, i) => incident(`i${i}`, i, "running")),
      incident("done", 100, "completed"),
      incident("none", 101),
    ];
    const pills = liveIncidentPills(page);
    expect(pills.shown.map((i) => i.id)).toEqual(["i6", "i5", "i4", "i3", "i2"]);
    expect(pills.more).toBe(2);
    expect(pills.pageFull).toBe(false);
  });

  it("flags a full first page as 50+ open", () => {
    const page = Array.from({ length: INCIDENT_PAGE }, (_, i) => incident(`i${i}`, i));
    expect(liveIncidentPills(page).pageFull).toBe(true);
  });

  it("treats waiting runs as live and stale ones as not", () => {
    expect(isLive(incident("a", 1, "waiting_input"))).toBe(true);
    expect(isLive(incident("b", 1, "running", true))).toBe(false);
  });

  it("puts waiting approvals first and drops threads already minimised", () => {
    const pills = threadPills(
      [
        { sid: "a", title: "A", signal: "unread" },
        { sid: "b", title: "B", signal: "running" },
        { sid: "c", title: "C", signal: "approval" },
        { sid: "d", title: "D", signal: "running" },
      ],
      ["d"],
    );
    expect(pills.map((p) => p.sid)).toEqual(["c", "b", "a"]);
  });
});
