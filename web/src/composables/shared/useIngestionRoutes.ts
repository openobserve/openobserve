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
import SyslogNg from "@/components/ingestion/logs/SyslogNg.vue";
import Ingestion from "@/views/Ingestion.vue";
import FluentBit from "@/components/ingestion/logs/FluentBit.vue";
import Fluentd from "@/components/ingestion/logs/Fluentd.vue";
import Vector from "@/components/ingestion/logs/Vector.vue";
import Curl from "@/components/ingestion/logs/Curl.vue";
import AWSConfig from "@/components/ingestion/recommended/AWSConfig.vue";
import GCPConfig from "@/components/ingestion/recommended/GCPConfig.vue";
import AzureConfig from "@/components/ingestion/recommended/AzureConfig.vue";
import FileBeat from "@/components/ingestion/logs/FileBeat.vue";
import OpenTelemetry from "@/components/ingestion/traces/OpenTelemetry.vue";
import PrometheusConfig from "@/components/ingestion/metrics/PrometheusConfig.vue";
import OtelCollector from "@/components/ingestion/metrics/OtelCollector.vue";
import TelegrafConfig from "@/components/ingestion/metrics/TelegrafConfig.vue";
import CloudWatchMetricConfig from "@/components/ingestion/metrics/CloudWatchMetrics.vue";
import IngestLogs from "@/components/ingestion/logs/Index.vue";
import IngestMetrics from "@/components/ingestion/metrics/Index.vue";
import IngestTraces from "@/components/ingestion/traces/Index.vue";
import Recommended from "@/components/ingestion/Recommended.vue";
import Custom from "@/components/ingestion/Custom.vue";
import LogstashDatasource from "@/components/ingestion/logs/LogstashDatasource.vue";

import RUMWeb from "@/components/ingestion/recommended/FrontendRumConfig.vue";
import KubernetesConfig from "@/components/ingestion/recommended/KubernetesConfig.vue";
import LinuxConfig from "@/components/ingestion/recommended/LinuxConfig.vue";
import OtelConfig from "@/components/ingestion/recommended/OtelConfig.vue";
import WindowsConfig from "@/components/ingestion/recommended/WindowsConfig.vue";

import DatabaseConfig from "@/components/ingestion/Database.vue";
import SqlServer from "@/components/ingestion/databases/SqlServer.vue";
import Postgres from "@/components/ingestion/databases/Postgres.vue";
import Oracle from "@/components/ingestion/databases/Oracle.vue";
import MongoDB from "@/components/ingestion/databases/MongoDB.vue";
import Redis from "@/components/ingestion/databases/Redis.vue";
import CouchDB from "@/components/ingestion/databases/CouchDB.vue";
import Elasticsearch from "@/components/ingestion/databases/Elasticsearch.vue";
import MySQL from "@/components/ingestion/databases/MySQL.vue";
import SAPHana from "@/components/ingestion/databases/SAPHana.vue";
import Snowflake from "@/components/ingestion/databases/Snowflake.vue";
import Zookeeper from "@/components/ingestion/databases/Zookeeper.vue";
import Cassandra from "@/components/ingestion/databases/Cassandra.vue";
import Aerospike from "@/components/ingestion/databases/Aerospike.vue";
import DynamoDB from "@/components/ingestion/databases/DynamoDB.vue";
import Databricks from "@/components/ingestion/databases/Databricks.vue";

import Security from "@/components/ingestion/Security.vue";
import Falco from "@/components/ingestion/security/Falco.vue";
import OSQuery from "@/components/ingestion/security/OSQuery.vue";
import Okta from "@/components/ingestion/security/Okta.vue";
import Jumpcloud from "@/components/ingestion/security/Jumpcloud.vue";
import OpenVPN from "@/components/ingestion/security/OpenVPN.vue";
import Office365 from "@/components/ingestion/security/Office365.vue";
import GoogleWorkspace from "@/components/ingestion/security/GoogleWorkspace.vue";

