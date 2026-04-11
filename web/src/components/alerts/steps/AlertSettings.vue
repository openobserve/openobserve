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
  <div class="step-alert-conditions" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <!-- Section header -->
    <div class="section-header">
      <div class="section-header-accent" />
      <span class="section-header-title">Settings</span>
    </div>
    <div class="tw:px-3 tw:py-2">
      <q-form ref="alertSettingsForm" @submit.prevent>
      <!-- For Real-Time Alerts -->
      <template v-if="isRealTime === 'true'">
        <!-- Silence Notification (Cooldown) -->
        <div class="flex justify-start items-start tw:pb-3 tw:mb-4">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 28px">
            {{ t("alerts.silenceNotification") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  {{ t('alerts.alertSettings.cooldownTooltip') }}
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center q-mr-sm" style="width: fit-content">
              <div
                style="width: 87px; margin-left: 0 !important"
                class="silence-notification-input"
              >
                <q-input
                  v-model.number="formData.trigger_condition.silence"
                  type="number"
                  dense
                  borderless
                  min="0"
                  class="alert-v3-input"
                  style="background: none"
                  @update:model-value="$emit('update:trigger', formData.trigger_condition)"
                />
              </div>
              <div
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 28px;
                  font-size: 13px;
                "
                :class="
                  store.state.theme === 'dark'
                    ? 'bg-grey-9'
                    : 'bg-grey-2'
                "
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="formData.trigger_condition.silence < 0 || formData.trigger_condition.silence === undefined || formData.trigger_condition.silence === null || formData.trigger_condition.silence === ''"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Destinations -->
        <div class="flex items-start tw:pb-4 tw:mb-4">
          <div style="width: 190px; height: 28px" class="flex items-center tw:font-semibold">
            <span>{{ t("alerts.destination") }} *</span>
          </div>
          <div class="tw:flex tw:flex-col">
            <div class="tw:flex tw:items-center">
              <q-select
                v-model="localDestinations"
                :options="filteredDestinations"
                data-test="alert-destinations-select"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop no-case destinations-select-field"
                filled
                dense
                multiple
                use-input
                input-debounce="0"
                @filter="filterDestinations"
                style="width: 300px; max-width: 300px"
                @update:model-value="emitDestinationsUpdate"
              >
                <template v-slot:selected>
                  <div v-if="localDestinations.length > 0" class="ellipsis">
                    {{ localDestinations.join(", ") }}
                  </div>
                </template>
                <template v-slot:option="option">
                  <q-list dense>
                    <q-item tag="label" :data-test="`alert-destination-option-${option.opt}`">
                      <q-item-section avatar>
                        <q-checkbox
                          size="xs"
                          dense
                          v-model="localDestinations"
                          :val="option.opt"
                          @update:model-value="emitDestinationsUpdate"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label class="ellipsis">{{ option.opt }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </template>
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">No destinations available</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-btn
                icon="refresh"
                class="iconHoverBtn q-ml-xs"
                :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                padding="xs"
                unelevated
                size="sm"
                round
                flat
                title="Refresh latest Destinations"
                @click="$emit('refresh:destinations')"
                style="min-width: auto"
              />
              <q-btn
                data-test="create-destination-btn"
                :label="t('alerts.alertSettings.addNewDestination')"
                class="o2-secondary-button q-ml-sm"
                no-caps
                size="sm"
                style="min-height: 28px; height: 28px;"
                @click="routeToCreateDestination"
              />
            </div>
            <div
              v-if="destinationsTouched && (!localDestinations || localDestinations.length === 0)"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

      </template>

      <!-- For Scheduled Alerts -->
      <template v-else>
        <!-- Threshold — now handled by inline condition sentence in QueryConfig (V3.1) -->
        <div v-if="false" class="flex justify-start items-start q-mb-xs no-wrap alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.threshold") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  {{ t('alerts.alertSettings.thresholdTooltip') }}
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
            <div ref="thresholdFieldRef" class="flex tw:flex-col justify-start items-start tw:w-full">
                <!-- Main threshold input row -->
                <div class="flex items-start tw:w-full">
                  <div class="tw:flex tw:flex-col">
                    <q-select
                      v-model="formData.trigger_condition.operator"
                      :options="triggerOperators"
                      data-test="alert-threshold-operator-select"
                      class="showLabelOnTop no-case q-py-none"
                      borderless
                      dense
                      use-input
                      hide-selected
                      fill-input
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      :style="{
                        width: (formData.trigger_condition.operator === 'Contains' || formData.trigger_condition.operator === 'NotContains')
                          ? '124px'
                          : '88px',
                        minWidth: '88px'
                      }"
                      @update:model-value="emitTriggerUpdate"
                    />
                    <div
                      v-if="!formData.trigger_condition.operator"
                      class="text-red-8 q-pt-xs"
                      style="font-size: 11px; line-height: 12px"
                    >
                      Field is required!
                    </div>
                  </div>
                  <div class="flex items-start tw:flex-col" style="border-left: none">
                    <div class="tw:flex tw:items-center">
                      <div style="width: 89px; margin-left: 0 !important">
                        <q-input
                          v-model.number="formData.trigger_condition.threshold"
                          data-test="alert-threshold-value-input"
                          type="number"
                          dense
                          borderless
                          min="1"
                          style="background: none"
                          debounce="300"
                          @update:model-value="emitTriggerUpdate"
                        />
                      </div>
                      <div class="tw:ml-2 tw:flex tw:items-center" style="height: 36px; font-weight: normal">
                        <span class="tw:text-sm">{{ thresholdMetricType }}</span>
                      </div>
                    </div>
                    <div
                      v-if="!Number(formData.trigger_condition.threshold)"
                      class="text-red-8 q-pt-xs"
                      style="font-size: 11px; line-height: 12px"
                    >
                      Field is required!
                    </div>
                  </div>
                </div>

                <!-- Context lines (GROUP BY and HAVING) -->
                <div v-if="showGroupByContext || showHavingContext" class="tw:mt-3 tw:ml-0 tw:text-sm tw:space-y-2" style="line-height: 1.6">
                  <div v-if="showGroupByContext" class="tw:flex tw:flex-row tw:items-center tw:gap-2">
                    <span class="tw:font-semibold tw:whitespace-nowrap" :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'">
                      {{ t('alerts.thresholdDynamic.contextLabels.groupedBy') }}
                    </span>
                    <span
                      class="tw:px-2 tw:py-1 tw:rounded tw:font-mono tw:text-xs"
                      :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:text-gray-200' : 'tw:bg-gray-100 tw:text-gray-800'"
                    >
                      {{ groupByFieldsText }}
                    </span>
                  </div>
                  <div v-if="showHavingContext" class="tw:flex tw:flex-row tw:items-center tw:gap-2">
                    <span class="tw:font-semibold tw:whitespace-nowrap" :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'">
                      {{ t('alerts.thresholdDynamic.contextLabels.havingConditions') }}
                    </span>
                    <span
                      class="tw:px-2 tw:py-1 tw:rounded tw:font-mono tw:text-xs"
                      :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:text-gray-200' : 'tw:bg-gray-100 tw:text-gray-800'"
                    >
                      {{ havingFieldsText }}
                    </span>
                  </div>
                </div>
              </div>
          </div>
        </div>

        <!-- Period -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 28px">
            {{ t("alerts.period") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  {{ t('alerts.alertSettings.periodTooltip') }}
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div ref="periodFieldRef" class="flex items-center q-mr-sm" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important" class="period-input-container">
                <q-input
                  v-model.number="formData.trigger_condition.period"
                  type="number"
                  dense
                  borderless
                  min="1"
                  class="alert-v3-input"
                  style="background: none"
                  debounce="300"
                  @update:model-value="handlePeriodChange"
                />
              </div>
              <div
                style="min-width: 90px; margin-left: 0 !important; height: 28px; font-weight: normal; font-size: 13px;"

                :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'"
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="!Number(formData.trigger_condition.period)"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Silence Notification (Cooldown) for Scheduled Alerts -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 28px">
            {{ t("alerts.silenceNotification") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  {{ t('alerts.alertSettings.cooldownTooltip') }}
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div ref="silenceFieldRef" class="flex items-center q-mr-sm" style="width: fit-content">
              <div
                style="width: 87px; margin-left: 0 !important"
              >
                <q-input
                  v-model.number="formData.trigger_condition.silence"
                  type="number"
                  dense
                  borderless
                  min="0"
                  class="alert-v3-input"
                  debounce="300"
                  @update:model-value="emitTriggerUpdate"
                />
              </div>
              <div
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 28px;
                  font-size: 13px;
                "

                :class="
                  store.state.theme === 'dark'
                    ? 'bg-grey-9'
                    : 'bg-grey-2'
                "
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="formData.trigger_condition.silence < 0 || formData.trigger_condition.silence === undefined || formData.trigger_condition.silence === null || formData.trigger_condition.silence === ''"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Destinations -->
        <div class="flex items-start q-mr-sm alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 28px">
            {{ t("alerts.destination") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">{{ t('alerts.alertSettings.destinationsTooltip') }}</span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center">
              <q-select
                ref="destinationsFieldRef"
                v-model="localDestinations"
                :options="filteredDestinations"
                data-test="alert-destinations-select"
                class="no-case q-py-none destinations-select-field alert-v3-select"
                borderless
                dense
                multiple
                use-input
                fill-input
                :input-debounce="400"
                hide-bottom-space
                @filter="filterDestinations"
                @update:model-value="emitDestinationsUpdate"
                style="width: 180px; max-width: 300px"
              >
                <template v-slot:selected>
                  <div
                    v-if="localDestinations.length > 0"
                    class="ellipsis"
                  >
                    {{ localDestinations.join(", ") }}
                    <q-tooltip>{{ localDestinations.join(", ") }}</q-tooltip>
                  </div>
                </template>
                <template v-slot:option="option">
                  <q-list dense>
                    <q-item tag="label" :data-test="`alert-destination-option-${option.opt}`">
                      <q-item-section avatar>
                        <q-checkbox
                          size="xs"
                          dense
                          v-model="localDestinations"
                          :val="option.opt"
                          @update:model-value="emitDestinationsUpdate"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label class="ellipsis">{{ option.opt }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </template>
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">No destinations available</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-btn
                icon="refresh"
                class=" q-ml-xs"
                padding="xs"
                unelevated
                size="sm"
                round
                flat
                title="Refresh latest Destinations"
                @click="$emit('refresh:destinations')"
                style="min-width: auto"
              />
              <q-btn
                data-test="create-destination-btn"
                :label="t('alerts.alertSettings.addNewDestination')"
                class="o2-secondary-button q-ml-sm"
                no-caps
                size="sm"
                style="min-height: 28px; height: 28px;"
                @click="routeToCreateDestination"
              />
            </div>
            <div
              v-if="destinationsTouched && (!localDestinations || localDestinations.length === 0)"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

      </template>

      <!-- Creates Incident toggle — shown for all alert types -->
      <div class="flex items-start alert-settings-row">
        <div
          class="tw:font-semibold flex items-center"
          style="width: 190px; height: 28px"
        >
          {{ t("alerts.alertSettings.createsIncident") }}
          <q-icon
            name="info"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            <q-tooltip anchor="center right" self="center left" max-width="350px">
              <span style="font-size: 14px">
                {{ t("alerts.alertSettings.createsIncidentTooltip") }}
              </span>
            </q-tooltip>
          </q-icon>
        </div>
        <q-toggle
          v-model="formData.creates_incident"
          data-test="alert-creates-incident-toggle"
          color="primary"
          size="30px"
          class="o2-toggle-button-xs"
        />
      </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import {
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  convertMinutesToCron,
} from "@/utils/zincutils";
import searchService from "@/services/search";

export default defineComponent({
  name: "Step3AlertConditions",
  props: {
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    isRealTime: {
      type: String,
      default: "false",
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    formattedDestinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: [
    "update:trigger",
    "update:aggregation",
    "update:isAggregationEnabled",
    "update:destinations",
    "refresh:destinations",
    "update:promqlCondition",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    // Form ref
    const alertSettingsForm = ref(null);

    // Field refs for focus manager
    const periodFieldRef = ref(null);
    const thresholdFieldRef = ref(null);
    const silenceFieldRef = ref(null);
    const destinationsFieldRef = ref(null);

    // Local state for aggregation toggle
    // Only enable aggregation when query type is "custom" (not "sql" or "promql")
    const queryType = computed(() => props.formData.query_condition?.type || "custom");
    const localIsAggregationEnabled = ref(
      queryType.value === "custom" && props.isAggregationEnabled
    );
    const localDestinations = ref(props.destinations);
    const destinationsTouched = ref(false);

    // Timezone management
    const browserTimezone = ref("");
    const filteredTimezone = ref<string[]>([]);
    const showTimezoneWarning = ref(false);

    // Cron validation
    const cronJobError = ref("");

    // Query schema information from result_schema API
    interface HavingCondition {
      type: 'condition';
      expression: string;
      alias?: string;
      operator: string;
      value: string;
    }

    interface HavingLogicalOp {
      type: 'logical_op';
      operator: 'AND' | 'OR';
      conditions: HavingNode[];
    }

    type HavingNode = HavingCondition | HavingLogicalOp;

    const querySchema = ref<{
      group_by: string[];
      having: HavingNode | null;
      projections: string[];
    }>({
      group_by: [],
      having: null,
      projections: [],
    });

    // Fetch query schema from result_schema API
    const fetchQuerySchema = async () => {
      // Only fetch if we have a SQL query (not PromQL - PromQL doesn't need schema analysis)
      const sqlQuery = props.formData.query_condition?.sql;
      const queryType = props.formData.query_condition?.type;

      // Skip for PromQL mode - it doesn't use result_schema
      if (queryType === 'promql') {
        querySchema.value = { group_by: [], having: null, projections: [] };
        return;
      }

      if (!sqlQuery) {
        // Reset schema if no query
        querySchema.value = { group_by: [], having: null, projections: [] };
        return;
      }

      try {
        const query = {
          query: {
            sql: sqlQuery,
            query_fn: null,
            size: -1,
            streaming_output: false,
            streaming_id: null,
          },
        };

        const response = await searchService.result_schema(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query,
            start_time: (Date.now() - 3600000) * 1000,
            end_time: Date.now() * 1000,
            page_type: props.formData.stream_type || "logs",
            is_streaming: false,
          },
          "ui"
        );

        if (response.data) {
          querySchema.value = {
            group_by: response.data.group_by || [],
            having: response.data.having || null,
            projections: response.data.projections || [],
          };
          console.log('Query schema fetched:', querySchema.value);
        }
      } catch (error) {
        console.error("Error fetching query schema:", error);
        // Reset on error
        querySchema.value = { group_by: [], having: null, projections: [] };
      }
    };

    // Clean up DataFusion expression to make it more readable
    const cleanExpression = (expr: string): string => {
      // Replace count(Int64(1)) with count(*)
      expr = expr.replace(/count\(Int64\(\d+\)\)/gi, 'count(*)');

      // Replace qualified table names: default.field_name -> field_name
      expr = expr.replace(/\w+\.(\w+)/g, '$1');

      // Replace Utf8("string") with just "string"
      expr = expr.replace(/Utf8\("([^"]+)"\)/g, '"$1"');

      // Replace Int64(number) with just number
      expr = expr.replace(/Int64\((\d+)\)/g, '$1');

      // Replace Float64(number) with just number
      expr = expr.replace(/Float64\(([\d.]+)\)/g, '$1');

      return expr;
    };

    // Parse HavingNode tree into human-readable text
    const parseHavingNode = (node: HavingNode, isRoot: boolean = true): string => {
      if (node.type === 'condition') {
        // Use alias if present, otherwise clean up the expression
        const field = node.alias || cleanExpression(node.expression);
        return `${field} ${node.operator} ${node.value}`;
      } else if (node.type === 'logical_op') {
        // Recursively parse child conditions
        const childTexts = node.conditions.map(child => parseHavingNode(child, false));

        // Join with the logical operator
        const joinedText = childTexts.join(` ${node.operator} `);

        // Only wrap in parentheses if this is not the root and has multiple conditions
        const needsParentheses = !isRoot && childTexts.length > 1;

        return needsParentheses ? `(${joinedText})` : joinedText;
      }
      return '';
    };

    // Initialize timezone
    const initializeTimezone = () => {
      try {
        const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        browserTimezone.value = detectedTimezone;

        // Auto-detect and set timezone if not already set and in cron mode
        if (props.formData.trigger_condition.frequency_type === 'cron' && !props.formData.trigger_condition.timezone) {
          props.formData.trigger_condition.timezone = detectedTimezone;
          showTimezoneWarning.value = true;
        }

        // Get all available timezones
        try {
          // @ts-ignore - supportedValuesOf is not in all TypeScript versions
          if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
            // @ts-ignore
            filteredTimezone.value = Intl.supportedValuesOf("timeZone");
          } else {
            // Fallback for older browsers
            filteredTimezone.value = [detectedTimezone];
          }
        } catch (err) {
          filteredTimezone.value = [detectedTimezone];
        }
      } catch (e) {
        console.error('Error initializing timezone:', e);
        browserTimezone.value = "UTC";
        filteredTimezone.value = ["UTC"];
      }
    };

    // Initialize on mount
    initializeTimezone();

    // Watch for SQL/PromQL query changes
    watch(
      () => [props.formData.query_condition?.sql, props.formData.query_condition?.promql],
      () => {
        fetchQuerySchema();
      },
      { immediate: true }
    );

    // Watch for prop changes
    watch(
      () => props.isAggregationEnabled,
      (newVal) => {
        // Only enable aggregation if query type is "custom"
        localIsAggregationEnabled.value = queryType.value === "custom" && newVal;
      }
    );

    // Watch for query type changes
    watch(
      queryType,
      (newType) => {
        // Disable aggregation when switching to sql or promql
        if (newType !== "custom") {
          localIsAggregationEnabled.value = false;
          emit("update:isAggregationEnabled", false);
        } else {
          // Re-enable aggregation if it was previously enabled
          localIsAggregationEnabled.value = props.isAggregationEnabled;
        }
      }
    );

    watch(
      () => props.destinations,
      (newVal) => {
        localDestinations.value = newVal;
      }
    );

    // Watch for frequency type changes to manage timezone
    watch(
      () => props.formData.trigger_condition.frequency_type,
      (newVal) => {
        if (newVal === 'cron') {
          initializeTimezone();
        }
      }
    );

    // Aggregation functions
    const aggFunctions = ["count", "min", "max", "avg", "sum", "median", "p50", "p75", "p90", "p95", "p99"];

    // Trigger operators
    const triggerOperators = ["=", "!=", ">=", ">", "<=", "<", "Contains", "NotContains"];

    const havingFieldsText = computed(() => {
      if (!querySchema.value.having) {
        return '';
      }
      return parseHavingNode(querySchema.value.having);
    });

    // Dynamic threshold description based on query schema
    // CRITICAL: Threshold compares RESULT ROW COUNT, not aggregated column values
    // See: /test-data/ALERTS_UI_TEXT_COMPLETE.md for detailed examples
    //
    // Natural Language Strategy:
    // 1. "matching logs found" - Simple log searches (SELECT * WHERE...)
    // 2. "metrics match criteria" - PromQL value checks (cpu > 80)
    // 3. "distinct groups affected" - GROUP BY queries (impact-focused)
    // 4. "results passed filter" - HAVING/aggregations (clarifies row counting)
    const thresholdMetricType = computed(() => {
      const hasGroupBy = querySchema.value.group_by.length > 0;
      const hasHaving = querySchema.value.having !== null;
      const isAggEnabled = localIsAggregationEnabled.value && props.formData.query_condition.aggregation;
      const isPromQL = queryType.value === 'promql';

      // Case 1: Complex Filters (HAVING) & Aggregations
      // Logic: HAVING count > 5 or SELECT COUNT(*)
      // Natural: "results passed filter"
      // Why: Clarifies we count output rows, not logs inside them
      //      "passed filter" reminds user the logic happened in HAVING clause
      // Example SQL: SELECT service, COUNT(*) FROM logs WHERE level='error'
      //              GROUP BY service HAVING COUNT(*) > 10
      // Reality: Counts number of services (groups) that passed HAVING filter
      if (hasGroupBy && hasHaving) {
        return t('alerts.thresholdDynamic.metricTypes.resultsPassedFilter') || 'results passed filter';
      }

      // Case 2: Grouped Data (GROUP BY)
      // Logic: GROUP BY service
      // Natural: "distinct groups affected"
      // Why: "Affected" is powerful - shifts focus from counting to impact
      //      Implies the group (server/service) is experiencing the issue
      // Example SQL: SELECT service, COUNT(*) FROM logs WHERE level='error' GROUP BY service
      // Example PromQL: avg(cpu_usage) by (hostname)
      // Reality: Counts number of distinct groups (services/hostnames)
      if (hasGroupBy) {
        return t('alerts.thresholdDynamic.metricTypes.distinctGroupsAffected') || 'distinct groups affected';
      }

      // Case 3: SQL/PromQL without GROUP BY
      if (queryType.value === 'sql' || queryType.value === 'promql') {
        const hasAggregates = querySchema.value.projections.some(p =>
          p.toLowerCase().includes('count') ||
          p.toLowerCase().includes('sum') ||
          p.toLowerCase().includes('avg') ||
          p.toLowerCase().includes('min') ||
          p.toLowerCase().includes('max')
        );

        // Case 3a: With aggregation (COUNT/SUM/AVG)
        // Natural: "results passed filter"
        // ⚠️ MAJOR CONFUSION: Scalar aggregations always return exactly 1 row
        // Example SQL: SELECT COUNT(*) FROM logs WHERE level='error'
        // Example PromQL: count(http_requests_total)
        // Reality: Always returns 1 row. Threshold > 1 will NEVER trigger!
        // Fix: Use HAVING clause for SQL, or use PromQL conditions with 'value > X'
        if (hasAggregates) {
          return t('alerts.thresholdDynamic.metricTypes.resultsPassedFilter') || 'results passed filter';
        }

        // Case 3b: Simple query without aggregation
        // For PromQL: "metrics match criteria" - value checks (cpu > 80)
        // For SQL: "matching logs found" - direct log searches
        // Example SQL: SELECT * FROM logs WHERE level='error'
        // Example PromQL: cpu_usage_percent{hostname="server-01"}
        if (isPromQL) {
          return t('alerts.thresholdDynamic.metricTypes.metricsMatchCriteria') || 'metrics match criteria';
        }
        return t('alerts.thresholdDynamic.metricTypes.matchingLogsFound') || 'matching logs found';
      }

      // Case 4: Custom query with aggregation
      if (isAggEnabled) {
        const hasGroupByFields = props.formData.query_condition.aggregation.group_by?.length > 0 &&
                                  props.formData.query_condition.aggregation.group_by[0]?.trim() !== "";

        // Case 4a: Custom with GROUP BY - counts distinct groups
        // Natural: "distinct groups affected"
        // Example: Conditions: level='error', Aggregation: COUNT, Group By: service
        // Reality: ✅ Correctly counts number of distinct services
        // Note: This is already handled by Case 2 above, but kept for clarity
        if (hasGroupByFields) {
          return t('alerts.thresholdDynamic.metricTypes.distinctGroupsAffected') || 'distinct groups affected';
        }

        // Case 4b: Custom with aggregation only (no GROUP BY)
        // Natural: "results passed filter"
        // ⚠️ MAJOR CONFUSION: Same issue as Case 3a - always returns 1 row
        // Fix: Add GROUP BY or use HAVING conditions
        return t('alerts.thresholdDynamic.metricTypes.resultsPassedFilter') || 'results passed filter';
      }

      // Default: Standard Log Searches (Simple SQL/Custom)
      // Logic: SELECT * ... (No groupings, no math)
      // Natural: "matching logs found"
      // Why: Direct and conversational - you searched for logs, system found logs
      // Reality: ✅ Correctly counts number of matching rows/events
      return t('alerts.thresholdDynamic.metricTypes.matchingLogsFound') || 'matching logs found';
    });

    const showGroupByContext = computed(() => {
      const hasGroupBy = querySchema.value.group_by.length > 0;
      return (queryType.value === 'sql' || queryType.value === 'promql') && hasGroupBy;
    });

    const showHavingContext = computed(() => {
      const hasHaving = querySchema.value.having !== null;
      return (queryType.value === 'sql' || queryType.value === 'promql') && hasHaving;
    });

    const groupByFieldsText = computed(() => {
      return querySchema.value.group_by.join(', ');
    });

    // Filtered numeric columns for aggregation
    const filteredNumericColumns = ref([...props.columns]);
    const filterNumericColumns = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredNumericColumns.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredNumericColumns.value = props.columns.filter((v: any) => v.toLowerCase().indexOf(needle) > -1);
        }
      });
    };

    // Filtered destinations
    const filteredDestinations = ref([...props.formattedDestinations]);
    const filterDestinations = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredDestinations.value = [...props.formattedDestinations];
        } else {
          const needle = val.toLowerCase();
          filteredDestinations.value = props.formattedDestinations.filter(
            (v: any) => v.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    // Timezone filter function
    const timezoneFilterFn = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          try {
            // @ts-ignore
            if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
              // @ts-ignore
              filteredTimezone.value = Intl.supportedValuesOf("timeZone");
            }
          } catch (e) {
            // Keep current filtered list
          }
        } else {
          const needle = val.toLowerCase();
          const allTimezones: string[] = [];
          try {
            // @ts-ignore
            if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
              // @ts-ignore
              allTimezones.push(...Intl.supportedValuesOf("timeZone"));
            }
          } catch (e) {
            allTimezones.push(browserTimezone.value);
          }
          filteredTimezone.value = allTimezones.filter((v: string) =>
            v.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    // Handle frequency type change with conversion
    const handleFrequencyTypeChange = (type: 'minutes' | 'cron') => {
      // If switching to cron and we have a frequency value, convert it
      // Only convert if there's no existing cron expression
      if (type === 'cron' && props.formData.trigger_condition.frequency_type === 'minutes') {
        const frequencyMinutes = Number(props.formData.trigger_condition.frequency);
        const existingCron = props.formData.trigger_condition.cron;

        // Only convert if we have a frequency value and no existing cron expression
        if (frequencyMinutes && frequencyMinutes > 0 && (!existingCron || existingCron.trim() === '')) {
          // Convert minutes to cron expression (6-field format: second minute hour day month dayOfWeek)
          const cronExpression = convertMinutesToCron(frequencyMinutes);
          props.formData.trigger_condition.cron = cronExpression;

          // Set timezone if not already set
          if (!props.formData.trigger_condition.timezone) {
            props.formData.trigger_condition.timezone = browserTimezone.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
          }
        }
      }

      // Update the frequency type
      props.formData.trigger_condition.frequency_type = type;
      emitTriggerUpdate();
    };


    // Validate cron expression
    const validateFrequency = () => {
      cronJobError.value = "";

      if (props.formData.trigger_condition.frequency_type === "cron") {
        try {
          const intervalInSecs = getCronIntervalDifferenceInSeconds(props.formData.trigger_condition.cron);

          if (
            typeof intervalInSecs === "number" &&
            !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
          ) {
            const minInterval = Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
            cronJobError.value = `Frequency should be greater than ${minInterval - 1} seconds.`;
            return;
          }
        } catch (e) {
          cronJobError.value = "Invalid cron expression";
        }
      }

      if (props.formData.trigger_condition.frequency_type === "minutes") {
        const intervalInMins = Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60);

        if (props.formData.trigger_condition.frequency < intervalInMins) {
          cronJobError.value = "Minimum frequency should be " + intervalInMins + " minutes";
          return;
        }
      }
    };

    // Emit updates
    const emitTriggerUpdate = () => {
      validateFrequency();
      emit("update:trigger", props.formData.trigger_condition);
    };

    // Handle period change and sync with frequency, silence, and cron
    const handlePeriodChange = () => {
      const periodValue = Number(props.formData.trigger_condition.period);

      if (periodValue && periodValue > 0) {
        // Only sync frequency if period is above minimum refresh interval
        // This prevents frequency from going below the minimum allowed value
        const minFrequency = Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60) || 10;
        if (periodValue >= minFrequency) {
          props.formData.trigger_condition.frequency = periodValue;
        }

        // Always sync cron expression, regardless of current mode
        // This ensures cron is up-to-date when user switches to cron mode
        const cronExpression = convertMinutesToCron(periodValue);
        props.formData.trigger_condition.cron = cronExpression;

        // Ensure timezone is set
        if (!props.formData.trigger_condition.timezone) {
          props.formData.trigger_condition.timezone = browserTimezone.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
        }

        // Always sync silence notification
        props.formData.trigger_condition.silence = periodValue;
      }

      emitTriggerUpdate();
    };

    const emitAggregationUpdate = () => {
      emit("update:aggregation", props.formData.query_condition.aggregation);
    };

    const emitDestinationsUpdate = () => {
      destinationsTouched.value = true;
      emit("update:destinations", localDestinations.value);
    };

    const emitPromqlConditionUpdate = () => {
      emit("update:promqlCondition", props.formData.query_condition.promql_condition);
    };

    const routeToCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    // Validation method - just call the inline validations that already exist
    const validate = async () => {
      // Validate cron/frequency first
      validateFrequency();

      // Check if there are any cron validation errors
      if (cronJobError.value) {
        return { valid: false, message: cronJobError.value };
      }

      // For Real-Time Alerts
      if (props.isRealTime === 'true') {
        // Check silence notification
        if (
          props.formData.trigger_condition.silence < 0 ||
          props.formData.trigger_condition.silence === undefined ||
          props.formData.trigger_condition.silence === null ||
          props.formData.trigger_condition.silence === ''
        ) {
          return { valid: false, message: `${t('alerts.silenceNotification')} should be greater than or equal to 0` };
        }

        // Check destinations (required for both real-time and scheduled)
        if (!localDestinations.value || localDestinations.value.length === 0) {
          destinationsTouched.value = true;
          return { valid: false, message: null }; // null means show inline error only
        }

        return { valid: true };
      }

      // For Scheduled Alerts
      // Check if aggregation is enabled
      // Check if query type is PromQL - validate both promql_condition AND threshold
      if (queryType.value === 'promql') {
        // Validate PromQL condition
        if (!props.formData.query_condition.promql_condition) {
          return { valid: false, message: 'PromQL condition is required' };
        }
        if (!props.formData.query_condition.promql_condition.operator) {
          return { valid: false, message: null };
        }
        if (
          props.formData.query_condition.promql_condition.value === undefined ||
          props.formData.query_condition.promql_condition.value === null ||
          props.formData.query_condition.promql_condition.value === ''
        ) {
          return { valid: false, message: null };
        }

        // Also validate threshold for PromQL
        if (!props.formData.trigger_condition.operator) {
          return { valid: false, message: null };
        }
        const threshold = Number(props.formData.trigger_condition.threshold);
        if (isNaN(threshold) || threshold < 1) {
          return { valid: false, message: `${t('alerts.threshold')} should be greater than 0` };
        }
      } else if (localIsAggregationEnabled.value && props.formData.query_condition.aggregation) {
        // Validate group by fields (if any are added, they must not be empty)
        const groupByFields = props.formData.query_condition.aggregation.group_by;
        if (groupByFields && groupByFields.length > 0) {
          for (const field of groupByFields) {
            if (!field || field === '') {
              return { valid: false, message: null }; // Show inline error only
            }
          }
        }

        // Validate aggregation having clause
        if (!props.formData.query_condition.aggregation.having.column || props.formData.query_condition.aggregation.having.column === '') {
          return { valid: false, message: null };
        }
        if (!props.formData.query_condition.aggregation.having.value || props.formData.query_condition.aggregation.having.value === '') {
          return { valid: false, message: null };
        }
        if (!props.formData.query_condition.aggregation.having.operator) {
          return { valid: false, message: null };
        }

        // Also validate threshold when aggregation is enabled
        if (!props.formData.trigger_condition.operator) {
          return { valid: false, message: null };
        }
        const threshold = Number(props.formData.trigger_condition.threshold);
        if (isNaN(threshold) || threshold < 1) {
          return { valid: false, message: `${t('alerts.threshold')} should be greater than 0` };
        }
      } else {
        // Validate threshold without aggregation
        if (!props.formData.trigger_condition.operator) {
          return { valid: false, message: null };
        }
        const threshold = Number(props.formData.trigger_condition.threshold);
        if (isNaN(threshold) || threshold < 1) {
          return { valid: false, message: `${t('alerts.threshold')} should be greater than 0` };
        }
      }

      // Validate period
      const period = Number(props.formData.trigger_condition.period);
      if (isNaN(period) || period < 1) {
        return { valid: false, message: `${t('alerts.period')} should be greater than 0` };
      }

      // Validate frequency
      if (props.formData.trigger_condition.frequency_type === 'minutes') {
        const frequency = Number(props.formData.trigger_condition.frequency);
        if (isNaN(frequency) || frequency < 1) {
          return { valid: false, message: `${t('alerts.frequency')} should be greater than 0` };
        }
      } else if (props.formData.trigger_condition.frequency_type === 'cron') {
        if (!props.formData.trigger_condition.cron || !props.formData.trigger_condition.timezone) {
          return { valid: false, message: null };
        }
      }

      // Validate silence notification
      if (
        props.formData.trigger_condition.silence < 0 ||
        props.formData.trigger_condition.silence === undefined ||
        props.formData.trigger_condition.silence === null ||
        props.formData.trigger_condition.silence === ''
      ) {
        return { valid: false, message: `${t('alerts.silenceNotification')} should be greater than or equal to 0` };
      }

      // Check destinations (required for both real-time and scheduled)
      if (!localDestinations.value || localDestinations.value.length === 0) {
        destinationsTouched.value = true;
        return { valid: false, message: null }; // null means show inline error only
      }

      return { valid: true };
    };

    return {
      t,
      store,
      queryType,
      localIsAggregationEnabled,
      localDestinations,
      destinationsTouched,
      aggFunctions,
      triggerOperators,
      filteredNumericColumns,
      filterNumericColumns,
      filteredDestinations,
      filterDestinations,
      emitTriggerUpdate,
      emitAggregationUpdate,
      emitDestinationsUpdate,
      routeToCreateDestination,
      handlePeriodChange,
      // Cron validation
      cronJobError,
      validateFrequency,
      // Validation
      validate,
      alertSettingsForm,
      // Field refs for focus manager
      periodFieldRef,
      thresholdFieldRef,
      silenceFieldRef,
      destinationsFieldRef,
      // Query schema
      querySchema,
      // Dynamic threshold description
      thresholdMetricType,
      showGroupByContext,
      showHavingContext,
      groupByFieldsText,
      havingFieldsText,
      emitPromqlConditionUpdate,
    };
  },
});
</script>

<style scoped lang="scss">
.step-alert-conditions {
  width: 100%;
  margin: 0 auto;
  border-radius: 8px;

  .step-content {
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
  }

  .step-header {
    .step-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 0.2rem;
    }

    .step-subtitle {
      font-size: 13px;
      opacity: 0.8;
      margin: 0;
      margin-bottom: 0.5rem;
    }
  }

  &.dark-mode {
    background-color: #212121;
    border: 1px solid #343434;

    .section-header {
      border-bottom: 1px solid #343434;
    }
    .section-header-title {
      color: #e0e0e0;
    }
    .section-header-accent {
      background: var(--q-primary);
    }

    .step-title {
      color: #ffffff;
    }

    .step-subtitle {
      color: #bdbdbd;
    }
  }

  &.light-mode {
    background-color: #ffffff;
    border: 1px solid #e6e6e6;

    .section-header {
      border-bottom: 1px solid #eeeeee;
    }
    .section-header-title {
      color: #374151;
    }
    .section-header-accent {
      background: var(--q-primary);
    }

    .step-title {
      color: #1a1a1a;
    }

    .step-subtitle {
      color: #5c5c5c;
    }
  }
}

.section-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
}

.section-header-accent {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
}

.section-header-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

// Consistent spacing for alert settings rows
.alert-settings-row {
  margin-bottom: 16px !important;
  padding-bottom: 0 !important;
}

// Fix for destinations select - keep selected items and input on same line
.destinations-select-field {
  :deep(.q-field__control) {
    .q-field__native {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      flex-wrap: nowrap !important;
      overflow: hidden !important;

      > span {
        flex: 0 0 80% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        min-width: 0 !important;
      }

      > input {
        flex: 0 0 20% !important;
        min-width: 0 !important;
        width: 20% !important;
      }
    }
  }
}

// Fix for template select - keep selected value and input on same line
.template-select-field {
  :deep(.q-field__control) {
    .q-field__native {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      flex-wrap: nowrap !important;
      overflow: hidden !important;

      > span {
        flex: 0 0 70% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        min-width: 0 !important;
      }

      > input {
        flex: 0 0 30% !important;
        min-width: 0 !important;
        width: 30% !important;
      }
    }
  }
}
</style>
