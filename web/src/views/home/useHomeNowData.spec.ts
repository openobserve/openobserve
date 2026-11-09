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

import { describe, expect, it, vi } from "vitest";

import type { OrgRcaRun } from "@/services/rca_runs_org";

import {
  anomalyRowsOf,
  homeRunsOf,
  perConfigHistory,
  periodToMs,
  windowOf,
} from "./useHomeNowData";

const getHistory = vi.hoisted(() => vi.fn());
vi.mock("@/services/anomaly_detection", () => ({ default: { getHistory } }));

describe("useHomeNowData helpers", () => {
  it("reads relative periods and falls back to 15 minutes", () => {
    expect(periodToMs("24h")).toBe(86_400_000);
    expect(periodToMs("15m")).toBe(900_000);
    expect(periodToMs("bogus")).toBe(900_000);
  });

  it("anchors a relative window to now and keeps an absolute one", () => {
    expect(windowOf({ type: "relative", period: "1h" }, 10_000_000)).toEqual({
      start: (10_000_000 - 3_600_000) * 1000,
      end: 10_000_000 * 1000,
    });
    expect(windowOf({ type: "absolute", from: 1, to: 2 }, 99)).toEqual({ start: 1, end: 2 });
  });

  it("keeps anomalies inside the window, newest per config name", () => {
    const cfg = { id: "c1", name: "latency", stream_name: "default" };
    const rows = anomalyRowsOf(
      [
        {
          cfg: { id: "c1" },
          hits: [
            { timestamp: 150, anomaly_count: 2 },
            { timestamp: 180, anomaly_count: 1 },
            { timestamp: 900, anomaly_count: 5 },
            { timestamp: 160, anomaly_count: 0 },
          ],
        },
      ],
      new Map([["c1", cfg]]),
      { start: 100, end: 200 },
    );
    expect(rows).toEqual([
      { configId: "c1", name: "latency", stream: "default", anomalyCount: 1, at: 180 },
    ]);
  });

  it("falls back to each config's own history, keeping the configs that answered", async () => {
    getHistory.mockImplementation((_org: string, id: string) =>
      id === "c1"
        ? Promise.resolve({ data: [{ timestamp: 1, anomaly_count: 2 }] })
        : Promise.reject(new Error("404")),
    );
    const entries = await perConfigHistory("o", [{ id: "c1" }, { id: "c2" }]);
    expect(entries).toEqual([
      { cfg: { id: "c1" }, hits: [{ timestamp: 1, anomaly_count: 2 }] },
      { cfg: { id: "c2" }, hits: [] },
    ]);
    expect(getHistory).toHaveBeenCalledWith("o", "c1", 20);
  });

  it("throws the first refusal when no config's history answers, so the source reads as failed", async () => {
    const denied = Object.assign(new Error("forbidden"), { status: 403 });
    getHistory.mockReset().mockRejectedValue(denied);
    await expect(perConfigHistory("o", [{ id: "c1" }, { id: "c2" }])).rejects.toBe(denied);
  });

  it("returns no entries for an empty config list without reading", async () => {
    getHistory.mockReset();
    await expect(perConfigHistory("o", [])).resolves.toEqual([]);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("gives each incident its newest run and lists only auto-runs whose newest attempt failed (C2 page)", () => {
    // The shape `GET /api/v2/{org}/alerts/rca_runs` answers with, newest first and every field present.
    const page: { runs: OrgRcaRun[]; has_more: boolean } = JSON.parse(
      JSON.stringify({
        runs: [
          {
            run_id: "r5",
            incident_id: "inc-481",
            incident_title: "Payments",
            severity: "P2",
            state: "refused",
            trigger: "auto",
            started_at: 50,
            ended_at: 51,
            error_code: "turn_limit",
          },
          {
            run_id: "r4",
            incident_id: "inc-482",
            incident_title: "Checkout 5xx",
            severity: "P1",
            state: "completed",
            trigger: "auto",
            started_at: 40,
            ended_at: 47,
            error_code: null,
          },
          {
            run_id: "r3",
            incident_id: "inc-482",
            incident_title: "Checkout 5xx",
            severity: "P1",
            state: "failed",
            trigger: "auto",
            started_at: 30,
            ended_at: 31,
            error_code: "agent_unavailable",
          },
          {
            run_id: "r2",
            incident_id: "inc-483",
            incident_title: null,
            severity: null,
            state: "failed",
            trigger: "manual",
            started_at: 20,
            ended_at: 21,
            error_code: null,
          },
          {
            run_id: "r1",
            incident_id: "inc-484",
            incident_title: "Disk",
            severity: "P3",
            state: "failed",
            trigger: "auto",
            started_at: 10,
            ended_at: 12,
            error_code: "query_timeout",
          },
        ],
        has_more: false,
      }),
    );
    const { byIncident, failedAuto } = homeRunsOf(page.runs);
    expect([...byIncident.entries()].map(([id, run]) => [id, run.run_id])).toEqual([
      ["inc-481", "r5"],
      ["inc-482", "r4"],
      ["inc-483", "r2"],
      ["inc-484", "r1"],
    ]);
    expect(failedAuto.map((run) => run.run_id)).toEqual(["r5", "r1"]);
  });
});
