import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";
import {
  checkFeatureAccess,
  buildFeatureGateContext,
  type FeatureKey,
} from "@/utils/enterpriseFeatures";

const Settings = () => import("@/components/settings/index.vue");

/**
 * Real component when the edition unlocks `key`, else the shared locked
 * placeholder — resolved on EACH navigation (not once at router-build time),
 * so a key that depends on async-loaded state never freezes a stale verdict.
 * None of this file's keys need `rbac`, so an edition-only context is enough.
 */
const gatedComponent = (key: FeatureKey, real: () => Promise<any>) => () =>
  checkFeatureAccess(key, buildFeatureGateContext()).allowed
    ? real()
    : import("@/components/EnterpriseFeatureLocked.vue");

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

  // LLM Model Pricing, LLM Providers and GenAI Agent Mapping (used by the AI
  // Observability / Online Evals flows), and the enterprise-only operations/
  // security pages below, are always registered now — the component resolves
  // to the shared locked placeholder (see `gatedComponent`) when the edition
  // doesn't unlock them, so the section is reachable (nav + direct URL) but
  // inert rather than absent.
  routes[0].children.push({
    path: "model_pricing",
    name: "modelPricing",
    meta: {
      keepAlive: true,
      titleKey: "settings.llmModelPricing",
      featureKey: "modelPricing",
    },
    component: gatedComponent(
      "modelPricing",
      () => import("@/components/settings/ModelPricingList.vue"),
    ),
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
  });
  routes[0].children.push({
    path: "model_pricing/edit",
    name: "modelPricingEditor",
    meta: {
      titleKey: "routeTitles.modelPricingEditor",
      featureKey: "modelPricing",
    },
    component: gatedComponent(
      "modelPricing",
      () => import("@/components/settings/ModelPricingEditor.vue"),
    ),
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
  });
  routes[0].children.push({
    path: "llm_providers",
    name: "llmProviders",
    component: gatedComponent(
      "llmProviders",
      () => import("@/components/settings/LlmProvidersSettings.vue"),
    ),
    meta: {
      titleKey: "llmProviders.title",
      featureKey: "llmProviders",
    },
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
  });
  routes[0].children.push({
    path: "gen_ai_agent_mapping",
    name: "genAiAgentMapping",
    component: gatedComponent(
      "genAiAgentMapping",
      () => import("@/components/settings/GenAiAgentMappingSettings.vue"),
    ),
    meta: {
      keepAlive: true,
      titleKey: "settings.genAiAgentMapping.title",
      featureKey: "genAiAgentMapping",
    },
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
  });
  // Alert Sources moved to a flat top-level route (router.ts, name
  // "alertSources") — no longer pushed here. It used to be conditional on
  // this same enterprise/cloud check; that gating now lives on the target
  // route's own beforeEnter instead.
  //
  // This batch is self-hosted-only — it does not exist on Cloud at all (not
  // even locked): Cloud users can't "upgrade" into managing their own nodes,
  // license, or cipher keys, so a pure-cloud build keeps excluding it
  // entirely, exactly as it did before `gatedComponent` existed. OSS keeps
  // registering it (locked); self-hosted enterprise gets the real pages.
  if (config.isEnterprise == "true" || config.isCloud != "true") {
    routes[0].children.push(
      ...[
        {
          path: "query_management",
          name: "query_management",
          component: gatedComponent(
            "queryManagement",
            () => import("@/components/queries/RunningQueries.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "settings.queryManagement",
            featureKey: "queryManagement",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "cipher_keys",
          name: "cipherKeys",
          component: gatedComponent(
            "cipherKeys",
            () => import("@/components/settings/CipherKeys.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "settings.cipherKeys",
            featureKey: "cipherKeys",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "ai_toolsets",
          name: "aiToolsets",
          component: gatedComponent(
            "aiToolsets",
            () => import("@/components/settings/AiToolsets.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "aiToolset.header",
            featureKey: "aiToolsets",
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
            featureKey: "pipelineDestinations",
          },
          component: gatedComponent(
            "pipelineDestinations",
            () => import("@/components/alerts/PipelinesDestinationList.vue"),
          ),
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "storage_settings",
          name: "storageSettings",
          component: gatedComponent(
            "storageSettings",
            () => import("@/components/settings/OrgStorageSettings.vue"),
          ),
          meta: {
            titleKey: "routeTitles.storageSettings",
            featureKey: "storageSettings",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "nodes",
          name: "nodes",
          component: gatedComponent("nodes", () => import("@/components/settings/Nodes.vue")),
          meta: {
            keepAlive: true,
            titleKey: "settings.nodes",
            featureKey: "nodes",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "domain_management",
          name: "domainManagement",
          component: gatedComponent(
            "domainManagement",
            () => import("@/components/settings/DomainManagement.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.domainManagement",
            featureKey: "domainManagement",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "regex_patterns",
          name: "regexPatterns",
          component: gatedComponent(
            "regexPatterns",
            () => import("@/components/settings/RegexPatternList.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.regexPatterns",
            featureKey: "regexPatterns",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "password_policy",
          name: "passwordPolicy",
          component: gatedComponent(
            "passwordPolicy",
            () => import("@/components/settings/PasswordPolicy.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "routeTitles.passwordPolicy",
            featureKey: "passwordPolicy",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "correlation/:tab?",
          name: "correlationSettings",
          component: gatedComponent(
            "correlationSettings",
            () => import("@/components/settings/CorrelationSettings.vue"),
          ),
          meta: {
            keepAlive: true,
            titleKey: "settings.correlationSettings",
            featureKey: "correlationSettings",
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "license",
          name: "license",
          component: gatedComponent("license", () => import("@/components/settings/License.vue")),
          meta: { featureKey: "license" },
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
