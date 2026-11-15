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
    size="lg"
    v-model:open="showDialog"
    data-test="enterprise-upgrade-dialog"
    :aria-title="dialogConfig.heroTitle"
    :primary="
      dialogConfig.showPrimaryButton
        ? { label: dialogConfig.primaryButtonText, dataTest: 'enterprise-upgrade-download-btn' }
        : undefined
    "
    :secondary="
      dialogConfig.showContactSales
        ? {
            label: t('about.enterprise_offer.buttons.contact_sales'),
            dataTest: 'enterprise-upgrade-contact-sales-btn',
          }
        : {
            label: t('about.enterprise_offer.buttons.learn_more'),
            dataTest: 'enterprise-upgrade-learn-more-btn',
          }
    "
    @click:primary="handlePrimaryButtonClick"
    @click:secondary="dialogConfig.showContactSales ? contactSales() : openDocsLink()"
    @update:open="(v) => !v && onDialogHide()"
  >
    <template #header>
      <div class="flex min-w-0 items-center gap-3">
        <div class="min-w-0 flex-1">
          <OTruncatedText
            data-test="enterprise-upgrade-hero-title"
            class="text-dialog-header-text text-title block font-semibold"
            >{{ dialogConfig.heroTitle }}</OTruncatedText
          >
          <OTruncatedText class="text-text-secondary text-compact block">{{
            dialogConfig.offerText
          }}</OTruncatedText>
        </div>
        <OSkeleton
          v-if="isLoadingLicense && dialogConfig.showUsageIndicator"
          shape="block"
          class="h-5 w-32 shrink-0"
          data-test="enterprise-upgrade-offer-badge-skeleton"
        />
        <OTag
          v-else
          tone="accent"
          class="shrink-0"
          :label="dialogConfig.badgeText"
          data-test="enterprise-upgrade-offer-badge"
        />
      </div>
    </template>

    <div class="flex flex-col gap-4" :class="{ 'cloud-layout': dialogConfig.isCloudLayout }">
      <!-- A licensed install sees its daily ingestion against the limit before the catalog. -->
      <section v-if="dialogConfig.isLicensed" class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-semibold">
          {{ t("about.enterprise_offer.usageTitle") }}
        </h3>
        <OSkeleton
          v-if="isLoadingLicense"
          preset="chart"
          class="h-37.5"
          data-test="enterprise-upgrade-chart-skeleton"
        />
        <template v-else-if="chartData">
          <div class="usage-chart-container h-37.5 w-full">
            <ChartRenderer :key="dashboardRenderKey" :data="chartData" />
          </div>
          <OText v-if="isIngestionUnlimited" variant="meta">
            {{ t("about.usage_shows_zero_unlimited") }}
          </OText>
        </template>
      </section>

      <EnterpriseOfferFeatureGrid
        :is-cloud-layout="dialogConfig.isCloudLayout"
        :core-features="coreFeatures"
        :enterprise-features="enterpriseFeatures"
      />
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import EnterpriseOfferFeatureGrid from "@/components/EnterpriseOfferFeatureGrid.vue";
import { useEnterpriseOfferContent } from "@/composables/useEnterpriseOfferContent";
import { FREE_LIMIT_GB } from "@/utils/featureGate";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

export default defineComponent({
  name: "EnterpriseUpgradeDialog",
  components: {
    ChartRenderer,
    OTag,
    OText,
    OTruncatedText,
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
      return (
        licenseData.value?.license?.limits?.Ingestion?.typ === "Unlimited" &&
        !licenseData.value?.expired
      );
    });

    // Get ingestion limit value for threshold
    const ingestionLimitGB = computed(() => {
      if (isIngestionUnlimited.value) {
        return null; // No limit for unlimited plans
      }
      if (licenseData.value?.expired) return FREE_LIMIT_GB;
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

        // The chart sits on the dialog surface, so its ink follows the theme.
        const ink = isDark.value
          ? {
              line: "rgba(255, 255, 255, 0.2)",
              label: "rgba(255, 255, 255, 0.7)",
              split: "rgba(255, 255, 255, 0.08)",
            }
          : {
              line: "rgba(0, 0, 0, 0.15)",
              label: "rgba(0, 0, 0, 0.6)",
              split: "rgba(0, 0, 0, 0.06)",
            };

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
                lineStyle: { color: ink.line },
              },
              axisTick: {
                show: true,
                lineStyle: { color: ink.line },
              },
              axisLabel: {
                show: true,
                color: ink.label,
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
                lineStyle: { color: ink.line },
              },
              axisTick: {
                show: true,
                lineStyle: { color: ink.line },
              },
              axisLabel: {
                show: true,
                color: ink.label,
                fontSize: 10,
                formatter: (value: number) => {
                  return value.toFixed(0) + dataUnit;
                },
              },
              splitLine: {
                show: true,
                lineStyle: {
                  color: ink.split,
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
