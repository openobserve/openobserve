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
  identityVerdict,
  metricCandidates,
  repairMetric,
  repairRole,
  type StreamFacts,
} from "./streamCandidates";
import type { PackStreamRole } from "./types";

const NOW = 2_000_000_000_000;
const sources = { groups: [], aliases: [] };
const stream = (name: string, columns: string[], ageHours = 1): StreamFacts => ({
  name,
  columns: new Set(columns),
  lastIngested: (NOW - ageHours * 3_600_000) * 1000,
});
const labels = ["k8s_cluster", "namespace", "deployment"];

const role: PackStreamRole = {
  id: "events",
  titleKey: "starterPacks.kubernetes.title",
  stream: "k8s_events",
  fields: ["kind", "reason", "namespace"],
  identity: [
    { field: "instrumentation_library_name", pattern: "k8sobjects" },
    { field: "service_name", pattern: "^k8s-events$" },
  ],
};
const eventColumns = ["kind", "reason", "namespace"];

describe("metric candidates", () => {
  const want = { name: "kube_deployment_spec_replicas", fields: labels, used: new Set<string>() };

  it("kube_node_status_condition must not match a deployment alert", () => {
    const streams = [stream("kube_node_status_condition", [...labels, "condition"])];
    expect(metricCandidates(want, streams, sources, NOW)).toEqual([]);
    expect(repairMetric(want, streams, sources, NOW)).toEqual({ repair: undefined });
  });

  it("offers a same-entity metric but never fixes it without asking", () => {
    const streams = [stream("kube_deployment_status_replicas", labels)];
    const { repair, question } = repairMetric(want, streams, sources, NOW);
    expect(repair).toBeUndefined();
    expect(question?.candidates.map((row) => row.stream)).toEqual([
      "kube_deployment_status_replicas",
    ]);
    expect(question?.answer).toBeUndefined();
  });

  it("refuses a metric the query already uses", () => {
    const used = new Set(["kube_deployment_status_replicas"]);
    const streams = [stream("kube_deployment_status_replicas", labels)];
    expect(repairMetric({ ...want, used }, streams, sources, NOW).question).toBeUndefined();
  });

  it("refuses a strict rename the query already uses", () => {
    const used = new Set(["Kube_Deployment_Spec_Replicas"]);
    const streams = [stream("Kube_Deployment_Spec_Replicas", labels)];
    expect(repairMetric({ ...want, used }, streams, sources, NOW).repair).toBeUndefined();
  });

  it.each([
    "KUBE_DEPLOYMENT_SPEC_REPLICAS",
    "kube_deployment_spec_replicas_total",
    "otel_kube_deployment_spec_replicas",
  ])("fixes the strict rename %s on its own", (name) => {
    const { repair } = repairMetric(want, [stream(name, labels)], sources, NOW);
    expect(repair).toEqual({ from: want.name, to: name });
  });

  it("offers a strict rename outside the entity prefix, so Change has a choice", () => {
    const name = "otel_kube_deployment_spec_replicas";
    const { question } = repairMetric(want, [stream(name, labels)], sources, NOW);
    expect(question?.answer).toEqual({ from: want.name, to: name });
    expect(question?.candidates.map((row) => row.stream)).toEqual([name]);
  });

  it("ignores a stream silent for more than a day", () => {
    const streams = [stream("KUBE_DEPLOYMENT_SPEC_REPLICAS", labels, 30)];
    expect(repairMetric(want, streams, sources, NOW).repair).toBeUndefined();
  });
});

describe("log roles", () => {
  const agree = { instrumentation_library_name: ["otel/k8sobjectsreceiver"] };

  it("reads identity values as agreeing, mixed or silent", () => {
    expect(identityVerdict(role, agree)).toBe("agrees");
    expect(identityVerdict(role, { service_name: ["k8s-events", "web"] })).toBe("mixed");
    expect(identityVerdict(role, { service_name: ["web"] })).toBe("none");
  });

  it("fixes one stream that agrees on identity", () => {
    const question = repairRole(
      role,
      [stream("cluster_events", eventColumns)],
      { cluster_events: agree },
      sources,
      NOW,
    );
    expect(question.answer).toEqual({ from: "k8s_events", to: "cluster_events" });
  });

  it("asks when fields match but no identity agrees", () => {
    const question = repairRole(role, [stream("edge", eventColumns)], {}, sources, NOW);
    expect(question).toMatchObject({ kind: "confirm", answer: undefined });
  });

  it("asks once with every close match", () => {
    const streams = [stream("events_eu", eventColumns), stream("events_us", eventColumns)];
    const values = { events_eu: agree, events_us: agree };
    const question = repairRole(role, streams, values, sources, NOW);
    expect(question.candidates).toHaveLength(2);
    expect(question.answer).toBeUndefined();
  });

  it("always asks for a shared stream and offers its top values", () => {
    const values = {
      default: { service_name: ["web", "k8s-events", "api"], instrumentation_library_name: [] },
    };
    const question = repairRole(role, [stream("default", eventColumns)], values, sources, NOW);
    expect(question).toMatchObject({
      kind: "shared",
      filters: { default: { field: "service_name", values: ["web", "k8s-events", "api"] } },
    });
    expect(question.answer).toBeUndefined();
  });

  it("asks which shared stream when several are close, each with its own values", () => {
    const streams = [stream("default", eventColumns), stream("mixed_logs", eventColumns)];
    const values = {
      default: { service_name: ["web", "k8s-events"] },
      mixed_logs: { service_name: ["api", "k8s-events"] },
    };
    const question = repairRole(role, streams, values, sources, NOW);
    expect(question.kind).toBe("shared");
    expect(question.candidates.map((row) => row.stream).sort()).toEqual(["default", "mixed_logs"]);
    expect(question.filters?.mixed_logs).toEqual({
      field: "service_name",
      values: ["api", "k8s-events"],
    });
  });

  it("keeps a shared stream out of a list where it would lose its filter", () => {
    const streams = [stream("default", eventColumns), stream("events_eu", eventColumns)];
    const values = { default: { service_name: ["web"] }, events_eu: agree };
    const question = repairRole(role, streams, values, sources, NOW);
    expect(question.candidates.map((row) => row.stream)).toEqual(["events_eu"]);
    expect(question.answer).toBeUndefined();
  });

  it("falls to the picker with field matches when nothing is close", () => {
    const question = repairRole(role, [stream("noise", ["kind"])], {}, sources, NOW);
    expect(question.kind).toBe("none");
    expect(question.candidates[0]).toMatchObject({ stream: "noise", matched: 1, total: 3 });
  });
});
