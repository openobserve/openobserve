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
  it("lays out four columns: fleet, receiver, exporter, destination", () => {
    const map = buildPipelineMap([logs, traces], layout);
    const columns = ["fleet", "receiver", "exporter", "destination"].map((c) =>
      map.nodes.filter((n) => n.column === c).map((n) => n.id),
    );
    expect(columns).toEqual([
      ["f:prod"],
      ["r:prod|filelog", "r:prod|otlp"],
      ["e:prod|otlphttp", "e:prod|s3"],
      ["d:d_o2", "d:d_s3"],
    ]);
    const xs = columns.map((ids) => byId(map.nodes).get(ids[0])!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(4);
  });

  it("splits an exporter's rate over the receivers by their share of the pipeline input", () => {
    const edges = byId(buildPipelineMap([logs], layout).edges);
    expect(edges.get("re:prod|filelog|otlphttp|logs")?.rate).toBe(150);
    expect(edges.get("re:prod|otlp|otlphttp|logs")?.rate).toBe(50);
    expect(edges.get("re:prod|filelog|s3|logs")?.rate).toBe(300);
  });

  it("keeps one line per signal, so a shared receiver and exporter carry each signal apart", () => {
    const map = buildPipelineMap([logs, traces], layout);
    const edges = byId(map.edges);
    expect(edges.get("fr:prod|otlp|logs")?.rate).toBe(100);
    expect(edges.get("fr:prod|otlp|traces")?.rate).toBe(80);
    expect(edges.get("ed:prod|otlphttp|d_o2|logs")?.signal).toBe("logs");
    expect(edges.get("ed:prod|otlphttp|d_o2|traces")?.signal).toBe("traces");
    expect(byId(map.nodes).get("e:prod|otlphttp")?.rate).toBe(280);
    expect(byId(map.nodes).get("r:prod|otlp")?.rate).toBe(180);
    expect(byId(map.nodes).get("e:prod|otlphttp")?.pipelines).toEqual(["prod/logs", "prod/traces"]);
  });

  it("draws a failure branch off the failing exporter with its failed share", () => {
    const map = buildPipelineMap([logs], layout);
    const branch = map.edges.find((e) => e.branch);
    expect(branch).toMatchObject({
      id: "br:e:prod|otlphttp",
      source: "e:prod|otlphttp",
      target: "x:e:prod|otlphttp",
      branch: { kind: "failed", ratio: 0.2 },
    });
    expect(map.edges.filter((e) => e.branch)).toHaveLength(1);
    const sink = byId(map.nodes).get("x:e:prod|otlphttp")!;
    const from = byId(map.nodes).get("e:prod|otlphttp")!;
    expect(sink.x).toBeGreaterThan(from.x);
    expect(sink.y).toBeGreaterThan(from.y);
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
    expect(edges.get("re:edge|a|otlp|logs")?.rate).toBe(5);
    expect(edges.get("re:edge|a|debug|logs")?.rate).toBeNull();
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
