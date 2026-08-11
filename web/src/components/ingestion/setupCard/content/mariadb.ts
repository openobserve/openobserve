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

// MariaDB data-source setup card.
//
// The backend has supported MariaDB since the server-vantage work landed
// (`canonicalize_mariadb_deadlock`, the `mariadb_lock_waits` recipe tag, and
// the `o2_maria_event` filelog tag), and `MARIADB_DBM_CONFIG_YAML` was verified
// against a live MariaDB 11.8 on the rig. What was missing was any way for a
// user to REACH it: no content module, no registry key, no route. This file is
// that missing surface — the collector config it hands out is the same one
// dbmMariadb.spec.ts already pins.
//
// MariaDB is wire-compatible with MySQL, so the metrics half reuses the
// `mysql` receiver and the `mysql` driver. The DBM half deliberately does NOT
// reuse MySQL's receivers: `detect_engine` maps the `mysql_lock_waits` tag and
// every `my_*` key to "mysql", which would file MariaDB rows under the wrong
// engine and — because the deadlock stitch groups on (engine, instance,
// database) — could merge two different servers' sides into one fabricated
// deadlock.

import { gt, raw } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";
import { MARIADB_DBM_CONFIG_YAML, MARIADB_DBM_GRANT_SQL, dbmVerifyStep } from "./dbmShared";

const USER_SQL = `CREATE USER 'otel'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT SELECT, PROCESS, REPLICATION CLIENT ON *.* TO 'otel'@'localhost';
FLUSH PRIVILEGES;`;

// The SQL runs INSIDE MariaDB — step 1 offers runnable mariadb / Docker
// commands that pass it via -e, plus the raw SQL for a GUI client.
const applyUser = (connect: string) => `${connect} -e "
${USER_SQL}
"`;

// MariaDB speaks the MySQL wire protocol, so the `mysql` receiver is the
// correct one for instance metrics — there is no separate mariadb receiver.
const CONFIG_YAML = `receivers:
  mysql:
    endpoint: "{host}:{port}"
    username: otel
    password: \${env:MYSQL_PASSWORD}
    database: otel
    collection_interval: 10s
    initial_delay: 1s

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
      receivers: [mysql]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

export default function mariadbCard(subs: CardSubstitutions): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: "MariaDB",
      tagline: gt("ingestion.setupCard.mariadbTagline"),
      // No MariaDB mark ships with the app yet; MySQL's is the honest stand-in
      // for a fork of MySQL, and beats a broken image.
      logo: getImageURL("images/ingestion/mysql.svg"),
      tone: "#C0765A",
      // Logs too: the optional Database Monitoring steps ship deadlock and
      // blocking events into the dbm_server logs stream.
      metaBadges: [gt("common.metrics"), gt("common.logs")],
    },
    steps: [
      {
        id: "prepare",
        titleKey: "ingestion.setupCard.prepareMariadbTitle",
        descriptionKey: "ingestion.setupCard.prepareMariadbDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mariadb",
            label: raw("mariadb"),
            icon: tool.terminal,
            code: { lang: "bash", raw: applyUser("mariadb -h localhost -u root -p") },
            note: "Run as a MariaDB admin (it prompts for the password).",
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyUser("docker exec -i mariadb mariadb -u root -p"),
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
      collectorInstallStep(),
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
            labelKey: "ingestion.setupCard.mariadbHostLabel",
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
        descriptionKey: "ingestion.setupCard.runCollectorMariadbDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "MYSQL_PASSWORD='yourpassword' ./otelcol-contrib --config ./config.yaml",
        },
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyMariadbMetricsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // mysql receiver metric names — they land verbatim in the data, so the
        // pills stay untranslated.
        pills: [
          raw("Buffer Pool"),
          raw("Operations"),
          raw("Threads"),
          raw("Row Locks"),
          raw("Handlers"),
        ],
      },
      // ── Database Monitoring (optional) ──────────────────────────────────
      // See postgres.ts for why these are separate from the metrics steps: the
      // Deadlocks and Blocked queries tabs read the SERVER vantage, which no
      // client span can supply.
      {
        id: "dbm-grant",
        titleKey: "ingestion.setupCard.dbmPrepareMariadbTitle",
        descriptionKey: "ingestion.setupCard.dbmPrepareMariadbDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mariadb",
            label: raw("mariadb"),
            icon: tool.terminal,
            code: {
              lang: "bash",
              raw: `mariadb -h localhost -u root -p -e "${MARIADB_DBM_GRANT_SQL}"`,
            },
            note: "Blocking chains read performance_schema.data_lock_waits, which needs MariaDB 10.6 or newer — on 10.5 and earlier that view does not exist and the lock recipe will error every interval. Deadlock capture works on any version.",
          },
          {
            id: "docker",
            label: raw("Docker"),
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: `docker exec -i mariadb mariadb -u root -p -e "${MARIADB_DBM_GRANT_SQL}"`,
            },
          },
          {
            id: "sql-client",
            labelKey: "ingestion.setupCard.sqlClientGuiVariant",
            icon: getImageURL("images/ingestion/mysql.svg"),
            code: { lang: "sql", raw: MARIADB_DBM_GRANT_SQL },
          },
        ],
      },
      {
        id: "dbm-configure",
        titleKey: "ingestion.setupCard.dbmConfigureTitle",
        descriptionKey: "ingestion.setupCard.dbmConfigureMariadbDesc",
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
            labelKey: "ingestion.setupCard.dbmMariadbLogPathLabel",
            default: "/var/log/mysql/error.log",
            placeholder: raw("/var/log/mysql/error.log"),
            helpKey: "ingestion.setupCard.dbmMariadbLogPathHelp",
          },
        ],
        variants: writeConfigVariants(MARIADB_DBM_CONFIG_YAML, subs).map((v) => ({
          ...v,
          code: {
            ...v.code,
            raw: v.code.raw.replace(/config\.yaml/g, "dbm-config.yaml"),
            masked: v.code.masked?.replace(/config\.yaml/g, "dbm-config.yaml"),
          },
        })),
      },
      {
        id: "dbm-run",
        titleKey: "ingestion.setupCard.dbmRunTitle",
        descriptionKey: "ingestion.setupCard.dbmRunMariadbDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "MYSQL_USER='otel' MYSQL_PASSWORD='yourpassword' \\\n  ./otelcol-contrib --config ./config.yaml --config ./dbm-config.yaml",
        },
        note: "Two --config flags merge the metrics and database-monitoring pipelines into one collector.",
      },
      dbmVerifyStep(),
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "mysql", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-mysql-metrics-otel",
  };
}
