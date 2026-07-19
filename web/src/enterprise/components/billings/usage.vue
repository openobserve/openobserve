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
    <div class="p-3 w-full" style="height: calc(100vh - 130px);" >
      <!-- Billing usage tiles (always shown). When self-usage reporting is
           enabled, the calendar in the toolbar drives the range and a daily
           chart is appended below. -->
      <div>
        <div v-if="Object.keys(usageData).length === 0" >
          <div class="text-xl font-semibold font-medium text-center">
            {{ t("billing.messageDataNotFound") }}
          </div>
        </div>
      </div>
      <!-- usage section new -->
      <div class="flex flex-col gap-4 w-full">
      <!-- tab-info-section -->
      <!-- this will be unlocked when we get the actionscripts , rum sessions , error tracking from BE -->
        <div v-if="false" class="grid grid-cols-3 gap-4 w-full">
            <div class="bg-card-glass-bg border border-card-glass-border rounded-default p-4 min-h-32 flex flex-col justify-between transition-shadow duration-200 ease-in-out">
              <div class="flex flex-col justify-between rounded-default h-full gap-4 ">
              <!-- Top Section (60%) -->
              <div class="flex flex-col justify-between">
                <!-- Title row -->
                <div class="flex justify-between items-center">
                  <div class="text-(length:--text-sm) font-semibold leading-(--leading-base) tracking-normal text-text-heading text-left"> Action Scripts</div>
                  <div class="opacity-80">
                    <img :src="actionScriptIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="text-(length:--text-2xl) font-semibold leading-(--leading-xl) tracking-normal text-text-body text-left flex items-end ">
              2
            </div>
            </div>
            </div>
            <div class="bg-card-glass-bg border border-card-glass-border rounded-default p-4 min-h-32 flex flex-col justify-between transition-shadow duration-200 ease-in-out">
              <div class="flex flex-col justify-between rounded-default h-full gap-4 ">
              <!-- Top Section (60%) -->
              <div class="flex flex-col justify-between">
                <!-- Title row -->
                <div class="flex justify-between items-center">
                  <div class="text-(length:--text-sm) font-semibold leading-(--leading-base) tracking-normal text-text-heading text-left">Error Tracking</div>
                  <div class="opacity-80">
                    <img :src="errorTrackingIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="text-(length:--text-2xl) font-semibold leading-(--leading-xl) tracking-normal text-text-body text-left flex items-end ">
              300
            </div>
            </div>
            </div>
            <div class="bg-card-glass-bg border border-card-glass-border rounded-default p-4 min-h-32 flex flex-col justify-between transition-shadow duration-200 ease-in-out">
              <div class="flex flex-col justify-between rounded-default h-full gap-4 ">
              <!-- Top Section (60%) -->
              <div class="flex flex-col justify-between">
                <!-- Title row -->
                <div class="flex justify-between items-center">
                  <div class="text-(length:--text-sm) font-semibold leading-(--leading-base) tracking-normal text-text-heading text-left" data-test="billings-usage-tile-title">RUM Session</div>
                  <div class="opacity-80">
                    <img :src="rumSessionIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="text-(length:--text-2xl) font-semibold leading-(--leading-xl) tracking-normal text-text-body text-left flex items-end ">
              20
            </div>
            </div>
            </div>

        </div>
        <!-- Billable usage tiles — one row of six compact stat cards. Wraps to
             3-per-row on narrower screens. Values auto-scale from the GB/MB
             base so large numbers stay readable. -->
        <div
          v-if="!dataLoading && Object.keys(usageData).length > 0"
          class="grid grid-cols-3 xl:grid-cols-6 gap-3 w-full"
        >
          <div
            v-for="tile in usageTiles"
            :key="tile.key"
            data-test="billings-usage-tile"
            class="usage-tile bg-card-glass-bg border border-card-glass-border rounded-default px-3 py-3 flex flex-col gap-2 transition-shadow duration-200 ease-in-out"
          >
            <div class="flex items-center justify-between gap-2">
              <div
                class="text-(length:--text-xs) font-medium text-text-secondary truncate"
                data-test="billings-usage-tile-title"
                :title="tile.label"
              >
                {{ tile.label }}
              </div>
              <div class="h-7 w-7 bg-bg-gray shrink-0 flex items-center justify-center rounded-default">
                <img :src="tile.icon" class="h-4 w-4" />
              </div>
            </div>
            <div class="flex items-baseline gap-1 whitespace-nowrap">
              <span class="text-(length:--text-xl) font-bold text-text-body leading-none">
                {{ tile.value }}
              </span>
              <span class="text-(length:--text-xs) font-medium text-text-secondary">
                {{ tile.unit }}
              </span>
            </div>
            <div
              v-if="usageCost[tile.key]"
              class="text-(length:--text-xs) font-medium text-text-secondary"
            >
              ${{ usageCost[tile.key] }}
            </div>
          </div>
        </div>
        <!-- charts section -->
        <div>

        </div>
      </div>
      <div v-if="dataLoading" class="text-xl font-semibold font-medium text-center">
        <OSpinner size="md" class="mx-auto block text-center mt-3" />
      </div>

      <!-- Self-usage reporting ON → append a daily line chart (Ingestion +
           Query) below the cards, driven by the same calendar range above. -->
      <div
        v-if="usageStreamEnabled"
        data-test="usage-daily-chart"
        class="bg-card-glass-bg border border-card-glass-border rounded-default p-4 mt-4"
      >
        <div class="text-(length:--text-sm) font-semibold text-text-heading mb-2">
          {{ t("billing.usageTrends.dailyUsage") }}
        </div>
        <div class="h-90 relative w-full">
          <PanelSchemaRenderer
            v-if="combinedSchema && dailyTimeObj"
            :key="'chart-r-' + dailyChartKey"
            class="h-full w-full"
            :panelSchema="combinedSchema"
            :selectedTimeObj="dailyTimeObj"
            :variablesData="{}"
            :dashboardId="''"
            :folderId="''"
            searchType="dashboards"
            :allowAnnotationsAPI="false"
            @error="onChartError"
          />
          <!-- Until the org reports any usage its `usage` stream doesn't exist,
               so the search errors. Show the illustrated empty state OVER the
               chart; it clears itself once data lands and the error resets. -->
          <div
            v-if="usageStreamMissing"
            data-test="usage-waiting-for-data"
            class="flex items-center justify-center z-2 absolute inset-0 bg-card-glass-bg"
          >
            <OEmptyState
              size="block"
              illustration="wave-bars"
              :title="t('billing.usageTrends.waitingTitle')"
              :description="t('billing.usageTrends.waitingForData')"
            />
          </div>
        </div>
      </div>

      <!-- Reporting OFF → illustrated empty state inviting the user to enable
           usage reporting so the daily chart can populate. Uses the app-wide
           OEmptyState primitive with the animated bar-chart illustration. -->
      <OEmptyState
        v-else
        data-test="usage-enable-cta"
        class="mt-4 border border-card-glass-border rounded-default bg-card-glass-bg"
        size="block"
        illustration="wave-bars"
        :title="t('billing.usageTrends.enableTitle')"
        :description="t('billing.usageTrends.enableSubtitle')"
        :action-label="t('billing.usageTrends.enableButton')"
        action-icon="check"
        @action="showEnableConfirm = true"
      />

      <!-- Confirm before enabling — turning this on starts writing the org's
           own usage stream, so we ask first. -->
      <ConfirmDialog
        v-model="showEnableConfirm"
        data-test="usage-enable-confirm"
        :title="t('billing.usageTrends.enableConfirmTitle')"
        :message="t('billing.usageTrends.enableConfirmMessage')"
        :ok-label="t('billing.usageTrends.enableButton')"
        @update:ok="onConfirmEnable"
        @update:cancel="showEnableConfirm = false"
      />
    </div>
  </template>
  <script lang="ts">
  import { defineComponent, ref, onMounted, defineAsyncComponent, watch, computed, onUnmounted, onActivated   , onBeforeMount, nextTick, inject } from "vue";
  import { useStore } from "vuex";
  import useTheme from "@/composables/useTheme";
  import { useI18n } from "vue-i18n";
  import BillingService from "@/services/billings";
  import organizations from "@/services/organizations";
  import { convertBillingData } from "@/utils/billing/convertBillingData";
