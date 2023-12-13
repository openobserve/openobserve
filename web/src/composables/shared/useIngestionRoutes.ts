// Copyright 2023 Zinc Labs Inc.
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
import SysLog from "@/components/ingestion/logs/SysLog.vue";
import SyslogNg from "@/components/ingestion/logs/SyslogNg.vue";
import Ingestion from "@/views/Ingestion.vue";
import FluentBit from "@/components/ingestion/logs/FluentBit.vue";
import Fluentd from "@/components/ingestion/logs/Fluentd.vue";
import Vector from "@/components/ingestion/logs/Vector.vue";
import Curl from "@/components/ingestion/logs/Curl.vue";
import KinesisFirehose from "@/components/ingestion/logs/KinesisFirehose.vue";
import GcpPubSub from "@/components/ingestion/logs/GcpPubSub.vue";
import FileBeat from "@/components/ingestion/logs/FileBeat.vue";
import OpenTelemetry from "@/components/ingestion/traces/OpenTelemetry.vue";
import PrometheusConfig from "@/components/ingestion/metrics/PrometheusConfig.vue";
import OtelCollector from "@/components/ingestion/metrics/OtelCollector.vue";
import TelegrafConfig from "@/components/ingestion/metrics/TelegrafConfig.vue";
import IngestLogs from "@/components/ingestion/logs/Index.vue";
import IngestMetrics from "@/components/ingestion/metrics/Index.vue";
import IngestTraces from "@/components/ingestion/traces/Index.vue";
import Recommended from "@/components/ingestion/Recommended.vue";
import Custom from "@/components/ingestion/Custom.vue";

import RUMWeb from "@/components/ingestion/recommended/FrontendRumConfig.vue";
import KubernetesConfig from "@/components/ingestion/recommended/KubernetesConfig.vue";
import LinuxConfig from "@/components/ingestion/recommended/LinuxConfig.vue";
import OtelConfig from "@/components/ingestion/recommended/OtelConfig.vue";
import WindowsConfig from "@/components/ingestion/recommended/WindowsConfig.vue";

const useIngestionRoutes = () => {
  const ingestionRoutes: any = [
    {
      path: "ingestion",
      name: "ingestion",
      component: Ingestion,
      children: [
        {
          path: "custom",
          name: "custom",
          component: Custom,
          children: [
            {
              path: "logs",
              name: "ingestLogs",
              component: IngestLogs,
              children: [
                {
                  path: "curl",
                  name: "curl",
                  component: Curl,
                },
                {
                  path: "fluentbit",
                  name: "fluentbit",
                  component: FluentBit,
                },
                {
                  path: "fluentd",
                  name: "fluentd",
                  component: Fluentd,
                },
                {
                  path: "vector",
                  name: "vector",
                  component: Vector,
                },
                {
                  path: "filebeat",
                  name: "filebeat",
                  component: FileBeat,
                },
                {
                  path: "otel",
                  name: "ingestLogsFromOtel",
                  component: OtelConfig,
                },
              ],
            },
            {
              path: "metrics",
              name: "ingestMetrics",
              component: IngestMetrics,
              children: [
                {
                  path: "prometheus",
                  name: "prometheus",
                  component: PrometheusConfig,
                },
                {
                  path: "otelcollector",
                  name: "otelCollector",
                  component: OtelCollector,
                },
                {
                  path: "telegraf",
                  name: "telegraf",
                  component: TelegrafConfig,
                },
              ],
            },
            {
              path: "traces",
              name: "ingestTraces",
              component: IngestTraces,
              children: [
                {
                  path: "opentelemetry",
                  name: "tracesOTLP",
                  component: OpenTelemetry,
                },
                {
                  path: "otel",
                  name: "ingestTracesFromOtel",
                  component: OtelConfig,
                },
              ],
            },
          ],
        },
        {
          path: "recommended",
          name: "recommended",
          component: Recommended,
          children: [
            {
              path: "kubernetes",
              name: "ingestFromKubernetes",
              component: KubernetesConfig,
            },
            {
              path: "windows",
              name: "ingestFromWindows",
              component: WindowsConfig,
            },
            {
              path: "linux",
              name: "ingestFromLinux",
              component: LinuxConfig,
            },
            {
              path: "traces",
              name: "ingestFromTraces",
              component: OpenTelemetry,
            },
            {
              path: "frontend-monitoring",
              name: "frontendMonitoring",
              component: RUMWeb,
            },
          ],
        },
      ],
    },
  ];

  const sysLog = {
    path: "syslog",
    name: "syslog",
    component: SysLog,
  };

  const sysLogNg = {
    path: "syslogng",
    name: "syslogNg",
    component: SyslogNg,
  };

  const kinesisFirehose = {
    path: "kinesisfirehose",
    name: "kinesisfirehose",
    component: KinesisFirehose,
  };

  const gcpPubSub = {
    path: "gcp",
    name: "gcpLogs",
    component: GcpPubSub,
  };

  if (config.isCloud === "false" || !config.isCloud) {
    ingestionRoutes[0].children
      .find((child: any) => child.name === "custom")
      .children.find((child: any) => child.name === "ingestLogs")
      ?.children.push(...[sysLog, sysLogNg]);
  } else {
    ingestionRoutes[0].children
      .find((child: any) => child.name === "custom")
      .children.find((child: any) => child.name === "ingestLogs")
      ?.children.push(...[kinesisFirehose, gcpPubSub]);
  }
  return ingestionRoutes;
};

export default useIngestionRoutes;
