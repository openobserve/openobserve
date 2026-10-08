import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";
import { withFeatureGate } from "@/utils/enterpriseFeatures";

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
      redirect: (to: any) => ({ name: "general", query: to.query }),
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "general",
          name: "general",
          meta: {
            titleKey: "settings.groupGeneral",
            allowOnEmptyData: true,
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

  // Shared stand-in page for any enterprise/cloud-only route this build
  // doesn't unlock — every `withFeatureGate` redirect lands here.
  routes.push({
    path: "enterprise-locked",
    name: "enterpriseFeatureLocked",
    component: () => import("@/components/EnterpriseFeatureLocked.vue"),
    meta: { titleKey: "enterpriseFeature.lockedTitle" },
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
  });

  // Public synthetics locations are the registry the Lambda venue dispatches
  // against, and synthetics ships in OSS — so this registers in every build. The
  // page itself lists public rows only; private locations stay enterprise.
  routes[0].children.push({
    path: "synthetics_locations",
    name: "syntheticsLocations",
    component: () => import("@/components/settings/SyntheticsLocationsList.vue"),
    // Locations are set up before the first check can run, so an empty org must reach this.
    meta: {
      keepAlive: true,
      titleKey: "routeTitles.syntheticsLocations",
      allowOnEmptyData: true,
    },
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
  });

  // LLM Model Pricing, LLM Providers, GenAI Agent Mapping (used by the AI
  // Observability / Online Evals flows), and the enterprise-only operations/
  // security pages below are all always registered; a direct URL redirects
  // to the shared locked page (see `withFeatureGate`) when the edition
  // doesn't unlock them, instead of landing on the real page or a 404.
  routes[0].children.push({
    path: "model_pricing",
    name: "modelPricing",
    meta: {
      keepAlive: true,
      titleKey: "settings.llmModelPricing",
    },
    component: () => import("@/components/settings/ModelPricingList.vue"),
    beforeEnter: withFeatureGate("modelPricing", routeGuard),
  });
  routes[0].children.push({
    path: "model_pricing/edit",
    name: "modelPricingEditor",
    meta: {
      titleKey: "routeTitles.modelPricingEditor",
    },
    component: () => import("@/components/settings/ModelPricingEditor.vue"),
    beforeEnter: withFeatureGate("modelPricing", routeGuard),
  });
  routes[0].children.push({
    path: "llm_providers",
    name: "llmProviders",
    component: () => import("@/components/settings/LlmProvidersSettings.vue"),
    meta: {
      titleKey: "llmProviders.title",
    },
    beforeEnter: withFeatureGate("llmProviders", routeGuard),
  });
  routes[0].children.push({
    path: "gen_ai_agent_mapping",
    name: "genAiAgentMapping",
    component: () => import("@/components/settings/GenAiAgentMappingSettings.vue"),
    meta: {
      keepAlive: true,
      titleKey: "settings.genAiAgentMapping.title",
    },
    beforeEnter: withFeatureGate("genAiAgentMapping", routeGuard),
  });
  // Alert Sources moved to a flat top-level route (router.ts, name
  // "alertSources") — no longer pushed here. It used to be conditional on
  // this same enterprise/cloud check; that gating now lives on the target
  // route's own beforeEnter instead.
  //
  // This batch is self-hosted-only — it does not exist on Cloud at all (not
  // even locked): Cloud users can't "upgrade" into managing their own nodes,
  // license, or cipher keys, so a pure-cloud build keeps excluding it
  // entirely, exactly as it did before this gating existed. OSS keeps
  // registering it (redirects to the locked page); self-hosted enterprise
  // gets the real pages.
  if (config.isEnterprise == "true" || config.isCloud != "true") {
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
          beforeEnter: withFeatureGate("queryManagement", routeGuard),
        },
        {
          path: "cipher_keys",
          name: "cipherKeys",
          component: () => import("@/components/settings/CipherKeys.vue"),
          meta: {
            keepAlive: true,
            titleKey: "settings.cipherKeys",
          },
          beforeEnter: withFeatureGate("cipherKeys", routeGuard),
        },
        {
          path: "ai_toolsets",
          name: "aiToolsets",
          component: () => import("@/components/settings/AiToolsets.vue"),
          meta: {
            keepAlive: true,
            titleKey: "aiToolset.header",
          },
          beforeEnter: withFeatureGate("aiToolsets", routeGuard),
        },
        {
          path: "pipeline_destinations",
          name: "pipelineDestinations",
          meta: {
            titleKey: "pipeline_destinations.header",
          },
          component: () => import("@/components/alerts/PipelinesDestinationList.vue"),
          beforeEnter: withFeatureGate("pipelineDestinations", routeGuard),
        },
        {
          path: "storage_settings",
          name: "storageSettings",
          component: () => import("@/components/settings/OrgStorageSettings.vue"),
          meta: {
            titleKey: "routeTitles.storageSettings",
          },
          beforeEnter: withFeatureGate("storageSettings", routeGuard),
        },
        {
          path: "nodes",
          name: "nodes",
          component: () => import("@/components/settings/Nodes.vue"),
          meta: {
            keepAlive: true,
            titleKey: "settings.nodes",
          },
          beforeEnter: withFeatureGate("nodes", routeGuard),
        },
        {
          path: "domain_management",
          name: "domainManagement",
          component: () => import("@/components/settings/DomainManagement.vue"),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.domainManagement",
          },
          beforeEnter: withFeatureGate("domainManagement", routeGuard),
        },
        {
          path: "regex_patterns",
          name: "regexPatterns",
          component: () => import("@/components/settings/RegexPatternList.vue"),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.regexPatterns",
          },
          beforeEnter: withFeatureGate("regexPatterns", routeGuard),
        },
        {
          path: "password_policy",
          name: "passwordPolicy",
          component: () => import("@/components/settings/PasswordPolicy.vue"),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.passwordPolicy",
          },
          beforeEnter: withFeatureGate("passwordPolicy", routeGuard),
        },
        {
          path: "correlation/:tab?",
          name: "correlationSettings",
          component: () => import("@/components/settings/CorrelationSettings.vue"),
          meta: {
            keepAlive: true,
            titleKey: "settings.correlationSettings",
          },
          beforeEnter: withFeatureGate("correlationSettings", routeGuard),
        },
        {
          path: "license",
          name: "license",
          component: () => import("@/components/settings/License.vue"),
          beforeEnter: withFeatureGate("license", routeGuard),
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
