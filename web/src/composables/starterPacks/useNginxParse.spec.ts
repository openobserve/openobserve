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

import reference from "./fixtures/nginxLines.json";

const fake = vi.hoisted(() => ({
  values: [] as string[],
  writes: [] as Array<Record<string, any>>,
  stored: [] as Array<Record<string, any>>,
  existing: null as Record<string, any> | null,
  failWriteOn: "",
  test: vi.fn(),
  createFunction: vi.fn(),
  deleteFunction: vi.fn(),
  createPipeline: vi.fn(),
  deletePipeline: vi.fn(),
  queries: {} as Record<string, any[]>,
}));

vi.mock("./useStreamValues", () => ({
  useStreamValues: () => ({
    readValues: async (_stream: string, fields: string[]) => ({ [fields[0]]: fake.values }),
  }),
}));
vi.mock("./useInstallRecords", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useInstallRecords")>()),
  useInstallRecords: () => ({
    write: async (record: Record<string, any>) => {
      if (record.status === fake.failWriteOn) throw new Error("kv down");
      fake.writes.push(structuredClone(record));
    },
    list: async () => fake.stored,
    read: async () => fake.existing,
  }),
}));
vi.mock("@/services/jstransform", () => ({
  default: { test: fake.test, create: fake.createFunction, delete: fake.deleteFunction },
}));
vi.mock("@/services/pipelines", () => ({
  default: { createPipeline: fake.createPipeline, deletePipeline: fake.deletePipeline },
}));
vi.mock("@/services/dashboards", () => ({
  default: { list: async () => ({ data: { dashboards: fake.queries.dashboards ?? [] } }) },
}));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async (options: { queryKey: unknown[] }) => {
    const key = JSON.stringify(options.queryKey);
    if (key.includes("alert")) return fake.queries.alerts ?? [];
    if (key.includes("pipeline")) return fake.queries.pipelines ?? [];
    if (key.includes('"v1"')) return fake.queries.viewDetails?.shift();
    return fake.queries.views ?? [];
  },
}));

import { repairName } from "./nginxParse";
import { useNginxParse } from "./useNginxParse";

const notice = { stream: "edge", column: "message" };
const NAME = repairName("edge");
const missing = () => Object.assign(new Error("gone"), { response: { status: 404 } });

