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
  <div class="rounded-default w-full h-full px-page-edge pb-2.5 pt-2.5">
    <div class="h-full overflow-auto">
      <div class="flex flex-col gap-4">

        <!-- ── Hero Banner ─────────────────────────────────────────── -->
        <div class="relative bg-card-glass-bg rounded-default p-4 overflow-hidden">
          <div class="relative z-1">
            <img
              :src="
                isDark
                  ? getImageURL('images/common/openobserve_latest_dark_2.svg')
                  : getImageURL('images/common/openobserve_latest_light_2.svg')
              "
              class="block max-w-55"
              width="220"
            />
            <OText variant="body" class="mt-1 mb-0">
              {{ t("about.logoMsg") }}
            </OText>

            <!-- One-line meta bar -->
            <div class="inline-flex items-center flex-wrap gap-2 mt-5">
              <!-- version -->
              <span class="inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap py-2 px-3.5 rounded-default border text-status-positive border-[color-mix(in_srgb,var(--color-status-positive)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-status-positive)_8%,var(--color-card-glass-bg))]">
                <OIcon name="check-circle" size="sm" class="text-status-positive shrink-0" />
                {{ store.state.zoConfig.version }}
              </span>
              <!-- build type -->
              <span class="inline-flex items-center gap-1.5 text-sm font-semibold capitalize whitespace-nowrap py-2 px-3.5 rounded-default border text-accent border-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-card-glass-bg))]">
                <OIcon name="workspaces" size="sm" class="text-accent shrink-0" />
                {{ store.state.zoConfig.build_type }}
              </span>
              <!-- commit -->
              <span class="inline-flex items-center gap-1.5 text-sm text-text-body whitespace-nowrap py-2 px-3.5 rounded-default border border-[color-mix(in_srgb,var(--color-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_8%,var(--color-card-glass-bg))]">
                <OIcon name="code" size="sm" class="text-info shrink-0" />
                <span class="text-xs font-semibold uppercase tracking-wide text-info">{{ t("about.commit_lbl") }}</span>
                <OText variant="mono">{{ store.state.zoConfig.commit_hash }}</OText>
                <button
                  @click="copyToClipboard(store.state.zoConfig.commit_hash)"
                  class="inline-flex items-center justify-center p-0.5 rounded-default border-none bg-transparent cursor-pointer text-text-muted hover:text-info transition-colors duration-150"
                  title="Copy commit hash"
                >
                  <OIcon name="content-copy" size="sm" />
                </button>
              </span>
              <!-- built date -->
              <span class="inline-flex items-center gap-1.5 text-sm text-text-body whitespace-nowrap py-2 px-3.5 rounded-default border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,var(--color-card-glass-bg))]">
                <OIcon name="event" size="sm" class="text-warning shrink-0" />
                <span class="text-xs font-semibold uppercase tracking-wide text-warning">{{ t("about.build_lbl") }}</span>
                {{ formatDate(store.state.zoConfig.build_date) }}
              </span>
            </div>
          </div>
        </div>

        <!-- ── Info Cards Grid ─────────────────────────────────────── -->
        <div class="grid grid-cols-1 gap-4">

          <!-- Open Source Libraries -->
          <div class="bg-card-glass-bg rounded-default p-4 flex flex-col gap-y-2">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-default flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-card-glass-bg))] text-accent">
                <OIcon name="code" size="md" />
              </div>
                <OText variant="page-title" as="h2" class="text-xl font-medium">{{ t("about.os_libraries") }}</OText>
            </div>
            <div class="text-sm text-text-secondary">{{ t("about.os_libraries_msg") }}</div>
            <div class="grid grid-cols-4 gap-2.5">
              <a
                href="https://github.com/openobserve/openobserve/blob/main/Cargo.toml"
                target="_blank"
                class="flex items-center gap-3 py-3 px-3.5 border border-card-glass-border rounded-default bg-card-glass-bg no-underline transition-all duration-200 hover:border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
              >
                <OIcon name="settings" size="md" class="text-accent shrink-0" />
                <div class="flex-1 flex flex-col gap-0.5 min-w-0">
                  <span class="text-sm font-semibold font-mono text-text-heading whitespace-nowrap overflow-hidden text-ellipsis">Cargo.toml</span>
                  <span class="text-xs text-text-muted">Rust crates</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://github.com/openobserve/openobserve/blob/main/web/package.json"
                target="_blank"
                class="flex items-center gap-3 py-3 px-3.5 border border-card-glass-border rounded-default bg-card-glass-bg no-underline transition-all duration-200 hover:border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
              >
                <OIcon name="backpack" size="md" class="text-accent shrink-0" />
                <div class="flex-1 flex flex-col gap-0.5 min-w-0">
                  <span class="text-sm font-semibold font-mono text-text-heading whitespace-nowrap overflow-hidden text-ellipsis">package.json</span>
                  <span class="text-xs text-text-muted">Node packages</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://npmjs.com"
                target="_blank"
                class="flex items-center gap-3 py-3 px-3.5 border border-card-glass-border rounded-default bg-card-glass-bg no-underline transition-all duration-200 hover:border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
              >
                <OIcon name="javascript" size="md" class="text-accent shrink-0" />
                <div class="flex-1 flex flex-col gap-0.5 min-w-0">
                  <span class="text-sm font-semibold font-mono text-text-heading whitespace-nowrap overflow-hidden text-ellipsis">npmjs.com</span>
                  <span class="text-xs text-text-muted">JS registry</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://crates.io"
                target="_blank"
                class="flex items-center gap-3 py-3 px-3.5 border border-card-glass-border rounded-default bg-card-glass-bg no-underline transition-all duration-200 hover:border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
              >
                <OIcon name="inventory-2" size="md" class="text-accent shrink-0" />
                <div class="flex-1 flex flex-col gap-0.5 min-w-0">
                  <span class="text-sm font-semibold font-mono text-text-heading whitespace-nowrap overflow-hidden text-ellipsis">crates.io</span>
                  <span class="text-xs text-text-muted">Rust registry</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
            </div>
          </div>

          <!-- License Info (opensource or enterprise on-prem) -->
          <div
            v-if="store.state.zoConfig.build_type == 'opensource' || (store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false')"
            class="bg-card-glass-bg rounded-default p-4"
          >
            <div class="flex items-center gap-3 mb-3">
              <div class="w-12 h-12 rounded-default flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--color-info)_12%,var(--color-card-glass-bg))] text-info">
                <OIcon name="shield" size="md" />
              </div>
              <OText variant="page-title" as="h2" class="m-0 text-xl font-medium">{{ t("about.license_info") }}</OText>
            </div>
            <OText v-if="store.state.zoConfig.build_type == 'opensource'" variant="body" as="div" class="leading-relaxed m-0 mb-4">
              {{ t("about.license_info_os_msg") }}
              <a
                href="https://github.com/openobserve/openobserve/blob/main/LICENSE"
                target="_blank"
                class="text-text-link no-underline font-medium border-b border-[color-mix(in_srgb,var(--color-text-link)_35%,transparent)] transition-colors duration-200 hover:border-text-link"
              >GNU Affero General Public License (AGPL)</a>.
            </OText>
            <OText v-if="store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false'" variant="body" as="div" class="leading-relaxed">
              {{ t("about.license_info_msg") }}
            </OText>
            <OBanner variant="info" icon="info" class="mt-2">
              {{ t("about.license_info_note") }}
            </OBanner>
          </div>

          <!-- Community Card (fallback for cloud) -->
          <div v-else class="bg-card-glass-bg rounded-default p-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-12 h-12 rounded-default flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-card-glass-bg))] text-accent">
                <OIcon name="groups" size="md" />
              </div>
              <OText variant="page-title" as="h3" class="m-0 text-lg font-medium leading-6">{{ t("about.community_lbl") }}</OText>
            </div>
            <OText variant="body" class="leading-relaxed m-0 mb-4">{{ t("about.community_msg") }}</OText>
            <div class="flex flex-wrap gap-2">
              <a
                href="https://github.com/openobserve/openobserve"
                target="_blank"
                class="inline-flex items-center gap-1.5 py-2 px-3.5 rounded-default bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-card-glass-bg))] text-accent no-underline text-sm font-medium border border-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] transition-all duration-200"
              >
                <OIcon name="code" size="sm" />
                GitHub
              </a>
              <a
                href="https://openobserve.ai"
                target="_blank"
                class="inline-flex items-center gap-1.5 py-2 px-3.5 rounded-default bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-card-glass-bg))] text-accent no-underline text-sm font-medium border border-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] transition-all duration-200"
              >
                <OIcon name="language" size="sm" />
                Website
              </a>
            </div>
          </div>
        </div>

        <!-- ── Enterprise License Details ──────────────────────────── -->
        <div v-if="config.isEnterprise == 'true' && config.isCloud === 'false'" class="bg-card-glass-bg rounded-default p-4">
          <!-- Header: eyebrow + title + manage button -->
          <div class="flex items-start justify-between mb-2">
            <div class="flex items-start gap-3">
              <div class="w-12 h-12 rounded-default flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--color-info)_12%,var(--color-card-glass-bg))] text-info">
                <OIcon name="workspace-premium" size="md" />
              </div>
              <div>
                <OText variant="label" class="uppercase tracking-widest m-0 mb-1 text-accent">License &amp; Usage</OText>
                <h2 class="text-xl font-semibold m-0 text-text-heading">{{ t("about.ent_lincese_detail_lbl") }}</h2>
              </div>
            </div>
            <OButton variant="primary" size="sm" @click="navigateToLicense">
              {{ t('about.manage_license') }}
            </OButton>
          </div>
          <OText variant="body" class="leading-relaxed m-0 mb-5">{{ t("about.license_info_msg") }}</OText>

          <div v-if="loadingLicense" class="text-center py-8">
            <OSpinner size="md" />
            <div class="mt-3 text-sm text-text-muted">{{ t("about.loading_license_info") }}</div>
          </div>

          <div v-else-if="!licenseData || !licenseData.license" class="py-2">
            <OBanner variant="warning" icon="warning">
              <div class="font-semibold mb-1">{{ t("about.no_license_installed_lbl") }}</div>
              <p class="text-sm mb-2">{{ t("about.no_license_installed_msg") }}</p>
              <div v-if="licenseData && licenseData.installation_id" class="text-xs flex items-center flex-wrap gap-1">
                {{ t("about.installation_id_lbl") }}:
                <code class="px-2 py-0.5 rounded-default font-mono border border-solid border-card-glass-border bg-code-bg select-all">
                  {{ licenseData.installation_id }}
                </code>
              </div>
            </OBanner>
          </div>

          <div v-else class="grid grid-cols-2 gap-4">
            <!-- License details table -->
            <div class="border border-card-glass-border rounded-default overflow-hidden">
              <table class="w-full border-collapse">
                <tbody>
                  <tr class="border-b border-table-row-divider last:border-b-0">
                    <td class="w-2/5 font-semibold text-sm text-table-header-text py-2.5 px-3.5 border-r border-table-row-divider whitespace-nowrap bg-table-header-bg">{{ t("about.lincese_id_lbl") }}</td>
                    <td class="text-sm text-text-body py-2.5 px-3.5 font-mono">
                      <div class="flex items-center gap-1.5">
                        <span>{{ licenseData.license.license_id }}</span>
                        <button
                          @click="copyToClipboard(licenseData.license.license_id)"
                          class="inline-flex items-center justify-center p-0.5 rounded-default border-none bg-transparent cursor-pointer text-text-muted hover:text-accent transition-colors duration-150"
                          title="Copy license ID"
                        >
                          <OIcon name="content-copy" size="sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr class="border-b border-table-row-divider last:border-b-0">
                    <td class="w-2/5 font-semibold text-sm text-table-header-text py-2.5 px-3.5 border-r border-table-row-divider whitespace-nowrap bg-table-header-bg">{{ t("about.status_lbl") }}</td>
                    <td class="text-sm text-text-body py-2.5 px-3.5">
                      <span
                        class="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                        :class="licenseData?.expired ? 'bg-status-negative' : 'bg-status-positive'"
                      />
                      <span :class="licenseData?.expired ? 'text-status-error-text' : 'text-status-positive'">
                        {{ licenseData?.expired ? t("about.expired_lbl") : t("about.active_lbl") }}
                      </span>
                    </td>
                  </tr>
                  <tr class="border-b border-table-row-divider last:border-b-0">
                    <td class="w-2/5 font-semibold text-sm text-table-header-text py-2.5 px-3.5 border-r border-table-row-divider whitespace-nowrap bg-table-header-bg">Edition</td>
                    <td class="text-sm text-text-body py-2.5 px-3.5">{{ t("about.value_license_enterprise") }}</td>
                  </tr>
                  <tr class="border-b border-table-row-divider last:border-b-0">
                    <td class="w-2/5 font-semibold text-sm text-table-header-text py-2.5 px-3.5 border-r border-table-row-divider whitespace-nowrap bg-table-header-bg">{{ t("about.create_at_lbl") }}</td>
                    <td class="text-sm text-text-body py-2.5 px-3.5">{{ formatLicenseDate(licenseData.license.created_at) }}</td>
                  </tr>
                  <tr class="border-b border-table-row-divider last:border-b-0">
                    <td class="w-2/5 font-semibold text-sm text-table-header-text py-2.5 px-3.5 border-r border-table-row-divider whitespace-nowrap bg-table-header-bg">{{ t("about.expires_at_lbl") }}</td>
                    <td class="text-sm text-text-body py-2.5 px-3.5">{{ formatLicenseDate(licenseData.license.expires_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Ingestion usage panel -->
            <div class="bg-[color-mix(in_srgb,var(--color-accent)_4%,var(--color-card-glass-bg))] border border-card-glass-border rounded-default p-5">
              <p class="text-sm font-semibold m-0 mb-1 text-text-heading">{{ t("about.usage_limits") }}</p>
              <p class="text-xs m-0 mb-4 text-text-muted">
                {{ licenseData.license.limits?.Ingestion?.typ || 'PerDayCount' }}
                · limit {{ licenseData.license.limits?.Ingestion?.value || 50 }} GB / day
              </p>
              <div v-if="licenseData.ingestion_used !== undefined">
                <div class="flex items-baseline gap-2 mb-3">
                  <span
                    class="text-4xl font-bold text-text-body leading-none"
                    :class="licenseData.ingestion_used > 90 ? 'text-status-error-text' : licenseData.ingestion_used > 70 ? 'text-status-warning-text' : ''"
                  >{{ licenseData.ingestion_used.toFixed(2) }}%</span>
                  <span class="text-xs text-text-secondary">of daily limit used today</span>
                </div>
                <div class="h-1.5 rounded-full bg-card-glass-border overflow-hidden mb-1.5">
                  <div
                    class="h-full rounded-full transition-[width] duration-[400ms] min-w-1"
                    :class="licenseData.ingestion_used > 90 ? 'bg-status-negative' : licenseData.ingestion_used > 70 ? 'bg-warning' : 'bg-accent'"
                    :style="{ width: Math.min(licenseData.ingestion_used, 100) + '%' }"
                  />
                </div>
                <div class="flex justify-between text-xs text-text-muted mb-3.5">
                  <span>{{ ((licenseData.ingestion_used / 100) * (licenseData.license.limits?.Ingestion?.value || 50)).toFixed(0) }} GB today</span>
                  <span>{{ licenseData.license.limits?.Ingestion?.value || 50 }} GB / day</span>
                </div>
              </div>
              <div class="flex items-start gap-1.5 text-xs text-status-positive bg-[color-mix(in_srgb,var(--color-status-positive)_8%,var(--color-card-glass-bg))] border border-[color-mix(in_srgb,var(--color-status-positive)_22%,transparent)] rounded-default py-2 px-3">
                <OIcon name="check-circle" size="sm" class="shrink-0 mt-0.5" />
                {{ t("about.feature_comparision_plan_detail") }}
              </div>
            </div>
          </div>
        </div>

        <!-- ── Feature Comparison ──────────────────────────────────── -->
        <div v-if="config.isCloud === 'false'" class="bg-card-glass-bg rounded-default p-4 mb-5">
          <FeatureComparisonTable />
        </div>

      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { getImageURL } from "../utils/zincutils";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import licenseServer from "@/services/license_server";
import FeatureComparisonTable from "@/components/about/FeatureComparisonTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageAbout",
  components: {
    FeatureComparisonTable,
    OButton,
    OIcon,
    OSpinner,
    OBanner,
    OText,
  },
  setup() {
    const store = useStore();
    const { isDark } = useTheme();
    const router = useRouter();
    const pageData = ref("Page Data");
    const { t } = useI18n();
    const licenseData = ref<any>(null);
    const loadingLicense = ref(false);

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    const formatLicenseDate = (timestamp: number) => {
      return new Date(timestamp / 1000).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    };

    const loadLicenseData = async () => {
      try {
        loadingLicense.value = true;
        const response = await licenseServer.get_license();
        licenseData.value = response.data;
      } catch (error) {
        console.error("Error loading license data:", error);
        licenseData.value = null;
      } finally {
        loadingLicense.value = false;
      }
    };

    onMounted(() => {
      if (config.isCloud == 'false' && config.isEnterprise == 'true') {
        loadLicenseData();
      }
    });

    const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        toast({ message: "Copied to clipboard", variant: "success" });
      });
    };

    const navigateToLicense = () => {
      const metaOrgIdentifier = store.state.zoConfig.meta_org;
      const metaOrg = store.state.organizations?.find(
        (org: any) => org.identifier === metaOrgIdentifier
      );

      if (metaOrg) {
        const metaOrgOption = {
          label: metaOrg.name,
          id: metaOrg.id,
          identifier: metaOrg.identifier,
          user_email: store.state.userInfo.email,
          ingest_threshold: metaOrg.ingest_threshold,
          search_threshold: metaOrg.search_threshold,
        };
        store.dispatch("setSelectedOrganization", metaOrgOption);
        router.push({
          name: 'license',
          query: { org_identifier: metaOrgIdentifier }
        });
      } else {
        toast({
          message: "You are not authorized to manage the license.",
          variant: "error",
        });
      }
    };

    return {
      isDark,
      t,
      store,
      config,
      pageData,
      getImageURL,
      formatDate,
      licenseData,
      loadingLicense,
      formatLicenseDate,
      navigateToLicense,
      copyToClipboard,
    };
  },
});
</script>

