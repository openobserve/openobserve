// Copyright 2023 Zinc Labs Inc.

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
const ViewDashboard = () => import("@/views/Dashboards/ViewDashboard.vue");
const AddPanel = () => import("@/views/Dashboards/addPanel/AddPanel.vue");
import MemberSubscription from "@/views/MemberSubscription.vue";
const Search = () => import("@/views/Search.vue");
const AppMetrics = () => import("@/views/AppMetrics.vue");
const AppTraces = () => import("@/views/AppTraces.vue");
const LogStream = () => import("@/views/LogStream.vue");
const StreamExplorer = () => import("@/views/StreamExplorer.vue");
const Alerts = () => import("@/views/AppAlerts.vue");
import Error404 from "@/views/Error404.vue";
const Dashboards = () => import("@/views/Dashboards/Dashboards.vue");
const AlertList = () => import("@/components/alerts/AlertList.vue");
const TemplateList = () => import("@/components/alerts/TemplateList.vue");
const DestinationList = () => import("@/components/alerts/DestinationList.vue");
const Settings = () => import("@/components/settings/index.vue");

import ImportDashboard from "@/views/Dashboards/ImportDashboard.vue";
const Functions = () => import("@/views/Functions.vue");
const FunctionList = () => import("@/components/functions/FunctionList.vue");
const AssociatedStreamFunction = () =>
  import("@/components/functions/AssociatedStreamFunction.vue");
const EnrichmentTableList = () =>
  import("@/components/functions/EnrichmentTableList.vue");
const RealUserMonitoring = () => import("@/views/RUM/RealUserMonitoring.vue");
const SessionViewer = () => import("@/views/RUM/SessionViewer.vue");
const ErrorViewer = () => import("@/views/RUM/ErrorViewer.vue");
const AppPerformance = () => import("@/views/RUM/AppPerformance.vue");
const AppErrors = () => import("@/views/RUM/AppErrors.vue");
const AppSessions = () => import("@/views/RUM/AppSessions.vue");

import { routeGuardPendingSubscriptions } from "@/utils/zincutils";
import useIngestionRoutes from "./useIngestionRoutes";
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
        // keepAlive: true,
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
      path: "settings",
      name: "settings",
      component: Settings,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
      children: [
        {
          path: "general",
          name: "general",
          component: () => import("@/components/settings/General.vue"),
        },
      ],
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
      meta: {
        keepAlive: true,
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
    {
      path: "rum",
      name: "RUM",
      component: RealUserMonitoring,
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
      children: [
        {
          path: "sessions",
          name: "Sessions",
          component: AppSessions,
        },
        {
          path: "sessions/view/:id",
          name: "SessionViewer",
          component: SessionViewer,
          props: true,
        },
        {
          path: "errors",
          name: "ErrorTracking",
          component: AppErrors,
        },
        {
          path: "errors/view/:id",
          name: "ErrorViewer",
          component: ErrorViewer,
          props: true,
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
