import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";

const Settings = () => import("@/components/settings/index.vue");

const useManagementRoutes = () => {
  const routes: any = [
    {
      path: "settings",
      name: "settings",
      component: Settings,
      meta: {
        keepAlive: true,
        titleKey: "menu.settings",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "general",
          name: "general",
          meta: {
            titleKey: "settings.groupGeneral",
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
            titleKey: "settings.orgLabel",
          },
          component: () => import("@/components/settings/OrganizationSettings.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        // Notification destinations moved to /alert-destinations (Reliability).
        // Kept as a redirect so existing bookmarks and links still resolve.
        // The function form is required to carry the query across: callers pass
        // `org_identifier`, and `?action=import` opens the import view — an
        // object redirect would silently drop both.
        {
          path: "alert_destinations",
          redirect: (to: any) => ({ name: "alertDestinations", query: to.query }),
        },
        // Alert templates moved to /alert-templates (Reliability). Redirect kept
        // for the same reason as alert_destinations above, query included.
        {
          path: "templates",
          redirect: (to: any) => ({ name: "alertTemplates", query: to.query }),
        },
        // Alert Sources moved to /alert-sources (Reliability), same reasoning
        // as alert_destinations/templates above. Redirect kept for bookmarks;
        // the enterprise/cloud gate now lives on the target route itself
        // (router.ts), not on whether this redirect entry exists.
        {
          path: "alert_sources",
          redirect: (to: any) => ({ name: "alertSources", query: to.query }),
        },
      ],
    },
  ];
  // LLM Model Pricing, LLM Providers and GenAI Agent Mapping (used by the AI
  // Observability / Online Evals flows) are enterprise/cloud-only features — the
  // backend routes only exist behind the enterprise feature flag, so they must
  // not be exposed in OSS builds.
  if (config.isEnterprise == "true" || config.isCloud == "true") {
    routes[0].children.push({
      path: "model_pricing",
      name: "modelPricing",
      meta: {
        keepAlive: true,
        titleKey: "settings.llmModelPricing",
      },
      component: () => import("@/components/settings/ModelPricingList.vue"),
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });
    routes[0].children.push({
      path: "model_pricing/edit",
      name: "modelPricingEditor",
      meta: {
        titleKey: "routeTitles.modelPricingEditor",
      },
      component: () => import("@/components/settings/ModelPricingEditor.vue"),
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });
    routes[0].children.push({
      path: "llm_providers",
      name: "llmProviders",
      component: () => import("@/components/settings/LlmProvidersSettings.vue"),
      meta: {
        titleKey: "llmProviders.title",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });
    routes[0].children.push({
      path: "gen_ai_agent_mapping",
      name: "genAiAgentMapping",
      component: () => import("@/components/settings/GenAiAgentMappingSettings.vue"),
      meta: {
        keepAlive: true,
        titleKey: "settings.genAiAgentMapping.title",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    });
    // Alert Sources moved to a flat top-level route (router.ts, name
    // "alertSources") — no longer pushed here. It used to be conditional on
    // this same enterprise/cloud check; that gating now lives on the target
    // route's own beforeEnter instead.
  }
  if (config.isEnterprise == "true") {
    routes[0].children.push(
      ...[
        {
          path: "query_management",
          name: "query_management",
          component: () => import("@/components/queries/RunningQueries.vue"),
          meta: {
            keepAlive: true,
            titleKey: "settings.queryManagement",
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
            titleKey: "settings.cipherKeys",
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
            titleKey: "aiToolset.header",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "pipeline_destinations",
          name: "pipelineDestinations",
          meta: {
            titleKey: "pipeline_destinations.header",
          },
          component: () => import("@/components/alerts/PipelinesDestinationList.vue"),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "storage_settings",
          name: "storageSettings",
          component: () => import("@/components/settings/OrgStorageSettings.vue"),
          meta: {
            titleKey: "routeTitles.storageSettings",
          },
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
            titleKey: "settings.nodes",
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
            titleKey: "routeTitles.domainManagement",
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
            titleKey: "routeTitles.regexPatterns",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "synthetics_locations",
          name: "syntheticsLocations",
          component: () => import("@/components/settings/SyntheticsLocationsList.vue"),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.syntheticsLocations",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "correlation/:tab?",
          name: "correlationSettings",
          component: () => import("@/components/settings/CorrelationSettings.vue"),
          meta: {
            keepAlive: true,
            titleKey: "settings.correlationSettings",
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
            titleKey: "settings.organizationManagement",
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
