import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";

const Settings = () => import("@/components/settings/index.vue");
const TemplateList = () => import("@/components/alerts/TemplateList.vue");
const AlertsDestinationList = () => import("@/components/alerts/AlertsDestinationList.vue");

const useManagementRoutes = () => {
  const routes: any = [
    {
      path: "settings",
      name: "settings",
      component: Settings,
      meta: {
        keepAlive: true,
        title: "Settings",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "general",
          name: "general",
          meta: {
            title: "General",
          },
          component: () => import("@/components/settings/General.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "organization",
          name: "organizationSettings",
          meta:{
            title: "Organization Parameters",
          },
          component: () =>
            import("@/components/settings/OrganizationSettings.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "alert_destinations",
          name: "alertDestinations",
          meta:{
            title: "Alert Destinations",
          },
          component: AlertsDestinationList,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "templates",
          name: "alertTemplates",
          meta:{
            title: "Templates",
          },
          component: TemplateList,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    },
  ];
  if (config.isEnterprise == "true") {
    routes[0].children.push(
      ...[
        {
          path: "query_management",
          name: "query_management",
          component: () => import("@/components/queries/RunningQueries.vue"),
          meta: {
            keepAlive: true,
            title: "Query Management",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "cipher_keys",
          name: "cipherKeys",
          component: () => import("@/components/settings/CipherKeys.vue"),
          meta: {
            keepAlive: true,
            title: "Cipher Keys",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "pipeline_destinations",
          name: "pipelineDestinations",
          meta:{
            title: "Pipeline Destinations",
          },
          component: () =>
            import("@/components/alerts/PipelinesDestinationList.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "nodes",
          name: "nodes",
          component: () => import("@/components/settings/Nodes.vue"),
          meta: {
            keepAlive: true,
            title: "Nodes",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "domain_management",
          name: "domainManagement",
          component: () => import("@/components/settings/DomainManagement.vue"),
          meta: {
            keepAlive: true,
            title: "Domain Management",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "regex_patterns",
          name: "regexPatterns",
          component: () => import("@/components/settings/RegexPatternList.vue"),
          meta: {
            keepAlive: true,
            title: "Regex Patterns",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },

        },
        {
          path: "correlation_settings",
          name: "correlationSettings",
          component: () => import("@/components/settings/CorrelationSettings.vue"),
          meta: {
            keepAlive: true,
            title: "Correlation Settings",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "license",
          name: "license",
          component: () => import("@/components/settings/License.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    );
  }
  if (config.isCloud == "true") {
    routes[0].children.push(
      ...[
        {
          path: "organization_management",
          name: "orgnizationManagement",
          component: () => import("@/components/settings/OrganizationManagement.vue"),
          meta: {
            keepAlive: true,
            title: "Organization Management",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        }
      ]
    )
  }
  return routes;
};

export default useManagementRoutes;
