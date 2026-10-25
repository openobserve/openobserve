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

import type { I18nKey } from "@/types/i18n";
import type { IconToken } from "@/lib/forms/EmojiPicker/OGlyph.types";

export type ReadyMadeSourceId =
  | "kubernetes"
  | "postgresql"
  | "mysql"
  | "redis"
  | "otelcol"
  | "mongodb"
  | "sqlserver"
  | "oracle"
  | "kafka"
  | "rabbitmq"
  | "nginx"
  | "apache";

export interface ReadyMadeDashboardRef {
  /** Stable key inside the marker, e.g. `cluster` in `ready-made:kubernetes/cluster:1`. */
  key: string;
  /** Pinned title; the marked-copy lookup searches by it. */
  title: string;
}

export interface ReadyMadeSource {
  id: ReadyMadeSourceId;
  /** Product name, never translated. */
  name: string;
  /** Exact name of the folder the dashboards install into (reused when it exists). */
  folderName: string;
  /** Brand glyph for the dialog row and the folder created at install. */
  glyph: IconToken;
  /** Dashboards in install order; the first one is what "Add" opens. */
  dashboards: ReadyMadeDashboardRef[];
  /** Data-source setup page for the "Set up" link. */
  setupRoute: string;
  /** Banner question for a single source. */
  askKey: I18nKey;
  /** Banner sentence naming the destination folder. */
  folderSentenceKey: I18nKey;
  /** Dialog row contents line. */
  contentsKey: I18nKey;
  /** Dashboard documents in the same order as `dashboards`, loaded only at install. */
  load: (orgId: string) => Promise<Record<string, any>[]>;
}

/** Marker schema version written into every installed dashboard's `role`. */
export const READY_MADE_MARKER_VERSION = 1;

export const READY_MADE_SOURCES: readonly ReadyMadeSource[] = [
  {
    id: "kubernetes",
    name: "Kubernetes",
    folderName: "Kubernetes",
    glyph: "o2:kubernetes",
    dashboards: [
      { key: "cluster", title: "Kubernetes / Cluster" },
      { key: "node", title: "Kubernetes / Node" },
      { key: "pod", title: "Kubernetes / Pod" },
      { key: "workload", title: "Kubernetes / Workload" },
    ],
    setupRoute: "ingestFromKubernetes",
    askKey: "dashboard.readyMade.askKubernetes",
    folderSentenceKey: "dashboard.readyMade.folderSentenceKubernetes",
    contentsKey: "dashboard.readyMade.contentsKubernetes",
    // Lazy: the curated pack it renders from stays out of the Dashboards chunk.
    load: (orgId) =>
      import("./kubernetesDashboards").then((m) => m.buildKubernetesDashboards(orgId)),
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    folderName: "PostgreSQL",
    glyph: "o2:postgresql",
    dashboards: [{ key: "overview", title: "PostgreSQL / Overview" }],
    setupRoute: "postgres",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/postgresql.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "mysql",
    name: "MySQL",
    folderName: "MySQL",
    glyph: "o2:mysql",
    dashboards: [{ key: "overview", title: "MySQL / Overview" }],
    setupRoute: "mysql",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/mysql.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "redis",
    name: "Redis",
    folderName: "Redis",
    glyph: "o2:redis",
    dashboards: [{ key: "overview", title: "Redis / Overview" }],
    setupRoute: "redis",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/redis.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "otelcol",
    name: "OTel Collector",
    folderName: "OTel Collector",
    glyph: "o2:opentelemetry",
    dashboards: [{ key: "overview", title: "OTel Collector / Overview" }],
    setupRoute: "otelCollector",
    askKey: "dashboard.readyMade.askOne",
    // "an OTel": the article follows the sound, which a {folder} slot can't pick.
    folderSentenceKey: "dashboard.readyMade.folderSentenceOneAn",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/otel_collector.dashboard.json").then((m) => [
        m.default,
      ]),
  },
  {
    id: "mongodb",
    name: "MongoDB",
    folderName: "MongoDB",
    glyph: "o2:mongodb",
    dashboards: [{ key: "overview", title: "MongoDB / Overview" }],
    setupRoute: "mongodb",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/mongodb.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "sqlserver",
    name: "SQL Server",
    folderName: "SQL Server",
    glyph: "o2:sqlserver",
    dashboards: [{ key: "overview", title: "SQL Server / Overview" }],
    setupRoute: "sqlserver",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/sqlserver.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "oracle",
    name: "Oracle",
    folderName: "Oracle",
    glyph: "o2:oracle",
    dashboards: [{ key: "overview", title: "Oracle / Overview" }],
    setupRoute: "oracle",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOneAn",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/oracle.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "kafka",
    name: "Kafka",
    folderName: "Kafka",
    glyph: "o2:kafka",
    dashboards: [{ key: "overview", title: "Kafka / Overview" }],
    setupRoute: "kafka",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/kafka.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    folderName: "RabbitMQ",
    glyph: "o2:rabbitmq",
    dashboards: [{ key: "overview", title: "RabbitMQ / Overview" }],
    setupRoute: "rabbitmq",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOne",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/rabbitmq.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "nginx",
    name: "Nginx",
    folderName: "Nginx",
    glyph: "o2:nginx",
    dashboards: [{ key: "overview", title: "Nginx / Overview" }],
    setupRoute: "nginx",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOneAn",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/nginx.dashboard.json").then((m) => [m.default]),
  },
  {
    id: "apache",
    name: "Apache",
    folderName: "Apache",
    glyph: "o2:apache",
    dashboards: [{ key: "overview", title: "Apache / Overview" }],
    setupRoute: "apache",
    askKey: "dashboard.readyMade.askOne",
    folderSentenceKey: "dashboard.readyMade.folderSentenceOneAn",
    contentsKey: "dashboard.readyMade.contentsOne",
    load: () =>
      import("@/assets/dashboards/ready-made/apache.dashboard.json").then((m) => [m.default]),
  },
];

