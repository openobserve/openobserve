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

import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";

import { aiCategories } from "@/components/ingestion/ai/data";

const SplunkHec = () => import("@/components/ingestion/logs/SplunkHec.vue");
const SyslogNg = () => import("@/components/ingestion/logs/SyslogNg.vue");
const LoongCollector = () => import("@/components/ingestion/logs/LoongCollector.vue");
const Ingestion = () => import("@/views/Ingestion.vue");
const FluentBit = () => import("@/components/ingestion/logs/FluentBit.vue");
const Fluentd = () => import("@/components/ingestion/logs/Fluentd.vue");
const Vector = () => import("@/components/ingestion/logs/Vector.vue");
const Curl = () => import("@/components/ingestion/logs/Curl.vue");
const KinesisFirehose = () => import("@/components/ingestion/logs/KinesisFirehose.vue");
const AWSConfig = () => import("@/components/ingestion/recommended/AWSConfig.vue");
const GCPConfig = () => import("@/components/ingestion/recommended/GCPConfig.vue");
const AzureConfig = () => import("@/components/ingestion/recommended/AzureConfig.vue");
const FileBeat = () => import("@/components/ingestion/logs/FileBeat.vue");
const OpenTelemetry = () => import("@/components/ingestion/traces/OpenTelemetry.vue");
const PrometheusConfig = () => import("@/components/ingestion/metrics/PrometheusConfig.vue");
const VMagentConfig = () => import("@/components/ingestion/metrics/VMagentConfig.vue");
const NightingaleConfig = () => import("@/components/ingestion/metrics/NightingaleConfig.vue");
const CategrafConfig = () => import("@/components/ingestion/metrics/CategrafConfig.vue");
const OtelCollector = () => import("@/components/ingestion/metrics/OtelCollector.vue");
const TelegrafConfig = () => import("@/components/ingestion/metrics/TelegrafConfig.vue");
const CloudWatchMetricConfig = () => import("@/components/ingestion/metrics/CloudWatchMetrics.vue");
const IngestLogs = () => import("@/components/ingestion/logs/Index.vue");
const IngestMetrics = () => import("@/components/ingestion/metrics/Index.vue");
const IngestProfiles = () => import("@/components/ingestion/profiles/Index.vue");
const IngestTraces = () => import("@/components/ingestion/traces/Index.vue");
const Recommended = () => import("@/components/ingestion/Recommended.vue");
const Custom = () => import("@/components/ingestion/Custom.vue");
const LogstashDatasource = () => import("@/components/ingestion/logs/LogstashDatasource.vue");
const ProfilesOtelCollector = () => import("@/components/ingestion/profiles/OtelCollector.vue");
const RUMWeb = () => import("@/components/ingestion/recommended/FrontendRumConfig.vue");
const KubernetesConfig = () => import("@/components/ingestion/recommended/KubernetesConfig.vue");
const GpuConfig = () => import("@/components/ingestion/recommended/GpuConfig.vue");
const LinuxConfig = () => import("@/components/ingestion/recommended/LinuxConfig.vue");
const MacOSConfig = () => import("@/components/ingestion/recommended/MacOSConfig.vue");
const OtelConfig = () => import("@/components/ingestion/recommended/OtelConfig.vue");
const WindowsConfig = () => import("@/components/ingestion/recommended/WindowsConfig.vue");
const DatabaseConfig = () => import("@/components/ingestion/Database.vue");
const SqlServer = () => import("@/components/ingestion/databases/SqlServer.vue");
const Postgres = () => import("@/components/ingestion/databases/Postgres.vue");
const Oracle = () => import("@/components/ingestion/databases/Oracle.vue");
const MongoDB = () => import("@/components/ingestion/databases/MongoDB.vue");
const Redis = () => import("@/components/ingestion/databases/Redis.vue");
const CouchDB = () => import("@/components/ingestion/databases/CouchDB.vue");
const Elasticsearch = () => import("@/components/ingestion/databases/Elasticsearch.vue");
const MySQL = () => import("@/components/ingestion/databases/MySQL.vue");
const MariaDB = () => import("@/components/ingestion/databases/MariaDB.vue");
const SAPHana = () => import("@/components/ingestion/databases/SAPHana.vue");
const Snowflake = () => import("@/components/ingestion/databases/Snowflake.vue");
const Zookeeper = () => import("@/components/ingestion/databases/Zookeeper.vue");
const Cassandra = () => import("@/components/ingestion/databases/Cassandra.vue");
const Aerospike = () => import("@/components/ingestion/databases/Aerospike.vue");
const DynamoDB = () => import("@/components/ingestion/databases/DynamoDB.vue");
const Databricks = () => import("@/components/ingestion/databases/Databricks.vue");
const Security = () => import("@/components/ingestion/Security.vue");
const Falco = () => import("@/components/ingestion/security/Falco.vue");
const OSQuery = () => import("@/components/ingestion/security/OSQuery.vue");
const Okta = () => import("@/components/ingestion/security/Okta.vue");
const Jumpcloud = () => import("@/components/ingestion/security/Jumpcloud.vue");
const OpenVPN = () => import("@/components/ingestion/security/OpenVPN.vue");
const Office365 = () => import("@/components/ingestion/security/Office365.vue");
const GoogleWorkspace = () => import("@/components/ingestion/security/GoogleWorkspace.vue");
const DevOps = () => import("@/components/ingestion/DevOps.vue");
const Jenkins = () => import("@/components/ingestion/devops/Jenkins.vue");
const Ansible = () => import("@/components/ingestion/devops/Ansible.vue");
const Terraform = () => import("@/components/ingestion/devops/Terraform.vue");
const GithubActions = () => import("@/components/ingestion/devops/GithubActions.vue");
const Networking = () => import("@/components/ingestion/Networking.vue");
const Netflow = () => import("@/components/ingestion/networking/Netflow.vue");
const Server = () => import("@/components/ingestion/Server.vue");
const Nginx = () => import("@/components/ingestion/servers/Nginx.vue");
const Apache = () => import("@/components/ingestion/servers/Apache.vue");
const IIS = () => import("@/components/ingestion/servers/IIS.vue");
const MessageQueues = () => import("@/components/ingestion/MessageQueues.vue");
const Kafka = () => import("@/components/ingestion/messagequeues/Kafka.vue");
const RabbitMQ = () => import("@/components/ingestion/messagequeues/RabbitMQ.vue");
const NATS = () => import("@/components/ingestion/messagequeues/Nats.vue");
const Languages = () => import("@/components/ingestion/Languages.vue");
const Python = () => import("@/components/ingestion/languages/Python.vue");
const DotNetTracing = () => import("@/components/ingestion/languages/DotNetTracing.vue");
const DotNetLogs = () => import("@/components/ingestion/languages/DotNetLogs.vue");
const NodeJS = () => import("@/components/ingestion/languages/NodeJS.vue");
const Rust = () => import("@/components/ingestion/languages/Rust.vue");
const Java = () => import("@/components/ingestion/languages/Java.vue");
const Go = () => import("@/components/ingestion/languages/Go.vue");
const FastAPI = () => import("@/components/ingestion/languages/FastAPI.vue");
const Others = () => import("@/components/ingestion/Others.vue");
const Airflow = () => import("@/components/ingestion/others/Airflow.vue");
const Airbyte = () => import("@/components/ingestion/others/Airbyte.vue");
const Cribl = () => import("@/components/ingestion/others/Cribl.vue");
const Vercel = () => import("@/components/ingestion/others/Vercel.vue");
const Heroku = () => import("@/components/ingestion/others/Heroku.vue");
const AIIntegrations = () => import("@/components/ingestion/AIIntegrations.vue");
const AIIntegrationDetail = () => import("@/components/ingestion/ai/AIIntegrationDetail.vue");
const McpCrossLink = () => import("@/components/ingestion/McpCrossLink.vue");

