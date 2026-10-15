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

import { describe, it, expect, vi, beforeAll } from "vitest";

// The Kubernetes loader renders from the org's live streams, so it reads the kind-cluster fixture here.
vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  const { k8sStreamList, k8sSchemaEntry } = await import("./__fixtures__/k8sStreams");
  return overlayServiceMock(await importOriginal(), {
    default: {
      nameList: vi.fn(async () => ({ data: { list: k8sStreamList() } })),
      schema: vi.fn(async (_org: string, name: string) => ({ data: k8sSchemaEntry(name) })),
    },
  });
});
vi.mock("@/utils/semanticGroupsCache", () => ({
  loadSemanticGroups: vi.fn(async () => []),
  clearSemanticGroupsCacheForOrg: vi.fn(),
  getCachedSemanticGroups: vi.fn(() => null),
}));

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
    it("lists the twelve sources in table order with their folders and titles", () => {
      expect(READY_MADE_SOURCES.map((s) => [s.id, s.folderName])).toEqual([
        ["kubernetes", "Kubernetes"],
        ["postgresql", "PostgreSQL"],
        ["mysql", "MySQL"],
        ["redis", "Redis"],
        ["otelcol", "OTel Collector"],
        ["mongodb", "MongoDB"],
        ["sqlserver", "SQL Server"],
        ["oracle", "Oracle"],
        ["kafka", "Kafka"],
        ["rabbitmq", "RabbitMQ"],
        ["nginx", "Nginx"],
        ["apache", "Apache"],
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
        mongoDB: "mongodb",
        sqlServer: "sqlserver",
        oracle: "oracle",
        kubernetes: "kubernetes",
      });
    });

    it.each([
      ["mongodb", "MongoDB / Overview", "mongodb", "o2:mongodb"],
      ["sqlserver", "SQL Server / Overview", "sqlserver", "o2:sqlserver"],
      ["oracle", "Oracle / Overview", "oracle", "o2:oracle"],
      ["kafka", "Kafka / Overview", "kafka", "o2:kafka"],
      ["rabbitmq", "RabbitMQ / Overview", "rabbitmq", "o2:rabbitmq"],
      ["nginx", "Nginx / Overview", "nginx", "o2:nginx"],
      ["apache", "Apache / Overview", "apache", "o2:apache"],
    ] as const)("%s has one overview, its setup route and glyph", (id, title, route, glyph) => {
      const source = getReadyMadeSource(id);
      expect(source.dashboards).toEqual([{ key: "overview", title }]);
      expect(source.setupRoute).toBe(route);
      expect(source.glyph).toBe(glyph);
    });

    it('takes "an" before the folder names that start with a vowel sound', () => {
      const an = READY_MADE_SOURCES.filter(
        (s) => s.folderSentenceKey === "dashboard.readyMade.folderSentenceOneAn",
      ).map((s) => s.id);
      expect(an).toEqual(["otelcol", "oracle", "nginx", "apache"]);
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

    it.each([
      ["mongodb", "mongodb_"],
      ["sqlserver", "sqlserver_"],
      ["oracle", "oracledb_"],
      ["kafka", "kafka_"],
      ["rabbitmq", "rabbitmq_"],
      ["nginx", "nginx_"],
      ["apache", "apache_"],
    ] as const)("%s needs two streams starting %s", (id, prefix) => {
      expect(detectReadyMadeSources([`${prefix}a`])).toEqual([]);
      expect(detectReadyMadeSources([`${prefix}a`, `${prefix}b`])).toEqual([id]);
    });

    it("does not take oracle_ for the oracledb receiver", () => {
      expect(detectReadyMadeSources(["oracle_a", "oracle_b"])).toEqual([]);
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

    it("finds all twelve at once, in catalog order", () => {
      const names = [
        "kube_pod_status_phase",
        "k8s_node_cpu_usage",
        ...["apache_", "nginx_", "rabbitmq_", "kafka_", "oracledb_", "sqlserver_", "mongodb_"]
          .concat(["otelcol_", "redis_", "mysql_", "postgresql_"])
          .flatMap((prefix) => [`${prefix}a`, `${prefix}b`]),
      ];
      expect(detectReadyMadeSources(names)).toEqual(READY_MADE_SOURCES.map((s) => s.id));
    });
  });

  describe("bundled content", () => {
    // The Kubernetes chunk pulls in the curated engine; a cold transform inside the test outlasts its timeout.
    beforeAll(() => import("./kubernetesDashboards"), 60_000);

    it.each([
      "postgresql",
      "mysql",
      "redis",
      "otelcol",
      "mongodb",
      "sqlserver",
      "oracle",
      "kafka",
      "rabbitmq",
      "nginx",
      "apache",
    ] as const)("%s loads one v8 document carrying its marker", async (id) => {
      const docs = await getReadyMadeSource(id).load("org");
      expect(docs).toHaveLength(1);
      expect(docs[0].version).toBe(8);
      expect(docs[0].title).toBe(getReadyMadeSource(id).dashboards[0].title);
      expect(docs[0].role).toBe(readyMadeMarker(id, "overview"));
      expect(docs[0].defaultDatetimeDuration.relativeTimePeriod).toBe("15m");
    });

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
