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

import { beforeEach, describe, expect, it, vi } from "vitest";

import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import commonService from "@/services/common";
import dashboardService from "@/services/dashboards";
import jsTransformService from "@/services/jstransform";
import pipelineService from "@/services/pipelines";
import {
  SAMPLE_ALERT_DESTINATION,
  SAMPLE_ALERT_TEMPLATE,
  SAMPLE_DASHBOARD_TITLES,
  SAMPLE_FOLDER_NAME,
  SAMPLE_FUNCTIONS,
  SAMPLE_PIPELINE,
  SAMPLE_STREAMS,
} from "./catalog";
import { loadSampleData, removeSampleData, sampleWindowHours } from "./loader";

const accepted = (rows: unknown[]) => ({
  data: { code: 200, status: [{ name: "s", successful: rows.length, failed: 0 }] },
});

const mocks = vi.hoisted(() => ({
  sampleData: {
    ingestLogs: vi.fn(async (_org: string, _stream: string, rows: unknown[]) => accepted(rows)),
    ingestMetrics: vi.fn(async (_org: string, rows: unknown[]) => accepted(rows)),
    ingestTraces: vi.fn(async () => ({ data: {} })),
    putState: vi.fn(),
    deleteState: vi.fn(),
  },
  dashboardCreate: vi.fn(),
  streamDelete: vi.fn(),
}));

vi.mock("@/services/sample_data", () => ({ default: mocks.sampleData }));
vi.mock("@/services/dashboards", () => ({
  default: {
    list: vi.fn(async () => ({ data: { dashboards: [] } })),
    create: vi.fn(async (...args: unknown[]) => {
      mocks.dashboardCreate(...args);
      return { data: {} };
    }),
    delete: vi.fn(),
  },
}));
vi.mock("@/services/common", () => ({
  default: {
    list_Folders: vi.fn(async () => ({ data: { list: [] } })),
    new_Folder: vi.fn(async () => ({ data: { folderId: "f1" } })),
    delete_Folder: vi.fn(),
  },
}));
vi.mock("@/services/alerts", () => ({
  default: {
    listByFolderId: vi.fn(async () => ({ data: { list: [] } })),
    create_by_alert_id: vi.fn(),
    delete_by_alert_id: vi.fn(),
  },
}));
vi.mock("@/services/alert_destination", () => ({ default: { create: vi.fn(), delete: vi.fn() } }));
vi.mock("@/services/alert_templates", () => ({ default: { create: vi.fn(), delete: vi.fn() } }));
vi.mock("@/services/jstransform", () => ({
  default: { create: vi.fn(), delete: vi.fn(), create_enrichment_table: vi.fn() },
}));
vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn(async () => ({ data: { list: [] } })),
    createPipeline: vi.fn(),
    deletePipeline: vi.fn(),
  },
}));
vi.mock("@/services/stream", () => ({ default: { delete: mocks.streamDelete } }));
vi.mock("./generator", () => ({
  createSampleGenerator: vi.fn(() => ({
    chunkCount: 1,
    generateChunk: () => ({
      appLogs: [{ _timestamp: 1, service_name: "cart", message: "ok" }],
      accessLogs: [{ _timestamp: 1 }, { _timestamp: 2 }],
      metrics: [{ _timestamp: 1 }],
      traces: {},
      spanCount: 3,
    }),
  })),
}));

