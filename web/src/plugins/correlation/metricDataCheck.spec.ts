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
import { findNoDataMetricStreams, metricExistenceSql, metricProbeTargets } from "./metricDataCheck";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import type { StreamInfo } from "@/services/service_streams";

const stream = (name: string, has_data?: boolean): StreamInfo => ({
  stream_name: name,
  stream_type: "metrics",
  ...(has_data === undefined ? {} : { has_data }),
});

describe("metricExistenceSql", () => {
  it("reads one row under the chart's WHERE", () => {
    expect(metricExistenceSql("cpu", "a = 'x'")).toBe(
      `SELECT _timestamp FROM "cpu" WHERE a = 'x' LIMIT 1`,
    );
    expect(metricExistenceSql("cpu", "")).toBe(`SELECT _timestamp FROM "cpu" LIMIT 1`);
  });
});

describe("findNoDataMetricStreams", () => {
  it("trusts has_data false and true without probing", async () => {
    const probe = vi.fn();
    const result = await findNoDataMetricStreams({
      streams: [stream("empty", false), stream("full", true)],
      probe,
    });
    expect([...(result ?? [])]).toEqual(["empty"]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes only streams without has_data", async () => {
    const probe = vi.fn(async (s: StreamInfo) => s.stream_name === "a");
    const result = await findNoDataMetricStreams({
      streams: [stream("a"), stream("b"), stream("c", true)],
      probe,
    });
    expect([...(result ?? [])]).toEqual(["b"]);
    expect(probe.mock.calls.map((c) => c[0].stream_name).sort()).toEqual(["a", "b"]);
  });

  it("returns null when every probe fails, so the selection stays as today", async () => {
    const result = await findNoDataMetricStreams({
      streams: [stream("a"), stream("b")],
      probe: async () => {
        throw new Error("boom");
      },
    });
    expect(result).toBeNull();
  });

  it("keeps a stream whose probe failed out of the no-data set", async () => {
    const result = await findNoDataMetricStreams({
      streams: [stream("a"), stream("b")],
      probe: async (s) => {
        if (s.stream_name === "a") throw new Error("boom");
        return false;
      },
    });
    expect([...(result ?? [])]).toEqual(["b"]);
  });

  it("runs at most `concurrency` probes at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await findNoDataMetricStreams({
      streams: Array.from({ length: 9 }, (_, i) => stream(`s${i}`)),
      concurrency: 3,
      probe: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return true;
      },
    });
    expect(peak).toBe(3);
  });

  it("returns null once aborted", async () => {
    const controller = new AbortController();
    const result = await findNoDataMetricStreams({
      streams: [stream("a"), stream("b")],
      signal: controller.signal,
      probe: async () => {
        controller.abort();
        return false;
      },
    });
    expect(result).toBeNull();
  });
});

describe("metricProbeTargets", () => {
  const groups = [{ id: "k8s-pod", display: "Pod", fields: ["k8s_pod_name", "pod_name"] }];
  const served: StreamInfo = {
    stream_name: "cpu",
    stream_type: "metrics",
    filters: { k8s_pod_name: "p1" },
    has_data: false,
  };
  const schemas = { cpu: { schema: [{ name: "k8s_pod_name" }] } };

  it("keeps the server's answer when the chart runs the served filters", () => {
    const [target] = metricProbeTargets([served], (s) => s, {
      matchedDimensions: {},
      semanticGroups: groups,
      metricSchemas: schemas,
    });
    expect(target.where).toContain("'p1'");
    expect(target.stream.has_data).toBe(false);
  });

  it("probes with the subject override the chart applies once the schema is loaded", () => {
    const [target] = metricProbeTargets([served], (s) => s, {
      matchedDimensions: { "k8s-pod": "p2" },
      semanticGroups: groups,
      metricSchemas: schemas,
    });
    expect(target.where).toContain("'p2'");
    expect(target.where).not.toContain("'p1'");
    expect(target.stream.has_data).toBeUndefined();
  });

  it("applies no override before the schema loads, as the chart does", () => {
    const [target] = metricProbeTargets([served], (s) => s, {
      matchedDimensions: { "k8s-pod": "p2" },
      semanticGroups: groups,
      metricSchemas: {},
    });
    expect(target.where).toContain("'p1'");
    expect(target.stream.has_data).toBe(false);
  });

  it("probes the charted copy when its filters differ from the served ones", () => {
    const [target] = metricProbeTargets(
      [served],
      (s) => ({ ...s, filters: { k8s_pod_name: SELECT_ALL_VALUE } }),
      { matchedDimensions: {}, semanticGroups: groups, metricSchemas: schemas },
    );
    expect(target.where).toBe("");
    expect(target.stream.has_data).toBeUndefined();
  });
});
