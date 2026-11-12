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
  <div class="rounded-default px-page-edge h-full w-full pt-2.5 pb-2.5">
    <div class="h-full overflow-auto">
      <div class="flex flex-col gap-4">
        <!-- ── Hero Banner ─────────────────────────────────────────── -->
        <div class="bg-card-glass-bg rounded-default relative overflow-hidden p-4">
          <div class="relative z-1">
            <img
              :alt="t('login.openObserveLogoAlt')"
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
            <div
              class="mt-5 inline-flex flex-wrap items-center gap-2 max-md:max-w-full max-md:[&>span]:max-w-full max-md:[&>span]:overflow-hidden"
            >
              <!-- version -->
              <span
                class="rounded-default text-status-positive border-status-positive/28 bg-card-glass-tint-positive inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm font-semibold whitespace-nowrap"
              >
                <OIcon name="check-circle" size="sm" class="text-status-positive shrink-0" />
                {{ store.state.zoConfig.version }}
              </span>
              <!-- build type -->
              <span
                class="rounded-default text-accent border-accent/28 bg-card-glass-tint-soft inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm font-semibold whitespace-nowrap capitalize"
              >
                <OIcon name="workspaces" size="sm" class="text-accent shrink-0" />
                {{ store.state.zoConfig.build_type }}
              </span>
              <!-- commit -->
              <span
                class="text-text-body rounded-default border-info/28 bg-card-glass-tint-info-soft inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm whitespace-nowrap max-md:min-w-0"
              >
                <OIcon name="code" size="sm" class="text-info shrink-0" />
                <span class="text-info text-xs font-semibold tracking-wide uppercase">{{
                  t("about.commit_lbl")
                }}</span>
                <OText variant="mono" class="max-md:max-w-28 max-md:truncate">{{
                  store.state.zoConfig.commit_hash
                }}</OText>
                <button
                  @click="copyToClipboard(store.state.zoConfig.commit_hash)"
                  class="rounded-default text-text-muted hover:text-info inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0.5 transition-colors duration-150"
                  :title="t('about.copyCommitHash')"
                >
                  <OIcon name="content-copy" size="sm" />
                </button>
              </span>
              <!-- built date -->
              <span
                class="text-text-body rounded-default border-warning/28 bg-card-glass-tint-warning inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm whitespace-nowrap"
              >
                <OIcon name="event" size="sm" class="text-warning shrink-0" />
                <span class="text-warning text-xs font-semibold tracking-wide uppercase">{{
                  t("about.build_lbl")
                }}</span>
                {{
                  store.state.zoConfig.build_date ? formatDate(store.state.zoConfig.build_date) : ""
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- ── Info Cards Grid ─────────────────────────────────────── -->
        <div class="grid grid-cols-1 gap-4">
          <!-- Open Source Libraries -->
          <div class="bg-card-glass-bg rounded-default flex flex-col gap-y-2 p-4">
            <div class="flex items-center gap-3">
              <div
                class="rounded-default text-accent bg-card-glass-tint-medium flex h-12 w-12 shrink-0 items-center justify-center"
              >
                <OIcon name="code" size="md" />
              </div>
              <OText variant="page-title" as="h2" class="text-xl font-medium">{{
                t("about.os_libraries")
              }}</OText>
            </div>
            <div class="text-text-secondary text-sm">{{ t("about.os_libraries_msg") }}</div>
            <div class="grid grid-cols-4 gap-2.5 max-md:grid-cols-1">
              <a
                href="https://github.com/openobserve/openobserve/blob/main/Cargo.toml"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3.5 py-3 no-underline transition-all duration-200"
              >
                <OIcon name="settings" size="md" class="text-accent shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading font-mono text-sm font-semibold">{{
                    t("about.cargoToml")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.rustCrates") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://github.com/openobserve/openobserve/blob/main/web/package.json"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3.5 py-3 no-underline transition-all duration-200"
              >
                <OIcon name="backpack" size="md" class="text-accent shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading font-mono text-sm font-semibold">{{
                    t("about.packageJson")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.nodePackages") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://npmjs.com"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3.5 py-3 no-underline transition-all duration-200"
              >
                <OIcon name="javascript" size="md" class="text-accent shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading font-mono text-sm font-semibold">{{
                    t("about.npmjsCom")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.jsRegistry") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://crates.io"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3.5 py-3 no-underline transition-all duration-200"
              >
                <OIcon name="inventory-2" size="md" class="text-accent shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading font-mono text-sm font-semibold">{{
                    t("about.cratesIo")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.rustRegistry") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
            </div>
          </div>

          <!-- License Info (opensource or enterprise on-prem) -->
          <div
            v-if="
              store.state.zoConfig.build_type == 'opensource' ||
              (store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false')
            "
            class="bg-card-glass-bg rounded-default p-4"
          >
            <div class="mb-3 flex items-center gap-3">
              <div
                class="rounded-default text-info bg-card-glass-tint-info flex h-12 w-12 shrink-0 items-center justify-center"
              >
                <OIcon name="shield" size="md" />
              </div>
              <OText variant="page-title" as="h2" class="m-0 text-xl font-medium">{{
                t("about.license_info")
              }}</OText>
            </div>
            <OText
              v-if="store.state.zoConfig.build_type == 'opensource'"
              variant="body"
              as="div"
              class="m-0 mb-4 leading-relaxed"
            >
              {{ t("about.license_info_os_msg") }}
              <a
                href="https://github.com/openobserve/openobserve/blob/main/LICENSE"
                target="_blank"
                class="text-text-link hover:border-text-link border-text-link/35 border-b font-medium no-underline transition-colors duration-200"
                >{{ t("about.agplFullName") }}</a
              >.
            </OText>
            <OText
              v-if="store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false'"
              variant="body"
              as="div"
              class="leading-relaxed"
            >
              {{ t("about.license_info_msg") }}
            </OText>
            <OBanner variant="info" icon="info" class="mt-2">
              {{ t("about.license_info_note") }}
            </OBanner>
          </div>

          <!-- Community Card (fallback for cloud) -->
          <div v-else class="bg-card-glass-bg rounded-default p-4">
            <div class="mb-3 flex items-center gap-3">
              <div
                class="rounded-default text-accent bg-card-glass-tint-medium flex h-12 w-12 shrink-0 items-center justify-center"
              >
                <OIcon name="groups" size="md" />
              </div>
              <OText variant="page-title" as="h3" class="m-0 text-lg leading-6 font-medium">{{
                t("about.community_lbl")
              }}</OText>
            </div>
            <OText variant="body" class="m-0 mb-4 leading-relaxed">{{
              t("about.community_msg")
            }}</OText>
            <div class="flex flex-wrap gap-2">
              <a
                href="https://github.com/openobserve/openobserve"
                target="_blank"
                class="rounded-default text-accent border-accent/18 bg-card-glass-tint-soft inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm font-medium no-underline transition-all duration-200"
              >
                <OIcon name="code" size="sm" />
                {{ t("about.github") }}
              </a>
              <a
                href="https://openobserve.ai"
                target="_blank"
                class="rounded-default text-accent border-accent/18 bg-card-glass-tint-soft inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm font-medium no-underline transition-all duration-200"
              >
                <OIcon name="language" size="sm" />
                {{ t("about.website") }}
              </a>
            </div>
          </div>
        </div>

        <!-- ── Enterprise License Details ──────────────────────────── -->
        <div
          v-if="config.isEnterprise == 'true' && config.isCloud === 'false'"
          class="bg-card-glass-bg rounded-default p-4"
        >
          <!-- Header: eyebrow + title + manage button -->
          <div class="mb-2 flex items-start justify-between">
            <div class="flex items-start gap-3">
              <div
                class="rounded-default text-info bg-card-glass-tint-info flex h-12 w-12 shrink-0 items-center justify-center"
              >
                <OIcon name="workspace-premium" size="md" />
              </div>
              <div>
                <OText variant="label" class="text-accent m-0 mb-1 tracking-widest uppercase">{{
                  t("about.licenseAndUsage")
                }}</OText>
                <h2 class="text-text-heading m-0 text-xl font-semibold">
                  {{ t("about.ent_lincese_detail_lbl") }}
                </h2>
              </div>
            </div>
            <OButton variant="primary" size="sm" @click="navigateToLicense">
              {{ t("about.manage_license") }}
            </OButton>
          </div>
          <OText variant="body" class="m-0 mb-5 leading-relaxed">{{
            t("about.license_info_msg")
          }}</OText>

          <div v-if="loadingLicense" class="py-8 text-center">
            <OSpinner size="md" />
            <div class="text-text-muted mt-3 text-sm">{{ t("about.loading_license_info") }}</div>
          </div>

          <div v-else-if="!licenseData || !licenseData.license" class="py-2">
            <OBanner variant="warning" icon="warning">
              <div class="mb-1 font-semibold">{{ t("about.no_license_installed_lbl") }}</div>
              <p class="mb-2 text-sm">{{ t("about.no_license_installed_msg") }}</p>
              <div
                v-if="licenseData && licenseData.installation_id"
                class="flex flex-wrap items-center gap-1 text-xs"
              >
                {{ t("about.installation_id_lbl") }}:
                <code
                  class="rounded-default border-card-glass-border bg-code-bg border border-solid px-2 py-0.5 font-mono select-all"
                >
                  {{ licenseData.installation_id }}
                </code>
              </div>
            </OBanner>
          </div>

          <template v-else>
            <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <!-- License details table -->
              <div class="border-card-glass-border rounded-default overflow-hidden border">
                <table class="w-full border-collapse">
                  <tbody>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg w-2/5 border-e px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap"
                      >
                        {{ t("about.lincese_id_lbl") }}
                      </td>
                      <td class="text-text-body px-3.5 py-2.5 font-mono text-sm">
                        <div class="flex items-center gap-1.5">
                          <span>{{ licenseData.license.license_id }}</span>
                          <button
                            @click="copyToClipboard(licenseData.license.license_id)"
                            class="rounded-default text-text-muted hover:text-accent inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0.5 transition-colors duration-150"
                            :title="t('about.copyLicenseId')"
                          >
                            <OIcon name="content-copy" size="sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg w-2/5 border-e px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap"
                      >
                        {{ t("about.status_lbl") }}
                      </td>
                      <td class="text-text-body px-3.5 py-2.5 text-sm">
                        <span
                          class="me-1.5 inline-block h-2 w-2 rounded-full align-middle"
                          :class="
                            licenseData?.expired ? 'bg-status-negative' : 'bg-status-positive'
                          "
                        />
                        <span
                          :class="
                            licenseData?.expired ? 'text-status-error-text' : 'text-status-positive'
                          "
                        >
                          {{
                            licenseData?.expired ? t("about.expired_lbl") : t("about.active_lbl")
                          }}
                        </span>
                      </td>
                    </tr>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg w-2/5 border-e px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap"
                      >
                        {{ t("about.editionLbl") }}
                      </td>
                      <td class="text-text-body px-3.5 py-2.5 text-sm">
                        {{ t("about.value_license_enterprise") }}
                      </td>
                    </tr>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg w-2/5 border-e px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap"
                      >
                        {{ t("about.create_at_lbl") }}
                      </td>
                      <td class="text-text-body px-3.5 py-2.5 text-sm">
                        {{ formatLicenseDate(licenseData.license.created_at) }}
                      </td>
                    </tr>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg w-2/5 border-e px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap"
                      >
                        {{ t("about.expires_at_lbl") }}
                      </td>
                      <td class="text-text-body px-3.5 py-2.5 text-sm">
                        {{ formatLicenseDate(licenseData.license.expires_at) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Ingestion usage panel -->
              <div
                class="border-card-glass-border rounded-default bg-card-glass-tint-faint border p-5"
              >
                <p class="text-text-heading m-0 mb-1 text-sm font-semibold">
                  {{ t("about.usage_limits") }}
                </p>
                <p class="text-text-muted m-0 mb-4 text-xs" data-test="about-license-limit">
                  {{
                    limitGb === null
                      ? t("about.license_status_unlimited")
                      : `${limitGb} ${t("about.gbPerDay")}`
                  }}
                </p>
                <div v-if="usedPercent !== null">
                  <div class="mb-3 flex items-baseline gap-2">
                    <span
                      class="text-text-body text-4xl leading-none font-bold"
                      :class="
                        usedPercent > 90
                          ? 'text-status-error-text'
                          : usedPercent > 70
                            ? 'text-status-warning-text'
                            : ''
                      "
                      >{{ usedPercent }}%</span
                    >
                    <span class="text-text-secondary text-xs">{{
                      t("about.ofDailyLimitUsedToday")
                    }}</span>
                  </div>
                  <div class="bg-card-glass-border mb-1.5 h-1.5 overflow-hidden rounded-full">
                    <div
                      class="h-full min-w-1 rounded-full transition-[width] duration-[400ms]"
                      :class="
                        usedPercent > 90
                          ? 'bg-status-negative'
                          : usedPercent > 70
                            ? 'bg-warning'
                            : 'bg-accent'
                      "
                      :style="{ width: Math.min(usedPercent, 100) + '%' }"
                    />
                  </div>
                </div>
                <div
                  v-if="usedGb !== null"
                  class="text-text-muted mb-3.5 flex justify-between text-xs"
                  data-test="about-license-used"
                >
                  <span>{{ usedGb.toFixed(0) }} {{ t("about.gbToday") }}</span>
                  <span v-if="limitGb !== null">{{ limitGb }} {{ t("about.gbPerDay") }}</span>
                </div>
                <div
                  v-if="limitGb === FREE_LIMIT_GB"
                  data-test="about-license-plan-detail"
                  class="text-status-positive rounded-default border-status-positive/22 bg-card-glass-tint-positive flex items-start gap-1.5 border px-3 py-2 text-xs"
                >
                  <OIcon name="check-circle" size="sm" class="mt-0.5 shrink-0" />
                  {{ t("about.feature_comparision_plan_detail") }}
                </div>
              </div>
            </div>
            <div class="mt-4" data-test="about-license-features">
              <p class="text-text-heading m-0 mb-2 text-sm font-semibold">
                {{ t("about.features") }}
              </p>
              <LicenseFeatures
                :license="licenseData.license"
                :evaluated-at="licenseData.evaluated_at"
                :hide-request-access="!licenseData.can_update_license"
                @request-access="openLicenseRequest"
              />
            </div>
          </template>
        </div>

        <!-- ── Feature Comparison ──────────────────────────────────── -->
        <div v-if="config.isCloud === 'false'" class="bg-card-glass-bg rounded-default mb-5 p-4">
          <FeatureComparisonTable />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { getImageURL } from "../utils/zincutils";
import { useI18nTyped } from "@/types/i18n";
import config from "@/aws-exports";
import licenseServer from "@/services/license_server";
import FeatureComparisonTable from "@/components/about/FeatureComparisonTable.vue";
import LicenseFeatures from "@/components/settings/LicenseFeatures.vue";
import { useLicensePage } from "@/composables/useLicensePage";
import { effectiveLimitGb, FREE_LIMIT_GB, licenseRequestUrl } from "@/utils/featureGate";
import { quotaPercent } from "@/utils/licenseWaivers";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageAbout",
  components: {
    FeatureComparisonTable,
    LicenseFeatures,
    OButton,
    OIcon,
    OSpinner,
    OBanner,
    OText,
    OTruncatedText,
  },
  setup() {
    const store = useStore();
    const { isDark } = useTheme();
    const { goToLicensePage: navigateToLicense } = useLicensePage();
    const pageData = ref("Page Data");
    const { t } = useI18nTyped();
    const licenseData = ref<any>(null);
    const loadingLicense = ref(false);

    const limitGb = computed(() =>
      licenseData.value ? effectiveLimitGb(licenseData.value) : null,
    );

    // Only an evaluated decision knows today's usage; before that the stored percentage is the one figure.
    const evaluatedDecision = computed(() =>
      licenseData.value?.evaluated_at !== 0 ? licenseData.value?.decision : undefined,
    );

    const usedPercent = computed<number | null>(() => {
      if (limitGb.value === null) return null;
      if (evaluatedDecision.value) return quotaPercent(evaluatedDecision.value);
      const stored = licenseData.value?.ingestion_used;
      return stored === undefined ? null : Math.round(stored);
    });

    const usedGb = computed<number | null>(() => {
      if (evaluatedDecision.value) return evaluatedDecision.value.used_today_gb;
      const stored = licenseData.value?.ingestion_used;
      return stored === undefined || limitGb.value === null ? null : (stored / 100) * limitGb.value;
    });

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    };

    const formatLicenseDate = (timestamp: number) => {
      return new Date(timestamp / 1000).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
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
      if (config.isCloud == "false" && config.isEnterprise == "true") {
        loadLicenseData();
      }
    });

    const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        toast({ message: t("toastMessages.views.copiedToClipboard"), variant: "success" });
      });
    };

    const openLicenseRequest = () => {
      window.open(
        licenseRequestUrl(store.state.zoConfig, licenseData.value, window.location.origin),
        "_blank",
      );
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
      openLicenseRequest,
      limitGb,
      usedPercent,
      usedGb,
      FREE_LIMIT_GB,
      copyToClipboard,
    };
  },
});
</script>
