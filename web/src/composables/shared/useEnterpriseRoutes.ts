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

const ActionScipts = () =>
  import("@/components/actionScripts/ActionScipts.vue");

const Invitations = () => import("@/views/Invitations.vue");

import Users from "@/views/User.vue";

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
          path: "serviceAccounts",
          name: "serviceAccounts",
          meta: {
            title: "Service Accounts",
          },
          component: ServiceAccountsList,
          beforeEnter(to: any, from: any, next: any) {
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
    routes.push({
      path: "actions",
      name: "actionScripts",
      meta:{
        title: "Action Scripts",
      },
      component: ActionScipts,
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
          },
          component: AppGroups,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "groups/edit/:group_name",
          name: "editGroup",
          meta:{
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
          meta:{
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
          meta:{
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
          meta: {
            title: "Quota",
          },
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
