<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <q-dialog v-model="showDialog" @hide="onDialogHide">
    <q-card class="enterprise-dialog-v3" style="min-width: 1200px; max-width: 1400px">
      <!-- Close Button -->
      <q-btn
        icon="cancel"
        flat
        round
        dense
        v-close-popup
        class="close-btn-top-right"
      />

      <div class="dialog-split-layout" :class="{ 'cloud-layout': dialogConfig.isCloudLayout }">
        <!-- Left Panel - Hero Section (hidden for Cloud) -->
        <div v-if="!dialogConfig.isCloudLayout" class="hero-panel">

          <div class="hero-content">
            <div class="hero-icon">
              <q-icon name="workspace_premium" size="48px" />
            </div>

            <h2 class="hero-title">{{ dialogConfig.heroTitle }}</h2>

            <p class="offer-text">
              {{ dialogConfig.offerText }}
            </p>

            <div class="hero-offer">
              <!-- Loading State: Show skeleton -->
              <template v-if="isLoadingLicense && dialogConfig.showUsageIndicator">
                <q-skeleton
                  type="circle"
                  size="40px"
                  class="usage-indicator"
                  animation="pulse"
                  style="background: rgba(255, 255, 255, 0.2);"
                />
                <q-skeleton
                  type="rect"
                  width="200px"
                  height="44px"
                  class="offer-badge-skeleton"
                  animation="pulse"
                  style="background: rgba(255, 255, 255, 0.2); border-radius: 24px;"
                />
              </template>

              <!-- Loaded State: Show actual data -->
              <template v-else>
                <q-circular-progress
                  v-if="dialogConfig.showUsageIndicator"
                  :value="dialogConfig.usagePercentage"
                  size="40px"
                  :thickness="0.18"
                  :color="getProgressColor(dialogConfig.usagePercentage)"
                  track-color="rgba(255, 255, 255, 0.3)"
                  class="usage-indicator"
                  show-value
                  font-size="10px"
                >
                  <span style="color: white; font-weight: 700; font-size: 10px;">{{ Math.round(dialogConfig.usagePercentage) }}%</span>
                </q-circular-progress>
                <div class="offer-badge" :class="{ 'licensed-badge': dialogConfig.isLicensed }">
                  <q-icon v-if="!dialogConfig.showUsageIndicator" :name="dialogConfig.badgeIcon" size="20px" class="q-mr-xs" />
                  <span>{{ dialogConfig.badgeText }}</span>
                </div>
              </template>
            </div>

            <!-- License Limit Note (only for Enterprise without license) -->
            <div v-if="dialogConfig.showLicenseNote" class="license-note">
              <q-icon name="info" size="14px" class="q-mr-xs" />
              <span>{{ dialogConfig.licenseNoteText }}</span>
            </div>

            <div class="hero-actions">
              <q-btn
                v-if="dialogConfig.showPrimaryButton"
                unelevated
                :label="dialogConfig.primaryButtonText"
                @click="handlePrimaryButtonClick"
                :icon-right="dialogConfig.primaryButtonIcon"
                no-caps
                class="download-btn"
              />
              <q-btn
                v-if="dialogConfig.showContactSales"
                flat
                :label="t('about.enterprise_offer.buttons.contact_sales')"
                @click="contactSales"
                no-caps
                class="learn-more-btn"
                color="white"
              />
              <q-btn
                v-else
                flat
                :label="t('about.enterprise_offer.buttons.learn_more')"
                @click="openDocsLink"
                no-caps
                class="learn-more-btn"
                color="white"
              />
            </div>
          </div>
        </div>

        <!-- Right Panel - Features List -->
        <div class="features-panel">
          <div class="features-header">
            <h4>{{ dialogConfig.featuresTitle }}</h4>
            <p class="header-subtitle">{{ dialogConfig.featuresSubtitle }}</p>
          </div>

          <!-- Cloud 3-column layout -->
          <div v-if="dialogConfig.isCloudLayout" class="features-list cloud-three-column">
            <!-- Column 1: Core Features -->
            <div
              v-for="feature in coreFeatures"
              :key="feature.name"
              class="feature-list-item"
              :class="{ 'has-link': feature.link }"
              @click="feature.link && openFeatureLink(feature.link)"
            >
              <div class="feature-icon-badge">
                <q-icon :name="feature.icon" size="15px" />
              </div>
              <div class="feature-content">
                <div class="feature-name">
                  {{ feature.name }}
                  <q-icon v-if="feature.link" name="open_in_new" size="12px" class="external-link-icon" />
                </div>
                <div class="feature-desc">{{ feature.note }}</div>
              </div>
            </div>

            <!-- Columns 2 & 3: Enterprise Features -->
            <div
              v-for="feature in enterpriseFeatures"
              v-show="!feature.cloudHidden"
              :key="feature.name"
              class="feature-list-item"
              :class="{ 'has-link': feature.link }"
              @click="feature.link && openFeatureLink(feature.link)"
            >
              <div class="feature-icon-badge">
                <q-icon :name="feature.icon" size="15px" />
              </div>
              <div class="feature-content">
                <div class="feature-name">
                  {{ feature.name }}
                  <q-icon v-if="feature.link" name="open_in_new" size="12px" class="external-link-icon" />
                </div>
                <div class="feature-desc">{{ feature.note }}</div>
              </div>
            </div>
          </div>

          <!-- Standard 2-column layout for non-Cloud -->
          <div v-else class="features-list">
            <div
              v-for="feature in enterpriseFeatures"
              :key="feature.name"
              class="feature-list-item"
              :class="{ 'has-link': feature.link }"
              @click="feature.link && openFeatureLink(feature.link)"
            >
              <div class="feature-icon-badge">
                <q-icon :name="feature.icon" size="15px" />
              </div>
              <div class="feature-content">
                <div class="feature-name">
                  {{ feature.name }}
                  <q-icon v-if="feature.link" name="open_in_new" size="12px" class="external-link-icon" />
                  <span v-if="feature.requiresHA" class="ha-badge">
                    HA
                    <q-tooltip anchor="top middle" self="bottom middle" :offset="[0, 8]">
                      {{ t('about.enterprise_offer.tooltip.high_availability_mode_only') }}
                    </q-tooltip>
                  </span>
                </div>
                <div class="feature-desc">{{ feature.note }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, PropType, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import licenseServer from "@/services/license_server";

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
  workload_management: "workload_mgmt",
  audit_trail: "audit_trail",
  action_scripts: "action_scripts",
  sensitive_data_redaction: "data_redact",
  pipeline_remote_destinations: "pipeline_remote",
  query_optimizer: "query_opt",
  incident_management: "incident_mgmt",
  sre_agent: "sre_agent",
  ai_assistant: "ai_assistant",
  anomaly_detection: "anomaly_detect",
  metrics_auto_downsampling: "metrics_downsample",
  log_patterns: "log_patterns",
  mcp_server: "mcp_server",
  rate_limiting: "rate_limit",
  broadcast_join: "broadcast_join",
  logs_metrics_traces_correlation: "telemetry_corr",
  service_maps: "service_maps",
};

