// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import Home from "@/views/HomeView.vue";
import Tickets from "@/views/TicketsView.vue";
import Users from "@/views/User.vue";
import About from "@/views/About.vue";
import ViewDashboard from "@/views/Dashboards/ViewDashboard.vue";
import AddPanel from "@/views/Dashboards/addPanel/AddPanel.vue";
import MemberSubscription from "@/views/MemberSubscription.vue";
import Search from "@/views/Search.vue";
import AppMetrics from "@/views/AppMetrics.vue";
import AppTraces from "@/views/AppTraces.vue";
import LogStream from "@/views/LogStream.vue";
import {
  FunctionList,
  AssociatedStreamFunction,
} from "../../components/functions/index";
import Alerts from "@/views/AppAlerts.vue";
import Ingestion from "@/views/Ingestion.vue";
import Error404 from "@/views/Error404.vue";
import Dashboards from "@/views/Dashboards/Dashboards.vue";
import FluentBit from "@/components/ingestion/logs/FluentBit.vue";
import Fluentd from "@/components/ingestion/logs/Fluentd.vue";
import Vector from "@/components/ingestion/logs/Vector.vue";
import Curl from "@/components/ingestion/logs/Curl.vue";
import KinesisFirehose from "@/components/ingestion/logs/KinesisFirehose.vue";
import OpenTelemetry from "@/components/ingestion/traces/OpenTelemetry.vue";
import PrometheusConfig from "@/components/ingestion/metrics/PrometheusConfig.vue";
import OtelCollector from "@/components/ingestion/metrics/OtelCollector.vue";
import TelegrafConfig from "@/components/ingestion/metrics/TelegrafConfig.vue";
import IngestLogs from "@/components/ingestion/logs/Index.vue";
import IngestMetrics from "@/components/ingestion/metrics/Index.vue";
import IngestTraces from "@/components/ingestion/traces/Index.vue";
import {
  AlertList,
  TemplateList,
  DestinationList,
} from "@/components/alerts/index";
import ImportDashboard from "@/views/Dashboards/ImportDashboard.vue";
import Functions from "../../views/Functions.vue";

const useRoutes = () => {
  const parentRoutes: never[] = [];

  const homeChildRoutes = [
    {
      path: "",
      name: "home",
      component: Home,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "logs",
      name: "logs",
      component: Search,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "metrics",
      name: "metrics",
      component: AppMetrics,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "traces",
      name: "traces",
      component: AppTraces,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "logstreams",
      name: "logstreams",
      component: LogStream,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "tickets",
      name: "tickets",
      component: Tickets,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "about",
      name: "about",
      component: About,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "dashboards",
      name: "dashboards",
      component: Dashboards,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "/dashboards/view",
      name: "viewDashboard",
      component: ViewDashboard,
      props: true,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "/dashboards/import",
      name: "importDashboard",
      component: ImportDashboard,
      props: true,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "/dashboards/add_panel",
      name: "addPanel",
      component: AddPanel,
      props: true,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "users",
      name: "users",
      component: Users,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "member_subscription",
      name: "member_subscription",
      component: MemberSubscription,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: "functions",
      name: "functions",
      component: Functions,
      children: [
        {
          path: "functions",
          name: "functionList",
          component: FunctionList,
        },
        {
          path: "stream-association",
          name: "streamFunctions",
          component: AssociatedStreamFunction,
        },
      ],
    },
    {
      path: "ingestion",
      name: "ingestion",
      component: Ingestion,
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
              path: "kinesisfirehose",
              name: "kinesisfirehose",
              component: KinesisFirehose,
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
          ],
        },
      ],
    },
    {
      path: "alerts",
      name: "alerts",
      component: Alerts,
      children: [
        {
          path: "alerts",
          name: "alertList",
          component: AlertList,
        },
        {
          path: "destinations",
          name: "alertDestinations",
          component: DestinationList,
        },
        {
          path: "templates",
          name: "alertTemplates",
          component: TemplateList,
        },
      ],
    },
    {
      path: "/:catchAll(.*)*",
      component: Error404,
      meta: {
        keepAlive: true,
      },
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useRoutes;