describe("useNginxParse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.writes = [];
    fake.stored = [];
    fake.existing = null;
    fake.failWriteOn = "";
    fake.queries = {};
    fake.values = reference.combined.map(({ line }) => line).concat("extra line");
  });

  it("previews the parser on 5 of the stream's own records, showing only added fields", async () => {
    fake.test.mockResolvedValue({
      data: {
        results: fake.values
          .slice(0, 5)
          .map((line, index) => ({ event: { message: line, status: 200 + index } })),
      },
    });
    const preview = await useNginxParse("org").preview(notice);
    const payload = fake.test.mock.calls[0][1];
    expect(fake.test.mock.calls[0][0]).toBe("org");
    expect(payload.events).toEqual(fake.values.slice(0, 5).map((line) => ({ message: line })));
    expect(payload.function).toContain('parse_nginx_log(.message, "combined")');
    expect(preview?.format).toBe("combined");
    expect(preview?.rows[1]).toEqual({ line: fake.values[1], added: { status: 201 } });
  });

  it("gives no preview when the records are not a supported format", async () => {
    fake.values = ["plain text", "more text"];
    expect(await useNginxParse("org").preview(notice)).toBeNull();
    expect(fake.test).not.toHaveBeenCalled();
  });

  it("lists readers from dashboards, alerts, saved views and pipelines", async () => {
    fake.queries = {
      dashboards: [
        {
          version: 8,
          title: "Edge",
          v8: { panels: [{ queries: [{ fields: { stream: "edge" } }] }] },
        },
      ],
      alerts: [{ name: "5xx", stream_name: "edge" }],
      views: [{ view_id: "v1", view_name: "Edge view", view_type: "logs" }],
      viewDetails: [
        { view_name: "Edge view", data: { data: { stream: { selectedStream: ["edge"] } } } },
      ],
      pipelines: [],
    };
    expect(await useNginxParse("org").readers("edge")).toEqual([
      { kind: "dashboard", name: "Edge" },
      { kind: "alert", name: "5xx" },
      { kind: "savedView", name: "Edge view" },
    ]);
  });

  it("creates the function and a realtime pipeline on the stream and records both", async () => {
    fake.createPipeline.mockResolvedValue({ data: { id: "p1" } });
    const record = await useNginxParse("org").confirm(notice, "combined", "a@example.com");
    expect(fake.createFunction).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ name: NAME, transType: 0 }),
    );
    const { data } = fake.createPipeline.mock.calls[0][0];
    expect(data.source.source_type).toBe("realtime");
    expect(data.nodes[0].data.stream_name).toBe("edge");
    expect(fake.writes[0].status).toBe("installing");
    expect(record.status).toBe("complete");
    expect(record.items).toEqual([
      expect.objectContaining({
        kind: "function",
        status: "created",
        id: NAME,
      }),
      expect.objectContaining({ kind: "pipeline", status: "created", id: "p1" }),
    ]);
  });

  it("leaves an undoable record when the pipeline create fails", async () => {
    fake.createPipeline.mockRejectedValue(new Error("stream in use"));
    await expect(useNginxParse("org").confirm(notice, "combined")).rejects.toThrow();
    const last = fake.writes.at(-1)!;
    expect(last.status).toBe("incomplete");
    expect(last.items.map((item: any) => `${item.kind}=${item.status}`)).toEqual([
      "function=created",
      "pipeline=failed",
    ]);
    await useNginxParse("org").undo(last as any);
    expect(fake.deletePipeline).not.toHaveBeenCalled();
    expect(fake.deleteFunction).toHaveBeenCalledWith("org", NAME);
    expect(fake.writes.at(-1)!.status).toBe("removed");
  });

  it("Undo deletes only the pipeline and function the record says it created", async () => {
    const record = {
      packId: "nginx_parse",
      installId: NAME,
      status: "complete",
      items: [
        { kind: "function", itemId: "combined", status: "created", id: NAME },
        { kind: "pipeline", itemId: "combined", status: "created", id: "p1" },
      ],
    } as any;
    await useNginxParse("org").undo(record);
    expect(fake.deletePipeline).toHaveBeenCalledTimes(1);
    expect(fake.deletePipeline).toHaveBeenCalledWith({ pipeline_id: "p1", org_id: "org" });
    expect(fake.deleteFunction).toHaveBeenCalledTimes(1);
    expect(fake.deleteFunction).toHaveBeenCalledWith("org", NAME);
    expect(fake.deletePipeline.mock.invocationCallOrder[0]).toBeLessThan(
      fake.deleteFunction.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["pipeline", () => fake.deletePipeline.mockRejectedValue(missing())],
    ["function", () => fake.deleteFunction.mockRejectedValue(missing())],
  ])("Undo finishes when the %s is already gone", async (_kind, arrange) => {
    arrange();
    const record = {
      packId: "nginx_parse",
      installId: NAME,
      status: "complete",
      items: [
        { kind: "function", itemId: "combined", status: "created", id: NAME },
        { kind: "pipeline", itemId: "combined", status: "created", id: "p1" },
      ],
    } as any;
    await useNginxParse("org").undo(record);
    expect(fake.writes.at(-1)!.status).toBe("removed");
    expect(fake.writes.at(-1)!.items.map((item: any) => item.status)).toEqual([
      "skipped",
      "skipped",
    ]);
  });

  it("Undo still fails on an error other than missing", async () => {
    fake.deleteFunction.mockRejectedValue(
      Object.assign(new Error("x"), { response: { status: 500 } }),
    );
    const record = {
      packId: "nginx_parse",
      installId: NAME,
      status: "complete",
      items: [{ kind: "function", itemId: "combined", status: "created", id: NAME }],
    } as any;
    await expect(useNginxParse("org").undo(record)).rejects.toThrow("x");
    expect(fake.writes.some((write) => write.status === "removed")).toBe(false);
  });

  it("refuses to overwrite a live repair with the same name, and allows one after Undo", async () => {
    fake.existing = { status: "complete" };
    await expect(useNginxParse("org").confirm(notice, "combined")).rejects.toThrow();
    expect(fake.writes).toEqual([]);
    expect(fake.createFunction).not.toHaveBeenCalled();
    fake.existing = { status: "removed" };
    fake.createPipeline.mockResolvedValue({ data: { id: "p2" } });
    expect((await useNginxParse("org").confirm(notice, "combined")).status).toBe("complete");
  });

  it("rethrows the create error when the record write after it also fails", async () => {
    fake.createPipeline.mockRejectedValue(new Error("stream in use"));
    fake.failWriteOn = "incomplete";
    await expect(useNginxParse("org").confirm(notice, "combined")).rejects.toThrow("stream in use");
  });

  it("lists only repairs that were not undone", async () => {
    fake.stored = [{ status: "complete" }, { status: "removed" }, { status: "incomplete" }];
    expect((await useNginxParse("org").active()).map(({ status }) => status)).toEqual([
      "complete",
      "incomplete",
    ]);
  });
});