export default defineComponent({
  name: "EnterpriseUpgradeDialog",
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const showDialog = ref(props.modelValue);
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();
    const { t } = useI18n();
    const licenseData = ref<any>(null);
    const isLoadingLicense = ref(false);

    // Fetch license data when dialog opens for Enterprise with license
    const fetchLicenseData = async () => {
      const isEnterprise = config.isEnterprise === 'true';
      const isCloud = config.isCloud === 'true';
      const hasLicense = store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

      // Only fetch for Enterprise with license (not Cloud)
      if (isEnterprise && hasLicense && !isCloud) {
        isLoadingLicense.value = true;
        try {
          const response = await licenseServer.get_license();
          licenseData.value = response.data;
        } catch (error) {
          console.error("Failed to fetch license data:", error);
          // On error, set default values (0% usage, unlimited)
          licenseData.value = {
            license: {
              limits: {
                Ingestion: {
                  value: 0
                }
              }
            },
            ingestion_used: 0
          };
        } finally {
          isLoadingLicense.value = false;
        }
      }
    };

    // Dialog configuration based on deployment type
    const dialogConfig = computed(() => {
      const isEnterprise = config.isEnterprise === 'true';
      const isCloud = config.isCloud === 'true';
      const hasLicense = store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

      // Calculate ingestion quota limit for non-licensed enterprise
      // Use ingestion_quota (the limit), not ingestion_quota_used (the usage percentage)
      const ingestionQuota = store.state.zoConfig?.ingestion_quota ?? 200; // Use nullish coalescing to allow 0

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
          badgeText: t("about.enterprise_offer.enterprise_without_license.badge_text", { quota: ingestionQuota }),
          badgeIcon: "data_usage",
          showUsageIndicator: true,
          usagePercentage: usagePercentage,
          featuresTitle: t("about.enterprise_offer.enterprise_without_license.features_title"),
          featuresSubtitle: t("about.enterprise_offer.enterprise_without_license.features_subtitle"),
          primaryButtonText: t("about.enterprise_offer.enterprise_without_license.primary_button_text"),
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
        const badgeText = ingestionLimit > 0
          ? t("about.enterprise_offer.enterprise_with_license.badge_text_limited", { limit: ingestionLimit })
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
        name: t("about.enterprise_offer.core_features.rum.name"),
        note: t("about.enterprise_offer.core_features.rum.note"),
        icon: "visibility",
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.rum,
      },
      {
        name: t("about.enterprise_offer.core_features.alerts.name"),
        note: t("about.enterprise_offer.core_features.alerts.note"),
        icon: "notifications_active",
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
        note: t("about.enterprise_offer.core_features.vrl_functions.note"),
        icon: "functions",
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.vrl_functions,
      },
      {
        name: t("about.enterprise_offer.core_features.pipelines.name"),
        note: t("about.enterprise_offer.core_features.pipelines.note"),
        icon: "account_tree",
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.pipelines,
      },
      {
        name: t("about.enterprise_offer.core_features.high_availability.name"),
        note: t("about.enterprise_offer.core_features.high_availability.note"),
        icon: "cloud_done",
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.high_availability,
      },
      {
        name: t("about.enterprise_offer.core_features.multitenancy.name"),
        note: t("about.enterprise_offer.core_features.multitenancy.note"),
        icon: "corporate_fare",
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
    const enterpriseFeatures = [
      {
        name: t("about.enterprise_offer.enterprise_features.single_sign_on.name"),
        note: t("about.enterprise_offer.enterprise_features.single_sign_on.note"),
        icon: "key",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.single_sign_on,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.rbac.name"),
        note: t("about.enterprise_offer.enterprise_features.rbac.note"),
        icon: "admin_panel_settings",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.rbac,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.federated_search.name"),
        note: t("about.enterprise_offer.enterprise_features.federated_search.note"),
        icon: "hub",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.federated_search,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.query_management.name"),
        note: t("about.enterprise_offer.enterprise_features.query_management.note"),
        icon: "insights",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.query_management,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.workload_management.name"),
        note: t("about.enterprise_offer.enterprise_features.workload_management.note"),
        icon: "speed",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.workload_management,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.audit_trail.name"),
        note: t("about.enterprise_offer.enterprise_features.audit_trail.note"),
        icon: "fact_check",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.audit_trail,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.action_scripts.name"),
        note: t("about.enterprise_offer.enterprise_features.action_scripts.note"),
        icon: "code",
        requiresHA: true,
        cloudHidden: true, // Hide from Cloud layout
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.action_scripts,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.sensitive_data_redaction.name"),
        note: t("about.enterprise_offer.enterprise_features.sensitive_data_redaction.note"),
        icon: "shield",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.sensitive_data_redaction,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.pipeline_remote_destinations.name"),
        note: t("about.enterprise_offer.enterprise_features.pipeline_remote_destinations.note"),
        icon: "alt_route",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.pipeline_remote_destinations,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.query_optimizer.name"),
        note: t("about.enterprise_offer.enterprise_features.query_optimizer.note"),
        icon: "memory",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.query_optimizer,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.incident_management.name"),
        note: t("about.enterprise_offer.enterprise_features.incident_management.note"),
        icon: "emergency",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.incident_management,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.sre_agent.name"),
        note: t("about.enterprise_offer.enterprise_features.sre_agent.note"),
        icon: "smart_toy",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.sre_agent,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.ai_assistant.name"),
        note: t("about.enterprise_offer.enterprise_features.ai_assistant.note"),
        icon: "psychology",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.ai_assistant,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.anomaly_detection.name"),
        note: t("about.enterprise_offer.enterprise_features.anomaly_detection.note"),
        icon: "query_stats",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.anomaly_detection,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.metrics_auto_downsampling.name"),
        note: t("about.enterprise_offer.enterprise_features.metrics_auto_downsampling.note"),
        icon: "compress",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.metrics_auto_downsampling,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.log_patterns.name"),
        note: t("about.enterprise_offer.enterprise_features.log_patterns.note"),
        icon: "pattern",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.log_patterns,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.mcp_server.name"),
        note: t("about.enterprise_offer.enterprise_features.mcp_server.note"),
        icon: "dns",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.mcp_server,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.rate_limiting.name"),
        note: t("about.enterprise_offer.enterprise_features.rate_limiting.note"),
        icon: "speed",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.rate_limiting,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.broadcast_join.name"),
        note: t("about.enterprise_offer.enterprise_features.broadcast_join.note"),
        icon: "call_merge",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.broadcast_join,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.logs_metrics_traces_correlation.name"),
        note: t("about.enterprise_offer.enterprise_features.logs_metrics_traces_correlation.note"),
        icon: "auto_graph",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.logs_metrics_traces_correlation,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.service_maps.name"),
        note: t("about.enterprise_offer.enterprise_features.service_maps.note"),
        icon: "account_tree",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.service_maps,
      },
    ];

    const onDialogHide = () => {
      emit("update:modelValue", false);
    };

    const openDownloadPage = () => {
      window.open("https://o2.ws/download_resources", "_blank");
    };

    const openDocsLink = () => {
      const isEnterprise = config.isEnterprise === 'true';
      const isCloud = config.isCloud === 'true';
      const hasLicense = store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

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
      // Get meta org identifier
      const metaOrgIdentifier = store.state.zoConfig.meta_org;

      // Find the meta org from the organizations list
      const metaOrg = store.state.organizations?.find(
        (org: any) => org.identifier === metaOrgIdentifier
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

        // Close the dialog
        emit("update:modelValue", false);

        // Navigate to license page with the meta org identifier
        router.push({
          name: 'license',
          query: { org_identifier: metaOrgIdentifier }
        });
      } else {
        // Show error notification when user doesn't have access to meta org
        $q.notify({
          message: t("about.enterprise_offer.error_messages.not_authorized_manage_license"),
          color: 'negative',
          timeout: 5000,
        });
      }
    };

    const handlePrimaryButtonClick = () => {
      const isEnterprise = config.isEnterprise === 'true';
      const isCloud = config.isCloud === 'true';
      const hasLicense = store.state.zoConfig?.license_expiry && store.state.zoConfig.license_expiry !== 0;

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

    // Function to get progress color based on percentage
    const getProgressColor = (percentage: number): string => {
      if (percentage >= 80) {
        return "red";
      } else if (percentage >= 60) {
        return "orange";
      } else {
        return "green";
      }
    };

    // Watch for dialog opening to fetch license data
    watch(showDialog, (newVal) => {
      if (newVal) {
        fetchLicenseData();
      }
    });

    return {
      showDialog,
      dialogConfig,
      coreFeatures,
      enterpriseFeatures,
      onDialogHide,
      openDownloadPage,
      openDocsLink,
      contactSales,
      openFeatureLink,
      navigateToLicense,
      handlePrimaryButtonClick,
      getProgressColor,
      isLoadingLicense,
      t,
      Math,
    };
  },
  watch: {
    modelValue(newVal) {
      this.showDialog = newVal;
    },
    showDialog(newVal) {
      if (!newVal) {
        this.$emit("update:modelValue", false);
      }
    },
  },
});
</script>

<style scoped lang="scss">
.enterprise-dialog-v3 {
  overflow: hidden;
  position: relative;
}

.close-btn-top-right {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 100;
  color: rgba(0, 0, 0, 0.6);

  &:hover {
    color: rgba(0, 0, 0, 0.87);
  }
}

.dialog-split-layout {
  display: flex;
  height: 780px;
  max-height: 92vh;

  &.cloud-layout {
    .features-panel {
      flex: 1;
      max-width: 100%;
    }
  }
}

// Left Panel - Hero Section
.hero-panel {
  flex: 0 0 35%;
  background: linear-gradient(135deg, var(--q-primary) 0%, color-mix(in srgb, var(--q-primary) 85%, black 15%) 100%);
  padding: 40px;
  display: flex;
  flex-direction: column;
  position: relative;
  color: white;
  overflow: hidden;

  .hero-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    max-width: 400px;
    width: 100%;
  }

  .hero-icon {
    width: 80px;
    height: 80px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
    backdrop-filter: blur(10px);

    .q-icon {
      color: white;
    }
  }

  .hero-title {
    font-size: 32px;
    font-weight: 700;
    margin: 0 0 16px 0;
    line-height: 1.2;
    text-align: center;
  }

  .offer-text {
    margin: 0 0 24px 0;
    font-size: 14px;
    line-height: 1.6;
    opacity: 0.95;
    text-align: center;
  }

  .hero-offer {
    margin-bottom: 32px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 16px;

    .usage-indicator {
      flex-shrink: 0;
    }

    .offer-badge-skeleton {
      flex-shrink: 0;
    }

    .offer-badge {
      display: inline-flex;
      align-items: center;
      background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%);
      padding: 10px 20px;
      border-radius: 24px;
      font-weight: 700;
      font-size: 15px;
      backdrop-filter: blur(10px);
      color: white;
      box-shadow: 0 4px 16px rgba(34, 197, 94, 0.4);

      .q-icon {
        color: white;
        font-size: 20px;
      }

      // Licensed badge styling - neutral white/transparent for users who already have license
      &.licensed-badge {
        background: rgba(255, 255, 255, 0.2);
        color: white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

        .q-icon {
          color: white;
        }
      }
    }
  }

  .license-note {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: -8px;
    margin-bottom: 16px;
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.9);
    font-size: 12px;
    font-weight: 500;
    backdrop-filter: blur(10px);
    white-space: nowrap;

    .q-icon {
      color: rgba(255, 255, 255, 0.85);
    }
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;

    .download-btn {
      background: white !important;
      color: var(--q-primary) !important;
      font-weight: 700;
      padding: 10px 32px;
      font-size: 15px;
      border-radius: 8px !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: 0.3px;

      &:hover {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }

      &:active {
        transform: translateY(-1px) scale(0.98);
      }
    }

    .learn-more-btn {
      font-weight: 600;
      padding: 10px 24px;
      font-size: 15px;
      border-radius: 8px !important;
      border: 2px solid rgba(255, 255, 255, 0.3);
      transition: all 0.3s ease;
      letter-spacing: 0.2px;
      background: transparent;

      &:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.5);
        transform: translateX(4px);
      }

      &:active {
        transform: scale(0.96);
      }
    }
  }
}