/** Detection over metrics stream NAMES only; edit a line here to adjust a source's signature. */
export type ReadyMadeDetectionRule =
  | { source: ReadyMadeSourceId; prefix: string; min: number }
  | { source: ReadyMadeSourceId; allOf: string[] };

export const READY_MADE_DETECTION_RULES: readonly ReadyMadeDetectionRule[] = [
  // Both: Test can pass on logs alone, and without these two the Cluster dashboard opens half-empty.
  { source: "kubernetes", allOf: ["kube_pod_status_phase", "k8s_node_cpu_usage"] },
  { source: "postgresql", prefix: "postgresql_", min: 2 },
  { source: "mysql", prefix: "mysql_", min: 2 },
  { source: "redis", prefix: "redis_", min: 2 },
  { source: "otelcol", prefix: "otelcol_", min: 2 },
  { source: "mongodb", prefix: "mongodb_", min: 2 },
  { source: "sqlserver", prefix: "sqlserver_", min: 2 },
  { source: "oracle", prefix: "oracledb_", min: 2 },
  { source: "kafka", prefix: "kafka_", min: 2 },
  { source: "rabbitmq", prefix: "rabbitmq_", min: 2 },
  { source: "nginx", prefix: "nginx_", min: 2 },
  { source: "apache", prefix: "apache_", min: 2 },
];

/** Setup-card slugs whose Test installs a ready-made source; MariaDB speaks the mysql receiver. */
export const READY_MADE_SOURCE_BY_SETUP_SLUG: Readonly<Record<string, ReadyMadeSourceId>> = {
  postgres: "postgresql",
  mySQL: "mysql",
  mariaDB: "mysql",
  redis: "redis",
  mongoDB: "mongodb",
  sqlServer: "sqlserver",
  oracle: "oracle",
  kubernetes: "kubernetes",
};

const MARKER_PATTERN = /^ready-made:([a-z0-9_-]+)\/([a-z0-9_-]+):(\d+)$/;

export function getReadyMadeSource(id: ReadyMadeSourceId): ReadyMadeSource {
  return READY_MADE_SOURCES.find((source) => source.id === id)!;
}

export function readyMadeMarker(
  sourceId: ReadyMadeSourceId,
  key: string,
  version: number = READY_MADE_MARKER_VERSION,
): string {
  return `ready-made:${sourceId}/${key}:${version}`;
}

export function parseReadyMadeMarker(
  role: unknown,
): { sourceId: ReadyMadeSourceId; key: string; version: number } | null {
  if (typeof role !== "string") return null;
  const match = MARKER_PATTERN.exec(role.trim());
  if (!match) return null;
  const sourceId = match[1] as ReadyMadeSourceId;
  if (!READY_MADE_SOURCES.some((source) => source.id === sourceId)) return null;
  return { sourceId, key: match[2], version: Number(match[3]) };
}

/** The search string that finds every dashboard of a source (titles share "<Name> /"). */
export function readyMadeTitleQuery(source: ReadyMadeSource): string {
  return `${source.name} /`;
}

function ruleMatches(rule: ReadyMadeDetectionRule, names: ReadonlySet<string>): boolean {
  if ("allOf" in rule) return rule.allOf.every((name) => names.has(name));
  let count = 0;
  for (const name of names) {
    if (name.startsWith(rule.prefix)) count += 1;
    if (count >= rule.min) return true;
  }
  return false;
}

/** Sources whose rule passes, in catalog order. */
export function detectReadyMadeSources(metricNames: readonly string[]): ReadyMadeSourceId[] {
  const names = new Set(metricNames);
  const hits = new Set(
    READY_MADE_DETECTION_RULES.filter((rule) => ruleMatches(rule, names)).map(
      (rule) => rule.source,
    ),
  );
  return READY_MADE_SOURCES.filter((source) => hits.has(source.id)).map((source) => source.id);
}