import router from "@/router";
import { useRouter } from "vue-router";
import { getImageURL } from "@/utils/zincutils";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { buildUsageCombinedLinePanelSchema } from "./usageDailyPanelSchema";

  let currentDate = new Date();

  let thirtyDaysAgo = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  export default defineComponent({
    name: "Usage",
    components: {
      ChartRenderer: defineAsyncComponent(
        () => import("@/components/dashboards/panels/ChartRenderer.vue")
      ),
      CustomChartRenderer,
      PanelSchemaRenderer,
      OSpinner,
      OEmptyState,
      ConfirmDialog,
    },
    setup() {
      const { t } = useI18n();
      const store = useStore();
      const { isDark } = useTheme();
      const router = useRouter();
      const dataLoading = ref(false);
      const lastUsageUpdated = ref(0);
      const pipelinesPanelDataKey = ref(0);
      const elapsedText = ref('Just now');
      const startTime = ref(new Date().getTime()*1000);
      const endTime = ref(new Date().getTime()*1000);
      const usageData = ref<any>({
        ingestion: "0.00",
        search: "0.00",
        functions: "0.00",
        pipeline: "0.00",
        remotepipeline: "0.00",
        dataretention: "0.00",
        ai_credits: "0.00"
      });
      const usageCost = ref<any>({
        ingestion: null,
        search: null,
        functions: null,
        pipeline: null,
        remotepipeline: null,
        dataretention: null,
        ai_credits: null
      });
      let chartData: any = ref({});
      // The member-org selector lives in Billing.vue (rendered beside this
      // component) and shares the current selection via this injected reactive.
      const usageMember = inject<{ selected: string }>(
        "usageMember",
        undefined as any
      );
      const selectedMember = computed(() => usageMember?.selected || "");

      // --- Daily chart (appended below the cards when self-usage is on) -----
      // The existing cards (billing API) stay; when reporting is enabled we also
      // render a daily line chart from the org's own `usage` stream, and the
      // calendar (in the Billing toolbar) drives BOTH the cards and the chart.
      const usageStreamEnabled = computed<boolean>(
        () =>
          !!store.state?.organizationData?.organizationSettings
            ?.usage_stream_enabled,
      );

      const enablingUsage = ref(false);
      // Controls the "are you sure?" dialog shown before we enable reporting.
      const showEnableConfirm = ref(false);

      // Persist an explicit opt-in. Merge with the current settings so we don't
      // clobber other org-parameter fields, then update the store so
      // usageStreamEnabled recomputes and the chart block replaces this CTA.
      const enableUsageReporting = async () => {
        if (enablingUsage.value) return;
        enablingUsage.value = true;
        const orgId = store.state.selectedOrganization.identifier;
        const currentSettings =
          store.state?.organizationData?.organizationSettings ?? {};
        // Build the merged object once so the POST and the store update can
        // never drift apart.
        const updatedSettings = {
          ...currentSettings,
          usage_stream_enabled: true,
        };
        try {
          await organizations.post_organization_settings(orgId, updatedSettings);
          store.dispatch("setOrganizationSettings", updatedSettings);
          toast({
            variant: "success",
            message: t("billing.usageTrends.enablePending"),
            timeout: 5000,
          });
        } catch (e: any) {
          toast({
            variant: "error",
            message: e?.message ?? "Failed to enable usage reporting",
            timeout: 5000,
          });
        } finally {
          enablingUsage.value = false;
        }
      };

      // Confirm-dialog OK handler: close the dialog, then run the enable flow.
      const onConfirmEnable = () => {
        showEnableConfirm.value = false;
        enableUsageReporting();
      };

      // The date-range picker lives in the Billing toolbar (next to GB/MB) and
      // shares its resolved window (microseconds) here via inject. `key` bumps
      // on every change. Defaults to the last 7 days until the picker resolves.
      const usageRange = inject<{ start: number; end: number; key: number }>(
        "usageRange",
        undefined as any,
      );
      const dailyChartKey = computed(() => usageRange?.key ?? 0);

      // Chart uses the exact micros window. selectedTimeObj wants Date objects
      // wrapping the microsecond value (see LLMSchemaPanel.vue — do NOT /1000).
      const dailyTimeObj = computed(() => ({
        start_time: new Date(
          usageRange?.start ??
            (new Date().getTime() - 7 * 24 * 60 * 60 * 1000) * 1000,
        ),
        end_time: new Date(usageRange?.end ?? new Date().getTime() * 1000),
      }));

      // Cards use the billing API, which only accepts relative range strings
      // (`<N>days`, integer). Derive N from the calendar window so the cards
      // cover the same span the chart does. Guard hard: a valid, whole, >=1 day
      // count — anything else falls back to 7days (the API rejects bad strings
      // with a 400).
      const MICROS_PER_DAY = 24 * 60 * 60 * 1000 * 1000;
      const calendarRangeString = computed<string>(() => {
        const start = Number(usageRange?.start);
        const end = Number(usageRange?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          return "7days";
        }
        const days = Math.max(1, Math.round((end - start) / MICROS_PER_DAY));
        return `${days}days`;
      });

      // Combined daily line panel (Ingestion + Query, one query), rebuilt on
      // org / GB-MB change.
      const combinedSchema = computed(() => {
        const orgId = store.state.selectedOrganization.identifier;
        const dt = usageDataType.value === "mb" ? "mb" : "gb";
        return buildUsageCombinedLinePanelSchema({ orgId, dataType: dt });
      });

      // The org's `usage` stream doesn't exist until it has reported some usage,
      // so the chart's first search fails with "stream not found: usage". We
      // catch that here and show the illustrated empty state OVER the chart
      // (the chart stays mounted underneath). When usage finally lands the
      // search succeeds, the error clears, and the overlay goes away.
      const usageStreamMissing = ref(false);
      const onChartError = (err: any) => {
        const msg = (err?.message ?? "").toString().toLowerCase();
        usageStreamMissing.value =
          !!err?.message &&
          msg.includes("stream not found") &&
          msg.includes("usage");
      };
      // ---------------------------------------------------------------------

      onMounted(async () => {
        selectUsageDate();
      });
      const usageDate: any = computed(() => {
        return router.currentRoute.value.query.usage_date ?? "30days";
      })
      const usageDataType: any = computed(() => { return router.currentRoute.value.query.data_type ?? "gb" })
      // The range that drives the cards: when self-usage is on the calendar
      // controls it (derived <N>days); otherwise the billing dropdown does.
      const effectiveUsageDate = computed(() =>
        usageStreamEnabled.value ? calendarRangeString.value : usageDate.value,
      );
      watch(effectiveUsageDate, () => {
        getUsage();
      })
      watch(usageDataType, (val) => {
        getUsage();
      })
      watch(selectedMember, () => {
        getUsage();
      })
      const getUsage = () => {
        const dismiss = toast({
          variant: "loading",
          message: "Please wait while loading usage data...",
                  timeout: 0,
});
        dataLoading.value = true;
        BillingService.get_data_usage(
          store.state.selectedOrganization.identifier,
          effectiveUsageDate.value,
          usageDataType.value,
          selectedMember.value || undefined
        )
          .then((res) => {
            dataLoading.value = false;
            // reset the data
            for(const key of Object.keys(usageData.value)){
                usageData.value[key] = "0.00";
                usageCost.value[key] = null;
            }
            res.data.data.forEach((item: any) => {
              const numericValue = parseFloat(item.value);
              // Map API event names to usageData keys
              const eventKeyMap: Record<string, string> = {
                "ingestion": "ingestion",
                "search": "search",
                "functions": "functions",
                "pipeline": "pipeline",
                "remotepipeline": "remotepipeline",
                "dataretention": "dataretention",
                "aicredits": "ai_credits",
              };
              const key = eventKeyMap[item.event.toLowerCase()];
              if (key) {
                usageData.value[key] = numericValue.toFixed(2);
                if(item.cost){
                    usageCost.value[key] = item.cost.toFixed(2);
                }else{
                    usageCost.value[key] = null;
                }
              }
            });
            startTime.value = res.data.start_time;
            endTime.value = res.data.end_time;

            dismiss();
          })
          .catch((e) => {
            toast({
              variant: "error",
              message: e.message,
              timeout: 5000,
            });
            dataLoading.value = false;
          })


      };
      const selectUsageDate = () => {
        chartData.value = {};
        getUsage();
      };
      const actionScriptIcon = getImageURL("images/usage/action_script.svg");
      const errorTrackingIcon = getImageURL("images/usage/error_tracking.svg");
      const rumSessionIcon = getImageURL("images/usage/rum_session.svg");
      const ingestionIcon = getImageURL("images/usage/ingestion.svg");
      const searchIcon = getImageURL("images/usage/search.svg");
      const functionsIcon = getImageURL("images/usage/function.svg");
      const pipelineIcon = getImageURL("images/usage/pipeline.svg");
      const remotePipelineIcon = getImageURL("images/usage/remote_pipeline.svg");
      const dataRetentionIcon = getImageURL("images/usage/data_retention.svg");
      const aiIcon = computed(() =>
        isDark.value
          ? getImageURL("images/common/ai_icon_dark.svg")
          : getImageURL("images/common/ai_icon_gradient.svg")
      );

      // Auto-scale a byte value UP from the page's base unit (the GB/MB toggle)
      // so large numbers stay readable: e.g. base GB → 10930.96 shows as
      // "10.93 TB", 1095652 as "1.07 PB"; small values keep the base unit.
      // Promotes only upward (never below the toggle's base).
      const BYTE_UNITS = ["MB", "GB", "TB", "PB", "EB"];
      const scaleByteValue = (
        rawValue: string | number,
        baseUnit: string,
      ): { value: string; unit: string } => {
        const num = Number(rawValue);
        if (!Number.isFinite(num)) {
          return { value: String(rawValue ?? "0.00"), unit: baseUnit };
        }
        let idx = BYTE_UNITS.indexOf(baseUnit.toUpperCase());
        if (idx === -1) return { value: num.toFixed(2), unit: baseUnit };
        let val = num;
        // Promote while the value has 4+ integer digits (>= 1000) and a bigger
        // unit exists.
        while (val >= 1000 && idx < BYTE_UNITS.length - 1) {
          val /= 1024;
          idx += 1;
        }
        return { value: val.toFixed(2), unit: BYTE_UNITS[idx] };
      };

      // The billable usage tiles (one row). `type` picks formatting: byte
      // metrics auto-scale from the GB/MB toggle; AI credits is a plain count.
      const usageTiles = computed(() => {
        const base = usageDataType.value.toUpperCase(); // GB | MB
        const byteTile = (key: string, label: string, icon: any) => {
          const scaled = scaleByteValue(usageData.value[key] ?? 0, base);
          return { key, label, icon, value: scaled.value, unit: scaled.unit };
        };
        return [
          byteTile("ingestion", "Ingestion", ingestionIcon),
          byteTile("search", "Search", searchIcon),
          byteTile("pipeline", "Pipelines", pipelineIcon),
          byteTile("remotepipeline", "Remote Pipelines", remotePipelineIcon),
          byteTile("dataretention", "Data Retention", dataRetentionIcon),
          {
            key: "ai_credits",
            label: t("billing.aiCredits"),
            icon: aiIcon.value,
            value: usageData.value.ai_credits ?? "0.00",
            unit: "Credits",
          },
        ];
      });
      //this is the example data that needs to be used to get the chart in usage page
      //we just need to have the data in the format of the dataModel
      //eg: date and value and in the array format
      const dataModel = ref(
                {
                "chartType": "bar",
                "options": {
                    "backgroundColor": "transparent",
                    "legend": {
                        "show": false,
                        "type": "scroll",
                        "orient": "horizontal",
                        "padding": [
                            10,
                            20,
                            10,
                            10
                        ],
                        "tooltip": {
                            "show": true,
                            "padding": 10,
                            "textStyle": {
                                "fontSize": 12
                            }
                        },
                        "textStyle": {
                            "width": 100,
                            "overflow": "truncate",
                            "rich": {
                                "a": {
                                    "fontWeight": "bold"
                                },
                                "b": {
                                    "fontStyle": "normal"
                                }
                            }
                        },
                        "left": "0",
                        "top": "bottom"
                    },
                    "grid": {
                        "containLabel": true,
                        "left": 30,
                        "right": 20,
                        "top": "15",
                        "bottom": 35
                    },
                    "tooltip": {
                        "trigger": "axis",
                        "textStyle": {
                            "color": "#000",
                            "fontSize": 12
                        },
                        "enterable": true,
                        "backgroundColor": "rgba(255,255,255,1)",
                        "extraCssText": "max-height: 200px; overflow: auto; max-width: 400px",
                        "axisPointer": {
                            "type": "cross",
                            "label": {
                                "fontsize": 12,
                                "precision": 2
                            }
                        }
                    },
                    "xAxis": [
                        {
                            "type": "time",
                            "position": "bottom",
                            "inverse": false,
                            "name": "Timestamp",
                            "label": {
                                "show": false,
                                "position": "None",
                                "rotate": 0
                            },
                            "nameLocation": "middle",
                            "nameGap": 25,
                            "nameTextStyle": {
                                "fontWeight": "bold",
                                "fontSize": 14
                            },
                            "axisLabel": {
                                "interval": "auto",
                                "overflow": "none",
                                "hideOverlap": true,
                                "width": 120,
                                "margin": 10
                            },
                            "splitLine": {
                                "show": true
                            },
                            "axisLine": {
                                "show": false
                            },
                            "axisTick": {
                                "show": false,
                                "align": "left",
                                "alignWithLabel": false,
                                "length": 5
                            },
                            "data": []
                        }
                    ],
                    "yAxis": {
                        "type": "value",
                        "name": "K8s Container Name",
                        "nameLocation": "middle",
                        "nameGap": 61,
                        "nameTextStyle": {
                            "fontWeight": "bold",
                            "fontSize": 14
                        },
                        "axisLabel": {},
                        "splitLine": {
                            "show": true
                        },
                        "axisLine": {
                            "show": false
                        }
                    },
                    "toolbox": {
                        "orient": "vertical",
                        "show": true,
                        "showTitle": false,
                        "tooltip": {
                            "show": false
                        },
                        "itemSize": 0,
                        "itemGap": 0,
                        "bottom": "100%",
                        "feature": {
                            "dataZoom": {
                                "yAxisIndex": "none"
                            }
                        }
                    },
                    "series": [
                        {
                            "name": "K8s Container Name",
                            "type": "bar",
                            "emphasis": {
                                "focus": "series"
                            },
                            "lineStyle": {
                                "width": 1.5
                            },
                            "label": {
                                "show": false,
                                "position": "None",
                                "rotate": 0
                            },
                            "originalSeriesName": "",
                            "markLine": {
                                "silent": true,
                                "animation": false,
                                "data": []
                            },
                            "connectNulls": false,
                            "large": true,
                            "color": "#64b5f6",
                            "data": [
                                [
                                    "2025-05-29T11:38:00.000Z",
                                    525
                                ],
                                [
                                    "2025-05-29T11:38:10.000Z",
                                    26185
                                ],
                                [
                                    "2025-05-29T11:38:20.000Z",
                                    19537
                                ],
                                [
                                    "2025-05-29T11:38:30.000Z",
                                    24852
                                ],
                                [
                                    "2025-05-29T11:38:40.000Z",
                                    12448
                                ],
                                [
                                    "2025-05-29T11:38:50.000Z",
                                    15757
                                ],
                                [
                                    "2025-05-29T11:39:00.000Z",
                                    16502
                                ],
                                [
                                    "2025-05-29T11:39:10.000Z",
                                    21424
                                ],
                                [
                                    "2025-05-29T11:39:20.000Z",
                                    13249
                                ],
                                [
                                    "2025-05-29T11:39:30.000Z",
                                    22533
                                ],
                                [
                                    "2025-05-29T11:39:40.000Z",
                                    17767
                                ],
                                [
                                    "2025-05-29T11:39:50.000Z",
                                    11406
                                ],
                                [
                                    "2025-05-29T11:40:00.000Z",
                                    19588
                                ],
                                [
                                    "2025-05-29T11:40:10.000Z",
                                    13109
                                ],
                                [
                                    "2025-05-29T11:40:20.000Z",
                                    14540
                                ],
                                [
                                    "2025-05-29T11:40:30.000Z",
                                    14074
                                ],
                                [
                                    "2025-05-29T11:40:40.000Z",
                                    12856
                                ],
                                [
                                    "2025-05-29T11:40:50.000Z",
                                    8782
                                ],
                                [
                                    "2025-05-29T11:41:00.000Z",
                                    14729
                                ],
                                [
                                    "2025-05-29T11:41:10.000Z",
                                    14617
                                ],
                                [
                                    "2025-05-29T11:41:20.000Z",
                                    21772
                                ],
                                [
                                    "2025-05-29T11:41:30.000Z",
                                    15147
                                ],
                                [
                                    "2025-05-29T11:41:40.000Z",
                                    17362
                                ],
                                [
                                    "2025-05-29T11:41:50.000Z",
                                    15018
                                ],
                                [
                                    "2025-05-29T11:42:00.000Z",
                                    17007
                                ],
                                [
                                    "2025-05-29T11:42:10.000Z",
                                    16545
                                ],
                                [
                                    "2025-05-29T11:42:20.000Z",
                                    17489
                                ],
                                [
                                    "2025-05-29T11:42:30.000Z",
                                    19863
                                ],
                                [
                                    "2025-05-29T11:42:40.000Z",
                                    18351
                                ],
                                [
                                    "2025-05-29T11:42:50.000Z",
                                    10001
                                ],
                                [
                                    "2025-05-29T11:43:00.000Z",
                                    21750
                                ],
                                [
                                    "2025-05-29T11:43:10.000Z",
                                    23619
                                ],
                                [
                                    "2025-05-29T11:43:20.000Z",
                                    14901
                                ],
                                [
                                    "2025-05-29T11:43:30.000Z",
                                    19604
                                ],
                                [
                                    "2025-05-29T11:43:40.000Z",
                                    14491
                                ],
                                [
                                    "2025-05-29T11:43:50.000Z",
                                    18249
                                ],
                                [
                                    "2025-05-29T11:44:00.000Z",
                                    14324
                                ],
                                [
                                    "2025-05-29T11:44:10.000Z",
                                    11322
                                ],
                                [
                                    "2025-05-29T11:44:20.000Z",
                                    10481
                                ],
                                [
                                    "2025-05-29T11:44:30.000Z",
                                    18098
                                ],
                                [
                                    "2025-05-29T11:44:40.000Z",
                                    14593
                                ],
                                [
                                    "2025-05-29T11:44:50.000Z",
                                    24532
                                ],
                                [
                                    "2025-05-29T11:45:00.000Z",
                                    11336
                                ],
                                [
                                    "2025-05-29T11:45:10.000Z",
                                    17646
                                ],
                                [
                                    "2025-05-29T11:45:20.000Z",
                                    16908
                                ],
                                [
                                    "2025-05-29T11:45:30.000Z",
                                    13049
                                ],
                                [
                                    "2025-05-29T11:45:40.000Z",
                                    19015
                                ],
                                [
                                    "2025-05-29T11:45:50.000Z",
                                    15213
                                ],
                                [
                                    "2025-05-29T11:46:00.000Z",
                                    17953
                                ],
                                [
                                    "2025-05-29T11:46:10.000Z",
                                    19638
                                ],
                                [
                                    "2025-05-29T11:46:20.000Z",
                                    10446
                                ],
                                [
                                    "2025-05-29T11:46:30.000Z",
                                    17906
                                ],
                                [
                                    "2025-05-29T11:46:40.000Z",
                                    15080
                                ],
                                [
                                    "2025-05-29T11:46:50.000Z",
                                    23020
                                ],
                                [
                                    "2025-05-29T11:47:00.000Z",
                                    22451
                                ],
                                [
                                    "2025-05-29T11:47:10.000Z",
                                    21097
                                ],
                                [
                                    "2025-05-29T11:47:20.000Z",
                                    16644
                                ],
                                [
                                    "2025-05-29T11:47:30.000Z",
                                    18096
                                ],
                                [
                                    "2025-05-29T11:47:40.000Z",
                                    14492
                                ],
                                [
                                    "2025-05-29T11:47:50.000Z",
                                    13806
                                ],
                                [
                                    "2025-05-29T11:48:00.000Z",
                                    13533
                                ],
                                [
                                    "2025-05-29T11:48:10.000Z",
                                    12718
                                ],
                                [
                                    "2025-05-29T11:48:20.000Z",
                                    15700
                                ],
                                [
                                    "2025-05-29T11:48:30.000Z",
                                    11800
                                ],
                                [
                                    "2025-05-29T11:48:40.000Z",
                                    13252
                                ],
                                [
                                    "2025-05-29T11:48:50.000Z",
                                    14647
                                ],
                                [
                                    "2025-05-29T11:49:00.000Z",
                                    10797
                                ],
                                [
                                    "2025-05-29T11:49:10.000Z",
                                    18977
                                ],
                                [
                                    "2025-05-29T11:49:20.000Z",
                                    14971
                                ],
                                [
                                    "2025-05-29T11:49:30.000Z",
                                    19181
                                ],
                                [
                                    "2025-05-29T11:49:40.000Z",
                                    14652
                                ],
                                [
                                    "2025-05-29T11:49:50.000Z",
                                    15085
                                ],
                                [
                                    "2025-05-29T11:50:00.000Z",
                                    11316
                                ],
                                [
                                    "2025-05-29T11:50:10.000Z",
                                    19070
                                ],
                                [
                                    "2025-05-29T11:50:20.000Z",
                                    11385
                                ],
                                [
                                    "2025-05-29T11:50:30.000Z",
                                    18561
                                ],
                                [
                                    "2025-05-29T11:50:40.000Z",
                                    13120
                                ],
                                [
                                    "2025-05-29T11:50:50.000Z",
                                    17771
                                ],
                                [
                                    "2025-05-29T11:51:00.000Z",
                                    17426
                                ],
                                [
                                    "2025-05-29T11:51:10.000Z",
                                    19740
                                ],
                                [
                                    "2025-05-29T11:51:20.000Z",
                                    26322
                                ],
                                [
                                    "2025-05-29T11:51:30.000Z",
                                    15417
                                ],
                                [
                                    "2025-05-29T11:51:40.000Z",
                                    18328
                                ],
                                [
                                    "2025-05-29T11:51:50.000Z",
                                    14118
                                ],
                                [
                                    "2025-05-29T11:52:00.000Z",
                                    20130
                                ],
                                [
                                    "2025-05-29T11:52:10.000Z",
                                    14243
                                ],
                                [
                                    "2025-05-29T11:52:20.000Z",
                                    15377
                                ],
                                [
                                    "2025-05-29T11:52:30.000Z",
                                    19846
                                ],
                                [
                                    "2025-05-29T11:52:40.000Z",
                                    17345
                                ],
                                [
                                    "2025-05-29T11:52:50.000Z",
                                    12196
                                ],
                                [
                                    "2025-05-29T11:53:00.000Z",
                                    6227
                                ]
                            ],
                            "zlevel": 2
                        },
                        {
                            "type": "line",
                            "data": [
                                [
                                    "Invalid Date",
                                    null
                                ]
                            ],
                            "markLine": {
                                "itemStyle": {
                                    "color": "rgba(0, 191, 255, 0.5)"
                                },
                                "silent": false,
                                "animation": false,
                                "data": []
                            },
                            "markArea": {
                                "itemStyle": {
                                    "color": "rgba(0, 191, 255, 0.15)"
                                },
                                "data": []
                            },
                            "zlevel": 1
                        }
                    ]
                },
                "extras": {
                    "panelId": "Panel_ID5876310",
                    "isTimeSeries": true
                }
              }
            )


      return {
        t,
        store,
        chartData,
        dataLoading,
        options: ["30days", "60days", "3months", "6months"],
        selectUsageDate,
        startTime,
        endTime,
        usageDate,
        usageDataType,
        lastUsageUpdated,
        elapsedText,
        actionScriptIcon,
        errorTrackingIcon,
        rumSessionIcon,
        pipelinesPanelDataKey,
        dataModel,
        ingestionIcon,
        searchIcon,
        functionsIcon,
        usageData,
        usageCost,
        usageTiles,
        getUsage,
        router,
        pipelineIcon,
        remotePipelineIcon,
        dataRetentionIcon,
        aiIcon,
        selectedMember,
        usageStreamEnabled,
        enablingUsage,
        enableUsageReporting,
        showEnableConfirm,
        onConfirmEnable,
        dailyTimeObj,
        combinedSchema,
        dailyChartKey,
        usageStreamMissing,
        onChartError,
      };
    },
  });
  </script>

