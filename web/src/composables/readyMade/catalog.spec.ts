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
import {
  READY_MADE_SOURCES,
  READY_MADE_SOURCE_BY_SETUP_SLUG,
  detectReadyMadeSources,
  getReadyMadeSource,
  parseReadyMadeMarker,
  readyMadeMarker,
  readyMadeTitleQuery,
} from "./catalog";

describe("ready-made catalog", () => {
  describe("shared contract", () => {
    it("lists the five sources in table order with their folders and titles", () => {
      expect(READY_MADE_SOURCES.map((s) => [s.id, s.folderName])).toEqual([
        ["kubernetes", "Kubernetes"],
        ["postgresql", "PostgreSQL"],
        ["mysql", "MySQL"],
        ["redis", "Redis"],
        ["otelcol", "OTel Collector"],
      ]);
      expect(getReadyMadeSource("kubernetes").dashboards).toEqual([
        { key: "cluster", title: "Kubernetes / Cluster" },
        { key: "node", title: "Kubernetes / Node" },
        { key: "pod", title: "Kubernetes / Pod" },
        { key: "workload", title: "Kubernetes / Workload" },
      ]);
      expect(getReadyMadeSource("otelcol").dashboards).toEqual([
        { key: "overview", title: "OTel Collector / Overview" },
      ]);
    });

    it("every title starts with the source's title query, so one search finds them all", () => {
      for (const source of READY_MADE_SOURCES) {
        for (const ref of source.dashboards) {
          expect(ref.title.startsWith(readyMadeTitleQuery(source))).toBe(true);
        }
      }
    });

    it("maps setup-card slugs, MariaDB onto mysql", () => {
      expect(READY_MADE_SOURCE_BY_SETUP_SLUG).toEqual({
        postgres: "postgresql",
        mySQL: "mysql",
        mariaDB: "mysql",
        redis: "redis",
        kubernetes: "kubernetes",
      });
    });
  });

  describe("marker", () => {
    it("round-trips the role marker", () => {
      expect(readyMadeMarker("postgresql", "overview")).toBe("ready-made:postgresql/overview:1");
      expect(parseReadyMadeMarker("ready-made:kubernetes/cluster:1")).toEqual({
        sourceId: "kubernetes",
        key: "cluster",
        version: 1,
      });
    });

    it.each([
      "",
      "admin",
      "ready-made:unknown/overview:1",
      "ready-made:postgresql/overview",
      "ready-made:postgresql:1",
      null,
      42,
    ])("rejects %s", (role) => {
      expect(parseReadyMadeMarker(role)).toBeNull();
    });
  });

  describe("detection rules", () => {
    it("needs at least two prefixed streams for the database and collector sources", () => {
      expect(detectReadyMadeSources(["postgresql_backends"])).toEqual([]);
      expect(detectReadyMadeSources(["postgresql_backends", "postgresql_commits"])).toEqual([
        "postgresql",
      ]);
      expect(detectReadyMadeSources(["mysql_threads", "mysql_operations"])).toEqual(["mysql"]);
      expect(detectReadyMadeSources(["redis_clients_connected", "redis_commands"])).toEqual([
        "redis",
      ]);
      expect(detectReadyMadeSources(["otelcol_process_uptime", "otelcol_exporter_sent"])).toEqual([
        "otelcol",
      ]);
    });

    it("matches a prefix, not a substring", () => {
      expect(detectReadyMadeSources(["my_postgresql_a", "x_postgresql_b"])).toEqual([]);
    });

    it("needs BOTH Kubernetes signature streams", () => {
      expect(detectReadyMadeSources(["kube_pod_status_phase"])).toEqual([]);
      expect(detectReadyMadeSources(["k8s_node_cpu_usage", "k8s_pod_cpu_usage"])).toEqual([]);
      expect(detectReadyMadeSources(["k8s_node_cpu_usage", "kube_pod_status_phase"])).toEqual([
        "kubernetes",
      ]);
    });

    it("returns every hit in catalog order", () => {
      expect(
        detectReadyMadeSources([
          "redis_a",
          "redis_b",
          "postgresql_a",
          "postgresql_b",
          "kube_pod_status_phase",
          "k8s_node_cpu_usage",
        ]),
      ).toEqual(["kubernetes", "postgresql", "redis"]);
    });
  });

  describe("bundled content", () => {
    it.each(["postgresql", "mysql", "redis", "otelcol"] as const)(
      "%s loads one v8 document carrying its marker",
      async (id) => {
        const docs = await getReadyMadeSource(id).load("org");
        expect(docs).toHaveLength(1);
        expect(docs[0].version).toBe(8);
        expect(docs[0].title).toBe(getReadyMadeSource(id).dashboards[0].title);
        expect(docs[0].role).toBe(readyMadeMarker(id, "overview"));
      },
    );

    it("Kubernetes renders four documents in table order", async () => {
      const docs = await getReadyMadeSource("kubernetes").load("org");
      expect(docs.map((doc) => doc.title)).toEqual(
        getReadyMadeSource("kubernetes").dashboards.map((ref) => ref.title),
      );
      expect(docs.map((doc) => doc.role)).toEqual(
        ["cluster", "node", "pod", "workload"].map((key) => readyMadeMarker("kubernetes", key)),
      );
    });
  });
});
