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

import type { StreamsByType } from "@/types/alertLibrary";

import { detectedStreams } from "./packDetect";
import type { StarterPack } from "./types";

const pack = (over: Partial<StarterPack>) => ({ id: "p", ...over }) as StarterPack;
const org = (byType: Record<string, string[]>): StreamsByType =>
  Object.fromEntries(
    Object.entries(byType).map(([type, names]) => [type, new Map(names.map((n) => [n, 1]))]),
  );
const noColumns = vi.fn(async () => [] as string[]);

describe("detectedStreams", () => {
  it("finds the metric names a pack lists, any spelling of a signal", async () => {
    const hosts = pack({ signals: [["system_cpu_time", "node_cpu"], ["system_memory_usage"]] });
    const streams = org({ metrics: ["node_cpu", "system_memory_usage", "other"] });
    expect(await detectedStreams(hosts, streams, noColumns)).toEqual([
      "node_cpu",
      "system_memory_usage",
    ]);
    expect(await detectedStreams(hosts, org({ metrics: ["other"] }), noColumns)).toEqual([]);
  });

  it("finds any stream of a type when the pack names none", async () => {
    const traces = pack({ detectStreams: [{ type: "traces" }] });
    expect(await detectedStreams(traces, org({ traces: ["default", "edge"] }), noColumns)).toEqual([
      "default",
      "edge",
    ]);
    expect(await detectedStreams(traces, org({ logs: ["default"] }), noColumns)).toEqual([]);
  });

  it("finds only the named stream of the named type", async () => {
    const cloudwatch = pack({ detectStreams: [{ type: "logs", name: "cloudwatch_metrics" }] });
    const streams = org({ logs: ["cloudwatch_metrics", "web"], metrics: ["cloudwatch_metrics"] });
    expect(await detectedStreams(cloudwatch, streams, noColumns)).toEqual(["cloudwatch_metrics"]);
    expect(
      await detectedStreams(cloudwatch, org({ metrics: ["cloudwatch_metrics"] }), noColumns),
    ).toEqual([]);
  });

  it("keeps only streams whose schema holds every listed field", async () => {
    const genai = pack({ detectStreams: [{ type: "traces", fields: ["gen_ai_operation_name"] }] });
    const columns: Record<string, string[]> = {
      llm: ["trace_id", "gen_ai_operation_name"],
      web: ["trace_id", "http_method"],
    };
    const read = vi.fn(async (_type: string, name: string) => columns[name] ?? []);
    const streams = org({ traces: ["llm", "web"], logs: ["llm_logs"] });
    expect(await detectedStreams(genai, streams, read)).toEqual(["llm"]);
    expect(read.mock.calls).toEqual([
      ["traces", "llm"],
      ["traces", "web"],
    ]);
    expect(await detectedStreams(genai, org({ traces: ["web"] }), read)).toEqual([]);
  });

  it("reads no schema for a pack that lists no fields", async () => {
    const read = vi.fn(async () => ["x"]);
    await detectedStreams(
      pack({ detectStreams: [{ type: "traces" }] }),
      org({ traces: ["t"] }),
      read,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("treats a stream whose schema read fails as not fitting", async () => {
    const genai = pack({ detectStreams: [{ type: "traces", fields: ["gen_ai_operation_name"] }] });
    const read = vi.fn(async (_type: string, name: string) => {
      if (name === "down") throw new Error("down");
      return ["gen_ai_operation_name"];
    });
    expect(await detectedStreams(genai, org({ traces: ["down", "llm"] }), read)).toEqual(["llm"]);
  });

  it("finds Kubernetes by its detection streams", async () => {
    const kubernetes = pack({ detector: "kubernetes" });
    expect(
      await detectedStreams(
        kubernetes,
        org({ metrics: ["kube_pod_status_phase", "x"] }),
        noColumns,
      ),
    ).toEqual(["kube_pod_status_phase"]);
    expect(
      await detectedStreams(kubernetes, org({ metrics: ["system_cpu_time"] }), noColumns),
    ).toEqual([]);
  });

  it("finds nothing for a pack with no detection rule", async () => {
    expect(await detectedStreams(pack({}), org({ metrics: ["a"] }), noColumns)).toEqual([]);
  });
});
