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

import { describe, it, expect } from "vitest";
import type { FleetPipeline } from "@/services/fleet";
import { MAX_WIDTH, MIN_WIDTH, buildPipelineMap, strokeWidth } from "./pipelineGraph";

const layout = { width: 1000, nodeWidth: 144, row: 100, top: 20 };

const exporter = (name: string, destination: string, rate: number | null, over = {}) => ({
  name,
  destination,
  rate,
  failed: 0,
  dropped: 0,
  queue: 0,
  ...over,
});

const pipeline = (over: Partial<FleetPipeline> & Pick<FleetPipeline, "fleet" | "name">) =>
  ({
    id: `${over.fleet}/${over.name}`,
    signal: over.name.split("/")[0],
    receivers: [],
    exporters: [],
    in_rate: null,
    out_rate: null,
    failed_ratio: null,
    dropped_ratio: null,
    queue_ratio: null,
    issues: [],
    ...over,
  }) as FleetPipeline;

const logs = pipeline({
  fleet: "prod",
  name: "logs",
  receivers: [
    { name: "filelog", rate: 300, refused: 0 },
    { name: "otlp", rate: 100, refused: 0 },
  ],
  exporters: [exporter("otlphttp", "d_o2", 200, { failed: 50 }), exporter("s3", "d_s3", 400)],
  out_rate: 600,
});
const traces = pipeline({
  fleet: "prod",
  name: "traces",
  receivers: [{ name: "otlp", rate: 80, refused: 0 }],
  exporters: [exporter("otlphttp", "d_o2", 80)],
  out_rate: 80,
});

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

