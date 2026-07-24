<!-- Copyright 2026 OpenObserve Inc.

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
  <ODialog v-model:open="showDialog" data-test="enterprise-upgrade-dialog" :show-close="false" :width="75" @update:open="(v) => !v && onDialogHide()">
    <div class="enterprise-dialog-v3 overflow-hidden relative -my-(--spacing-dialog-content-py) -mx-(--spacing-dialog-content-px)">
      <!-- Close Button -->
      <div class="absolute top-4 right-4 z-100 text-text-secondary hover:text-text-body">
        <OButton
          variant="ghost"
          size="icon"
          @click="showDialog = false"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </OButton>
      </div>

      <div class="dialog-split-layout flex max-h-[92vh] max-[56.25rem]:flex-col" :class="{ 'cloud-layout': dialogConfig.isCloudLayout }">
        <!-- Left Panel - Hero Section (hidden for Cloud) -->
        <div v-if="!dialogConfig.isCloudLayout" class="hero-panel [flex:0_0_35%] bg-[linear-gradient(135deg,var(--color-theme-accent)_0%,color-mix(in_srgb,var(--color-theme-accent)_85%,black_15%)_100%)] p-10 flex flex-col relative text-white overflow-y-auto min-h-0 max-[56.25rem]:flex-none max-[56.25rem]:min-h-100">

          <div class="flex-1 flex flex-col justify-center items-center max-w-100 w-full m-auto">
            <div class="w-20 h-20 bg-[rgba(255,255,255,0.15)] rounded-default flex items-center justify-center mb-6 backdrop-blur-[10px]">
              <OIcon name="workspace-premium" size="xl" />
            </div>

            <div data-test="enterprise-upgrade-hero-title" class="text-3xl font-bold mb-4 leading-[1.2] text-center text-white">{{ dialogConfig.heroTitle }}</div>

            <div class="mb-6 text-sm leading-[1.6] opacity-[0.95] text-center text-white">
              {{ dialogConfig.offerText }}
            </div>

            <div class="mb-8 flex flex-row items-center justify-center gap-4">
              <!-- Loading State: Show skeleton -->
              <template v-if="isLoadingLicense && dialogConfig.showUsageIndicator">
                <OSkeleton
                  class="shrink-0 rounded-full w-10 h-10"
                  data-test="enterprise-upgrade-usage-indicator-skeleton"
                />
                <OSkeleton
                  class="shrink-0 rounded-default"
                  style="width: 200px; height: 44px;"
                  data-test="enterprise-upgrade-offer-badge-skeleton"
                />
              </template>

              <!-- Loaded State: Show actual data -->
              <template v-else>
                <div data-test="enterprise-upgrade-offer-badge" class="inline-flex items-center bg-[linear-gradient(135deg,#22c55e_0%,#4ade80_100%)] py-2.5 px-5 rounded-default font-bold text-sm backdrop-blur-[10px] text-white shadow-[0_4px_16px_rgba(34,197,94,0.4)]" :class="{ 'bg-[rgba(255,255,255,0.2)]! shadow-[0_4px_12px_rgba(0,0,0,0.15)]!': dialogConfig.isLicensed }">
                  <OIcon v-if="!dialogConfig.showUsageIndicator" :name="dialogConfig.badgeIcon" size="md" class="mr-1" />
                  <span>{{ dialogConfig.badgeText }}</span>
                </div>
              </template>
            </div>

            <!-- Usage Chart (only for Enterprise with license) -->
            <div v-if="dialogConfig.isLicensed" class="w-full mb-6 bg-[rgba(255,255,255,0.1)] rounded-default p-4 backdrop-blur-[10px] border border-[rgba(255,255,255,0.2)]">
              <!-- Loading skeleton -->
              <template v-if="isLoadingLicense">
                <OSkeleton
                  class="chart-skeleton rounded-default"
                  style="height: 150px;"
                  data-test="enterprise-upgrade-chart-skeleton"
                />
              </template>
              <!-- Loaded chart -->
              <template v-else-if="chartData">
                <div class="relative w-full">
                  <div class="usage-chart-container w-full overflow-visible p-0 mx-auto min-h-37.5 max-h-37.5" style="height: 150px;">
                    <ChartRenderer
                      :key="dashboardRenderKey"
                      :data="chartData"
                    />
                  </div>
                  <div v-if="isIngestionUnlimited" class="text-xs text-center mt-1" style="color: rgba(255, 255, 255, 0.7); font-size: var(--text-3xs);">
                    {{ t('about.usage_shows_zero_unlimited') }}
                  </div>
                </div>
              </template>
            </div>

            <div class="flex flex-col gap-3 w-full">
              <OButton
                v-if="dialogConfig.showPrimaryButton"
                variant="on-dark-primary"
                size="lg"
                @click="handlePrimaryButtonClick"
                data-test="enterprise-upgrade-download-btn"
                class="bg-white! text-[var(--color-theme-accent)]! font-bold! py-2.5 px-8 text-sm rounded-default! shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-300 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] [letter-spacing:0.3px] hover:[transform:translateY(-3px)_scale(1.02)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] active:[transform:translateY(-1px)_scale(0.98)]"
              >
                {{ dialogConfig.primaryButtonText }}
                <template v-if="dialogConfig.primaryButtonIcon" #icon-right>
                  <OIcon :name="dialogConfig.primaryButtonIcon" size="sm" />
                </template>
              </OButton>
              <OButton
                v-if="dialogConfig.showContactSales"
                variant="on-dark-ghost"
                size="lg"
                @click="contactSales"
                class="font-semibold! py-2.5 px-6 text-sm rounded-default! border-2 border-[rgba(255,255,255,0.3)] transition-all duration-300 bg-transparent [letter-spacing:0.2px] hover:bg-[rgba(255,255,255,0.15)] hover:border-[rgba(255,255,255,0.5)] hover:[transform:translateX(4px)] active:[transform:scale(0.96)]"
              >
                {{ t('about.enterprise_offer.buttons.contact_sales') }}
              </OButton>
              <OButton
                v-else
                variant="on-dark-ghost"
                size="lg"
                @click="openDocsLink"
                data-test="enterprise-upgrade-learn-more-btn"
                class="font-semibold! py-2.5 px-6 text-sm rounded-default! border-2 border-[rgba(255,255,255,0.3)] transition-all duration-300 bg-transparent [letter-spacing:0.2px] hover:bg-[rgba(255,255,255,0.15)] hover:border-[rgba(255,255,255,0.5)] hover:[transform:translateX(4px)] active:[transform:scale(0.96)]"
              >
                {{ t('about.enterprise_offer.buttons.learn_more') }}
              </OButton>
            </div>
          </div>
        </div>

        <!-- Right Panel - Features List -->
        <div class="flex-1 flex flex-col overflow-hidden bg-surface-base" :class="[{ 'max-w-full': dialogConfig.isCloudLayout }]">
          <div class="pt-4 pb-3 px-8 sticky top-0 z-10 border-b text-center bg-surface-base border-border-default">
            <div data-test="enterprise-upgrade-features-title" class="text-lg font-bold mb-1 [letter-spacing:-0.3px] text-text-heading">{{ dialogConfig.featuresTitle }}</div>
            <div class="text-xs font-medium text-text-secondary">{{ dialogConfig.featuresSubtitle }}</div>
          </div>

          <!-- Cloud 3-column layout -->
          <div v-if="dialogConfig.isCloudLayout" data-test="enterprise-upgrade-features-list-cloud" class="flex-1 overflow-y-auto pt-2 pb-4 px-8 grid grid-cols-3 gap-y-[7px] gap-x-[14px] content-start">
            <!-- Column 1: Core Features -->
            <div
              v-for="feature in coreFeatures"
              :key="feature.name"
              data-test="enterprise-upgrade-feature-item"
              class="flex gap-2.5 p-[8px_12px] rounded-default border transition-all duration-200"
              :class="[
                'border-border-default',
                feature.link
                  ? (isDark
                    ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--color-theme-accent)_40%,transparent)] hover:[transform:translateX(2px)] active:[transform:translateX(0)]'
                    : 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_5%,transparent)] hover:border-[color-mix(in_srgb,var(--color-theme-accent)_30%,transparent)] hover:[transform:translateX(2px)] active:[transform:translateX(0)]')
                  : (isDark
                    ? 'hover:bg-[rgba(255,255,255,0.05)]'
                    : 'hover:bg-[rgba(0,0,0,0.03)] hover:border-[rgba(0,0,0,0.12)]')
              ]"
              @click="feature.link && openFeatureLink(feature.link)"
            >
              <div class="shrink-0 w-7.5 h-7.5 rounded-default flex items-center justify-center text-[var(--color-theme-accent)] bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-theme-accent)_15%,transparent)]">
                <OIcon :name="feature.icon" size="sm" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-compact font-semibold mb-0.5 leading-[1.25] flex items-center gap-1.5" :class="'text-text-heading'">
                  {{ feature.name }}
                  <OIcon v-if="feature.link" name="open-in-new" size="xs" class="opacity-60 ml-1 align-middle" />
                </div>
                <div class="text-2xs leading-[1.25]" :class="'text-text-secondary'">{{ feature.note }}</div>
              </div>
            </div>

            <!-- Columns 2 & 3: Enterprise Features -->
            <div
              v-for="feature in enterpriseFeatures"
              v-show="!feature.cloudHidden"
              :key="feature.name"
              data-test="enterprise-upgrade-feature-item"
              class="flex gap-2.5 p-[8px_12px] rounded-default border transition-all duration-200"
              :class="[
                'border-border-default',
                feature.link
                  ? (isDark
                    ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--color-theme-accent)_40%,transparent)] hover:[transform:translateX(2px)] active:[transform:translateX(0)]'
                    : 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_5%,transparent)] hover:border-[color-mix(in_srgb,var(--color-theme-accent)_30%,transparent)] hover:[transform:translateX(2px)] active:[transform:translateX(0)]')
                  : (isDark
                    ? 'hover:bg-[rgba(255,255,255,0.05)]'
                    : 'hover:bg-[rgba(0,0,0,0.03)] hover:border-[rgba(0,0,0,0.12)]')
              ]"
              @click="feature.link && openFeatureLink(feature.link)"
            >
              <div class="shrink-0 w-7.5 h-7.5 rounded-default flex items-center justify-center text-[var(--color-theme-accent)] bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-theme-accent)_15%,transparent)]">
                <OIcon :name="feature.icon" size="sm" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-compact font-semibold mb-0.5 leading-[1.25] flex items-center gap-1.5" :class="'text-text-heading'">
                  {{ feature.name }}
                  <OIcon v-if="feature.link" name="open-in-new" size="xs" class="opacity-60 ml-1 align-middle" />
                  <OTag v-if="feature.beta" type="featureFlag" value="beta" data-test="enterprise-upgrade-feature-beta-badge" />
                </div>
                <div class="text-2xs leading-[1.25]" :class="'text-text-secondary'">{{ feature.note }}</div>
              </div>
            </div>
          </div>

          <!-- Standard 2-column layout for non-Cloud -->
          <div v-else data-test="enterprise-upgrade-features-list-standard" class="flex-1 overflow-y-auto pt-2 pb-4 px-8 grid grid-cols-2 gap-y-[7px] gap-x-[14px] content-start">
            <div
              v-for="feature in enterpriseFeatures"
              v-show="!feature.cloudOnly"
              :key="feature.name"
              data-test="enterprise-upgrade-feature-item"
              class="flex gap-2.5 p-[8px_12px] rounded-default border transition-all duration-200"
              :class="[
                'border-border-default',
                feature.link
                  ? (isDark
                    ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--color-theme-accent)_40%,transparent)] hover:[transform:translateX(2px)] active:[transform:translateX(0)]'
                    : 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_5%,transparent)] hover:border-[color-mix(in_srgb,var(--color-theme-accent)_30%,transparent)] hover:[transform:translateX(2px)] active:[transform:translateX(0)]')
                  : (isDark
                    ? 'hover:bg-[rgba(255,255,255,0.05)]'
                    : 'hover:bg-[rgba(0,0,0,0.03)] hover:border-[rgba(0,0,0,0.12)]')
              ]"
              @click="feature.link && openFeatureLink(feature.link)"
            >
              <div class="shrink-0 w-7.5 h-7.5 rounded-default flex items-center justify-center text-[var(--color-theme-accent)] bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-theme-accent)_15%,transparent)]">
                <OIcon :name="feature.icon" size="sm" />
              </div>
              <div class="flex-1 min-w-0">
                <div data-test="enterprise-upgrade-feature-name" class="text-compact font-semibold mb-0.5 leading-[1.25] flex items-center gap-1.5" :class="'text-text-heading'">
                  {{ feature.name }}
                  <OIcon v-if="feature.link" name="open-in-new" size="xs" data-test="enterprise-upgrade-feature-external-link" class="opacity-60 ml-1 align-middle" />
                  <OTag v-if="feature.beta" type="featureFlag" value="beta" data-test="enterprise-upgrade-feature-beta-badge" />
                  <span v-if="feature.requiresHA" class="inline-flex">
                    <OTag type="featureFlag" value="ha" data-test="enterprise-upgrade-feature-ha-badge" />
                    <OTooltip side="top" align="center" :sideOffset="8" :content="t('about.enterprise_offer.tooltip.high_availability_mode_only')" />
                  </span>
                </div>
                <div class="text-2xs leading-[1.25]" :class="'text-text-secondary'">{{ feature.note }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import licenseServer from "@/services/license_server";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue")
);

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
  byob: "byob",
};

