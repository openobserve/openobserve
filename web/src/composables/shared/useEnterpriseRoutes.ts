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
import ServiceAccountsList from "@/components/iam/serviceAccounts/ServiceAccountsList.vue";
import { routeGuard } from "@/utils/zincutils";
import store from "@/stores";

// Synthetics routes are gated on the backend /config flag `synthetics_enabled`
// (enterprise O2_SYNTHETICS_ENABLED). Direct URL access redirects home when off.
const syntheticsRouteGuard = (to: any, from: any, next: any) => {
  if (store.state.zoConfig?.synthetics_enabled === false) {
    next("/");
    return;
  }
  routeGuard(to, from, next);
};

const IdentityAccessManagement = () =>
  import("@/views/IdentityAccessManagement.vue");

const AppGroups = () => import("@/components/iam/groups/AppGroups.vue");

const AppRoles = () => import("@/components/iam/roles/AppRoles.vue");

const EditRole = () => import("@/components/iam/roles/EditRole.vue");

const EditGroup = () => import("@/components/iam/groups/EditGroup.vue");

const Quota = () => import("@/components/iam/quota/Quota.vue");

const Organizations = () =>
  import("@/components/iam/organizations/AppOrganizations.vue");

const ActionScripts = () =>
  import("@/components/actionScripts/ActionScripts.vue");

const Invitations = () => import("@/views/Invitations.vue");

import Users from "@/views/User.vue";

const IncidentList = () => import("@/components/alerts/IncidentList.vue");

const WorkflowsList = () =>
  import("@/components/workflows/WorkflowsList.vue");

const WorkflowEditor = () =>
  import("@/components/workflows/WorkflowEditor.vue");

const WorkflowRuns = () =>
  import("@/components/workflows/WorkflowRuns.vue");

const useEnterpriseRoutes = () => {
  const routes: any = [
    {
      path: "iam",
      name: "iam",
      component: IdentityAccessManagement,
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "users",
          name: "users",
          meta: {
            title: "Users",
          },
          component: Users,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "ingestionTokens",
          name: "ingestionTokens",
          meta: {
            title: "Ingestion Tokens",
          },
          component: () =>
            import("@/components/iam/IngestionTokens.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "serviceAccounts",
          name: "serviceAccounts",
          meta: {
            title: "Service Accounts",
          },
          component: ServiceAccountsList,
          beforeEnter(to: any, from: any, next: any) {
            // Check if service accounts are enabled
            // Note: Using window.store here because useStore() doesn't work in route guards
            const store = (window as any).store;
            const serviceAccountEnabled = store?.state?.zoConfig?.service_account_enabled ?? true;

            if (!serviceAccountEnabled) {
              // Redirect to users page if service accounts are disabled
              next({ name: "users", query: to.query });
              return;
            }

            routeGuard(to, from, next);
          },
        },
        {
          path: "organizations",
          name: "organizations",
          meta: {
            title: "Organizations",
          },
          component: Organizations,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    },
  ];
  //the below are the routes that we support for enterprise and cloud
  //the above are the routes that we support for oss including both enterprise and cloud

  if (config.isCloud == "true" || config.isEnterprise == "true") {
    // Inbound MCP server setup — lives under IAM as a credentialed-access
    // surface, alongside Service Accounts / Ingestion Tokens. MCP is an AI
    // feature, gated on ai_enabled like the rest of the app — but that gate is
    // enforced by the sidebar item's reactive `visible` (isEnterprise &&
    // ai_enabled), NOT here: `window.store` is unset at runtime, so a guard read
    // is unreliable and must never fail-closed (it would bounce every click to
    // Users). The route itself is already limited to the enterprise/cloud build.
    routes[0].children.push({
      path: "mcpServer",
      name: "mcpServer",
      meta: { title: "MCP Server" },
      component: () => import("@/components/iam/McpServer.vue"),
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });

    routes.push({
      path: "synthetic",
      name: "synthetic",
      component: () => import("@/views/SyntheticMonitoring.vue"),
      meta: { title: "Synthetic Monitoring" },
      beforeEnter(to: any, from: any, next: any) {
        syntheticsRouteGuard(to, from, next);
      },
    });

    routes.push(
      {
        path: "synthetic/new",
        name: "synthetic-new",
        component: () => import("@/views/synthetics/CreateCheck.vue"),
        meta: { title: "New Check" },
        beforeEnter(to: any, from: any, next: any) {
          syntheticsRouteGuard(to, from, next);
        },
      },
      {
        path: "synthetic/:id/results",
        name: "synthetic-monitor-results",
        component: () => import("@/views/synthetics/MonitorResults.vue"),
        meta: { title: "Monitor Results" },
        beforeEnter(to: any, from: any, next: any) {
          syntheticsRouteGuard(to, from, next);
        },
      },
      {
        path: "synthetic/:id/results/run/:runId/:executionId",
        name: "synthetic-run-detail",
        component: () => import("@/views/synthetics/RunDetail.vue"),
        meta: { title: "Run Detail" },
        beforeEnter(to: any, from: any, next: any) {
          syntheticsRouteGuard(to, from, next);
        },
      }
    );

    routes.push(
      {
        path: "incidents",
        name: "incidentList",
        component: IncidentList,
        meta: {
          title: "Incidents",
        },
        beforeEnter(to: any, from: any, next: any) {
          routeGuard(to, from, next);
        },
      },
      {
        path: "incidents/:id",
        name: "incidentDetail",
        component: () => import("@/components/alerts/IncidentDetailDrawer.vue"),
        meta: {
          title: "Incident Detail",
        },
        beforeEnter(to: any, from: any, next: any) {
          routeGuard(to, from, next);
        },
      },
    );

    routes.push({
      path: "actions",
      name: "actionScripts",
      component: ActionScripts,
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });

    // Workflows — enterprise/cloud only (FD3). List is the parent; the editor
    // renders in its <router-view> for add/edit.
    routes.push({
      path: "workflows",
      name: "workflows",
      component: WorkflowsList,
      meta: {
        title: "Workflows",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "add",
          name: "createWorkflow",
          component: WorkflowEditor,
          meta: { title: "New Workflow" },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "edit",
          name: "workflowEditor",
          component: WorkflowEditor,
          meta: { title: "Edit Workflow" },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          // Dedicated READ-ONLY run-inspection surface (master-detail). Separate
          // from the editor so viewing a past run never drops the user into the
          // builder; deep-linkable by ?run_id.
          path: "runs",
          name: "workflowRuns",
          component: WorkflowRuns,
          meta: { title: "Workflow Runs" },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    });
    routes[0].children.push(
      ...[
        {
          path: "groups",
          name: "groups",
          meta: {
            title: "Groups",
          },
          component: AppGroups,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "groups/edit/:group_name",
          name: "editGroup",
          meta: {
            title: "Edit Group",
          },
          component: EditGroup,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "roles",
          name: "roles",
          meta: {
            title: "Roles",
          },
          component: AppRoles,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "roles/edit/:role_name",
          name: "editRole",
          meta: {
            title: "Edit Role",
          },
          component: EditRole,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "quota",
          name: "quota",
          component: Quota,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    );

    if (config.isCloud == "true") {
      routes[0].children.push({
        path: "invitations",
        name: "invitations",
        component: Invitations,
        beforeEnter(to: any, from: any, next: any) {
          routeGuard(to, from, next);
        },
      });
    }
  }

  return routes;
};

export default useEnterpriseRoutes;
