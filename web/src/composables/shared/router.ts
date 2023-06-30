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
import StreamExplorer from "@/views/StreamExplorer.vue";
import {
  FunctionList,
  AssociatedStreamFunction,
  EnrichmentTableList,
} from "../../components/functions/index";
import Alerts from "@/views/AppAlerts.vue";
import Error404 from "@/views/Error404.vue";
import Dashboards from "@/views/Dashboards/Dashboards.vue";
import {
  AlertList,
  TemplateList,
  DestinationList,
} from "@/components/alerts/index";
import ImportDashboard from "@/views/Dashboards/ImportDashboard.vue";
import Functions from "../../views/Functions.vue";
import { routeGuardPendingSubscriptions } from "@/utils/zincutils";
import useIngestionRoutes from "./useIngestionRoutes";
import VariableSettings from "../../components/dashboards/settings/VariableSettings.vue"
import GeneralSettings from "../../components/dashboards/settings/GeneralSettings.vue"
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
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      path: "metrics",
      name: "metrics",
      component: AppMetrics,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      path: "traces",
      name: "traces",
      component: AppTraces,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      name: "streamExplorer",
      path: "logstreams/stream-explore",
      component: StreamExplorer,
      props: true,
    },
    {
      path: "logstreams",
      name: "logstreams",
      component: LogStream,
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      path: "tickets",
      name: "tickets",
      component: Tickets,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
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
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
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
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
      children: [
        {
          path: "general-settings",
          name: "generalSettings",
          component: GeneralSettings,
        },
        {
          path: "variable-settings",
          name: "variableSettings",
          component: VariableSettings,
        }
      ]
    },
    {
      path: "/dashboards/import",
      name: "importDashboard",
      component: ImportDashboard,
      props: true,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
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
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      path: "users",
      name: "users",
      component: Users,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      path: "member_subscription",
      name: "member_subscription",
      component: MemberSubscription,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
    },
    {
      path: "functions",
      name: "functions",
      component: Functions,
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
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
        {
          path: "enrichment-tables",
          name: "enrichmentTables",
          component: EnrichmentTableList,
        },
      ],
    },
    {
      path: "alerts",
      name: "alerts",
      component: Alerts,
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
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
    ...useIngestionRoutes(),
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
