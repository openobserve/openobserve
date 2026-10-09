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
  ACTIVE_WINDOW_MS,
  LIVE_IDLE_STOP_MS,
  LIVE_MAX_SESSION_MS,
  errorLogKey,
  eventKey,
  isSessionLive,
  keepTrackRows,
  mergeManifestTail,
  raiseUpperTs,
  shouldStopLive,
} from "./sessionReplayLive";
import { segmentId } from "./sessionReplayManifest";

const row = (start: number, end = start + 999, extra: Record<string, any> = {}) => ({
  start,
  end,
  records_count: 1,
  ...extra,
});

describe("isSessionLive", () => {
  const now = 1_700_000_000_000;

  it("is live up to and including the active window, like the Sessions list", () => {
    expect(isSessionLive(now - ACTIVE_WINDOW_MS, now)).toBe(true);
    expect(isSessionLive(now - ACTIVE_WINDOW_MS - 1, now)).toBe(false);
    expect(isSessionLive(now - 1000, now)).toBe(true);
  });

  it("is never live without an end time", () => {
    expect(isSessionLive(0, now)).toBe(false);
    expect(isSessionLive(undefined, now)).toBe(false);
  });
});

describe("raiseUpperTs", () => {
  it("moves to the largest arrival time seen and never falls back", () => {
    expect(raiseUpperTs(100, [{ _timestamp: 90 }, { _timestamp: 250 }], "_timestamp")).toBe(250);
    expect(raiseUpperTs(250, [{ _timestamp: 10 }], "_timestamp")).toBe(250);
    expect(raiseUpperTs(250, [], "_timestamp")).toBe(250);
    expect(raiseUpperTs(250, [{}], "_timestamp")).toBe(250);
  });
});

describe("mergeManifestTail", () => {
  const manifest = [row(0), row(1000), row(2000)];
  const known = new Set(manifest.map(segmentId));

  it("appends only ids the manifest does not hold, in manifest order", () => {
    const polled = [row(4000), row(2000), row(3000), row(3000, 3999, { _timestamp: 7 })];

    const { appended, late } = mergeManifestTail(manifest, polled, known);

    expect(appended.map((r) => r.start)).toEqual([3000, 4000]);
    expect(late).toBe(false);
  });

  it("does not insert a new row that sorts before the tail, and flags it", () => {
    const tiedBefore = row(2000, 2500);

    const { appended, late } = mergeManifestTail(manifest, [tiedBefore, row(3000)], known);

    expect(appended.map((r) => r.start)).toEqual([3000]);
    expect(late).toBe(true);
  });

  it("returns nothing new for a poll that only repeats known rows", () => {
    expect(mergeManifestTail(manifest, [row(1000), row(2000)], known)).toEqual({
      appended: [],
      late: false,
    });
  });
});

describe("keepTrackRows", () => {
  const view = (id: string, start: number, extra: Record<string, any> = {}) =>
    row(start, start + 999, { view_id: id, ...extra });
  const tabA = [view("a", 0, { has_full_snapshot: true }), view("a", 1000)];

  it("follows the tab onto its next view, from that view's full snapshot", () => {
    const seen = [...tabA, view("c", 2000, { has_full_snapshot: true }), view("c", 3000)];

    const { rows, current, otherTab } = keepTrackRows(seen, "a");

    expect(rows.map((r) => r.start)).toEqual([0, 1000, 2000, 3000]);
    expect(current).toBe("c");
    expect(otherTab).toBe(false);
  });

  it("waits for a new view's full snapshot before moving to it", () => {
    const { rows, current } = keepTrackRows([...tabA, view("c", 3000)], "a");

    expect(rows.map((r) => r.start)).toEqual([0, 1000]);
    expect(current).toBe("a");
  });

  it("says a tab is left out once a view it moved past records again", () => {
    const opened = [...tabA, view("b", 2500, { has_full_snapshot: true })];
    const moved = keepTrackRows(opened, "a");

    const { rows, current, otherTab } = keepTrackRows([...opened, view("a", 4000)], moved.current);

    expect(moved.current).toBe("b");
    expect(rows.map((r) => r.start)).toEqual([2500]);
    expect(current).toBe("b");
    expect(otherTab).toBe(true);
  });

  it("puts a new view on the tab a reload would, not on the followed one", () => {
    // "b" overlaps "a", so it is another tab; "c" continues "b", the tab that ended last.
    const seen = [
      ...tabA,
      view("b", 500, { has_full_snapshot: true }),
      view("b", 1500),
      view("c", 3000, { has_full_snapshot: true }),
    ];

    const { rows, current, otherTab } = keepTrackRows(seen, "a");

    expect(rows.map((r) => r.start)).toEqual([0, 1000]);
    expect(current).toBe("a");
    expect(otherTab).toBe(true);
  });

  it("keeps every row of a schema without view columns", () => {
    const plain = [row(0, 999, { has_full_snapshot: true }), row(1000), row(2000)];

    expect(keepTrackRows(plain, "").rows.map((r) => r.start)).toEqual([0, 1000, 2000]);
  });
});

describe("shouldStopLive", () => {
  const start = 1_700_000_000_000;

  it("stops 15 minutes after the last new segment id", () => {
    const last = start + 60_000;
    expect(shouldStopLive(last, start, last + LIVE_IDLE_STOP_MS - 1)).toBe(false);
    expect(shouldStopLive(last, start, last + LIVE_IDLE_STOP_MS)).toBe(true);
  });

  it("stops once the session reaches 4 hours", () => {
    const now = start + LIVE_MAX_SESSION_MS;
    expect(shouldStopLive(now, start, now)).toBe(true);
    expect(shouldStopLive(now - 1, start, now - 1)).toBe(false);
  });
});

describe("event keys", () => {
  it("keys a RUM event by its own id and type", () => {
    expect(eventKey({ type: "view", view_id: "v1" })).toBe("view|v1");
    expect(eventKey({ type: "action", action_id: "a1" })).toBe("action|a1");
    expect(eventKey({ type: "action" })).toBeNull();
  });

  it("keys an error log by arrival time, device time and message", () => {
    const hit = { _timestamp: 5, date: 4, message: "boom" };
    expect(errorLogKey(hit, "_timestamp")).toBe("5|4|boom");
    expect(errorLogKey({ ...hit, error_id: "x" }, "_timestamp")).toBe(
      errorLogKey(hit, "_timestamp"),
    );
  });
});
