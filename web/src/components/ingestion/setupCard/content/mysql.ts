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

// MySQL data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/monitor-mysql-metrics-otel (requires MySQL 8.0+).

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { collectorInstallStep, writeConfigVariants, sharedToolIcons } from "./otelShared";

const USER_SQL = `CREATE USER 'otel'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT SELECT, PROCESS, REPLICATION CLIENT ON *.* TO 'otel'@'localhost';
FLUSH PRIVILEGES;`;

// The SQL runs INSIDE MySQL — Step 1 offers runnable mysql / Docker commands that
// pass it via -e, plus the raw SQL for a GUI client.
const applyUser = (connect: string) => `${connect} -e "
${USER_SQL}
"`;

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

export default function mysqlCard(subs: CardSubstitutions): RichCardContent {
  const tool = sharedToolIcons();
  return {
    provider: {
      name: "MySQL",
      tagline:
        "Collect MySQL metrics with the OpenTelemetry Collector and ship them to OpenObserve.",
      logo: getImageURL("images/ingestion/mysql.svg"),
      tone: "#00758F",
      metaBadges: ["Metrics"],
    },
    steps: [
      {
        id: "prepare",
        title: "Prepare MySQL",
        description: "Create the monitoring user — run it in a SQL client, **not** your shell.",
        chip: { kind: "terminal", label: "Terminal" },
        completeOn: "copy",
        variants: [
          {
            id: "mysql",
            label: "mysql",
            icon: tool.terminal,
            code: { lang: "bash", raw: applyUser("mysql -h localhost -u root -p") },
            note: "Run as a MySQL admin (it prompts for the password).",
          },
          {
            id: "docker",
            label: "Docker",
            icon: tool.docker,
            code: {
              lang: "bash",
              raw: applyUser("docker exec -i mysql mysql -u root -p"),
            },
          },
          {
            id: "sql-client",
            label: "SQL Client (GUI)",
            icon: getImageURL("images/ingestion/mysql.svg"),
            code: { lang: "sql", raw: USER_SQL },
          },
        ],
      },
      collectorInstallStep(),
      {
        id: "configure",
        title: "Configure the OpenTelemetry Collector",
        description: "Writes `config.yaml` — set the host/port below.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "os",
        variantToggle: false,
        inputs: [
          { id: "host", label: "MySQL Host", default: "localhost", placeholder: "localhost" },
          { id: "port", label: "Port", default: "3306", placeholder: "3306", width: "sm" },
        ],
        variants: writeConfigVariants(CONFIG_YAML, subs),
      },
      {
        id: "run",
        title: "Run the OpenTelemetry Collector",
        description: "Start the collector (the user's password via env var).",
        chip: { kind: "run", label: "Run" },
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: "MYSQL_PASSWORD='yourpassword' ./otelcol-contrib --config ./config.yaml",
        },
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description: "Hit Test below, or check Streams for the `mysql_*` metrics.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Buffer Pool", "Operations", "Threads", "Row Locks", "Handlers"],
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "mysql", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-mysql-metrics-otel",
  };
}
