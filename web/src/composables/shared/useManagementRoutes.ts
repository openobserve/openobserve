import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";

const Settings = () => import("@/components/settings/index.vue");
const TemplateList = () => import("@/components/alerts/TemplateList.vue");
const AlertsDestinationList = () =>
  import("@/components/alerts/AlertsDestinationList.vue");

const useManagementRoutes = () => {
  const routes: any = [
    {
      path: "settings",
      name: "settings",
      component: Settings,
      meta: {
        keepAlive: true,
        title: "Settings",
        titleKey: "menu.settings",
        searchable: true,
        icon: "settings",
        section: "Management",
        keywords: [
          "configuration",
          "admin",
          "organization parameters",
          "platform settings",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "general",
          name: "general",
          meta: {
            title: "General Settings",
            titleKey: "settings.generalLabel",
            searchable: true,
            icon: "tune",
            section: "Management",
            keywords: [
              "general",
              "default timezone",
              "scrape interval",
              "platform settings",
              "max series per query",
            ],
          },
          component: () => import("@/components/settings/General.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "organization",
          name: "organizationSettings",
          meta: {
            title: "Organization Parameters",
            titleKey: "settings.orgLabel",
            searchable: true,
            icon: "corporate_fare",
            section: "Management",
            keywords: [
              "org settings",
              "retention period",
              "ingest flatten level",
              "max file size",
              "partition time level",
            ],
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
          meta: {
            // Tab label in Settings sidebar: t("alert_destinations.header") = "Notification Destinations"
            title: "Notification Destinations",
            titleKey: "alert_destinations.header",
            searchable: true,
            icon: "send",
            section: "Management",
            keywords: [
              "alert destinations",
              "notification channels",
              "webhook",
              "email",
              "Slack",
              "PagerDuty",
              "SNS",
              "MSTeams",
            ],
          },
          component: AlertsDestinationList,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "templates",
          name: "alertTemplates",
          meta: {
            // Tab label in Settings sidebar: t("alert_templates.header") = "Templates"
            title: "Templates",
            titleKey: "alert_templates.header",
            searchable: true,
            icon: "description",
            section: "Management",
            keywords: ["alert templates", "notification templates"],
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
            titleKey: "settings.queryManagement",
            searchable: true,
            icon: "manage_search",
            section: "Management",
            keywords: [
              "running queries",
              "query management",
              "active queries",
              "Summary",
              "All Queries",
            ],
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
            titleKey: "settings.cipherKeys",
            searchable: true,
            icon: "key",
            section: "Management",
            keywords: [
              "encryption",
              "data encryption",
              "cipher",
              "security keys",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "ai_toolsets",
          name: "aiToolsets",
          component: () => import("@/components/settings/AiToolsets.vue"),
          meta: {
            keepAlive: true,
            title: "AI Toolsets",
            titleKey: "settings.aiToolsets",
            searchable: true,
            icon: "smart_toy",
            section: "Management",
            keywords: [
              "AI tools",
              "LLM",
              "AI assistant",
              "toolsets",
              "AI configuration",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "pipeline_destinations",
          name: "pipelineDestinations",
          meta: {
            title: "Pipeline Destinations",
            searchable: true,
            icon: "output",
            section: "Management",
            keywords: [
              "pipeline output",
              "stream destination",
              "data forwarding",
              "pipeline routing",
            ],
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
            searchable: true,
            icon: "device_hub",
            section: "Management",
            keywords: [
              "cluster nodes",
              "querier",
              "ingester",
              "compactor",
              "node status",
            ],
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
            // Tab label in Settings sidebar: t("settings.ssoDomainRestrictions") = "SSO Management"
            title: "SSO Management",
            titleKey: "settings.ssoDomainRestrictions",
            searchable: true,
            icon: "dns",
            section: "Management",
            keywords: [
              "domain management",
              "custom domain",
              "CNAME",
              "SSO domain restrictions",
              "allowed domains",
            ],
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
            // Tab label in Settings sidebar: t("regex_patterns.title") = "Sensitive Data Redaction"
            title: "Sensitive Data Redaction",
            titleKey: "regex_patterns.title",
            searchable: true,
            icon: "code",
            section: "Management",
            keywords: [
              "regex patterns",
              "regex",
              "pattern matching",
              "log parsing",
              "field extraction",
              "Built-in Patterns",
              "data masking",
              "PII redaction",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "correlation/:tab?",
          name: "correlationSettings",
          component: () =>
            import("@/components/settings/CorrelationSettings.vue"),
          meta: {
            keepAlive: true,
            title: "Correlation Settings",
            titleKey: "settings.correlationSettings",
            searchable: true,
            icon: "join_inner",
            section: "Management",
            keywords: [
              "log correlation",
              "trace correlation",
              "cross-stream correlation",
              "field correlation",
              "linked fields",
            ],
            // Tab labels resolved via i18n → work in every supported language
            keywordKeys: [
              "settings.correlation.discoveredServicesTab",
              "settings.correlation.serviceDiscoveryTab",
              "settings.correlation.alertCorrelationTab",
              "settings.correlation.fieldAliasesTab",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "license",
          name: "license",
          component: () => import("@/components/settings/License.vue"),
          meta: {
            title: "License",
            searchable: true,
            icon: "verified",
            section: "Management",
            keywords: ["license key", "enterprise license", "activation"],
          },
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
          component: () =>
            import("@/components/settings/OrganizationManagement.vue"),
          meta: {
            keepAlive: true,
            title: "Organization Management",
            searchable: true,
            icon: "business",
            section: "Management",
            keywords: [
              "manage organization",
              "billing",
              "subscription",
              "cloud org",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    );
  }
  return routes;
};

export default useManagementRoutes;