const useIngestionRoutes = () => {
  // One route per AI integration across all tabs. `aiCategories` is already
  // deduped in data.ts (manifest cards reuse an existing route and the original
  // is removed), so every routeName here is unique — no duplicate-name routes.
  const aiIntegrationRoutes = aiCategories.flatMap((category) =>
    category.integrations.map((integration) => ({
      path: `${category.slug}/${integration.slug}`,
      name: integration.routeName,
      component: AIIntegrationDetail,
      props: {
        categorySlug: category.slug,
        integrationSlug: integration.slug,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    })),
  );

  const ingestionRoutes: any = [
    {
      path: "ingestion",
      name: "ingestion",
      component: Ingestion,
      meta: {
        titleKey: "menu.ingestionText",
        allowOnEmptyData: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "custom",
          name: "custom",
          component: Custom,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "logs",
              name: "ingestLogs",
              component: IngestLogs,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "curl",
                  name: "curl",
                  component: Curl,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "fluentbit",
                  name: "fluentbit",
                  component: FluentBit,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "fluentd",
                  name: "fluentd",
                  component: Fluentd,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "vector",
                  name: "vector",
                  component: Vector,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "kinesisfirehose",
                  name: "kinesisfirehose",
                  component: KinesisFirehose,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "gcp",
                  name: "gcpLogs",
                  component: GCPConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "filebeat",
                  name: "filebeat",
                  component: FileBeat,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "otel",
                  name: "ingestLogsFromOtel",
                  component: OtelConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "logstash",
                  name: "logstash",
                  component: LogstashDatasource,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "syslogng",
                  name: "syslogNg",
                  component: SyslogNg,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "splunkhec",
                  name: "splunkHec",
                  component: SplunkHec,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "loongcollector",
                  name: "loongcollector",
                  component: LoongCollector,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
              ],
            },
            {
              path: "metrics",
              name: "ingestMetrics",
              component: IngestMetrics,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "prometheus",
                  name: "prometheus",
                  component: PrometheusConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "vmagent",
                  name: "vmagent",
                  component: VMagentConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "nightingale",
                  name: "nightingale",
                  component: NightingaleConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "categraf",
                  name: "categraf",
                  component: CategrafConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "otelcollector",
                  name: "otelCollector",
                  component: OtelCollector,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "telegraf",
                  name: "telegraf",
                  component: TelegrafConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "cloudwatchMetrics",
                  name: "cloudwatchMetrics",
                  component: CloudWatchMetricConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
              ],
            },
            {
              path: "profiles",
              name: "ingestProfiles",
              component: IngestProfiles,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "otelcollector",
                  name: "profilesOtelCollector",
                  component: ProfilesOtelCollector,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
              ],
            },
            {
              path: "traces",
              name: "ingestTraces",
              component: IngestTraces,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "opentelemetry",
                  name: "tracesOTLP",
                  component: OpenTelemetry,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "otel",
                  name: "ingestTracesFromOtel",
                  component: OtelConfig,
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
              ],
            },
          ],
        },
        {
          path: "recommended",
          name: "recommended",
          component: Recommended,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "kubernetes",
              name: "ingestFromKubernetes",
              component: KubernetesConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "windows",
              name: "ingestFromWindows",
              component: WindowsConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "linux",
              name: "ingestFromLinux",
              component: LinuxConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "macos",
              name: "ingestFromMacOS",
              component: MacOSConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "gpu",
              name: "ingestFromGpu",
              component: GpuConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "aws",
              name: "AWSConfig",
              component: AWSConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "gcp",
              name: "GCPConfig",
              component: GCPConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "azure",
              name: "AzureConfig",
              component: AzureConfig,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "traces",
              name: "ingestFromTraces",
              component: OpenTelemetry,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "frontend-monitoring",
              name: "frontendMonitoring",
              component: RUMWeb,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            // Discoverability pointer → the MCP setup home in IAM. Registered on
            // every edition, matching both the tab in Recommended.vue and the
            // target "mcpServer" route, which are no longer build-gated.
            {
              path: "mcp",
              name: "recommendedMcp",
              component: McpCrossLink,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "databases",
          name: "databases",
          component: DatabaseConfig,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "sqlserver",
              name: "sqlserver",
              component: SqlServer,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "postgres",
              name: "postgres",
              component: Postgres,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "mongodb",
              name: "mongodb",
              component: MongoDB,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "redis",
              name: "redis",
              component: Redis,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "couchdb",
              name: "couchdb",
              component: CouchDB,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "elasticsearch",
              name: "elasticsearch",
              component: Elasticsearch,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "mysql",
              name: "mysql",
              component: MySQL,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "mariadb",
              name: "mariadb",
              component: MariaDB,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "oracle",
              name: "oracle",
              component: Oracle,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "saphana",
              name: "saphana",
              component: SAPHana,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "snowflake",
              name: "snowflake",
              component: Snowflake,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "zookeeper",
              name: "zookeeper",
              component: Zookeeper,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "cassandra",
              name: "cassandra",
              component: Cassandra,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "aerospike",
              name: "aerospike",
              component: Aerospike,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "dynamodb",
              name: "dynamodb",
              component: DynamoDB,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "databricks",
              name: "databricks",
              component: Databricks,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "security",
          name: "security",
          component: Security,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "falco",
              name: "falco",
              component: Falco,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "osquery",
              name: "osquery",
              component: OSQuery,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "okta",
              name: "okta",
              component: Okta,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "jumpcloud",
              name: "jumpcloud",
              component: Jumpcloud,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "openvpn",
              name: "openvpn",
              component: OpenVPN,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "office365",
              name: "office365",
              component: Office365,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "google-workspace",
              name: "google-workspace",
              component: GoogleWorkspace,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "devops",
          name: "devops",
          component: DevOps,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "jenkins",
              name: "jenkins",
              component: Jenkins,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "ansible",
              name: "ansible",
              component: Ansible,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "terraform",
              name: "terraform",
              component: Terraform,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "github-actions",
              name: "github-actions",
              component: GithubActions,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "networking",
          name: "networking",
          component: Networking,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "netflow",
              name: "netflow",
              component: Netflow,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "servers",
          name: "servers",
          component: Server,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "nginx",
              name: "nginx",
              component: Nginx,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "apache",
              name: "apache",
              component: Apache,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "iis",
              name: "iis",
              component: IIS,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "message-queues",
          name: "message-queues",
          component: MessageQueues,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "rabbitmq",
              name: "rabbitmq",
              component: RabbitMQ,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "kafka",
              name: "kafka",
              component: Kafka,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "nats",
              name: "nats",
              component: NATS,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "languages",
          name: "languages",
          component: Languages,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "python",
              name: "python",
              component: Python,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "dotnettracing",
              name: "dotnettracing",
              component: DotNetTracing,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "dotnetlogs",
              name: "dotnetlogs",
              component: DotNetLogs,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "nodejs",
              name: "nodejs",
              component: NodeJS,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "java",
              name: "java",
              component: Java,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "go",
              name: "go",
              component: Go,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "rust",
              name: "rust",
              component: Rust,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "fastapi",
              name: "fastapi",
              component: FastAPI,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "ai-integrations",
          name: "ai-integrations",
          component: AIIntegrations,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              // Named so the router doesn't warn about an unnamed empty-path
              // child under a named parent. Nothing navigates to this name; it
              // exists only to land /ai-integrations on the first integration.
              name: "ai-integrations-default",
              path: "",
              redirect: () => {
                const first = aiCategories[0].integrations[0];
                return { name: first.routeName };
              },
            },
            ...aiIntegrationRoutes,
          ],
        },
        {
          path: "others",
          name: "others",
          component: Others,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "airflow",
              name: "airflow",
              component: Airflow,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "airbyte",
              name: "airbyte",
              component: Airbyte,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "cribl",
              name: "cribl",
              component: Cribl,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "vercel",
              name: "vercel",
              component: Vercel,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "heroku",
              name: "heroku",
              component: Heroku,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
      ],
    },
  ];

  if (config.isCloud === "false" || !config.isCloud) {
    ingestionRoutes[0].children
      .find((child: any) => child.name === "custom")
      .children.find((child: any) => child.name === "ingestLogs");
  }

  return ingestionRoutes;
};

export default useIngestionRoutes;