describe("loadSampleData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the ingest window after the load", async () => {
    const before = Date.now() * 1000;
    await loadSampleData("acme", 5, () => {});
    const [org, startUs, endUs] = mocks.sampleData.putState.mock.calls[0];
    expect(org).toBe("acme");
    expect(endUs).toBeGreaterThanOrEqual(before);
    expect(endUs - startUs).toBe(4 * 3_600_000_000);
  });

  it("saves the window before the dashboards step, so a closed tab keeps it", async () => {
    await loadSampleData("acme", 5, () => {});
    expect(mocks.sampleData.putState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dashboardCreate.mock.invocationCallOrder[0],
    );
  });

  it("builds the dashboards on the same absolute window", async () => {
    await loadSampleData("acme", 5, () => {});
    const [, startUs, endUs] = mocks.sampleData.putState.mock.calls[0];
    const dash = mocks.dashboardCreate.mock.calls[0][1];
    expect(dash.defaultDatetimeDuration).toMatchObject({
      type: "absolute",
      startTime: startUs,
      endTime: endUs,
    });
  });

  it("counts the records the server accepted, not the ones it was sent", async () => {
    // the app logs go first, then the access logs
    mocks.sampleData.ingestLogs.mockResolvedValueOnce(accepted([{}])).mockResolvedValueOnce({
      data: { code: 200, status: [{ name: "s", successful: 1, failed: 1, error: "Too old data" }] },
    });
    mocks.sampleData.ingestTraces.mockResolvedValueOnce({
      data: { partialSuccess: { rejectedSpans: "2", errorMessage: "Too old data" } },
    });
    const res = await loadSampleData("acme", 5, () => {});
    expect(res).toEqual({ counts: { logs: 2, spans: 1, metrics: 1 }, failedSteps: [] });
  });

  it("fails with the server's message when the server accepted nothing", async () => {
    const tooOld = "Too old data, only last 1 hours data can be ingested";
    const rejected = {
      data: { code: 200, status: [{ name: "s", successful: 0, failed: 1, error: tooOld }] },
    };
    mocks.sampleData.ingestLogs.mockResolvedValue(rejected);
    mocks.sampleData.ingestMetrics.mockResolvedValue(rejected);
    mocks.sampleData.ingestTraces.mockResolvedValue({
      data: { partialSuccess: { rejectedSpans: "3", errorMessage: tooOld } },
    });
    try {
      await expect(loadSampleData("acme", 1, () => {})).rejects.toThrow(tooOld);
      expect(mocks.sampleData.putState).not.toHaveBeenCalled();
    } finally {
      mocks.sampleData.ingestLogs.mockImplementation(async (_o, _s, rows) => accepted(rows));
      mocks.sampleData.ingestMetrics.mockImplementation(async (_o, rows) => accepted(rows));
      mocks.sampleData.ingestTraces.mockImplementation(async () => ({ data: {} }));
    }
  });

  it("fails with the server's message when it rejected every log and span but kept the metrics", async () => {
    const tooOld = "Too old data, only last 1 hours data can be ingested";
    mocks.sampleData.ingestLogs.mockResolvedValue({
      data: { code: 200, status: [{ name: "s", successful: 0, failed: 1, error: tooOld }] },
    });
    mocks.sampleData.ingestTraces.mockResolvedValue({
      data: { partialSuccess: { rejectedSpans: "3", errorMessage: tooOld } },
    });
    try {
      await expect(loadSampleData("acme", 1, () => {})).rejects.toThrow(tooOld);
      expect(mocks.sampleData.putState).not.toHaveBeenCalled();
    } finally {
      mocks.sampleData.ingestLogs.mockImplementation(async (_o, _s, rows) => accepted(rows));
      mocks.sampleData.ingestTraces.mockImplementation(async () => ({ data: {} }));
    }
  });

  it("names the signal the server kept none of when it gave no message", async () => {
    mocks.sampleData.ingestMetrics.mockResolvedValueOnce({
      data: { code: 200, status: [{ name: "s", successful: 0, failed: 1 }] },
    });
    await expect(loadSampleData("acme", 5, () => {})).rejects.toThrow(
      "The server did not accept any sample metrics",
    );
  });

  it("fails when the server kept none of the app logs, even though it kept the access logs", async () => {
    mocks.sampleData.ingestLogs.mockImplementation(async (_o, stream, rows) =>
      stream === SAMPLE_STREAMS.appLogs
        ? { data: { code: 200, status: [{ name: stream, successful: 0, failed: rows.length }] } }
        : accepted(rows),
    );
    try {
      await expect(loadSampleData("acme", 5, () => {})).rejects.toThrow(
        "The server did not accept any sample app logs",
      );
      expect(mocks.sampleData.putState).not.toHaveBeenCalled();
    } finally {
      mocks.sampleData.ingestLogs.mockImplementation(async (_o, _s, rows) => accepted(rows));
    }
  });

  it("keeps the oldest record minutes inside a one-hour ingest window", async () => {
    const { createSampleGenerator } =
      await vi.importActual<typeof import("./generator")>("./generator");
    const minuteUs = 60_000_000;
    const endUs = Date.now() * 1000;
    const startUs = endUs - sampleWindowHours(1) * 60 * minuteUs;
    const batch = createSampleGenerator({ startUs, endUs }).generateChunk(0);
    const oldest = Math.min(
      ...[...batch.appLogs, ...batch.accessLogs].map((r) => Number(r._timestamp)),
    );
    expect(oldest).toBeGreaterThanOrEqual(endUs - 60 * minuteUs + 5 * minuteUs);
  });

  it("keeps the last metric scrape inside the saved window", async () => {
    const { createSampleGenerator } =
      await vi.importActual<typeof import("./generator")>("./generator");
    // one second into a 30s scrape slot
    const endUs = 1_793_793_601_000_000;
    const gen = createSampleGenerator({ startUs: endUs - 120_000_000, endUs });
    const last = Math.max(
      ...gen.generateChunk(gen.chunkCount - 1).metrics.map((r) => Number(r._timestamp)),
    );
    expect(last).toBeLessThanOrEqual(endUs);
  });

  it("rebuilds a sample dashboard left by an earlier load on the new window", async () => {
    vi.mocked(dashboardService.list).mockResolvedValueOnce({
      data: {
        dashboards: [
          { dashboard_id: "old", title: SAMPLE_DASHBOARD_TITLES.overview, folder_id: "f1" },
        ],
      },
    } as any);
    await loadSampleData("acme", 5, () => {});
    const [, startUs, endUs] = mocks.sampleData.putState.mock.calls[0];
    expect(dashboardService.delete).toHaveBeenCalledWith("acme", "old", "f1");
    const overview = mocks.dashboardCreate.mock.calls
      .map((c) => c[1])
      .find((d) => d.title === SAMPLE_DASHBOARD_TITLES.overview);
    expect(overview.defaultDatetimeDuration).toMatchObject({ startTime: startUs, endTime: endUs });
  });

  it("loads four hours when the server allows more", () => {
    expect(sampleWindowHours(undefined)).toBe(4);
    expect(sampleWindowHours(5)).toBe(4);
    expect(sampleWindowHours(720)).toBe(4);
  });

  it("reports each asset step's end, and whether it failed, as soon as the step ends", async () => {
    vi.mocked(jsTransformService.create).mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ends: [string, boolean][] = [];
    await loadSampleData("acme", 5, (p) => {
      if (p.step !== "telemetry" && p.fraction === 1) ends.push([p.step, !!p.failed]);
    });
    warn.mockRestore();
    expect(ends).toEqual([
      ["functions", true],
      ["pipeline", false],
      ["dashboards", false],
      ["alerts", false],
      ["enrichment", false],
    ]);
  });

  it("still finishes when the window cannot be saved", async () => {
    mocks.sampleData.putState.mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadSampleData("acme", 5, () => {})).resolves.toBeTruthy();
    warn.mockRestore();
  });
});

