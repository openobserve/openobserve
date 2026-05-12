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

/**
 * Centralised route-name → tab-value allow-lists.
 *
 * Usage:
 *   import { resolveTab } from "@/utils/routeTabMaps";
 *   const activeTab = ref(resolveTab("databases", routeName, "sqlserver"));
 *
 * Adding a new child route?  Add its entry to the relevant map here — one
 * place to update instead of hunting across multiple component files.
 */

/** Map keyed by the parent component / section name. */
const ROUTE_TAB_MAPS: Record<string, Record<string, string>> = {
  databases: {
    sqlserver: "sqlserver",
    postgres: "postgres",
    mongodb: "mongodb",
    redis: "redis",
    mysql: "mysql",
    oracle: "oracle",
    snowflake: "snowflake",
    zookeeper: "zookeeper",
    cassandra: "cassandra",
    aerospike: "aerospike",
    dynamodb: "dynamodb",
    databricks: "databricks",
  },

  devops: {
    jenkins: "jenkins",
    ansible: "ansible",
    terraform: "terraform",
    "github-actions": "github-actions",
  },

  languages: {
    python: "python",
    dotnettracing: "dotnettracing",
    dotnetlogs: "dotnetlogs",
    nodejs: "nodejs",
    go: "go",
  },

  "message-queues": {
    rabbitmq: "rabbitmq",
    kafka: "kafka",
    nats: "nats",
  },

  networking: {
    netflow: "netflow",
  },

  others: {
    airflow: "airflow",
    cribl: "cribl",
    vercel: "vercel",
    heroku: "heroku",
  },

  recommended: {
    ingestFromKubernetes: "ingestFromKubernetes",
    ingestFromWindows: "ingestFromWindows",
    ingestFromLinux: "ingestFromLinux",
    AWSConfig: "AWSConfig",
    GCPConfig: "GCPConfig",
    AzureConfig: "AzureConfig",
    ingestFromTraces: "ingestFromTraces",
    frontendMonitoring: "frontendMonitoring",
  },

  security: {
    falco: "falco",
    osquery: "osquery",
    okta: "okta",
    jumpcloud: "jumpcloud",
    openvpn: "openvpn",
    office365: "office365",
    "google-workspace": "google-workspace",
  },

  servers: {
    nginx: "nginx",
    iis: "iis",
  },

  /** ingestion/metrics/Index.vue */
  ingestMetrics: {
    prometheus: "prometheus",
    otelCollector: "otelCollector",
    telegraf: "telegraf",
    cloudwatchMetrics: "cloudwatchMetrics",
  },

  /** ingestion/logs/Index.vue */
  ingestLogs: {
    curl: "curl",
    filebeat: "filebeat",
    fluentbit: "fluentbit",
    fluentd: "fluentd",
    vector: "vector",
    ingestLogsFromOtel: "ingestLogsFromOtel",
    logstash: "logstash",
    syslogNg: "syslogNg",
  },

  /** enterprise/components/billings/Billing.vue */
  billings: {
    usage: "usage",
    plans: "plans",
    invoice_history: "invoice_history",
  },

  /** views/IdentityAccessManagement.vue */
  iam: {
    users: "users",
    serviceAccounts: "serviceAccounts",
    groups: "groups",
    roles: "roles",
    quota: "quota",
    organizations: "organizations",
    invitations: "invitations",
  },
};

/**
 * Resolve the active tab for a given section and current route name.
 *
 * @param section    - Key in ROUTE_TAB_MAPS (matches the parent route name).
 * @param routeName  - The current `router.currentRoute.value.name` value.
 * @param fallback   - Default tab to use when the route is not in the map.
 */
export function resolveTab(
  section: keyof typeof ROUTE_TAB_MAPS,
  routeName: string | null | undefined,
  fallback: string,
): string {
  const map = ROUTE_TAB_MAPS[section];
  return (map && routeName && map[routeName]) ? map[routeName] : fallback;
}

/** Expose the raw maps for consumers that need to iterate over valid tab names. */
export { ROUTE_TAB_MAPS };