// Right Panel - Features List
.features-panel {
  flex: 1;
  background: white;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .features-header {
    padding: 16px 32px 12px 32px;
    background: white;
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    text-align: center;

    .header-icon-wrapper {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--q-primary), color-mix(in srgb, var(--q-primary) 85%, purple 15%));
      border-radius: 12px;
      margin-bottom: 8px;

      .header-icon {
        color: white;
        font-size: 18px;
      }
    }

    h4 {
      font-size: 18px;
      font-weight: 800;
      margin: 0 0 4px 0;
      color: rgba(0, 0, 0, 0.9);
      letter-spacing: -0.3px;
    }

    .header-subtitle {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
      margin: 0;
      font-weight: 500;
    }
  }

  .features-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 32px 16px 32px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 7px 14px;
    align-content: start;

    &.cloud-three-column {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .feature-list-item {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    transition: all 0.2s ease;

    &:hover {
      background: rgba(0, 0, 0, 0.03);
      border-color: rgba(0, 0, 0, 0.12);
    }

    &.has-link {
      cursor: pointer;

      &:hover {
        background: rgba(var(--q-primary-rgb), 0.05);
        border-color: rgba(var(--q-primary-rgb), 0.3);
        transform: translateX(2px);
      }

      &:active {
        transform: translateX(0);
      }
    }

    .feature-icon-badge {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: rgba(var(--q-primary-rgb), 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--q-primary);

      .q-icon {
        font-size: 15px;
      }
    }

    .feature-content {
      flex: 1;
      min-width: 0;
    }

    .feature-name {
      font-size: 13px;
      font-weight: 600;
      color: rgba(0, 0, 0, 0.87);
      margin-bottom: 2px;
      line-height: 1.25;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .external-link-icon {
      opacity: 0.6;
      margin-left: 4px;
      vertical-align: middle;
    }

    .ha-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      background: rgba(var(--q-primary-rgb), 0.15);
      color: var(--q-primary);
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      line-height: 1;
      cursor: pointer;
      margin-left: 4px;
    }

    .feature-desc {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.55);
      line-height: 1.25;
    }
  }
}

