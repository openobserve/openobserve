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
      <span class="section-header-title">{{ t('alerts.alertSettings.sectionTitle') }}</span>
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
              {{ t('alerts.alertSettings.fieldRequired') }}
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
                          @update:model-value="destinationError = false; emitDestinationsUpdate()"
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
                    <q-item-section class="text-grey">{{ t('alerts.alertSettings.noDestinationsAvailable') }}</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <OButton
                class="q-ml-xs"
                variant="ghost"
                size="icon-circle-sm"
                :title="t('alerts.alertSettings.refreshDestinations')"
                @click="$emit('refresh:destinations')"
              >
                <q-icon name="refresh" />
              </OButton>
              <OButton
                data-test="create-destination-btn"
                variant="outline"
                size="sm"
                class="q-ml-sm"
                @click="routeToCreateDestination"
              >{{ t('alerts.alertSettings.addNewDestination') }}</OButton>
            </div>
            <div
              v-if="destinationsTouched && (!localDestinations || localDestinations.length === 0)"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              {{ t('alerts.alertSettings.fieldRequired') }}
            </div>
          </div>
        </div>

      </template>

      <!-- For Scheduled Alerts -->
      <template v-else>
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
              {{ t('alerts.alertSettings.fieldRequired') }}
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
              {{ t('alerts.alertSettings.fieldRequired') }}
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
                class="no-case q-py-none destinations-select-field alert-v3-select destination-select-field"
                :class="destinationError ? 'destination-select-error' : ''"
                borderless
                dense
                multiple
                use-input
                fill-input
                :input-debounce="400"
                hide-bottom-space
                @filter="filterDestinations"
                @update:model-value="destinationError = false; emitDestinationsUpdate()"
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
                          @update:model-value="destinationError = false; emitDestinationsUpdate()"
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
                    <q-item-section class="text-grey">{{ t('alerts.alertSettings.noDestinationsAvailable') }}</q-item-section>
                  </q-item>
                </template>
              </q-select>
              <OButton
                class="q-ml-xs"
                variant="ghost"
                size="icon-circle-sm"
                :title="t('alerts.alertSettings.refreshDestinations')"
                @click="$emit('refresh:destinations')"
              >
                <q-icon name="refresh" />
              </OButton>
              <OButton
                data-test="create-destination-btn"
                variant="outline"
                size="sm"
                class="q-ml-sm"
                @click="routeToCreateDestination"
              >{{ t('alerts.alertSettings.addNewDestination') }}</OButton>
            </div>
            <div
              v-if="destinationsTouched && (!localDestinations || localDestinations.length === 0)"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              {{ t('alerts.alertSettings.fieldRequired') }}
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
          size="30px"
          class="o2-toggle-button-xs"
        />
      </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, nextTick, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from '@/lib/core/Button/OButton.vue';
import {
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
  convertMinutesToCron,
} from "@/utils/zincutils";

export default defineComponent({
  name: "Step3AlertConditions",
  components: { OButton },
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
    const destinationError = ref(false);

    // Timezone management
    const browserTimezone = ref("");
    const filteredTimezone = ref<string[]>([]);
    const showTimezoneWarning = ref(false);

    // Cron validation
    const cronJobError = ref("");

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
        // Only update local state — do not emit to parent so the composable
        // preserves the builder-mode isAggregationEnabled value across tab switches.
        if (newType !== "custom") {
          localIsAggregationEnabled.value = false;
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
          destinationError.value = true;
          return { valid: false, message: "At least one destination is required.", focusDestination: true };
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
        destinationError.value = true;
        return { valid: false, message: "At least one destination is required.", focusDestination: true };
      }

      return { valid: true };
    };

    const focusDestination = () => {
      nextTick(() => {
        const el = (destinationsFieldRef.value as any)?.$el as HTMLElement;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            const input = el.querySelector('input') as HTMLElement;
            input?.focus();
          }, 400);
        }
      });
    };

    return {
      t,
      store,
      queryType,
      localIsAggregationEnabled,
      localDestinations,
      destinationsTouched,
      destinationError,
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
      // Timezone
      browserTimezone,
      filteredTimezone,
      showTimezoneWarning,
      timezoneFilterFn,
      // Frequency type switching
      handleFrequencyTypeChange,
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
      focusDestination,
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

// Destination select — always has a subtle border (like stream type fields)
.destination-select-field {
  :deep(.q-field__control) {
    border: 1px solid rgba(0, 0, 0, 0.2) !important;
    border-radius: 4px !important;
    background: rgba(0, 0, 0, 0.03) !important;
  }
}
.body--dark .destination-select-field {
  :deep(.q-field__control) {
    border-color: rgba(255, 255, 255, 0.2) !important;
    background: rgba(255, 255, 255, 0.05) !important;
  }
}
.destination-select-field.destination-select-error {
  :deep(.q-field__control) {
    border-color: #ef5350 !important;
    background: rgba(239, 83, 80, 0.05) !important;
  }
}
.body--dark .destination-select-field.destination-select-error {
  :deep(.q-field__control) {
    border-color: #ef5350 !important;
    background: rgba(239, 83, 80, 0.08) !important;
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