import DevOps from "@/components/ingestion/DevOps.vue";
import Jenkins from "@/components/ingestion/devops/Jenkins.vue";
import Ansible from "@/components/ingestion/devops/Ansible.vue";
import Terraform from "@/components/ingestion/devops/Terraform.vue";
import GithubActions from "@/components/ingestion/devops/GithubActions.vue";

import Networking from "@/components/ingestion/Networking.vue";
import Netflow from "@/components/ingestion/networking/Netflow.vue";

import Server from "@/components/ingestion/Server.vue";
import Nginx from "@/components/ingestion/servers/Nginx.vue";
import Apache from "@/components/ingestion/servers/Apache.vue";
import IIS from "@/components/ingestion/servers/IIS.vue";

import MessageQueues from "@/components/ingestion/MessageQueues.vue";
import Kafka from "@/components/ingestion/messagequeues/Kafka.vue";
import RabbitMQ from "@/components/ingestion/messagequeues/RabbitMQ.vue";
import NATS from "@/components/ingestion/messagequeues/Nats.vue";

import Languages from "@/components/ingestion/Languages.vue";
import Python from "@/components/ingestion/languages/Python.vue";
import DotNetTracing from "@/components/ingestion/languages/DotNetTracing.vue";
import DotNetLogs from "@/components/ingestion/languages/DotNetLogs.vue";
import NodeJS from "@/components/ingestion/languages/NodeJS.vue";
import Rust from "@/components/ingestion/languages/Rust.vue";
import Java from "@/components/ingestion/languages/Java.vue";
import Go from "@/components/ingestion/languages/Go.vue";
import FastAPI from "@/components/ingestion/languages/FastAPI.vue";

import Others from "@/components/ingestion/Others.vue";
import Airflow from "@/components/ingestion/others/Airflow.vue";
import Airbyte from "@/components/ingestion/others/Airbyte.vue";
import Cribl from "@/components/ingestion/others/Cribl.vue";
import Vercel from "@/components/ingestion/others/Vercel.vue";
import Heroku from "@/components/ingestion/others/Heroku.vue";