export default defineComponent({
  name: "EnterpriseUpgradeDialog",
  components: {
    OIcon,
    ChartRenderer,
    OButton,
    ODialog,
    OSkeleton,
    OTooltip,
    OTag,
  },
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
    const { t } = useI18n();
    const licenseData = ref<any>(null);
    const isLoadingLicense = ref(false);
    const chartData = ref<any>(null);
    const dashboardRenderKey = ref(0);

    // Dark-mode flag from the sanctioned theme seam; used to toggle classes via
    // :class bindings for the few genuinely theme-divergent (translucent) styles.
    const { isDark } = useTheme();

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
          // Generate dashboard after license data is fetched
          generateUsageDashboard();
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
        note: t("about.enterprise_offer.core_features.vrl_functions.note"),
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
    }[] = [
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
        icon: "admin-panel-settings",
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
        icon: "fact-check",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.audit_trail,
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
        icon: "alt-route",
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
        beta: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.incident_management,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.sre_agent.name"),
        note: t("about.enterprise_offer.enterprise_features.sre_agent.note"),
        icon: "smart-toy",
        requiresHA: true,
        beta: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.sre_agent,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.ai_assistant.name"),
        note: t("about.enterprise_offer.enterprise_features.ai_assistant.note"),
        icon: "psychology",
        requiresHA: true,
        beta: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.ai_assistant,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.anomaly_detection.name"),
        note: t("about.enterprise_offer.enterprise_features.anomaly_detection.note"),
        icon: "query-stats",
        requiresHA: false,
        beta: true,
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
        icon: "call-merge",
        requiresHA: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.broadcast_join,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.logs_metrics_traces_correlation.name"),
        note: t("about.enterprise_offer.enterprise_features.logs_metrics_traces_correlation.note"),
        icon: "auto-graph",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.logs_metrics_traces_correlation,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.service_maps.name"),
        note: t("about.enterprise_offer.enterprise_features.service_maps.note"),
        icon: "account-tree",
        requiresHA: false,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.service_maps,
      },
      {
        name: t("about.enterprise_offer.enterprise_features.byob.name"),
        note: t("about.enterprise_offer.enterprise_features.byob.note"),
        icon: "database",
        requiresHA: false,
        beta: true,
        cloudOnly: true,
        link: FEATURE_DOCS_BASE_URL + FEATURE_LINKS.byob,
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
        toast({
          message: t("about.enterprise_offer.error_messages.not_authorized_manage_license"),
          variant: "error",
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

    // Check if ingestion is unlimited
    const isIngestionUnlimited = computed(() => {
      return licenseData.value?.license?.limits?.Ingestion?.typ === "Unlimited";
    });

    // Get ingestion limit value for threshold
    const ingestionLimitGB = computed(() => {
      if (isIngestionUnlimited.value) {
        return null; // No limit for unlimited plans
      }
      return licenseData.value?.license?.limits?.Ingestion?.value || 100;
    });

    // Generate usage chart data for ChartRenderer
    const generateUsageDashboard = async () => {
      try {
        // Get ingestion history from store
        const ingestionHistory = store.state.zoConfig?.ingestion_history || [];

        // Don't generate chart if there's no ingestion history data
        if (!ingestionHistory || ingestionHistory.length === 0) {
          chartData.value = null;
          return;
        }

        const dates: string[] = [];
        let values: number[] = [];
        let dataUnit = 'GB'; // Default unit
        let unitDivisor = 1024; // Default: MB to GB

        // Use actual ingestion history data
        // Data format: [{ ts: "2026-02-27T00:00:00", value: 202.90125079791258 }]
        // Values are in MB, determine best unit based on data range
        if (ingestionHistory.length > 0) {
          // Sort by timestamp to ensure chronological order
          const sortedHistory = [...ingestionHistory].sort((a, b) =>
            new Date(a.ts).getTime() - new Date(b.ts).getTime()
          );

          // Find max value to determine appropriate unit
          const maxValueMB = Math.max(...sortedHistory.map((item: any) => item.value));

          // Determine best unit based on max value
          if (maxValueMB >= 1024 * 1024) {
            // Use TB if max value is >= 1 TB
            dataUnit = 'TB';
            unitDivisor = 1024 * 1024;
          } else if (maxValueMB >= 1024) {
            // Use GB if max value is >= 1 GB
            dataUnit = 'GB';
            unitDivisor = 1024;
          } else {
            // Use MB for smaller values
            dataUnit = 'MB';
            unitDivisor = 1;
          }

          sortedHistory.forEach((item: any) => {
            const date = new Date(item.ts);
            const day = date.getDate();
            dates.push(`${day}`);
            // Convert MB to appropriate unit
            values.push(item.value / unitDivisor);
          });
        }

        // Calculate Y-axis max and interval based on ingestion limit
        const thresholdGB = ingestionLimitGB.value;
        const maxDataValue = values.length > 0 ? Math.max(...values) : 0;

        // Convert threshold to the same unit as data
        let thresholdInDataUnit = 0;
        if (thresholdGB && thresholdGB > 0) {
          if (dataUnit === 'TB') {
            thresholdInDataUnit = thresholdGB / 1024; // GB to TB
          } else if (dataUnit === 'GB') {
            thresholdInDataUnit = thresholdGB; // Already in GB
          } else {
            thresholdInDataUnit = thresholdGB * 1024; // GB to MB
          }
        }

        // Determine Y-axis max: use the greater of (threshold * 1.2) or (maxData * 1.2)
        let yAxisMax;
        if (thresholdInDataUnit > 0) {
          yAxisMax = Math.max(thresholdInDataUnit * 1.2, maxDataValue * 1.2);
        } else {
          yAxisMax = maxDataValue * 1.2;
        }

        // Calculate nice interval for Y-axis (aim for 4-5 grid lines)
        const calculateInterval = (max: number) => {
          const targetIntervals = 4;
          const rawInterval = max / targetIntervals;

          // Round to nice numbers (1, 2, 5, 10, 20, 50, 100, etc.)
          const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
          const normalized = rawInterval / magnitude;

          let niceInterval;
          if (normalized <= 1) niceInterval = 1 * magnitude;
          else if (normalized <= 2) niceInterval = 2 * magnitude;
          else if (normalized <= 5) niceInterval = 5 * magnitude;
          else niceInterval = 10 * magnitude;

          return niceInterval;
        };

        const yAxisInterval = yAxisMax > 0 ? calculateInterval(yAxisMax) : undefined;

        // Create mark line for threshold if limit exists
        const markLine: any = thresholdGB && thresholdGB > 0 ? {
          silent: true,
          symbol: 'none',
          label: {
            show: false
          },
          lineStyle: {
            color: '#FF0000',
            width: 2,
            type: 'solid'
          },
          data: [{
            yAxis: thresholdInDataUnit
          }]
        } : undefined;

        // Simple echarts configuration for bar chart
        // ChartRenderer expects data in format: { options: { ... } }
        chartData.value = {
          options: {
            backgroundColor: 'transparent',
            grid: {
              left: '10%',
              right: '5%',
              top: '10%',
              bottom: '15%',
              containLabel: true
            },
            xAxis: {
              type: 'category',
              data: dates,
              axisLine: {
                show: true,
                lineStyle: { color: 'rgba(255, 255, 255, 0.3)' }
              },
              axisTick: {
                show: true,
                lineStyle: { color: 'rgba(255, 255, 255, 0.3)' }
              },
              axisLabel: {
                show: true,
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: 10,
                interval: Math.floor(dates.length / 6) // Show ~6 labels based on actual data length
              }
            },
            yAxis: {
              type: 'value',
              min: 0,
              max: yAxisMax,
              interval: yAxisInterval,
              axisLine: {
                show: true,
                lineStyle: { color: 'rgba(255, 255, 255, 0.3)' }
              },
              axisTick: {
                show: true,
                lineStyle: { color: 'rgba(255, 255, 255, 0.3)' }
              },
              axisLabel: {
                show: true,
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: 10,
                formatter: (value: number) => {
                  return value.toFixed(0) + dataUnit;
                }
              },
              splitLine: {
                show: true,
                lineStyle: {
                  color: 'rgba(255, 255, 255, 0.1)',
                  type: 'dashed'
                }
              }
            },
            series: [{
              type: 'bar',
              data: values.map((value) => {
                // Color bars red if they exceed threshold, otherwise green
                const exceeds = thresholdInDataUnit > 0 && value > thresholdInDataUnit;
                return {
                  value: value,
                  itemStyle: {
                    color: exceeds ? '#FF6B6B' : '#22c55e' // Red if exceeds, green if within limit
                  }
                };
              }),
              barWidth: '60%',
              markLine: markLine
            }],
            tooltip: {
              show: true,
              trigger: 'axis',
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              borderWidth: 1,
              textStyle: {
                color: '#fff',
                fontSize: 12
              },
              formatter: (params: any) => {
                const dayNum = params[0].name;
                const value = params[0].value;
                const formattedValue = value.toFixed(2) + ' ' + dataUnit;

                // Get the actual date from ingestion history for this day
                const ingestionHistory = store.state.zoConfig?.ingestion_history || [];
                const matchingEntry = ingestionHistory.find((item: any) => {
                  const date = new Date(item.ts);
                  return date.getDate() === parseInt(dayNum);
                });

                if (matchingEntry) {
                  const fullDate = new Date(matchingEntry.ts);
                  const monthName = fullDate.toLocaleString('default', { month: 'short' });
                  return `${monthName} ${dayNum}<br/>Usage: ${formattedValue}`;
                }

                return `Day ${dayNum}<br/>Usage: ${formattedValue}`;
              }
            },
            animation: true
          }
        };

        dashboardRenderKey.value++;
      } catch (error) {
        console.error("Failed to generate chart data:", error);
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
      licenseData,
      chartData,
      dashboardRenderKey,
      isIngestionUnlimited,
      isDark,
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

<style scoped>
/* keep(lib-override): strip the gridstack widget's default border inside the usage chart
   (.grid-stack-item-content is gridstack-generated DOM, not addressable via template utilities) */
.usage-chart-container :deep(.grid-stack-item-content) {
  border: 0 !important;
}
</style>
