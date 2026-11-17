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

import { packStreams } from "./packStreams";
import type { StarterPack } from "./types";
import { packById } from "./usePackCatalog";

const HOSTS_PACK = packById("hosts")!;
const KUBERNETES_PACK = packById("kubernetes")!;

const names = (rows: { name: string }[]) => rows.map(({ name }) => name);

describe("packStreams", () => {
  it("gives a pack with no alerts health from its signals", () => {
    const rows = packStreams(HOSTS_PACK);
    expect(names(rows)).toEqual(HOSTS_PACK.signals?.flat());
    expect(rows.find(({ name }) => name === "node_cpu_seconds_total")?.signal).toBe(
      "system_cpu_time",
    );
    expect(rows.every(({ type, signal }) => type === "metrics" && signal)).toBe(true);
  });

  it("reads the matched flavour's alert streams, the role stream and the saved view stream", () => {
    const rows = packStreams(KUBERNETES_PACK, { flavourIds: ["opentelemetry"] });
    expect(names(rows)).toEqual(
      expect.arrayContaining([
        "k8s_container_cpu_request",
        "k8s_node_allocatable_cpu",
        "k8s_pod_phase",
        "k8s_events",
      ]),
    );
    expect(rows.find(({ name }) => name === "k8s_events")?.type).toBe("logs");
  });

  it("keeps only the alerts the install made", () => {
    const rows = packStreams(KUBERNETES_PACK, {
      flavourIds: ["opentelemetry"],
      alertIds: ["k8s/cluster_pod_count_high"],
    });
    expect(names(rows)).toContain("k8s_pod_phase");
    expect(names(rows)).not.toContain("k8s_container_cpu_request");
  });

  it("falls back to the bundled Library streams without a matched flavour", () => {
    const entry = KUBERNETES_PACK.bundledAlerts![0].entry;
    const rows = packStreams(KUBERNETES_PACK, { alertIds: [entry.id] });
    expect(names(rows)).toEqual(expect.arrayContaining(entry.required_streams));
  });

  it("adds dashboard streams untyped and lets a typed mention win", () => {
    const rows = packStreams(HOSTS_PACK, {
      dashboardStreams: ["system_cpu_time", "disk_io"],
    });
    expect(rows.find(({ name }) => name === "system_cpu_time")?.type).toBe("metrics");
    expect(rows.find(({ name }) => name === "disk_io")).toEqual({ name: "disk_io", type: "" });
  });

  it("follows a repair to the streams the items read now", () => {
    const rows = packStreams(KUBERNETES_PACK, {
      flavourIds: ["opentelemetry"],
      repairs: [{ from: "k8s_events", to: "events_a", also: ["events_b"] }],
    });
    expect(names(rows)).toEqual(expect.arrayContaining(["events_a", "events_b"]));
    expect(names(rows)).not.toContain("k8s_events");
  });

  it("lists each stream once", () => {
    const rows = packStreams(KUBERNETES_PACK, {
      flavourIds: ["opentelemetry"],
      alertStreams: [{ name: "k8s_pod_phase", type: "metrics" }],
    });
    expect(names(rows).filter((name) => name === "k8s_pod_phase")).toHaveLength(1);
  });

  it("adds the streams a pack is detected by name, but not a type-only rule", () => {
    const pack = {
      ...HOSTS_PACK,
      signals: undefined,
      detectStreams: [{ type: "logs", name: "cloudwatch_metrics" }, { type: "traces" }],
    } as StarterPack;
    expect(packStreams(pack)).toEqual([{ name: "cloudwatch_metrics", type: "logs" }]);
  });
});