const useIngestionRoutes = () => {
  const ingestionRoutes: any = [
    {
      path: "ingestion",
      name: "ingestion",
      component: Ingestion,
      meta: {
        title: "Ingestion",
        titleKey: "menu.ingestion",
        searchable: true,
        icon: "input",
        section: "Management",
        keywords: [
          "data sources",
          "Kubernetes",
          "Linux",
          "Windows",
          "AWS",
          "GCP",
          "Azure",
          "OpenTelemetry",
          "Fluent Bit",
          "Fluentd",
          "Vector",
          "Filebeat",
          "Telegraf",
          "database integrations",
          "message queues",
        ],
        // All tab labels on the Ingestion page — resolved in current locale
        keywordKeys: [
          "ingestion.recommendedLabel",
          "ingestion.customLabel",
          "ingestion.serverLabel",
          "ingestion.databaseLabel",
          "ingestion.securityLabel",
          "ingestion.devopsLabel",
          "ingestion.networkingLabel",
          "ingestion.messageQueuesLabel",
          "ingestion.languagesLabel",
          "ingestion.otherLabel",
          "ingestion.logsLabel",
          "ingestion.metricsLabel",
          "ingestion.tracesLabel",
          "ingestion.kubernetes",
          "ingestion.linux",
          "ingestion.windows",
          "ingestion.awsconfig",
          "ingestion.gcpconfig",
          "ingestion.azure",
          "ingestion.tracesotlp",
          "ingestion.rum",
        ],
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
              meta: {
                title: "Custom Log Ingestion",
                searchable: true,
                icon: "text_snippet",
                section: "Data Sources",
                keywords: [
                  "custom logs",
                  "log ingestion",
                  "curl",
                  "fluentbit",
                  "fluentd",
                  "vector",
                  "filebeat",
                  "logstash",
                  "syslog",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "curl",
                  name: "curl",
                  component: Curl,
                  meta: {
                    title: "Curl (HTTP API)",
                    searchable: true,
                    icon: "http",
                    section: "Data Sources",
                    keywords: [
                      "HTTP ingestion",
                      "REST API logs",
                      "curl",
                      "raw logs",
                      "custom logs",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "fluentbit",
                  name: "fluentbit",
                  component: FluentBit,
                  meta: {
                    title: "Fluent Bit",
                    searchable: true,
                    icon: "stream",
                    section: "Data Sources",
                    keywords: [
                      "log collector",
                      "lightweight log agent",
                      "fluent-bit",
                      "log shipping",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "fluentd",
                  name: "fluentd",
                  component: Fluentd,
                  meta: {
                    title: "Fluentd",
                    searchable: true,
                    icon: "stream",
                    section: "Data Sources",
                    keywords: [
                      "log aggregator",
                      "log collector",
                      "fluentd",
                      "log forwarding",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "vector",
                  name: "vector",
                  component: Vector,
                  meta: {
                    title: "Vector",
                    searchable: true,
                    icon: "stream",
                    section: "Data Sources",
                    keywords: [
                      "log pipeline",
                      "metrics pipeline",
                      "event pipeline",
                      "vector.dev",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "filebeat",
                  name: "filebeat",
                  component: FileBeat,
                  meta: {
                    title: "Filebeat",
                    searchable: true,
                    icon: "text_snippet",
                    section: "Data Sources",
                    keywords: [
                      "Elastic Filebeat",
                      "log shipper",
                      "log collector",
                      "filebeat",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "otel",
                  name: "ingestLogsFromOtel",
                  component: OtelConfig,
                  meta: {
                    title: "OpenTelemetry Logs",
                    searchable: true,
                    icon: "stream",
                    section: "Data Sources",
                    keywords: [
                      "OTEL logs",
                      "OpenTelemetry collector",
                      "OTel",
                      "otel logs ingestion",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "logstash",
                  name: "logstash",
                  component: LogstashDatasource,
                  meta: {
                    title: "Logstash",
                    searchable: true,
                    icon: "stream",
                    section: "Data Sources",
                    keywords: [
                      "ELK stack",
                      "log processing",
                      "log pipeline",
                      "Logstash",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "syslogng",
                  name: "syslogNg",
                  component: SyslogNg,
                  meta: {
                    title: "Syslog-ng",
                    searchable: true,
                    icon: "text_snippet",
                    section: "Data Sources",
                    keywords: [
                      "syslog",
                      "syslog-ng",
                      "log collection",
                      "log aggregation",
                    ],
                  },
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
              meta: {
                title: "Custom Metrics Ingestion",
                searchable: true,
                icon: "show_chart",
                section: "Data Sources",
                keywords: [
                  "custom metrics",
                  "metrics ingestion",
                  "prometheus",
                  "telegraf",
                  "cloudwatch",
                  "otel metrics",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "prometheus",
                  name: "prometheus",
                  component: PrometheusConfig,
                  meta: {
                    title: "Prometheus",
                    searchable: true,
                    icon: "show_chart",
                    section: "Data Sources",
                    keywords: [
                      "metrics scraping",
                      "prometheus remote write",
                      "time series",
                      "PromQL",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "otelcollector",
                  name: "otelCollector",
                  component: OtelCollector,
                  meta: {
                    title: "OpenTelemetry Collector (Metrics)",
                    searchable: true,
                    icon: "analytics",
                    section: "Data Sources",
                    keywords: [
                      "OTEL metrics",
                      "OTel collector",
                      "metrics pipeline",
                      "OpenTelemetry metrics",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "telegraf",
                  name: "telegraf",
                  component: TelegrafConfig,
                  meta: {
                    title: "Telegraf",
                    searchable: true,
                    icon: "analytics",
                    section: "Data Sources",
                    keywords: [
                      "InfluxDB telegraf",
                      "metrics collection",
                      "telegraf agent",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "cloudwatchMetrics",
                  name: "cloudwatchMetrics",
                  component: CloudWatchMetricConfig,
                  meta: {
                    title: "CloudWatch Metrics",
                    searchable: true,
                    icon: "cloud",
                    section: "Data Sources",
                    keywords: [
                      "AWS CloudWatch",
                      "cloud metrics",
                      "AWS monitoring",
                      "CloudWatch",
                    ],
                  },
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
              meta: {
                title: "Custom Trace Ingestion",
                searchable: true,
                icon: "account_tree",
                section: "Data Sources",
                keywords: [
                  "custom traces",
                  "trace ingestion",
                  "opentelemetry",
                  "OTLP",
                  "distributed tracing",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
              children: [
                {
                  path: "opentelemetry",
                  name: "tracesOTLP",
                  component: OpenTelemetry,
                  meta: {
                    title: "OpenTelemetry Traces",
                    searchable: true,
                    icon: "account_tree",
                    section: "Data Sources",
                    keywords: [
                      "OTLP traces",
                      "distributed tracing",
                      "OTel traces",
                      "OpenTelemetry",
                    ],
                  },
                  beforeEnter(to: any, from: any, next: any) {
                    routeGuard(to, from, next);
                  },
                },
                {
                  path: "otel",
                  name: "ingestTracesFromOtel",
                  component: OtelConfig,
                  meta: {
                    title: "OpenTelemetry Collector (Traces)",
                    searchable: true,
                    icon: "account_tree",
                    section: "Data Sources",
                    keywords: [
                      "OTEL traces",
                      "OTel collector",
                      "trace pipeline",
                      "OpenTelemetry collector traces",
                    ],
                  },
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
          meta: {
            title: "Recommended Integrations",
            titleKey: "ingestion.recommendedLabel",
            searchable: true,
            icon: "star",
            section: "Data Sources",
            keywords: [
              "Kubernetes",
              "Linux",
              "Windows",
              "AWS",
              "GCP",
              "Azure",
              "OpenTelemetry",
              "RUM",
              "frontend monitoring",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "kubernetes",
              name: "ingestFromKubernetes",
              component: KubernetesConfig,
              meta: {
                title: "Kubernetes",
                searchable: true,
                icon: "hub",
                section: "Data Sources",
                keywords: [
                  "k8s",
                  "container logs",
                  "pod logs",
                  "cluster monitoring",
                  "Helm",
                  "Kubernetes ingestion",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "windows",
              name: "ingestFromWindows",
              component: WindowsConfig,
              meta: {
                title: "Windows",
                searchable: true,
                icon: "computer",
                section: "Data Sources",
                keywords: [
                  "Windows logs",
                  "Windows events",
                  "WinEvent",
                  "Windows monitoring",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "linux",
              name: "ingestFromLinux",
              component: LinuxConfig,
              meta: {
                title: "Linux",
                searchable: true,
                icon: "terminal",
                section: "Data Sources",
                keywords: [
                  "Linux logs",
                  "syslog",
                  "Linux monitoring",
                  "system logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "aws",
              name: "AWSConfig",
              component: AWSConfig,
              meta: {
                title: "AWS",
                searchable: true,
                icon: "cloud",
                section: "Data Sources",
                keywords: [
                  "Amazon Web Services",
                  "CloudWatch",
                  "S3 logs",
                  "AWS ingestion",
                  "cloud logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "gcp",
              name: "GCPConfig",
              component: GCPConfig,
              meta: {
                title: "GCP",
                searchable: true,
                icon: "cloud",
                section: "Data Sources",
                keywords: [
                  "Google Cloud Platform",
                  "GCP logs",
                  "Cloud Logging",
                  "Pub/Sub",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "azure",
              name: "AzureConfig",
              component: AzureConfig,
              meta: {
                title: "Azure",
                searchable: true,
                icon: "cloud",
                section: "Data Sources",
                keywords: [
                  "Microsoft Azure",
                  "Azure Monitor",
                  "Azure logs",
                  "cloud logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "traces",
              name: "ingestFromTraces",
              component: OpenTelemetry,
              meta: {
                title: "OpenTelemetry Traces",
                searchable: true,
                icon: "account_tree",
                section: "Data Sources",
                keywords: [
                  "OTLP traces",
                  "distributed tracing",
                  "trace ingestion",
                  "OpenTelemetry",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "frontend-monitoring",
              name: "frontendMonitoring",
              component: RUMWeb,
              meta: {
                title: "Frontend Monitoring (RUM)",
                searchable: true,
                icon: "monitor",
                section: "Data Sources",
                keywords: [
                  "Real User Monitoring",
                  "RUM",
                  "browser monitoring",
                  "JavaScript SDK",
                  "frontend telemetry",
                ],
              },
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
          meta: {
            title: "Database Integrations",
            titleKey: "ingestion.databaseLabel",
            searchable: true,
            icon: "storage",
            section: "Data Sources",
            keywords: [
              "database",
              "SQL",
              "NoSQL",
              "relational",
              "PostgreSQL",
              "MySQL",
              "MongoDB",
              "Redis",
              "Oracle",
              "Snowflake",
              "Cassandra",
              "DynamoDB",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "sqlserver",
              name: "sqlserver",
              component: SqlServer,
              meta: {
                title: "SQL Server",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Microsoft SQL Server",
                  "MSSQL",
                  "relational database",
                  "SQL database",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "postgres",
              name: "postgres",
              component: Postgres,
              meta: {
                title: "PostgreSQL",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Postgres",
                  "PostgreSQL",
                  "relational database",
                  "SQL database",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "mongodb",
              name: "mongodb",
              component: MongoDB,
              meta: {
                title: "MongoDB",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "NoSQL",
                  "document database",
                  "MongoDB",
                  "document store",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "redis",
              name: "redis",
              component: Redis,
              meta: {
                title: "Redis",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "in-memory database",
                  "Redis cache",
                  "key-value store",
                  "Redis",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "couchdb",
              name: "couchdb",
              component: CouchDB,
              meta: {
                title: "CouchDB",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Apache CouchDB",
                  "document database",
                  "NoSQL",
                  "CouchDB",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "elasticsearch",
              name: "elasticsearch",
              component: Elasticsearch,
              meta: {
                title: "Elasticsearch",
                searchable: true,
                icon: "search",
                section: "Data Sources",
                keywords: [
                  "Elastic search",
                  "search engine",
                  "ELK stack",
                  "search index",
                  "Elasticsearch",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "mysql",
              name: "mysql",
              component: MySQL,
              meta: {
                title: "MySQL",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "MySQL",
                  "relational database",
                  "SQL",
                  "MariaDB",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "oracle",
              name: "oracle",
              component: Oracle,
              meta: {
                title: "Oracle Database",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Oracle DB",
                  "Oracle SQL",
                  "relational database",
                  "Oracle",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "saphana",
              name: "saphana",
              component: SAPHana,
              meta: {
                title: "SAP HANA",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "SAP HANA",
                  "in-memory database",
                  "SAP database",
                  "HANA analytics",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "snowflake",
              name: "snowflake",
              component: Snowflake,
              meta: {
                title: "Snowflake",
                searchable: true,
                icon: "ac_unit",
                section: "Data Sources",
                keywords: [
                  "Snowflake data warehouse",
                  "cloud database",
                  "data warehouse",
                  "Snowflake",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "zookeeper",
              name: "zookeeper",
              component: Zookeeper,
              meta: {
                title: "Zookeeper",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Apache ZooKeeper",
                  "distributed coordination",
                  "configuration management",
                  "ZooKeeper",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "cassandra",
              name: "cassandra",
              component: Cassandra,
              meta: {
                title: "Cassandra",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Apache Cassandra",
                  "NoSQL",
                  "wide-column store",
                  "distributed database",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "aerospike",
              name: "aerospike",
              component: Aerospike,
              meta: {
                title: "Aerospike",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "Aerospike database",
                  "in-memory NoSQL",
                  "key-value database",
                  "Aerospike",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "dynamodb",
              name: "dynamodb",
              component: DynamoDB,
              meta: {
                title: "DynamoDB",
                searchable: true,
                icon: "storage",
                section: "Data Sources",
                keywords: [
                  "AWS DynamoDB",
                  "NoSQL",
                  "serverless database",
                  "Amazon database",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "databricks",
              name: "databricks",
              component: Databricks,
              meta: {
                title: "Databricks",
                searchable: true,
                icon: "analytics",
                section: "Data Sources",
                keywords: [
                  "Databricks",
                  "data lakehouse",
                  "Apache Spark",
                  "data engineering",
                ],
              },
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
          meta: {
            title: "Security Integrations",
            titleKey: "ingestion.securityLabel",
            searchable: true,
            icon: "security",
            section: "Data Sources",
            keywords: [
              "SIEM",
              "endpoint security",
              "Falco",
              "osquery",
              "Okta",
              "JumpCloud",
              "OpenVPN",
              "Microsoft 365",
              "Google Workspace",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "falco",
              name: "falco",
              component: Falco,
              meta: {
                title: "Falco",
                searchable: true,
                icon: "security",
                section: "Data Sources",
                keywords: [
                  "runtime security",
                  "cloud-native security",
                  "container security",
                  "Falco SIEM",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "osquery",
              name: "osquery",
              component: OSQuery,
              meta: {
                title: "OSQuery",
                searchable: true,
                icon: "security",
                section: "Data Sources",
                keywords: [
                  "osquery",
                  "endpoint security",
                  "system introspection",
                  "SQL endpoint queries",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "okta",
              name: "okta",
              component: Okta,
              meta: {
                title: "Okta",
                searchable: true,
                icon: "lock",
                section: "Data Sources",
                keywords: [
                  "identity management",
                  "SSO",
                  "Okta logs",
                  "authentication",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "jumpcloud",
              name: "jumpcloud",
              component: Jumpcloud,
              meta: {
                title: "JumpCloud",
                searchable: true,
                icon: "lock",
                section: "Data Sources",
                keywords: [
                  "JumpCloud directory",
                  "identity provider",
                  "SSO",
                  "cloud directory",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "openvpn",
              name: "openvpn",
              component: OpenVPN,
              meta: {
                title: "OpenVPN",
                searchable: true,
                icon: "vpn_lock",
                section: "Data Sources",
                keywords: [
                  "VPN logs",
                  "OpenVPN access server",
                  "network access",
                  "VPN monitoring",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "office365",
              name: "office365",
              component: Office365,
              meta: {
                title: "Microsoft 365",
                searchable: true,
                icon: "business",
                section: "Data Sources",
                keywords: [
                  "Office 365",
                  "Microsoft 365",
                  "Exchange logs",
                  "SharePoint logs",
                  "M365",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "google-workspace",
              name: "google-workspace",
              component: GoogleWorkspace,
              meta: {
                title: "Google Workspace",
                searchable: true,
                icon: "business",
                section: "Data Sources",
                keywords: [
                  "Google Workspace",
                  "G Suite",
                  "Gmail logs",
                  "Google audit logs",
                ],
              },
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
          meta: {
            title: "DevOps Integrations",
            titleKey: "ingestion.devopsLabel",
            searchable: true,
            icon: "build",
            section: "Data Sources",
            keywords: [
              "CI/CD",
              "Jenkins",
              "Ansible",
              "Terraform",
              "GitHub Actions",
              "infrastructure automation",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "jenkins",
              name: "jenkins",
              component: Jenkins,
              meta: {
                title: "Jenkins",
                searchable: true,
                icon: "build",
                section: "Data Sources",
                keywords: [
                  "CI/CD",
                  "Jenkins pipeline",
                  "build automation",
                  "continuous integration",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "ansible",
              name: "ansible",
              component: Ansible,
              meta: {
                title: "Ansible",
                searchable: true,
                icon: "settings_ethernet",
                section: "Data Sources",
                keywords: [
                  "configuration management",
                  "Ansible playbook",
                  "infrastructure automation",
                  "Ansible",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "terraform",
              name: "terraform",
              component: Terraform,
              meta: {
                title: "Terraform",
                searchable: true,
                icon: "construction",
                section: "Data Sources",
                keywords: [
                  "infrastructure as code",
                  "IaC",
                  "Terraform state",
                  "HashiCorp",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "github-actions",
              name: "github-actions",
              component: GithubActions,
              meta: {
                title: "GitHub Actions",
                searchable: true,
                icon: "play_circle",
                section: "Data Sources",
                keywords: [
                  "CI/CD",
                  "GitHub workflows",
                  "GitHub Actions logs",
                  "continuous delivery",
                ],
              },
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
          meta: {
            title: "Networking Integrations",
            titleKey: "ingestion.networkingLabel",
            searchable: true,
            icon: "network_check",
            section: "Data Sources",
            keywords: ["network", "NetFlow", "IPFIX", "sFlow", "network traffic"],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "netflow",
              name: "netflow",
              component: Netflow,
              meta: {
                title: "NetFlow",
                searchable: true,
                icon: "network_check",
                section: "Data Sources",
                keywords: [
                  "network flow",
                  "NetFlow protocol",
                  "network traffic",
                  "IPFIX",
                  "sFlow",
                ],
              },
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
          meta: {
            title: "Server Integrations",
            titleKey: "ingestion.serverLabel",
            searchable: true,
            icon: "dns",
            section: "Data Sources",
            keywords: [
              "web server",
              "Nginx",
              "Apache",
              "IIS",
              "server logs",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "nginx",
              name: "nginx",
              component: Nginx,
              meta: {
                title: "Nginx",
                searchable: true,
                icon: "dns",
                section: "Data Sources",
                keywords: [
                  "Nginx web server",
                  "reverse proxy",
                  "load balancer",
                  "web server logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "apache",
              name: "apache",
              component: Apache,
              meta: {
                title: "Apache HTTP Server",
                searchable: true,
                icon: "dns",
                section: "Data Sources",
                keywords: [
                  "Apache web server",
                  "httpd",
                  "web server logs",
                  "Apache access logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "iis",
              name: "iis",
              component: IIS,
              meta: {
                title: "IIS",
                searchable: true,
                icon: "dns",
                section: "Data Sources",
                keywords: [
                  "Internet Information Services",
                  "IIS logs",
                  "Windows web server",
                  "Microsoft IIS",
                ],
              },
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
          meta: {
            title: "Message Queue Integrations",
            titleKey: "ingestion.messageQueuesLabel",
            searchable: true,
            icon: "queue",
            section: "Data Sources",
            keywords: [
              "message queue",
              "message broker",
              "Kafka",
              "RabbitMQ",
              "NATS",
              "event streaming",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "rabbitmq",
              name: "rabbitmq",
              component: RabbitMQ,
              meta: {
                title: "RabbitMQ",
                searchable: true,
                icon: "queue",
                section: "Data Sources",
                keywords: [
                  "message broker",
                  "RabbitMQ",
                  "AMQP",
                  "message queue",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "kafka",
              name: "kafka",
              component: Kafka,
              meta: {
                title: "Apache Kafka",
                searchable: true,
                icon: "queue",
                section: "Data Sources",
                keywords: [
                  "Kafka streaming",
                  "event streaming",
                  "message broker",
                  "Kafka topics",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "nats",
              name: "nats",
              component: NATS,
              meta: {
                title: "NATS",
                searchable: true,
                icon: "queue",
                section: "Data Sources",
                keywords: [
                  "NATS messaging",
                  "pub/sub",
                  "message bus",
                  "event streaming",
                ],
              },
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
          meta: {
            title: "Language SDKs",
            titleKey: "ingestion.languagesLabel",
            searchable: true,
            icon: "code",
            section: "Data Sources",
            keywords: [
              "SDK",
              "Python",
              "Java",
              "Node.js",
              "Go",
              "Rust",
              ".NET",
              "FastAPI",
              "programming language",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "python",
              name: "python",
              component: Python,
              meta: {
                title: "Python",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  "Python SDK",
                  "Python logs",
                  "Python tracing",
                  "Python application monitoring",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "dotnettracing",
              name: "dotnettracing",
              component: DotNetTracing,
              meta: {
                title: ".NET Tracing",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  ".NET",
                  "C#",
                  "ASP.NET tracing",
                  "dotnet traces",
                  "OpenTelemetry .NET",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "dotnetlogs",
              name: "dotnetlogs",
              component: DotNetLogs,
              meta: {
                title: ".NET Logs",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  ".NET logs",
                  "C# logging",
                  "ASP.NET logs",
                  "dotnet application logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "nodejs",
              name: "nodejs",
              component: NodeJS,
              meta: {
                title: "Node.js",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  "Node.js SDK",
                  "JavaScript backend",
                  "Express logs",
                  "Node application monitoring",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "java",
              name: "java",
              component: Java,
              meta: {
                title: "Java",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  "Java SDK",
                  "Spring Boot",
                  "JVM tracing",
                  "Java application monitoring",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "go",
              name: "go",
              component: Go,
              meta: {
                title: "Go (Golang)",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  "Golang SDK",
                  "Go application logs",
                  "Go tracing",
                  "Golang monitoring",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "rust",
              name: "rust",
              component: Rust,
              meta: {
                title: "Rust",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  "Rust SDK",
                  "Rust application logs",
                  "Rust tracing",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "fastapi",
              name: "fastapi",
              component: FastAPI,
              meta: {
                title: "FastAPI",
                searchable: true,
                icon: "code",
                section: "Data Sources",
                keywords: [
                  "FastAPI Python",
                  "REST API monitoring",
                  "Python web framework",
                  "FastAPI logs",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
        {
          path: "others",
          name: "others",
          component: Others,
          meta: {
            title: "Other Integrations",
            titleKey: "ingestion.otherLabel",
            searchable: true,
            icon: "extension",
            section: "Data Sources",
            keywords: [
              "Airflow",
              "Airbyte",
              "Cribl",
              "Vercel",
              "Heroku",
              "other integrations",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "airflow",
              name: "airflow",
              component: Airflow,
              meta: {
                title: "Apache Airflow",
                searchable: true,
                icon: "air",
                section: "Data Sources",
                keywords: [
                  "Airflow DAGs",
                  "workflow orchestration",
                  "data pipeline logs",
                  "Airflow",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "airbyte",
              name: "airbyte",
              component: Airbyte,
              meta: {
                title: "Airbyte",
                searchable: true,
                icon: "sync",
                section: "Data Sources",
                keywords: [
                  "Airbyte ETL",
                  "data integration",
                  "ELT platform",
                  "data pipeline",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "cribl",
              name: "cribl",
              component: Cribl,
              meta: {
                title: "Cribl",
                searchable: true,
                icon: "settings_input_component",
                section: "Data Sources",
                keywords: [
                  "Cribl Stream",
                  "data routing",
                  "log management",
                  "Cribl",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "vercel",
              name: "vercel",
              component: Vercel,
              meta: {
                title: "Vercel",
                searchable: true,
                icon: "cloud_upload",
                section: "Data Sources",
                keywords: [
                  "Vercel logs",
                  "serverless deployment",
                  "Next.js hosting",
                  "edge functions",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "heroku",
              name: "heroku",
              component: Heroku,
              meta: {
                title: "Heroku",
                searchable: true,
                icon: "cloud_upload",
                section: "Data Sources",
                keywords: [
                  "Heroku logs",
                  "PaaS",
                  "Heroku dyno",
                  "cloud application platform",
                ],
              },
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
