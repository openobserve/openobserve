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

import { alertRow } from "./homeFixtures";
import { SINCE_LAST_VISIT_CAP, sinceLastVisit, type SinceThread } from "./sinceLastVisit";

const incident = (id: string, created_at: number, resolved_at?: number) =>
  ({ id, title: `INC ${id}`, created_at, resolved_at }) as any;

describe("sinceLastVisit", () => {
  it("compares nothing on the first visit", () => {
    expect(
      sinceLastVisit({ since: null, incidents: null, rows: [alertRow("a")], threads: [] }),
    ).toEqual([]);
  });

  it("lists what changed after the last visit, approvals first", () => {
    const since = 1_000;
    const items = sinceLastVisit({
      since,
      incidents: {
        open: [incident("new", 2_000_000), incident("old", 500_000)],
        acknowledged: [],
        resolved: [incident("done", 100, 3_000_000)],
      },
      rows: [alertRow("a1", { lastAt: 4_000_000 }), alertRow("a0", { lastAt: 10 })],
      threads: [
        {
          sid: "t1",
          title: "Why slow",
          updatedAt: 5_000,
          activeTurn: false,
          pendingApproval: false,
          ended: "done",
        },
        {
          sid: "t2",
          title: "Add panel",
          updatedAt: 1,
          activeTurn: false,
          pendingApproval: true,
          ended: null,
        },
        {
          sid: "t3",
          title: "Running",
          updatedAt: 6_000,
          activeTurn: true,
          pendingApproval: false,
          ended: null,
        },
      ],
    });
    expect(items.map((item) => item.key)).toEqual([
      "approval_waiting:t2",
      "thread_finished:t1",
      "alert:a1",
      "incident_resolved:done",
      "incident_opened:new",
    ]);
  });

  it("names how a thread ended and claims nothing for one this tab never loaded", () => {
    const thread = (sid: string, ended: SinceThread["ended"]) => ({
      sid,
      title: sid,
      updatedAt: 5_000,
      activeTurn: false,
      pendingApproval: false,
      ended,
    });
    const items = sinceLastVisit({
      since: 1_000,
      incidents: null,
      rows: [],
      threads: [
        thread("a", "done"),
        thread("b", "stopped"),
        thread("c", "failed"),
        thread("d", null),
      ],
    });
    expect(items.map((item) => item.kind)).toEqual([
      "thread_finished",
      "thread_stopped",
      "thread_failed",
      "thread_updated",
    ]);
  });

  it("caps the list", () => {
    const threads = Array.from({ length: SINCE_LAST_VISIT_CAP + 3 }, (_, i) => ({
      sid: `t${i}`,
      title: "t",
      updatedAt: 10_000 + i,
      activeTurn: false,
      pendingApproval: false,
      ended: null,
    }));
    expect(sinceLastVisit({ since: 1, incidents: null, rows: [], threads })).toHaveLength(
      SINCE_LAST_VISIT_CAP,
    );
  });
});
