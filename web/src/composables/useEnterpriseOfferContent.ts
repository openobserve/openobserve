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

import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useTheme } from "@/composables/useTheme";
import { licenseQuery } from "@/services/license_server.queries";
import { queryClient } from "@/composables/query/queryClient";
import { raw, useI18nTyped } from "@/types/i18n";
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";

// Feature documentation links configuration
const FEATURE_DOCS_BASE_URL = "https://o2.ws/";

const FEATURE_LINKS = {
  // Core Features
  logs_metrics_traces: "logs_metrics_traces",
  rum: "rum",
  alerts: "alerts",
  dashboards: "dashboards",
  reports: "reports",
  vrl_functions: "vrl_func",
  pipelines: "pipelines",
  high_availability: "high_avail",
  multitenancy: "multitenancy",
  dynamic_schema: "dynamic_schema",
  multilingual_gui: "multilang_gui",

  // Enterprise Features
  single_sign_on: "sso",
  rbac: "rbac",
  federated_search: "fed_search",
  query_management: "query_mgmt",
  audit_trail: "audit_trail",
  sensitive_data_redaction: "data_redact",
  pipeline_remote_destinations: "pipeline_remote",
  incident_management: "incident_mgmt",
  sre_agent: "sre_agent",
  ai_assistant: "ai_assistant",
  anomaly_detection: "anomaly_detect",
  metrics_auto_downsampling: "metrics_downsample",
  log_patterns: "log_patterns",
  rate_limiting: "rate_limit",
  logs_metrics_traces_correlation: "telemetry_corr",
  service_maps: "service_maps",
  byob: "byob",
};

export type EnterpriseFeatureCategory = "security" | "scale" | "ai" | "analysis";

/**
 * Shared offer content (hero copy, license-aware badge/CTA, and the 21-feature
 * grid data) behind both `EnterpriseUpgradeDialog` (a modal) and the
 * `/enterprise-features` page a locked nav item now routes to — one catalog
 * instead of two forks drifting apart.
 *
 * `onBeforeNavigateAway` runs right before `navigateToLicense` pushes the
 * route — the dialog passes a callback that closes itself; the page has
 * nothing to close, so it's optional.
 */
