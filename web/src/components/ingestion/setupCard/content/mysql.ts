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

// MySQL data-source setup card. Requires MySQL 8.0+.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";
import {
  DBM_CONTRIB_VERSION,
  MYSQL_DBM_CONFIG_YAML,
  MYSQL_DBM_GRANT_SQL,
  dbmVerifyStep,
} from "./dbmShared";

const USER_SQL = `CREATE USER 'otel'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT SELECT, PROCESS, REPLICATION CLIENT ON *.* TO 'otel'@'localhost';
FLUSH PRIVILEGES;`;

const applyUser = (connect: string) => `${connect} -e "
${USER_SQL}
"`;

// The `sqlquery/mysql_limits` receiver exists because mysqlreceiver publishes
// no `max_connections`, so without it the Databases page can only show a
// connection COUNT, never a saturation percentage.
//
// CRITICAL: `mysql_instance_endpoint` must be BOTH projected in the SQL and
// listed in `attribute_columns`, spelled to match mysqlreceiver's own
// `mysql.instance.endpoint` attribute — the read side rejects the stream as
// unreadable when its identity column is missing (instanceMetricsRead.ts).
const CONFIG_YAML = `receivers:
  mysql:
    endpoint: "{host}:{port}"
    username: otel
    password: \${env:MYSQL_PASSWORD}
    database: otel
    collection_interval: 10s
    initial_delay: 1s
  sqlquery/mysql_limits:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    queries:
      - sql: "SELECT @@max_connections AS max_connections, '{host}:{port}' AS mysql_instance_endpoint"
        metrics:
          - metric_name: mysql.connection.max
            value_column: max_connections
            attribute_columns: [mysql_instance_endpoint]
            value_type: int
            data_type: gauge

processors:
  batch:
    send_batch_size: 10000
    timeout: 10s

exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}
      stream-name: default

service:
  pipelines:
    metrics:
      receivers: [mysql, sqlquery/mysql_limits]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function mysqlCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: raw("MySQL"),
      tagline: t("ingestion.setupCard.mysqlTagline"),
      logo: getImageURL("images/ingestion/mysql.svg"),
      tone: "#00758F",
      // Logs too: the optional Database Monitoring steps ship deadlock and
      // blocking events into the dbm_server logs stream.
      metaBadges: [t("common.metrics"), t("common.logs")],
    },
    steps: [
      {
        id: "prepare",
        titleKey: "ingestion.setupCard.prepareMysqlTitle",
        descriptionKey: "ingestion.setupCard.prepareMysqlDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mysql",
            label: raw("mysql"),
            icon: tool.terminal,
            code: { lang: "bash", raw: applyUser("mysql -h localhost -u root -p") },
            note: t("ingestion.setupCard.mysqlAdminNote"),
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyUser("docker exec -i mysql mysql -u root -p"),
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/mysql.svg"),
            code: { lang: "sql", raw: USER_SQL },
          },
        ],
      },
      // Pinned: the DBM config below needs upstream contrib >= 0.148.0 (the
      // `events:` block is an unknown key on older releases).
      collectorInstallStep(t, DBM_CONTRIB_VERSION),
      {
        id: "configure",
        titleKey: "ingestion.setupCard.configureCollectorTitle",
        descriptionKey: "ingestion.setupCard.configureCollectorDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "host",
            labelKey: "ingestion.setupCard.mysqlHostLabel",
            default: "localhost",
            placeholder: raw("localhost"),
          },
          {
            id: "port",
            labelKey: "ingestion.setupCard.portLabel",
            default: "3306",
            placeholder: raw("3306"),
            width: "sm",
          },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        titleKey: "ingestion.setupCard.runCollectorTitle",
        descriptionKey: "ingestion.setupCard.runCollectorMysqlDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          // MYSQL_USER feeds the sqlquery/mysql_limits datasource; the mysql
          // receiver names its user inline. Omitting the first breaks the
          // connection-limit query's auth while the pipeline stays green.
          raw: "MYSQL_USER='otel' MYSQL_PASSWORD='yourpassword' ./otelcol-contrib --config ./config.yaml",
        },
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyMysqlMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // Plain-English summary, NOT the receiver metric names — so these are
        // translated.
        pills: [
          t("ingestion.setupCard.pillBufferPool"),
          t("ingestion.setupCard.pillOperations"),
          t("ingestion.setupCard.pillThreads"),
          t("ingestion.setupCard.pillRowLocks"),
          t("ingestion.setupCard.pillHandlers"),
        ],
      },
      // ── Database Monitoring (optional) ──────────────────────────────────
      // See postgres.ts for why these are separate from the metrics steps: the
      // Deadlocks and Blocked queries tabs read the SERVER vantage, which no
      // client span can supply.
      {
        id: "dbm-grant",
        titleKey: "ingestion.setupCard.dbmPrepareMysqlTitle",
        descriptionKey: "ingestion.setupCard.dbmPrepareMysqlDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mysql",
            label: raw("mysql"),
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: `mysql -h localhost -u root -p -e "${MYSQL_DBM_GRANT_SQL}"`,
            },
            note: "Without innodb_print_all_deadlocks, MySQL keeps only the MOST RECENT deadlock — earlier ones are gone before they can be collected. Set it in my.cnf too, so it survives a restart.",
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: `docker exec -i mysql mysql -u root -p -e "${MYSQL_DBM_GRANT_SQL}"`,
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/mysql.svg"),
            code: { lang: "sql", raw: MYSQL_DBM_GRANT_SQL },
          },
        ],
      },
      {
        id: "dbm-configure",
        titleKey: "ingestion.setupCard.dbmConfigureTitle",
        descriptionKey: "ingestion.setupCard.dbmConfigureMysqlDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          {
            id: "database",
            labelKey: "ingestion.setupCard.dbmDatabaseLabel",
            default: "mysql",
            placeholder: raw("mysql"),
          },
          {
            id: "logpath",
            labelKey: "ingestion.setupCard.dbmMysqlLogPathLabel",
            default: "/var/log/mysql/error.log",
            placeholder: raw("/var/log/mysql/error.log"),
            helpKey: "ingestion.setupCard.dbmMysqlLogPathHelp",
          },
        ],
        variants: writeConfigVariants(MYSQL_DBM_CONFIG_YAML, subs).map((v) => ({
          ...v,
          code: {
            ...v.code,
            raw: v.code.raw.replace(/config\.yaml/g, "dbm-config.yaml"),
            masked: v.code.masked?.replace(/config\.yaml/g, "dbm-config.yaml"),
          },
        })),
        note: "Needs the upstream OpenTelemetry Collector Contrib from the install step, v0.148.0 or newer (verified at v0.158.0) — the OpenObserve collector build does not include the database receivers, so it cannot run this config. Deadlock capture tails the MySQL error log on disk, so it is not available on managed MySQL (RDS, Aurora, Cloud SQL): those platforms give the collector no file to read. Blocking chains, activity samples and top queries work there normally; estimated plans need MySQL 8.0.22 or newer. ACTIVITY SAMPLES AND TOP QUERIES SHIP ON. In the config above, events: db.server.query_sample and db.server.top_query are enabled: true — the collector's own default has been off since v0.148.0, so this block is the switch, and OpenObserve reads both feeds whenever Database Monitoring is enabled (no environment variable to pair). Set either to false to trim collection cost on your database; query_sample is the high-volume one. Activity samples are high-volume and share the dbm_server stream's normal retention; if volume is a concern, set a shorter retention policy on the dbm_server stream.",
      },
      {
        id: "dbm-run",
        titleKey: "ingestion.setupCard.dbmRunTitle",
        descriptionKey: "ingestion.setupCard.dbmRunMysqlDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "MYSQL_USER='otel' MYSQL_PASSWORD='yourpassword' \\\n  ./otelcol-contrib --config ./config.yaml --config ./dbm-config.yaml",
        },
        note: "Two --config flags merge the metrics and database-monitoring pipelines into one collector.",
      },
      dbmVerifyStep("full", true),
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "mysql", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-mysql-metrics-otel",
  };
}