describe("removeSampleData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the state after the streams", async () => {
    await removeSampleData("acme");
    expect(mocks.sampleData.deleteState).toHaveBeenCalledWith("acme");
    expect(mocks.streamDelete.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.sampleData.deleteState.mock.invocationCallOrder[0],
    );
  });

  it("deletes the sample streams without the alerts and pipelines the user attached to them", async () => {
    await removeSampleData("acme");
    expect(mocks.streamDelete).toHaveBeenCalled();
    for (const call of mocks.streamDelete.mock.calls) expect(call[3]).toBe(false);
  });

  it("deletes only the sample dashboards and alerts, and keeps a folder that still has the user's", async () => {
    vi.mocked(commonService.list_Folders).mockResolvedValue({
      data: { list: [{ name: SAMPLE_FOLDER_NAME, folderId: "sf" }] },
    } as any);
    vi.mocked(dashboardService.list).mockResolvedValueOnce({
      data: {
        dashboards: [
          { dashboard_id: "d1", title: SAMPLE_DASHBOARD_TITLES.overview, folder_id: "sf" },
          { dashboard_id: "mine", title: "My dashboard", folder_id: "sf" },
        ],
      },
    } as any);
    vi.mocked(alertsService.listByFolderId).mockResolvedValueOnce({
      data: {
        list: [
          { alert_id: "a1", name: "o2_demo_payment_errors_spike" },
          { alert_id: "mine", name: "my_alert" },
        ],
      },
    } as any);
    try {
      await removeSampleData("acme");
    } finally {
      vi.mocked(commonService.list_Folders).mockResolvedValue({ data: { list: [] } } as any);
    }
    expect(vi.mocked(dashboardService.delete).mock.calls).toEqual([["acme", "d1", "sf"]]);
    expect(vi.mocked(alertsService.delete_by_alert_id).mock.calls).toEqual([["acme", "a1", "sf"]]);
    expect(commonService.delete_Folder).not.toHaveBeenCalled();
  });

  it("deletes the sample folder once it holds nothing else", async () => {
    vi.mocked(commonService.list_Folders).mockResolvedValue({
      data: { list: [{ name: SAMPLE_FOLDER_NAME, folderId: "sf" }] },
    } as any);
    vi.mocked(dashboardService.list).mockResolvedValueOnce({
      data: {
        dashboards: [
          { dashboard_id: "d1", title: SAMPLE_DASHBOARD_TITLES.overview, folder_id: "sf" },
        ],
      },
    } as any);
    try {
      await removeSampleData("acme");
    } finally {
      vi.mocked(commonService.list_Folders).mockResolvedValue({ data: { list: [] } } as any);
    }
    expect(commonService.delete_Folder).toHaveBeenCalledWith("acme", "dashboards", "sf");
    expect(commonService.delete_Folder).toHaveBeenCalledWith("acme", "alerts", "sf");
  });

  it("still resolves when the state cannot be deleted", async () => {
    mocks.sampleData.deleteState.mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(removeSampleData("acme")).resolves.toEqual([]);
    warn.mockRestore();
  });

  it("keeps a sample function that the user's own pipeline uses, and still removes the rest", async () => {
    vi.mocked(jsTransformService.delete).mockRejectedValueOnce({ response: { status: 409 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = await removeSampleData("acme");
    warn.mockRestore();
    expect(kept).toEqual([SAMPLE_FUNCTIONS[0]]);
    expect(jsTransformService.delete).toHaveBeenCalledTimes(SAMPLE_FUNCTIONS.length);
    for (const call of vi.mocked(jsTransformService.delete).mock.calls) {
      expect(call).toEqual(["acme", expect.any(String)]);
    }
    expect(mocks.streamDelete).toHaveBeenCalled();
    expect(mocks.sampleData.deleteState).toHaveBeenCalledWith("acme");
  });

  it("keeps a sample destination and template that something still uses, and still removes the rest", async () => {
    vi.mocked(commonService.list_Folders).mockResolvedValue({
      data: { list: [{ name: SAMPLE_FOLDER_NAME, folderId: "sf" }] },
    } as any);
    vi.mocked(dashboardService.list).mockResolvedValueOnce({
      data: {
        dashboards: [
          { dashboard_id: "d1", title: SAMPLE_DASHBOARD_TITLES.overview, folder_id: "sf" },
        ],
      },
    } as any);
    vi.mocked(pipelineService.getPipelines).mockResolvedValueOnce({
      data: { list: [{ name: SAMPLE_PIPELINE, pipeline_id: "p1" }] },
    } as any);
    vi.mocked(destinationService.delete).mockRejectedValueOnce({ response: { status: 409 } });
    vi.mocked(templateService.delete).mockRejectedValueOnce({ response: { status: 409 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(removeSampleData("acme")).resolves.toEqual([
        SAMPLE_ALERT_DESTINATION,
        SAMPLE_ALERT_TEMPLATE,
      ]);
    } finally {
      warn.mockRestore();
      vi.mocked(commonService.list_Folders).mockResolvedValue({ data: { list: [] } } as any);
    }
    expect(dashboardService.delete).toHaveBeenCalledWith("acme", "d1", "sf");
    expect(pipelineService.deletePipeline).toHaveBeenCalledWith({
      pipeline_id: "p1",
      org_id: "acme",
    });
    expect(jsTransformService.delete).toHaveBeenCalledTimes(SAMPLE_FUNCTIONS.length);
    expect(mocks.streamDelete).toHaveBeenCalled();
    expect(mocks.sampleData.deleteState).toHaveBeenCalledWith("acme");
  });
});
