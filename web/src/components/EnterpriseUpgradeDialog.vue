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
  <ODialog
    v-model:open="showDialog"
    data-test="enterprise-upgrade-dialog"
    :show-close="false"
    :width="75"
    @update:open="(v) => !v && onDialogHide()"
  >
    <div
      class="enterprise-dialog-v3 relative -mx-(--spacing-dialog-content-px) -my-(--spacing-dialog-content-py) overflow-hidden"
    >
      <!-- Close Button -->
      <div class="text-text-secondary hover:text-text-body absolute top-4 right-4 z-100">
        <OButton variant="ghost" size="icon" @click="showDialog = false">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </OButton>
      </div>

      <div
        class="dialog-split-layout flex max-h-[92vh] max-[56.25rem]:flex-col"
        :class="{ 'cloud-layout': dialogConfig.isCloudLayout }"
      >
        <!-- Left Panel - Hero Section (hidden for Cloud) -->
        <div
          v-if="!dialogConfig.isCloudLayout"
          class="hero-panel relative flex min-h-0 [flex:0_0_35%] flex-col overflow-y-auto bg-[linear-gradient(135deg,var(--color-theme-accent)_0%,color-mix(in_srgb,var(--color-theme-accent)_85%,black_15%)_100%)] p-10 text-white max-[56.25rem]:min-h-100 max-[56.25rem]:flex-none"
        >
          <div class="m-auto flex w-full max-w-100 flex-1 flex-col items-center justify-center">
            <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — scaling it with text makes elevation bloom -->
            <div
              class="rounded-default mb-6 flex h-20 w-20 items-center justify-center bg-[rgba(255,255,255,0.15)] backdrop-blur-[10px]"
            >
              <!-- eslint-enable local/no-hardcoded-px -->
              <OIcon name="workspace-premium" size="xl" />
            </div>

            <div
              data-test="enterprise-upgrade-hero-title"
              class="mb-4 text-center text-3xl leading-[1.2] font-bold text-white"
            >
              {{ dialogConfig.heroTitle }}
            </div>

            <div class="mb-6 text-center text-sm leading-[1.6] text-white opacity-[0.95]">
              {{ dialogConfig.offerText }}
            </div>

            <div class="mb-8 flex flex-row items-center justify-center gap-4">
              <!-- Loading State: Show skeleton -->
              <template v-if="isLoadingLicense && dialogConfig.showUsageIndicator">
                <OSkeleton
                  class="h-10 w-10 shrink-0 rounded-full"
                  data-test="enterprise-upgrade-usage-indicator-skeleton"
                />
                <OSkeleton
                  class="rounded-default shrink-0"
                  style="width: 12.5rem; height: 2.75rem"
                  data-test="enterprise-upgrade-offer-badge-skeleton"
                />
              </template>

              <!-- Loaded State: Show actual data -->
              <template v-else>
                <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — scaling shadow and blur with text makes elevation bloom -->
                <div
                  data-test="enterprise-upgrade-offer-badge"
                  class="rounded-default shadow-success-500/40 inline-flex items-center bg-[linear-gradient(135deg,#22c55e_0%,#4ade80_100%)] px-5 py-2.5 text-sm font-bold text-white shadow-lg backdrop-blur-[10px]"
                  :class="{
                    'bg-[rgba(255,255,255,0.2)]! shadow-md!': dialogConfig.isLicensed,
                  }"
                >
                  <!-- eslint-enable local/no-hardcoded-px -->
                  <OIcon
                    v-if="!dialogConfig.showUsageIndicator"
                    :name="dialogConfig.badgeIcon"
                    size="md"
                    class="me-1"
                  />
                  <span>{{ dialogConfig.badgeText }}</span>
                </div>
              </template>
            </div>

            <!-- Usage Chart (only for Enterprise with license) -->
            <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — scaling the backdrop blur with text makes elevation bloom -->
            <div
              v-if="dialogConfig.isLicensed"
              class="rounded-default mb-6 w-full border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.1)] p-4 backdrop-blur-[10px]"
            >
              <!-- eslint-enable local/no-hardcoded-px -->
              <!-- Loading skeleton -->
              <template v-if="isLoadingLicense">
                <OSkeleton
                  class="chart-skeleton rounded-default"
                  style="height: 9.375rem"
                  data-test="enterprise-upgrade-chart-skeleton"
                />
              </template>
              <!-- Loaded chart -->
              <template v-else-if="chartData">
                <div class="relative w-full">
                  <div
                    class="usage-chart-container mx-auto max-h-37.5 min-h-37.5 w-full overflow-visible p-0"
                    style="height: 9.375rem"
                  >
                    <ChartRenderer :key="dashboardRenderKey" :data="chartData" />
                  </div>
                  <div
                    v-if="isIngestionUnlimited"
                    class="mt-1 text-center text-xs"
                    style="color: rgba(255, 255, 255, 0.7); font-size: var(--text-3xs)"
                  >
                    {{ t("about.usage_shows_zero_unlimited") }}
                  </div>
                </div>
              </template>
            </div>

            <div class="flex w-full flex-col gap-3">
              <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — shadow offsets/blurs and the 1px active-press nudge must not scale with text -->
              <OButton
                v-if="dialogConfig.showPrimaryButton"
                variant="on-dark-primary"
                size="lg"
                @click="handlePrimaryButtonClick"
                data-test="enterprise-upgrade-download-btn"
                class="rounded-default! text-theme-accent! bg-white! px-8 py-2.5 text-sm font-bold! [letter-spacing:0.01875rem] shadow-md transition-all duration-300 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] hover:[transform:translateY(-0.1875rem)_scale(1.02)] hover:shadow-lg active:[transform:translateY(-1px)_scale(0.98)]"
              >
                <!-- eslint-enable local/no-hardcoded-px -->
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
                class="rounded-default! border-2 border-[rgba(255,255,255,0.3)] bg-transparent px-6 py-2.5 text-sm font-semibold! [letter-spacing:0.0125rem] transition-all duration-300 hover:[transform:translateX(0.25rem)] hover:border-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.15)] active:[transform:scale(0.96)]"
              >
                {{ t("about.enterprise_offer.buttons.contact_sales") }}
              </OButton>
              <OButton
                v-else
                variant="on-dark-ghost"
                size="lg"
                @click="openDocsLink"
                data-test="enterprise-upgrade-learn-more-btn"
                class="rounded-default! border-2 border-[rgba(255,255,255,0.3)] bg-transparent px-6 py-2.5 text-sm font-semibold! [letter-spacing:0.0125rem] transition-all duration-300 hover:[transform:translateX(0.25rem)] hover:border-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.15)] active:[transform:scale(0.96)]"
              >
                {{ t("about.enterprise_offer.buttons.learn_more") }}
              </OButton>
            </div>
          </div>
        </div>

        <!-- Right Panel - Features List -->
        <EnterpriseOfferFeatureGrid
          :is-cloud-layout="dialogConfig.isCloudLayout"
          :features-title="dialogConfig.featuresTitle"
          :features-subtitle="dialogConfig.featuresSubtitle"
          :core-features="coreFeatures"
          :enterprise-features="enterpriseFeatures"
          :is-dark="isDark"
        />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import EnterpriseOfferFeatureGrid from "@/components/EnterpriseOfferFeatureGrid.vue";
