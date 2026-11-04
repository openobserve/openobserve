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

import { loadSampleData, removeSampleData } from "./loader";

const mocks = vi.hoisted(() => ({
  sampleData: {
    ingestLogs: vi.fn(),
    ingestMetrics: vi.fn(),
    ingestTraces: vi.fn(),
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
      appLogs: [],
      accessLogs: [],
      metrics: [],
      traces: {},
      spanCount: 0,
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

  it("still resolves when the state cannot be deleted", async () => {
    mocks.sampleData.deleteState.mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(removeSampleData("acme")).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
