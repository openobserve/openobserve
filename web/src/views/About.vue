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
  <OPageLayout bleed>
    <template #header>
      <OPageHeader :title="t('menu.about')" icon="info" class="border-border-default border-b" />
    </template>
    <div class="px-page-edge h-full w-full overflow-auto py-3">
      <div
        class="bg-card-glass-bg border-border-default rounded-default divide-border-default flex flex-col divide-y border"
      >
        <!-- ── Hero Banner ─────────────────────────────────────────── -->
        <div class="relative overflow-hidden p-3">
          <div class="relative z-1">
            <img
              :alt="t('login.openObserveLogoAlt')"
              :src="
                isDark
                  ? getImageURL('images/common/openobserve_latest_dark_2.svg')
                  : getImageURL('images/common/openobserve_latest_light_2.svg')
              "
              class="block h-8 w-auto"
            />
            <OText variant="body" class="text-compact mt-1 mb-0">
              {{ t("about.logoMsg") }}
            </OText>

            <!-- One-line meta bar -->
            <div
              class="mt-3 inline-flex flex-wrap items-center gap-2 max-md:max-w-full max-md:[&>span]:max-w-full max-md:[&>span]:overflow-hidden"
            >
              <!-- version -->
              <span
                class="rounded-default border-border-default bg-surface-base text-text-body text-compact inline-flex items-center gap-1.5 border px-2 py-0.5 font-semibold whitespace-nowrap"
              >
                <OIcon name="check-circle" size="sm" class="text-text-muted shrink-0" />
                {{ store.state.zoConfig.version }}
              </span>
              <!-- build type -->
              <span
                class="rounded-default border-border-default bg-surface-base text-text-body text-compact inline-flex items-center gap-1.5 border px-2 py-0.5 font-semibold whitespace-nowrap capitalize"
              >
                <OIcon name="workspaces" size="sm" class="text-text-muted shrink-0" />
                {{ store.state.zoConfig.build_type }}
              </span>
              <!-- commit -->
              <span
                class="border-border-default bg-surface-base text-text-body rounded-default text-compact inline-flex items-center gap-1.5 border px-2 py-0.5 whitespace-nowrap max-md:min-w-0"
              >
                <OIcon name="code" size="sm" class="text-text-muted shrink-0" />
                <span class="text-text-body text-xs font-semibold">{{
                  t("about.commit_lbl")
                }}</span>
                <OText variant="mono" class="max-md:max-w-28 max-md:truncate">{{
                  store.state.zoConfig.commit_hash
                }}</OText>
                <button
                  @click="copyToClipboard(store.state.zoConfig.commit_hash)"
                  class="rounded-default text-text-muted hover:text-text-heading inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0.5 transition-colors duration-150"
                  :title="t('about.copyCommitHash')"
                >
                  <OIcon name="content-copy" size="sm" />
                </button>
              </span>
              <!-- built date -->
              <span
                class="border-border-default bg-surface-base text-text-body rounded-default text-compact inline-flex items-center gap-1.5 border px-2 py-0.5 whitespace-nowrap"
              >
                <OIcon name="event" size="sm" class="text-text-muted shrink-0" />
                <span class="text-text-body text-xs font-semibold">{{ t("about.build_lbl") }}</span>
                {{
                  store.state.zoConfig.build_date ? formatDate(store.state.zoConfig.build_date) : ""
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- ── Info Cards Grid ─────────────────────────────────────── -->
        <div class="divide-border-default grid grid-cols-1 divide-y">
          <!-- Open Source Libraries -->
          <div class="flex flex-col gap-y-2 p-3">
            <div class="flex items-center gap-2">
              <div
                class="rounded-default text-text-muted bg-surface-base border-border-default flex h-6 w-6 shrink-0 items-center justify-center border"
              >
                <OIcon name="code" size="sm" />
              </div>
              <OText variant="page-title" as="h2" class="text-sm! font-semibold!">{{
                t("about.os_libraries")
              }}</OText>
            </div>
            <div class="text-text-secondary text-compact">{{ t("about.os_libraries_msg") }}</div>
            <div class="grid grid-cols-4 gap-2 max-md:grid-cols-1">
              <a
                href="https://github.com/openobserve/openobserve/blob/main/Cargo.toml"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3 py-2 no-underline transition-all duration-200"
              >
                <OIcon name="settings" size="md" class="text-text-muted shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading text-compact font-mono font-semibold">{{
                    t("about.cargoToml")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.rustCrates") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://github.com/openobserve/openobserve/blob/main/web/package.json"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3 py-2 no-underline transition-all duration-200"
              >
                <OIcon name="backpack" size="md" class="text-text-muted shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading text-compact font-mono font-semibold">{{
                    t("about.packageJson")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.nodePackages") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://npmjs.com"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3 py-2 no-underline transition-all duration-200"
              >
                <OIcon name="data-object" size="md" class="text-text-muted shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading text-compact font-mono font-semibold">{{
                    t("about.npmjsCom")
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-xs">{{ t("about.jsRegistry") }}</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="text-text-muted shrink-0" />
              </a>
              <a
                href="https://crates.io"
                target="_blank"
                class="border-card-glass-border rounded-default bg-card-glass-bg hover:border-accent/35 flex items-center gap-3 border px-3 py-2 no-underline transition-all duration-200"
              >
                <OIcon name="inventory-2" size="md" class="text-text-muted shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <OTruncatedText class="text-text-heading text-compact font-mono font-semibold">{{
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
            class="p-3"
          >
            <div class="mb-2 flex items-center gap-2">
              <div
                class="rounded-default text-text-muted bg-surface-base border-border-default flex h-6 w-6 shrink-0 items-center justify-center border"
              >
                <OIcon name="shield" size="sm" />
              </div>
              <OText variant="page-title" as="h2" class="m-0 text-sm! font-semibold!">{{
                t("about.license_info")
              }}</OText>
            </div>
            <OText
              v-if="store.state.zoConfig.build_type == 'opensource'"
              variant="body"
              as="div"
              class="text-compact m-0 mb-2"
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
              class="text-compact"
            >
              {{ t("about.license_info_msg") }}
            </OText>
            <p class="text-text-muted text-compact m-0 mt-2 flex items-start gap-1.5">
              <OIcon name="info" size="sm" class="mt-0.5 shrink-0" />
              {{ t("about.license_info_note") }}
            </p>
          </div>

          <!-- Community Card (fallback for cloud) -->
          <div v-else class="p-3">
            <div class="mb-2 flex items-center gap-2">
              <div
                class="rounded-default text-text-muted bg-surface-base border-border-default flex h-6 w-6 shrink-0 items-center justify-center border"
              >
                <OIcon name="groups" size="sm" />
              </div>
              <OText variant="page-title" as="h3" class="m-0 text-sm! font-semibold!">{{
                t("about.community_lbl")
              }}</OText>
            </div>
            <OText variant="body" class="text-compact m-0 mb-2">{{
              t("about.community_msg")
            }}</OText>
            <div class="flex flex-wrap gap-2">
              <a
                href="https://github.com/openobserve/openobserve"
                target="_blank"
                class="border-border-default bg-surface-base text-text-body rounded-default text-compact inline-flex items-center gap-1.5 border px-2 py-0.5 font-medium no-underline transition-all duration-200"
              >
                <OIcon name="code" size="sm" />
                {{ t("about.github") }}
              </a>
              <a
                href="https://openobserve.ai"
                target="_blank"
                class="border-border-default bg-surface-base text-text-body rounded-default text-compact inline-flex items-center gap-1.5 border px-2 py-0.5 font-medium no-underline transition-all duration-200"
              >
                <OIcon name="language" size="sm" />
                {{ t("about.website") }}
              </a>
            </div>
          </div>
        </div>

        <!-- ── Enterprise License Details ──────────────────────────── -->
        <div v-if="config.isEnterprise == 'true' && config.isCloud === 'false'" class="p-3">
          <!-- Header: eyebrow + title + manage button -->
          <div class="mb-2 flex items-start justify-between">
            <div class="flex items-start gap-2">
              <div
                class="rounded-default text-text-muted bg-surface-base border-border-default flex h-6 w-6 shrink-0 items-center justify-center border"
              >
                <OIcon name="workspace-premium" size="sm" />
              </div>
              <div>
                <OText variant="label" class="text-accent m-0 mb-1">{{
                  t("about.licenseAndUsage")
                }}</OText>
                <h2 class="text-text-heading m-0 text-sm font-semibold">
                  {{ t("about.ent_lincese_detail_lbl") }}
                </h2>
              </div>
            </div>
            <OButton variant="outline" size="sm" @click="navigateToLicense">
              {{ t("about.manage_license") }}
            </OButton>
          </div>
          <div v-if="loadingLicense" class="py-3 text-center">
            <OSpinner size="md" />
            <div class="text-text-muted text-compact mt-3">
              {{ t("about.loading_license_info") }}
            </div>
          </div>

          <div v-else-if="!licenseData || !licenseData.license" class="py-2">
            <div class="text-text-body border-border-default rounded-default border px-3 py-2">
              <div class="text-compact mb-1 font-semibold">
                {{ t("about.no_license_installed_lbl") }}
              </div>
              <p class="text-compact mb-2">{{ t("about.no_license_installed_msg") }}</p>
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
            </div>
          </div>

          <template v-else>
            <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <!-- License details table -->
              <div class="border-card-glass-border rounded-default overflow-hidden border">
                <table class="w-full border-collapse">
                  <tbody>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg text-compact w-2/5 border-e px-3 py-1 font-semibold whitespace-nowrap"
                      >
                        {{ t("about.lincese_id_lbl") }}
                      </td>
                      <td class="text-text-body text-compact px-3 py-1 font-mono">
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
                        class="text-table-header-text border-table-row-divider bg-table-header-bg text-compact w-2/5 border-e px-3 py-1 font-semibold whitespace-nowrap"
                      >
                        {{ t("about.status_lbl") }}
                      </td>
                      <td class="text-text-body text-compact px-3 py-1">
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
                        class="text-table-header-text border-table-row-divider bg-table-header-bg text-compact w-2/5 border-e px-3 py-1 font-semibold whitespace-nowrap"
                      >
                        {{ t("about.editionLbl") }}
                      </td>
                      <td class="text-text-body text-compact px-3 py-1">
                        {{ t("about.value_license_enterprise") }}
                      </td>
                    </tr>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg text-compact w-2/5 border-e px-3 py-1 font-semibold whitespace-nowrap"
                      >
                        {{ t("about.create_at_lbl") }}
                      </td>
                      <td class="text-text-body text-compact px-3 py-1">
                        {{ formatLicenseDate(licenseData.license.created_at) }}
                      </td>
                    </tr>
                    <tr class="border-table-row-divider border-b last:border-b-0">
                      <td
                        class="text-table-header-text border-table-row-divider bg-table-header-bg text-compact w-2/5 border-e px-3 py-1 font-semibold whitespace-nowrap"
                      >
                        {{ t("about.expires_at_lbl") }}
                      </td>
                      <td class="text-text-body text-compact px-3 py-1">
                        {{ formatLicenseDate(licenseData.license.expires_at) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Ingestion usage panel -->
              <div
                class="border-card-glass-border rounded-default bg-card-glass-tint-faint border p-3"
              >
                <p class="text-text-heading text-compact m-0 mb-1 font-semibold">
                  {{ t("about.usage_limits") }}
                </p>
                <p class="text-text-muted m-0 mb-2 text-xs" data-test="about-license-limit">
                  {{
                    limitGb === null
                      ? t("about.license_status_unlimited")
                      : `${limitGb} ${t("about.gbPerDay")}`
                  }}
                </p>
                <div v-if="usedPercent !== null">
                  <div class="mb-3 flex items-baseline gap-2">
                    <span
                      class="text-text-body text-lg leading-none font-semibold"
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
                  class="text-text-muted mb-2 flex justify-between text-xs"
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
            <div class="mt-3" data-test="about-license-features">
              <p class="text-text-heading text-compact m-0 mb-2 font-semibold">
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
        <div v-if="config.isCloud === 'false'" class="p-3">
          <FeatureComparisonTable />
        </div>
      </div>
    </div>
  </OPageLayout>
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
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
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
    OPageHeader,
    OPageLayout,
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