import { useEnterpriseOfferContent } from "@/composables/useEnterpriseOfferContent";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

export default defineComponent({
  name: "EnterpriseUpgradeDialog",
  components: {
    OIcon,
    ChartRenderer,
    OButton,
    ODialog,
    OSkeleton,
    EnterpriseOfferFeatureGrid,
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
    const { t } = useI18nTyped();
    const chartData = ref<any>(null);
    const dashboardRenderKey = ref(0);

    const onDialogHide = () => {
      emit("update:modelValue", false);
    };

    const {
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
      navigateToLicense,
      handlePrimaryButtonClick,
    } = useEnterpriseOfferContent({ onBeforeNavigateAway: onDialogHide });

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
        let dataUnit = "GB"; // Default unit
        let unitDivisor = 1024; // Default: MB to GB

        // Use actual ingestion history data
        // Data format: [{ ts: "2026-02-27T00:00:00", value: 202.90125079791258 }]
        // Values are in MB, determine best unit based on data range
        if (ingestionHistory.length > 0) {
          // Sort by timestamp to ensure chronological order
          const sortedHistory = [...ingestionHistory].sort(
            (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
          );

          // Find max value to determine appropriate unit
          const maxValueMB = Math.max(...sortedHistory.map((item: any) => item.value));

          // Determine best unit based on max value
          if (maxValueMB >= 1024 * 1024) {
            // Use TB if max value is >= 1 TB
            dataUnit = "TB";
            unitDivisor = 1024 * 1024;
          } else if (maxValueMB >= 1024) {
            // Use GB if max value is >= 1 GB
            dataUnit = "GB";
            unitDivisor = 1024;
          } else {
            // Use MB for smaller values
            dataUnit = "MB";
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
          if (dataUnit === "TB") {
            thresholdInDataUnit = thresholdGB / 1024; // GB to TB
          } else if (dataUnit === "GB") {
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
        const markLine: any =
          thresholdGB && thresholdGB > 0
            ? {
                silent: true,
                symbol: "none",
                label: {
                  show: false,
                },
                lineStyle: {
                  color: "#FF0000",
                  width: 2,
                  type: "solid",
                },
                data: [
                  {
                    yAxis: thresholdInDataUnit,
                  },
                ],
              }
            : undefined;

        // Simple echarts configuration for bar chart
        // ChartRenderer expects data in format: { options: { ... } }
        chartData.value = {
          options: {
            backgroundColor: "transparent",
            grid: {
              left: "10%",
              right: "5%",
              top: "10%",
              bottom: "15%",
              containLabel: true,
            },
            xAxis: {
              type: "category",
              data: dates,
              axisLine: {
                show: true,
                lineStyle: { color: "rgba(255, 255, 255, 0.3)" },
              },
              axisTick: {
                show: true,
                lineStyle: { color: "rgba(255, 255, 255, 0.3)" },
              },
              axisLabel: {
                show: true,
                color: "rgba(255, 255, 255, 0.8)",
                fontSize: 10,
                interval: Math.floor(dates.length / 6), // Show ~6 labels based on actual data length
              },
            },
            yAxis: {
              type: "value",
              min: 0,
              max: yAxisMax,
              interval: yAxisInterval,
              axisLine: {
                show: true,
                lineStyle: { color: "rgba(255, 255, 255, 0.3)" },
              },
              axisTick: {
                show: true,
                lineStyle: { color: "rgba(255, 255, 255, 0.3)" },
              },
              axisLabel: {
                show: true,
                color: "rgba(255, 255, 255, 0.8)",
                fontSize: 10,
                formatter: (value: number) => {
                  return value.toFixed(0) + dataUnit;
                },
              },
              splitLine: {
                show: true,
                lineStyle: {
                  color: "rgba(255, 255, 255, 0.1)",
                  type: "dashed",
                },
              },
            },
            series: [
              {
                type: "bar",
                data: values.map((value) => {
                  // Color bars red if they exceed threshold, otherwise green
                  const exceeds = thresholdInDataUnit > 0 && value > thresholdInDataUnit;
                  return {
                    value: value,
                    itemStyle: {
                      color: exceeds ? "#FF6B6B" : "#22c55e", // Red if exceeds, green if within limit
                    },
                  };
                }),
                barWidth: "60%",
                markLine: markLine,
              },
            ],
            tooltip: {
              show: true,
              trigger: "axis",
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              borderColor: "rgba(255, 255, 255, 0.2)",
              borderWidth: 1,
              textStyle: {
                color: "#fff",
                fontSize: 12,
              },
              formatter: (params: any) => {
                const dayNum = params[0].name;
                const value = params[0].value;
                const formattedValue = value.toFixed(2) + " " + dataUnit;

                // Get the actual date from ingestion history for this day
                const ingestionHistory = store.state.zoConfig?.ingestion_history || [];
                const matchingEntry = ingestionHistory.find((item: any) => {
                  const date = new Date(item.ts);
                  return date.getDate() === parseInt(dayNum);
                });

                // The <br/> stays in code — each line is a whole translated
                // sentence, so the markup never has to live in a message.
                const usageLine = t("about.usageChartUsage", { value: formattedValue });
                if (matchingEntry) {
                  const fullDate = new Date(matchingEntry.ts);
                  const monthName = fullDate.toLocaleString("default", { month: "short" });
                  const dateLine = t("about.usageChartDate", { month: monthName, day: dayNum });
                  return `${dateLine}<br/>${usageLine}`;
                }

                return `${t("about.usageChartDay", { day: dayNum })}<br/>${usageLine}`;
              },
            },
            animation: true,
          },
        };

        dashboardRenderKey.value++;
      } catch (error) {
        console.error("Failed to generate chart data:", error);
      }
    };

    // Watch for dialog opening to fetch license data, then redraw the usage chart
    watch(showDialog, (newVal) => {
      if (newVal) {
        fetchLicenseData().then(generateUsageDashboard);
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
