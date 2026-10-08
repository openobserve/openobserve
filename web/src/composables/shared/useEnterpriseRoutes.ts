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
import { withFeatureGate as withFeatureGateBase, buildFeatureGateContext } from "@/utils/enterpriseFeatures";

// "rbac" needs the backend `rbac_enabled` flag, which only `store.state.zoConfig`
// carries — every other key here is edition-only and could use the default.
const withFeatureGate: typeof withFeatureGateBase = (key, guard, getContext) =>
  withFeatureGateBase(key, guard, getContext ?? (() => buildFeatureGateContext(store.state.zoConfig)));

// Synthetics routes are gated on the backend /config flag `synthetics_enabled`
// (`ZO_SYNTHETICS_ENABLED`), not on the build: synthetics ships in OSS. Direct URL
// access redirects home when off.
const syntheticsRouteGuard = (to: any, from: any, next: any) => {
  if (store.state.zoConfig?.synthetics_enabled === false) {
    next("/");
    return;
  }
  routeGuard(to, from, next);
};

// Private locations are served by agents deployed inside the customer's network,
// which is the one enterprise part of synthetics — so the detail page needs the
// narrower flag as well. Same `=== false` stance as above: /config is fetched
// without await, so redirecting on "not yet known" would bounce a bookmarked
// link on a cold load.
const privateLocationRouteGuard = (to: any, from: any, next: any) => {
  if (store.state.zoConfig?.synthetics_private_locations_enabled === false) {
    next("/");
    return;
  }
  syntheticsRouteGuard(to, from, next);
};

// Workflows routes are gated on the backend /config flag `workflows_enabled`
// (enterprise O2_WORKFLOWS_ENABLED); `withFeatureGate("workflows", ...)` at
// each route below checks the edition separately.
//
// Checks `=== false`, NOT `!== true`, and that is deliberate: /config is fetched
// without await, so the flag is briefly undefined at startup. Redirecting on
// "not yet known" would bounce a bookmarked /workflows to home on a cold load.
// The sidebar entry takes the opposite stance (it requires `=== true`, so it
// never flashes in) — the two are not meant to match. Same split as
// syntheticsRouteGuard above.
const workflowsRouteGuard = (to: any, from: any, next: any) => {
  if (store.state.zoConfig?.workflows_enabled === false) {
    next("/");
    return;
  }
  routeGuard(to, from, next);
};

// On-call routes are gated on the backend /config flag `oncall_enabled`
// (enterprise O2_ONCALL_ENABLED); `withFeatureGate("oncall", ...)` at each
// route below checks the edition separately. Same `=== false` stance as
// synthetics above: the flag is briefly undefined on a cold load, and
// bouncing a bookmarked page home on "not yet known" is worse than a moment
// of empty state.
const oncallRouteGuard = (to: any, from: any, next: any) => {
  if (store.state.zoConfig?.oncall_enabled === false) {
    next("/");
    return;
  }
  routeGuard(to, from, next);
};

const OnCallTeams = () => import("@/views/OnCall/OnCallTeams.vue");
const OnCallTeamDetail = () => import("@/views/OnCall/OnCallTeamDetail.vue");
const OnCallResponses = () => import("@/views/OnCall/OnCallResponses.vue");
const OnCallResponseDetail = () => import("@/views/OnCall/OnCallResponseDetail.vue");
const OnCallRouting = () => import("@/views/OnCall/OnCallRouting.vue");
const OnCallMine = () => import("@/views/OnCall/OnCallMine.vue");
const OnCallPolicies = () => import("@/views/OnCall/OnCallPolicies.vue");

const IdentityAccessManagement = () => import("@/views/IdentityAccessManagement.vue");

const AppGroups = () => import("@/components/iam/groups/AppGroups.vue");

const AppRoles = () => import("@/components/iam/roles/AppRoles.vue");

const EditRole = () => import("@/components/iam/roles/EditRole.vue");

const EditGroup = () => import("@/components/iam/groups/EditGroup.vue");

const Quota = () => import("@/components/iam/quota/Quota.vue");

const Organizations = () => import("@/components/iam/organizations/AppOrganizations.vue");

const Invitations = () => import("@/views/Invitations.vue");

import Users from "@/views/User.vue";

const IncidentList = () => import("@/components/alerts/IncidentList.vue");

const WorkflowsList = () => import("@/components/workflows/WorkflowsList.vue");

const WorkflowEditor = () => import("@/components/workflows/WorkflowEditor.vue");

const WorkflowRuns = () => import("@/components/workflows/WorkflowRuns.vue");

