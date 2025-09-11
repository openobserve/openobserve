// Copyright 2023 OpenObserve Inc.
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
import MongoDB from '@/components/ingestion/databases/MongoDB.vue';
import Redis from '@/components/ingestion/databases/Redis.vue';
import CouchDB from '@/components/ingestion/databases/CouchDB.vue';
import Elasticsearch from '@/components/ingestion/databases/Elasticsearch.vue';
import MySQL from '@/components/ingestion/databases/MySQL.vue';
import SAPHana from '@/components/ingestion/databases/SAPHana.vue';
import Snowflake from '@/components/ingestion/databases/Snowflake.vue';
import Zookeeper from '@/components/ingestion/databases/Zookeeper.vue';
import Cassandra from '@/components/ingestion/databases/Cassandra.vue';
import Aerospike from '@/components/ingestion/databases/Aerospike.vue';
import DynamoDB from '@/components/ingestion/databases/DynamoDB.vue';
import Databricks from '@/components/ingestion/databases/Databricks.vue';

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
      meta:{
        title: "Ingestion",
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
          ]
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
          ]
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
              }
            },
            {
              path: "nats",
              name: "nats",
              component: NATS,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
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
              }
            },
            {
              path: "dotnetlogs",
              name: "dotnetlogs",
              component: DotNetLogs,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
            },
            {
              path: "nodejs",
              name: "nodejs",
              component: NodeJS,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
            },
            {
              path: "java",
              name: "java",
              component: Java,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
            },
            {
              path: "go",
              name: "go",
              component: Go,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
            },
            {
              path: "rust",
              name: "rust",
              component: Rust,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
            },
            {
              path: "fastapi",
              name: "fastapi",
              component: FastAPI,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              }
            },
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