describe("buildPipelineMap", () => {
  it("lays out three columns: fleet, receiver, destination", () => {
    const map = buildPipelineMap([logs, traces], layout);
    const columns = ["fleet", "receiver", "destination"].map((c) =>
      map.nodes.filter((n) => n.column === c).map((n) => n.id),
    );
    expect(columns).toEqual([["f:prod"], ["r:prod|filelog", "r:prod|otlp"], ["d:d_o2", "d:d_s3"]]);
    const xs = columns.map((ids) => byId(map.nodes).get(ids[0])!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
  });

  it("splits a destination's rate over the receivers by their share of the pipeline input", () => {
    const edges = byId(buildPipelineMap([logs], layout).edges);
    expect(edges.get("rd:prod|filelog|d_o2|logs")?.rate).toBe(150);
    expect(edges.get("rd:prod|otlp|d_o2|logs")?.rate).toBe(50);
    expect(edges.get("rd:prod|filelog|d_s3|logs")?.rate).toBe(300);
  });

  it("merges every exporter sending to one destination, across fleets, into one node", () => {
    const prod = pipeline({
      fleet: "prod",
      name: "logs",
      receivers: [{ name: "otlp", rate: 100, refused: 0 }],
      exporters: [
        exporter("otlphttp/a", "d_o2", 60, { failed: 10, queue: 0.2 }),
        exporter("otlphttp/b", "d_o2", 40),
      ],
    });
    const edge = pipeline({
      fleet: "edge",
      name: "logs",
      receivers: [{ name: "otlp", rate: 30, refused: 0 }],
      exporters: [exporter("otlphttp/c", "d_o2", 30, { dropped: 5, queue: 0.9 })],
    });
    const map = buildPipelineMap([prod, edge], layout);
    expect(map.nodes.filter((n) => n.column === "destination").map((n) => n.id)).toEqual([
      "d:d_o2",
    ]);
    expect(byId(map.nodes).get("d:d_o2")).toMatchObject({
      rate: 130,
      failed: 10,
      dropped: 5,
      queue: 0.9,
      pipelines: ["prod/logs", "edge/logs"],
    });
    const edges = byId(map.edges);
    expect(edges.get("rd:prod|otlp|d_o2|logs")?.rate).toBe(100);
    expect(edges.get("rd:edge|otlp|d_o2|logs")?.rate).toBe(30);
  });

  it("keeps one line per signal, so a shared receiver and destination carry each signal apart", () => {
    const map = buildPipelineMap([logs, traces], layout);
    const edges = byId(map.edges);
    expect(edges.get("fr:prod|otlp|logs")?.rate).toBe(100);
    expect(edges.get("fr:prod|otlp|traces")?.rate).toBe(80);
    expect(edges.get("rd:prod|otlp|d_o2|logs")?.signal).toBe("logs");
    expect(edges.get("rd:prod|otlp|d_o2|traces")?.signal).toBe("traces");
    expect(byId(map.nodes).get("d:d_o2")?.rate).toBe(280);
    expect(byId(map.nodes).get("r:prod|otlp")?.rate).toBe(180);
    expect(byId(map.nodes).get("d:d_o2")?.pipelines).toEqual(["prod/logs", "prod/traces"]);
  });

  it("draws a failure branch off the failing destination with its failed share", () => {
    const map = buildPipelineMap([logs], layout);
    const branch = map.edges.find((e) => e.branch);
    expect(branch).toMatchObject({
      id: "br:d:d_o2",
      source: "d:d_o2",
      target: "x:d:d_o2",
      branch: { kind: "failed", ratio: 0.2 },
    });
    expect(map.edges.filter((e) => e.branch)).toHaveLength(1);
    const sink = byId(map.nodes).get("x:d:d_o2")!;
    const from = byId(map.nodes).get("d:d_o2")!;
    expect(sink.x).toBeGreaterThan(from.x);
    expect(sink.y).toBeGreaterThan(from.y);
  });

  it("keeps a failure branch and its label inside the canvas, past the last column", () => {
    const failing = buildPipelineMap([logs], layout).nodes;
    const healthy = buildPipelineMap([traces], layout).nodes;
    const x = (nodes: typeof failing, id: string) => byId(nodes).get(id)!.x;
    expect(x(healthy, "d:d_o2") + layout.nodeWidth).toBe(layout.width - 16);
    const sink = x(failing, "x:d:d_o2");
    expect(sink).toBeGreaterThan(x(failing, "d:d_o2") + layout.nodeWidth);
    expect(sink + 120).toBeLessThanOrEqual(layout.width);
  });

  it("reports the worst exporter's share, so a busy healthy fleet cannot hide a failing one", () => {
    const failing = pipeline({
      fleet: "edge",
      name: "logs",
      receivers: [{ name: "otlp", rate: 100, refused: 0 }],
      exporters: [exporter("otlphttp/a", "d_o2", 50, { failed: 50 })],
    });
    const healthy = pipeline({
      fleet: "prod",
      name: "logs",
      receivers: [{ name: "otlp", rate: 100000, refused: 0 }],
      exporters: [exporter("otlphttp/b", "d_o2", 100000)],
    });
    const map = buildPipelineMap([failing, healthy], layout);
    expect(byId(map.nodes).get("d:d_o2")?.failedRatio).toBe(0.5);
    expect(map.edges.find((e) => e.branch)?.branch).toEqual({ kind: "failed", ratio: 0.5 });
  });

  it("names a drop-only branch as dropped", () => {
    const dropping = pipeline({
      fleet: "edge",
      name: "metrics",
      receivers: [{ name: "hostmetrics", rate: 10, refused: 0 }],
      exporters: [exporter("otlp", "d_o2", 90, { dropped: 10 })],
    });
    const branch = buildPipelineMap([dropping], layout).edges.find((e) => e.branch);
    expect(branch?.branch).toEqual({ kind: "dropped", ratio: 0.1 });
  });

  it("counts a receiver fanned out to two pipelines of one signal once", () => {
    const copy = pipeline({ ...logs, name: "logs/copy", id: "prod/logs/copy" });
    const map = buildPipelineMap([logs, copy], layout);
    expect(byId(map.nodes).get("r:prod|filelog")?.rate).toBe(300);
  });

  it("keeps a missing rate null, and a receiver without rates shares equally", () => {
    const silent = pipeline({
      fleet: "edge",
      name: "logs",
      receivers: [
        { name: "a", rate: null, refused: 0 },
        { name: "b", rate: null, refused: 0 },
      ],
      exporters: [exporter("otlp", "d_o2", 10), exporter("debug", "d_dbg", null)],
    });
    const edges = byId(buildPipelineMap([silent], layout).edges);
    expect(edges.get("fr:edge|a|logs")?.rate).toBeNull();
    expect(edges.get("rd:edge|a|d_o2|logs")?.rate).toBe(5);
    expect(edges.get("rd:edge|a|d_dbg|logs")?.rate).toBeNull();
  });
});

describe("strokeWidth", () => {
  it("scales on a log curve between the minimum and the maximum", () => {
    expect(strokeWidth(null, 100)).toBe(MIN_WIDTH);
    expect(strokeWidth(0, 100)).toBe(MIN_WIDTH);
    expect(strokeWidth(100, 100)).toBe(MAX_WIDTH);
    const mid = strokeWidth(10, 100);
    expect(mid).toBeGreaterThan(MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) / 10);
    expect(mid).toBeLessThan(MAX_WIDTH);
  });
});