const useEnterpriseRoutes = () => {
  const routes: any = [
    {
      path: "iam",
      name: "iam",
      component: IdentityAccessManagement,
      meta: { allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "users",
          name: "users",
          meta: {
            titleKey: "iam.basicUsers",
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
            titleKey: "iam.ingestionTokens",
          },
          component: () => import("@/components/iam/IngestionTokens.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "syntheticsTokens",
          name: "syntheticsTokens",
          meta: {
            titleKey: "iam.syntheticsTokens",
          },
          component: () => import("@/components/iam/SyntheticsTokens.vue"),
          beforeEnter(to: any, from: any, next: any) {
            syntheticsRouteGuard(to, from, next);
          },
        },
        {
          path: "serviceAccounts",
          name: "serviceAccounts",
          meta: {
            titleKey: "iam.serviceAccounts",
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
            titleKey: "iam.organizations",
          },
          component: Organizations,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        // Inbound MCP server setup — lives under IAM as a credentialed-access
        // surface, alongside Service Accounts / Ingestion Tokens. Available on
        // every edition: the backend registers `/{org}/mcp` and initialises the
        // MCP tools for all builds (only the OAuth *discovery* endpoints are
        // enterprise-only, which the card handles by hiding that auth mode).
        // So there is no build or runtime gate here or on the IAM tab.
        {
          path: "mcpServer",
          name: "mcpServer",
          meta: { titleKey: "iam.mcpServerLabel" },
          component: () => import("@/components/iam/McpServer.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    },
  ];

  // Synthetics ships in OSS; only the private-VPC-agent half stays enterprise, so
  // these routes register in every build. Visibility is the backend `/config` flag
  // `synthetics_enabled` (ZO_SYNTHETICS_ENABLED) via syntheticsRouteGuard, and the
  // private-location detail page carries the narrower
  // `synthetics_private_locations_enabled` gate on top of it.
  //
  // The Status Pages admin UI is a tab on this same view (reached via
  // `?section=status-pages`), so it needs no route of its own — it ships
  // with synthetics, no separate toggle. Notices/Custom Domains within it
  // are Enterprise-only, gated in-view on `build_type` instead.
  routes.push({
    path: "synthetics",
    name: "synthetics",
    component: () => import("@/views/SyntheticMonitoring.vue"),
    meta: { titleKey: "menu.synthetic", allowOnEmptyData: true },
    beforeEnter(to: any, from: any, next: any) {
      syntheticsRouteGuard(to, from, next);
    },
  });

  routes.push(
    {
      path: "synthetics/add",
      name: "synthetics-add",
      component: () => import("@/views/synthetics/CreateCheck.vue"),
      meta: { titleKey: "routeTitles.addCheck", allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        syntheticsRouteGuard(to, from, next);
      },
    },
    {
      path: "synthetics/edit/:id",
      name: "synthetics-edit",
      component: () => import("@/views/synthetics/CreateCheck.vue"),
      meta: { titleKey: "synthetics.results.editCheck", allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        syntheticsRouteGuard(to, from, next);
      },
    },
    {
      path: "synthetics/status-pages/edit/:id",
      name: "synthetics-status-page-edit",
      component: () => import("@/views/synthetics/status-pages/StatusPageEditor.vue"),
      meta: { titleKey: "statusPages.editTitle", allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        syntheticsRouteGuard(to, from, next);
      },
    },
    {
      path: "synthetic/private-locations/:id",
      name: "synthetic-private-location",
      component: () => import("@/views/synthetics/PrivateLocationDetail.vue"),
      meta: { titleKey: "synthetics.privateLocations.detail.title", allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        privateLocationRouteGuard(to, from, next);
      },
    },
    {
      path: "synthetics/:id/results",
      name: "synthetic-monitor-results",
      component: () => import("@/views/synthetics/MonitorResults.vue"),
      meta: { titleKey: "synthetics.results.title", allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        syntheticsRouteGuard(to, from, next);
      },
    },
    {
      path: "synthetics/:id/results/run/:runId/:executionId",
      name: "synthetics-run-detail",
      component: () => import("@/views/synthetics/RunDetail.vue"),
      meta: { titleKey: "synthetics.runDetail.title", allowOnEmptyData: true },
      beforeEnter(to: any, from: any, next: any) {
        syntheticsRouteGuard(to, from, next);
      },
    },
  );

  //the below are the routes that we support for enterprise and cloud
  //the above are the routes that we support for oss including both enterprise and cloud

  // On-call, Incidents, Workflows, RBAC (groups/roles/quota) are always
  // registered now — a direct URL redirects to the shared locked page (see
  // `withFeatureGate`) when the edition doesn't unlock them, instead of
  // landing on the real page or a 404.
  // On-call is configured before any data flows, so every route here stays open on an empty org.
  routes.push(
    {
      path: "oncall/responses",
      name: "onCallResponses",
      component: OnCallResponses,
      meta: { titleKey: "oncall.responsesTitle", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
    {
      path: "oncall/responses/:responseId",
      name: "onCallResponseDetail",
      component: OnCallResponseDetail,
      meta: { titleKey: "oncall.responseDetail", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
    {
      // A page again. It was retired to a redirect for being a stub that
      // hardcoded "You are not on an on-call team yet" without asking the
      // server anything — but two endpoints exist that only make sense here:
      // `my/teams` answers duty in one request instead of one per team, and
      // `my/deliveries` is the only thing in the product that answers "did my
      // phone actually ring", which no per-team screen can ask.
      //
      // "What needs somebody" still belongs to the Pages list; this page
      // links to it narrowed rather than rendering a second copy.
      path: "oncall/me",
      name: "onCallMine",
      component: OnCallMine,
      meta: { titleKey: "oncall.mineTitle", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
    {
      path: "oncall/teams",
      name: "onCallTeams",
      component: OnCallTeams,
      meta: { titleKey: "oncall.teamsTitle", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
    {
      // The tab is part of the URL, so a schedule somebody sends is the
      // schedule the recipient lands on. Defaults to `schedule`.
      //
      // `escalation` and `routing` are what the tabs are CALLED; `policy` and
      // `ownership` are what they were called when the routes were written,
      // and links to them are already in Slack threads and setup checklists.
      // Both are accepted, the view canonicalises to the visible word — a
      // shared link and the tab it lands on should not use two vocabularies
      // for one thing.
      path: "oncall/teams/:teamId/:tab(overview|schedule|members|policy|escalation|ownership|routing)?",
      name: "onCallTeamDetail",
      component: OnCallTeamDetail,
      meta: { titleKey: "oncall.teamDetail", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
    {
      path: "oncall/policies",
      name: "onCallPolicies",
      component: OnCallPolicies,
      meta: { titleKey: "oncall.policiesTitle", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
    {
      path: "oncall/routing",
      name: "onCallRouting",
      component: OnCallRouting,
      meta: { titleKey: "oncall.routingTitle", allowOnEmptyData: true },
      beforeEnter: withFeatureGate("oncall", oncallRouteGuard),
    },
  );

  routes.push(
    {
      path: "incidents",
      name: "incidentList",
      component: IncidentList,
      meta: {
        titleKey: "menu.incidents",
      },
      beforeEnter: withFeatureGate("incidents", routeGuard),
    },
    {
      path: "incidents/:id",
      name: "incidentDetail",
      component: () => import("@/components/alerts/IncidentDetailDrawer.vue"),
      meta: {
        titleKey: "routeTitles.incidentDetail",
      },
      beforeEnter: withFeatureGate("incidents", routeGuard),
    },
  );

  // Workflows — enterprise/cloud only (FD3). List is the parent; the editor
  // renders in its <router-view> for add/edit.
  routes.push({
    path: "workflows",
    name: "workflows",
    component: WorkflowsList,
    meta: {
      titleKey: "menu.workflows",
    },
    beforeEnter: withFeatureGate("workflows", workflowsRouteGuard),
    children: [
      {
        path: "add",
        name: "createWorkflow",
        component: WorkflowEditor,
        meta: { titleKey: "workflow.create" },
        beforeEnter: withFeatureGate("workflows", workflowsRouteGuard),
      },
      {
        path: "edit",
        name: "workflowEditor",
        component: WorkflowEditor,
        meta: { titleKey: "workflow.editMode" },
        beforeEnter: withFeatureGate("workflows", workflowsRouteGuard),
      },
      {
        // Dedicated READ-ONLY run-inspection surface (master-detail). Separate
        // from the editor so viewing a past run never drops the user into the
        // builder; deep-linkable by ?run_id.
        path: "runs",
        name: "workflowRuns",
        component: WorkflowRuns,
        meta: { titleKey: "workflow.runs.title" },
        beforeEnter: withFeatureGate("workflows", workflowsRouteGuard),
      },
    ],
  });
  routes[0].children.push(
    ...[
      {
        path: "groups",
        name: "groups",
        meta: {
          titleKey: "routeTitles.groups",
        },
        component: AppGroups,
        beforeEnter: withFeatureGate("rbac", routeGuard),
      },
      {
        path: "groups/edit/:group_name",
        name: "editGroup",
        meta: {
          titleKey: "routeTitles.editGroup",
        },
        component: EditGroup,
        beforeEnter: withFeatureGate("rbac", routeGuard),
      },
      {
        path: "roles",
        name: "roles",
        meta: {
          titleKey: "iam.roles",
        },
        component: AppRoles,
        beforeEnter: withFeatureGate("rbac", routeGuard),
      },
      {
        path: "roles/edit/:role_name",
        name: "editRole",
        meta: {
          titleKey: "routeTitles.editRole",
        },
        component: EditRole,
        beforeEnter: withFeatureGate("rbac", routeGuard),
      },
      {
        path: "quota",
        name: "quota",
        component: Quota,
        beforeEnter: withFeatureGate("rbac", routeGuard),
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

  return routes;
};

export default useEnterpriseRoutes;