export function useEnterpriseOfferContent(options?: { onBeforeNavigateAway?: () => void }) {
  const store = useStore();
  const router = useRouter();
  const { t } = useI18nTyped();
  const licenseData = ref<any>(null);
  const isLoadingLicense = ref(false);

  const { isDark } = useTheme();

  const fetchLicenseData = async () => {
    const isEnterprise = config.isEnterprise === "true";
    const isCloud = config.isCloud === "true";
    const hasLicense =
      store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

    // Only fetch for Enterprise with license (not Cloud)
    if (isEnterprise && hasLicense && !isCloud) {
      isLoadingLicense.value = true;
      try {
        licenseData.value = await queryClient.fetchQuery(licenseQuery());
      } catch (error) {
        console.error("Failed to fetch license data:", error);
        // On error, set default values (0% usage, unlimited)
        licenseData.value = {
          license: {
            limits: {
              Ingestion: {
                value: 0,
              },
            },
          },
          ingestion_used: 0,
        };
      } finally {
        isLoadingLicense.value = false;
      }
    }
  };

  // Dialog/page configuration based on deployment type
  const dialogConfig = computed(() => {
    const isEnterprise = config.isEnterprise === "true";
    const isCloud = config.isCloud === "true";
    const hasLicense =
      store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

    // Calculate ingestion quota limit for non-licensed enterprise
    // Use ingestion_quota (the limit), not ingestion_quota_used (the usage percentage)
    const ingestionQuota = store.state.zoConfig?.ingestion_quota ?? 50; // Use nullish coalescing to allow 0

    // Get usage percentage for circular indicator (this is already a percentage)
    const usagePercentage = store.state.zoConfig?.ingestion_quota_used ?? 0;

    // Cloud (check this first because Cloud has both isCloud=true and isEnterprise=true)
    if (isCloud) {
      return {
        heroTitle: t("about.enterprise_offer.cloud.hero_title"),
        offerText: t("about.enterprise_offer.cloud.offer_text"),
        badgeText: t("about.enterprise_offer.cloud.badge_text"),
        badgeIcon: "bolt",
        featuresTitle: t("about.enterprise_offer.cloud.features_title"),
        featuresSubtitle: t("about.enterprise_offer.cloud.features_subtitle"),
        primaryButtonText: t("about.enterprise_offer.cloud.primary_button_text"),
        primaryButtonIcon: "download",
        showPrimaryButton: true,
        isCloudLayout: true,
      };
    }

    // Enterprise without license
    if (isEnterprise && !hasLicense) {
      return {
        heroTitle: t("about.enterprise_offer.enterprise_without_license.hero_title"),
        offerText: t("about.enterprise_offer.enterprise_without_license.offer_text"),
        badgeText: t("about.enterprise_offer.enterprise_without_license.badge_text", {
          quota: ingestionQuota,
        }),
        badgeIcon: "data_usage",
        showUsageIndicator: true,
        usagePercentage: usagePercentage,
        featuresTitle: t("about.enterprise_offer.enterprise_without_license.features_title"),
        featuresSubtitle: t("about.enterprise_offer.enterprise_without_license.features_subtitle"),
        primaryButtonText: t(
          "about.enterprise_offer.enterprise_without_license.primary_button_text",
        ),
        primaryButtonIcon: "key",
        showPrimaryButton: true,
        showLicenseNote: true, // Show note about license limits
        licenseNoteText: t("about.enterprise_offer.enterprise_without_license.license_note"),
      };
    }

    // Enterprise with license
    if (isEnterprise && hasLicense) {
      // Calculate ingestion usage from license data
      const ingestionLimit = licenseData.value?.license?.limits?.Ingestion?.value || 0;
      const ingestionUsedPercentage = licenseData.value?.ingestion_used || 0;
      const badgeText =
        ingestionLimit > 0
          ? t("about.enterprise_offer.enterprise_with_license.badge_text_limited", {
              limit: ingestionLimit,
            })
          : t("about.enterprise_offer.enterprise_with_license.badge_text_unlimited");

      return {
        heroTitle: t("about.enterprise_offer.enterprise_with_license.hero_title"),
        offerText: t("about.enterprise_offer.enterprise_with_license.offer_text"),
        badgeText: badgeText,
        badgeIcon: "verified",
        showUsageIndicator: true,
        usagePercentage: ingestionUsedPercentage,
        featuresTitle: t("about.enterprise_offer.enterprise_with_license.features_title"),
        featuresSubtitle: t("about.enterprise_offer.enterprise_with_license.features_subtitle"),
        primaryButtonText: t("about.enterprise_offer.enterprise_with_license.primary_button_text"),
        primaryButtonIcon: "key",
        showPrimaryButton: true,
        showContactSales: true,
        isLicensed: true, // Flag to apply different badge styling
      };
    }

    // Open Source (both false) - Default fallback
    return {
      heroTitle: t("about.enterprise_offer.open_source.hero_title"),
      offerText: t("about.enterprise_offer.open_source.offer_text"),
      badgeText: t("about.enterprise_offer.open_source.badge_text"),
      badgeIcon: "card_giftcard",
      featuresTitle: t("about.enterprise_offer.open_source.features_title"),
      featuresSubtitle: t("about.enterprise_offer.open_source.features_subtitle"),
      primaryButtonText: t("about.enterprise_offer.open_source.primary_button_text"),
      primaryButtonIcon: "download",
      showPrimaryButton: true,
    };
  });

  // Core features list - available in all versions (for Cloud 3-column layout)
  const coreFeatures = [
    {
      name: t("about.enterprise_offer.core_features.logs_metrics_traces.name"),
      note: t("about.enterprise_offer.core_features.logs_metrics_traces.note"),
      icon: "storage",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.logs_metrics_traces,
    },
    {
      name: raw("RUM"),
      note: t("about.enterprise_offer.core_features.rum.note"),
      icon: "visibility",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.rum,
    },
    {
      name: t("about.enterprise_offer.core_features.alerts.name"),
      note: t("about.enterprise_offer.core_features.alerts.note"),
      icon: "notifications-active",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.alerts,
    },
    {
      name: t("about.enterprise_offer.core_features.dashboards.name"),
      note: t("about.enterprise_offer.core_features.dashboards.note"),
      icon: "dashboard",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.dashboards,
    },
    {
      name: t("about.enterprise_offer.core_features.reports.name"),
      note: t("about.enterprise_offer.core_features.reports.note"),
      icon: "description",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.reports,
    },
    {
      name: t("about.enterprise_offer.core_features.vrl_functions.name"),
      note: t("about.enterprise_offer.core_features.vrl_functions.note", {
        product: raw("Vector Remap Language"),
      }),
      icon: "functions",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.vrl_functions,
    },
    {
      name: t("about.enterprise_offer.core_features.pipelines.name"),
      note: t("about.enterprise_offer.core_features.pipelines.note"),
      icon: "account-tree",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.pipelines,
    },
    {
      name: t("about.enterprise_offer.core_features.high_availability.name"),
      note: t("about.enterprise_offer.core_features.high_availability.note"),
      icon: "cloud-done",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.high_availability,
    },
    {
      name: t("about.enterprise_offer.core_features.multitenancy.name"),
      note: t("about.enterprise_offer.core_features.multitenancy.note"),
      icon: "corporate-fare",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.multitenancy,
    },
    {
      name: t("about.enterprise_offer.core_features.dynamic_schema.name"),
      note: t("about.enterprise_offer.core_features.dynamic_schema.note"),
      icon: "schema",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.dynamic_schema,
    },
    {
      name: t("about.enterprise_offer.core_features.multilingual_gui.name"),
      note: t("about.enterprise_offer.core_features.multilingual_gui.note"),
      icon: "language",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.multilingual_gui,
    },
  ];

  // Enterprise features list - all 21 features
  const enterpriseFeatures: {
    name: string;
    note: string;
    icon: string;
    link?: string;
    requiresHA?: boolean;
    beta?: boolean;
    cloudOnly?: boolean;
    cloudHidden?: boolean;
    category: EnterpriseFeatureCategory;
  }[] = [
    {
      name: t("about.enterprise_offer.enterprise_features.single_sign_on.name"),
      note: t("about.enterprise_offer.enterprise_features.single_sign_on.note"),
      icon: "key",
      requiresHA: true,
      category: "security",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.single_sign_on,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.rbac.name"),
      note: t("about.enterprise_offer.enterprise_features.rbac.note"),
      icon: "admin-panel-settings",
      requiresHA: true,
      category: "security",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.rbac,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.federated_search.name"),
      note: t("about.enterprise_offer.enterprise_features.federated_search.note"),
      icon: "hub",
      requiresHA: true,
      category: "scale",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.federated_search,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.query_management.name"),
      note: t("about.enterprise_offer.enterprise_features.query_management.note"),
      icon: "insights",
      requiresHA: false,
      category: "scale",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.query_management,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.audit_trail.name"),
      note: t("about.enterprise_offer.enterprise_features.audit_trail.note"),
      icon: "fact-check",
      requiresHA: false,
      category: "security",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.audit_trail,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.sensitive_data_redaction.name"),
      note: t("about.enterprise_offer.enterprise_features.sensitive_data_redaction.note"),
      icon: "shield",
      requiresHA: false,
      category: "security",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.sensitive_data_redaction,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.pipeline_remote_destinations.name"),
      note: t("about.enterprise_offer.enterprise_features.pipeline_remote_destinations.note"),
      icon: "alt-route",
      requiresHA: false,
      category: "analysis",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.pipeline_remote_destinations,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.incident_management.name"),
      note: t("about.enterprise_offer.enterprise_features.incident_management.note"),
      icon: "emergency",
      requiresHA: true,
      beta: true,
      category: "ai",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.incident_management,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.sre_agent.name"),
      note: t("about.enterprise_offer.enterprise_features.sre_agent.note"),
      icon: "smart-toy",
      requiresHA: true,
      beta: true,
      category: "ai",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.sre_agent,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.ai_assistant.name"),
      note: t("about.enterprise_offer.enterprise_features.ai_assistant.note"),
      icon: "psychology",
      requiresHA: true,
      beta: true,
      category: "ai",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.ai_assistant,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.anomaly_detection.name"),
      note: t("about.enterprise_offer.enterprise_features.anomaly_detection.note"),
      icon: "query-stats",
      requiresHA: false,
      beta: true,
      category: "ai",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.anomaly_detection,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.metrics_auto_downsampling.name"),
      note: t("about.enterprise_offer.enterprise_features.metrics_auto_downsampling.note"),
      icon: "compress",
      requiresHA: false,
      category: "scale",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.metrics_auto_downsampling,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.log_patterns.name"),
      note: t("about.enterprise_offer.enterprise_features.log_patterns.note"),
      icon: "pattern",
      requiresHA: false,
      category: "analysis",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.log_patterns,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.rate_limiting.name"),
      note: t("about.enterprise_offer.enterprise_features.rate_limiting.note"),
      icon: "speed",
      requiresHA: false,
      category: "scale",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.rate_limiting,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.logs_metrics_traces_correlation.name"),
      note: t("about.enterprise_offer.enterprise_features.logs_metrics_traces_correlation.note"),
      icon: "auto-graph",
      requiresHA: false,
      category: "analysis",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.logs_metrics_traces_correlation,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.service_maps.name"),
      note: t("about.enterprise_offer.enterprise_features.service_maps.note"),
      icon: "account-tree",
      requiresHA: false,
      category: "analysis",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.service_maps,
    },
    {
      name: t("about.enterprise_offer.enterprise_features.byob.name"),
      note: t("about.enterprise_offer.enterprise_features.byob.note"),
      icon: "database",
      requiresHA: false,
      beta: true,
      cloudOnly: true,
      category: "scale",
      link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.byob,
    },
  ];

  const openDownloadPage = () => {
    window.open("https://o2.ws/download_resources", "_blank");
  };

  const openDocsLink = () => {
    const isEnterprise = config.isEnterprise === "true";
    const isCloud = config.isCloud === "true";
    const hasLicense =
      store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

    let docsUrl = "https://openobserve.ai/docs/";

    // Enterprise without license - redirect to license docs
    if (isEnterprise && !hasLicense) {
      docsUrl = "https://o2.ws/license_guide";
    }
    // Open Source or Cloud - redirect to enterprise edition installation guide
    else if (!isEnterprise || isCloud) {
      docsUrl = "https://o2.ws/ent_install_guide";
    }

    window.open(docsUrl, "_blank");
  };

  const contactSales = () => {
    window.open("https://o2.ws/contact_us", "_blank");
  };

  const openFeatureLink = (url: string) => {
    window.open(url, "_blank");
  };

  const navigateToLicense = () => {
    // Get meta org identifier; "_meta" fallback covers the window before the
    // authenticated full config (which carries meta_org) has loaded.
    const metaOrgIdentifier = store.state.zoConfig.meta_org || "_meta";

    // Find the meta org from the organizations list
    const metaOrg = store.state.organizations?.find(
      (org: any) => org.identifier === metaOrgIdentifier,
    );

    if (metaOrg) {
      // Create the org option object so that it will be used to switch to meta org
      const metaOrgOption = {
        label: metaOrg.name,
        id: metaOrg.id,
        identifier: metaOrg.identifier,
        user_email: store.state.userInfo.email,
        ingest_threshold: metaOrg.ingest_threshold,
        search_threshold: metaOrg.search_threshold,
      };

      // Set the selected organization using dispatch
      store.dispatch("setSelectedOrganization", metaOrgOption);

      options?.onBeforeNavigateAway?.();

      // Navigate to license page with the meta org identifier
      router.push({
        name: "license",
        query: { org_identifier: metaOrgIdentifier },
      });
    } else {
      // Show error notification when user doesn't have access to meta org
      toast({
        message: t("about.enterprise_offer.error_messages.not_authorized_manage_license"),
        variant: "error",
      });
    }
  };

  const handlePrimaryButtonClick = () => {
    const isEnterprise = config.isEnterprise === "true";
    const isCloud = config.isCloud === "true";
    const hasLicense =
      store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

    // Cloud - open download page
    if (isCloud) {
      openDownloadPage();
    }
    // Enterprise with license - navigate to license page
    else if (isEnterprise && hasLicense) {
      navigateToLicense();
    }
    // Enterprise without license - navigate to license page
    else if (isEnterprise && !hasLicense) {
      navigateToLicense();
    }
    // Open Source - open download page
    else {
      openDownloadPage();
    }
  };

  return {
    dialogConfig,
    coreFeatures,
    enterpriseFeatures,
    isDark,
    licenseData,
    isLoadingLicense,
    fetchLicenseData,
    openDownloadPage,
    openDocsLink,
    contactSales,
    openFeatureLink,
    navigateToLicense,
    handlePrimaryButtonClick,
  };
}
