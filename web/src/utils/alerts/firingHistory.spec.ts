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
  failedDelivery,
  flapCount,
  historyEvents,
  latestReading,
  latestState,
  statusBar,
  type AlertRun,
} from "./firingHistory";

const MIN = 60_000_000;
const NOW = 1_000 * MIN;
const at = (minutesAgo: number) => NOW - minutesAgo * MIN;
const run = (minutesAgo: number, status: string, extra: Partial<AlertRun> = {}): AlertRun => ({
  timestamp: at(minutesAgo),
  status,
  ...extra,
});

describe("flapCount", () => {
  it("counts changes inside the window, ignoring repeats, errors and acks", () => {
    const hits = [
      run(10, "firing"),
      run(20, "ack_event", { acked_by: "a@x" }),
      run(30, "error"),
      run(40, "normal"),
      run(50, "normal"),
      run(60, "firing"),
      run(400, "normal"),
    ];
    expect(flapCount(hits, at(360))).toBe(3);
  });

  it("counts nothing from one steady state", () => {
    expect(flapCount([run(1, "firing"), run(2, "firing")], at(360))).toBe(0);
  });
});

describe("latestReading", () => {
  it("reads the newest run that has a value, with its threshold", () => {
    const hits = [
      run(1, "ack_event"),
      run(2, "firing", { actual_value: 6.4, threshold_value: 2, threshold_operator: ">" }),
      run(3, "firing", { actual_value: 5 }),
    ];
    expect(latestReading(hits)).toEqual({ value: "6.4", threshold: "2" });
  });

  it("is null when no run recorded a value", () => {
    expect(latestReading([run(1, "firing")])).toBeNull();
  });

  it("marks a lower bound and keeps zero", () => {
    expect(
      latestReading([run(1, "firing", { actual_value: 9, value_is_lower_bound: true })]),
    ).toEqual({ value: "≥9", threshold: null });
    expect(latestReading([run(1, "normal", { actual_value: 0 })])?.value).toBe("0");
  });
});

describe("latestState", () => {
  it("skips rows that say nothing about the state", () => {
    expect(latestState([run(1, "suppressed"), run(2, "notify_failed")])).toBe("notify_failed");
    expect(latestState([run(1, "ack_event"), run(2, "normal")])).toBe("normal");
    expect(latestState([run(1, "skipped")])).toBeUndefined();
  });
});

describe("failedDelivery", () => {
  it("names each failed destination of the newest failed run", () => {
    const error =
      "Error sending notification for destination Pager Duty err: 500; Error sending notification for destination slack err: timeout;";
    expect(failedDelivery([run(1, "firing"), run(2, "notify_failed", { error })])).toEqual({
      names: ["Pager Duty", "slack"],
      error,
    });
  });

  it("keeps the raw error when a run failed before naming a destination", () => {
    const error = "error sending notification for alert: boom";
    expect(failedDelivery([run(1, "notify_failed", { error })])).toEqual({ names: [], error });
  });

  it("is null without a failed run", () => {
    expect(failedDelivery([run(1, "firing")])).toBeNull();
  });
});

describe("statusBar", () => {
  it("splits the window into firing and ok with their totals", () => {
    const bar = statusBar(
      [run(30, "firing"), run(60, "normal"), run(90, "firing"), run(100, "normal")],
      {
        startUs: at(120),
        nowUs: NOW,
      },
    );
    expect(bar.segments.map((s) => [s.state, s.pct])).toEqual([
      ["ok", 25],
      ["firing", 25],
      ["ok", 25],
      ["firing", 25],
    ]);
    expect(bar.firingMs).toBe(3_600_000);
    expect(bar.okMs).toBe(3_600_000);
  });

  it("paints the open firing from its start even when no run shows it", () => {
    const bar = statusBar([run(1, "suppressed")], {
      startUs: at(200),
      nowUs: NOW,
      firingStartedAt: at(200),
    });
    expect(bar.segments.map((s) => s.state)).toEqual(["firing"]);
  });

  it("clips what began before the window", () => {
    const bar = statusBar([run(10, "normal"), run(200, "firing")], {
      startUs: at(100),
      nowUs: NOW,
    });
    expect(bar.segments.map((s) => [s.state, s.pct])).toEqual([
      ["firing", 90],
      ["ok", 10],
    ]);
  });
});

describe("historyEvents", () => {
  const opts = { destinations: ["slack", "pd"], nowUs: NOW };

  it("lists real events newest first and drops repeats", () => {
    const sent = "destination slack ok; destination pd ok;";
    const hits = [
      run(1, "firing", { success_response: sent }),
      run(2, "firing"),
      run(3, "firing", { success_response: sent }),
      run(10, "firing", { actual_value: 3, threshold_value: 2, threshold_operator: ">" }),
      run(20, "normal", { actual_value: 1 }),
      run(30, "firing"),
      run(40, "normal"),
    ];
    const events = historyEvents(hits, { ...opts, firingStartedAt: at(10) });
    expect(events.map((e) => e.kind)).toEqual(["notified", "started", "recovered", "started"]);
    expect(events[0].names).toEqual(["slack", "pd"]);
    expect(events[0].at).toBe(at(3));
    expect(events[1]).toMatchObject({ condition: "3 > 2", durationMs: 600_000, open: true });
    expect(events[2]).toMatchObject({ condition: "1", durationMs: 600_000, open: false });
    expect(events[3]).toMatchObject({ durationMs: 600_000, open: false });
  });

  it("does not invent a start at the edge of the read", () => {
    expect(historyEvents([run(1, "firing"), run(2, "firing")], opts)).toEqual([]);
  });

  it("keeps the start of a recovered firing the status bar paints", () => {
    const hits = [run(10, "normal"), run(30, "firing")];
    const events = historyEvents(hits, { ...opts, windowStartUs: at(120) });
    expect(events.map((e) => e.kind)).toEqual(["recovered", "started"]);
  });

  it("drops a first change older than the painted window", () => {
    const hits = [run(10, "normal"), run(200, "firing")];
    const events = historyEvents(hits, { ...opts, windowStartUs: at(120) });
    expect(events.map((e) => e.kind)).toEqual(["recovered"]);
  });

  it("never turns a first ok run into a recovery", () => {
    const events = historyEvents([run(30, "normal")], { ...opts, windowStartUs: at(120) });
    expect(events).toEqual([]);
  });

  it("anchors the open firing to its start when the read does not reach it", () => {
    const events = historyEvents([run(1, "firing")], { ...opts, firingStartedAt: at(5000) });
    expect(events.map((e) => [e.kind, e.at])).toEqual([["started", at(5000)]]);
  });

  it("keeps the latest five", () => {
    const hits = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => run(n, n % 2 ? "firing" : "normal"));
    expect(historyEvents(hits, opts)).toHaveLength(5);
  });

  it("shows acks, one line for an ack across groups, and failed sends", () => {
    const ack = { acked_by: "a@x", ack_action: "ack", ack_source: "ui" };
    const hits = [
      run(1, "ack_event", ack),
      run(1, "ack_event", ack),
      run(2, "notify_failed", {
        error: "Error sending notification for destination pd err: 500;",
      }),
    ];
    const events = historyEvents(hits, opts);
    expect(events.map((e) => e.kind)).toEqual(["ack", "failed"]);
    expect(events[1].names).toEqual(["pd"]);
  });

  it("ignores a success body that is not a delivery", () => {
    const hits = [run(1, "firing", { success_response: '{"anomalies_found":3}' })];
    expect(historyEvents(hits, opts)).toEqual([]);
  });
});
