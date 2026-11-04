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
import commonService from "@/services/common";
import dashboardService from "@/services/dashboards";
import { SAMPLE_DASHBOARD_TITLES, SAMPLE_FOLDER_NAME } from "./catalog";
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
    mocks.sampleData.ingestLogs.mockResolvedValueOnce({
      data: { code: 200, status: [{ name: "s", successful: 0, failed: 1, error: "Too old data" }] },
    });
    mocks.sampleData.ingestTraces.mockResolvedValueOnce({
      data: { partialSuccess: { rejectedSpans: "2", errorMessage: "Too old data" } },
    });
    const res = await loadSampleData("acme", 5, () => {});
    expect(res.counts).toEqual({ logs: 2, spans: 1, metrics: 1 });
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

  it("loads four hours when the server allows more", () => {
    expect(sampleWindowHours(undefined)).toBe(4);
    expect(sampleWindowHours(5)).toBe(4);
    expect(sampleWindowHours(720)).toBe(4);
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
    await expect(removeSampleData("acme")).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