// Dark mode
body.body--dark {
  .close-btn-top-right {
    color: rgba(255, 255, 255, 0.7);

    &:hover {
      color: rgba(255, 255, 255, 0.95);
    }
  }

  .features-panel {
    background: #1e1e1e;

    .features-header {
      background: #1e1e1e;
      border-bottom-color: rgba(255, 255, 255, 0.1);

      h4 {
        color: rgba(255, 255, 255, 0.95);
      }

      .header-subtitle {
        color: rgba(255, 255, 255, 0.6);
      }
    }

    .feature-list-item {
      border: 1px solid rgba(255, 255, 255, 0.12);

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      &.has-link {
        &:hover {
          background: rgba(var(--q-primary-rgb), 0.1);
          border-color: rgba(var(--q-primary-rgb), 0.4);
        }
      }

      .feature-icon-badge {
        background: rgba(var(--q-primary-rgb), 0.15);
      }

      .feature-name {
        color: rgba(255, 255, 255, 0.95);
      }

      .ha-badge {
        background: rgba(var(--q-primary-rgb), 0.2);
        color: var(--q-primary);
      }

      .feature-desc {
        color: rgba(255, 255, 255, 0.55);
      }
    }
  }
}

@media (max-width: 900px) {
  .dialog-split-layout {
    flex-direction: column;
  }

  .hero-panel {
    flex: 0 0 auto;
    min-height: 400px;
  }
}
</style>
