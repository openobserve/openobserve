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
            titleKey: "menu.user",
            searchable: true,
            icon: "group",
            section: "Management",
            keywords: [
              "user management",
              "team members",
              "roles",
              "permissions",
            ],
          },
          component: Users,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "serviceAccounts",
          name: "serviceAccounts",
          meta: {
            title: "Service Accounts",
            searchable: true,
            icon: "manage_accounts",
            section: "Management",
            keywords: [
              "API keys",
              "service accounts",
              "programmatic access",
              "tokens",
            ],
            create: {
              labelKey: "commandPalette.newServiceAccount",
              keywords: ["new service account", "add service account", "create API key", "create token"],
            },
          },
          component: ServiceAccountsList,
          beforeEnter(to: any, from: any, next: any) {
            // Check if service accounts are enabled
            // Note: Using window.store here because useStore() doesn't work in route guards
            const store = (window as any).store;
            const serviceAccountEnabled =
              store?.state?.zoConfig?.service_account_enabled ?? true;

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
            searchable: true,
            icon: "corporate_fare",
            section: "Management",
            keywords: ["organization management", "switch org", "tenants"],
            create: {
              labelKey: "commandPalette.newOrganization",
              keywords: ["new organization", "add organization", "create org", "create tenant"],
            },
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
    routes.push(
      {
        path: "incidents",
        name: "incidentList",
        component: IncidentList,
        meta: {
          title: "Incidents",
          titleKey: "menu.incidents",
          searchable: true,
          icon: "emergency",
          section: "Observability",
          keywords: ["incident management", "on-call", "outage", "SLO breach"],
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
      meta: {
        title: "Action Scripts",
        titleKey: "menu.actions",
        searchable: true,
        icon: "code",
        section: "Management",
        keywords: [
          "automation",
          "runbooks",
          "remediation scripts",
          "alert actions",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });
    routes[0].children.push(
      ...[
        {
          path: "groups",
          name: "groups",
          meta: {
            title: "Groups",
            searchable: true,
            icon: "group_work",
            section: "Management",
            keywords: [
              "user groups",
              "RBAC groups",
              "access groups",
              "group permissions",
            ],
            create: {
              labelKey: "commandPalette.newUserGroup",
              keywords: ["new group", "add user group", "create group", "create RBAC group"],
            },
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
            searchable: true,
            icon: "admin_panel_settings",
            section: "Management",
            keywords: [
              "RBAC roles",
              "role-based access",
              "permissions",
              "access control",
            ],
            create: {
              labelKey: "commandPalette.newRole",
              keywords: ["new role", "add role", "create role", "create RBAC role"],
            },
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
          meta: {
            title: "Quota",
            searchable: true,
            icon: "data_usage",
            section: "Management",
            keywords: [
              "usage quota",
              "ingestion limits",
              "storage limits",
              "rate limits",
            ],
          },
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
