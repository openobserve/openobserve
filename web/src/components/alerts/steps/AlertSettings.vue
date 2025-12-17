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
  <div class="step-alert-conditions" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw-px-3 tw-py-4">
      <!-- For Real-Time Alerts -->
      <template v-if="isRealTime === 'true'">
        <!-- Silence Notification (Cooldown) -->
        <div class="flex justify-start items-center tw-font-semibold tw-pb-3 tw-mb-4">
          <div style="width: 190px">{{ t("alerts.silenceNotification") }} *</div>
          <q-input
            v-model.number="formData.trigger_condition.silence"
            type="number"
            dense
            filled
            min="0"
            suffix="Minutes"
            style="max-width: 300px"
            :class="
              store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'
            "
            @update:model-value="$emit('update:trigger', formData.trigger_condition)"
          />
        </div>

        <!-- Destinations -->
        <div class="flex items-start tw-pb-4 tw-mb-4">
          <div style="width: 190px" class="flex items-center tw-font-semibold">
            <span>{{ t("alerts.destination") }} *</span>
          </div>
          <div class="tw-flex tw-items-center">
            <q-select
              v-model="localDestinations"
              :options="filteredDestinations"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop no-case"
              :class="
                store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'
              "
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
                  <q-item tag="label">
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
              label="Add New Destination"
              class="text-bold no-border q-ml-sm"
              color="primary"
              no-caps
              @click="routeToCreateDestination"
            />
          </div>
        </div>
      </template>

      <!-- For Scheduled Alerts -->
      <template v-else>
        <!-- Aggregation Toggle -->
        <div class="flex justify-start items-center tw-font-semibold tw-pb-3 tw-mb-4">
          <div style="width: 190px">{{ t("common.aggregation") }}</div>
          <q-toggle
            v-model="localIsAggregationEnabled"
            size="md"
            color="primary"
            class="text-bold q-pl-0 o2-toggle-button-sm tw-h-[36px] tw-ml-1"
            @update:model-value="toggleAggregation"
          />
        </div>

        <!-- Group By Fields (shown when aggregation is enabled) -->
        <div
          v-if="localIsAggregationEnabled && formData.query_condition.aggregation"
          class="flex items-start no-wrap q-mr-sm tw-pb-4 tw-mb-4"
        >
          <div class="tw-font-semibold" style="width: 190px">
            {{ t("alerts.groupBy") }}
          </div>
          <div class="flex justify-start items-center flex-wrap" style="width: calc(100% - 190px)">
            <template
              v-for="(group, index) in formData.query_condition.aggregation.group_by"
              :key="index"
            >
              <div class="flex justify-start items-center no-wrap">
                <div>
                  <q-select
                    v-model="formData.query_condition.aggregation.group_by[index]"
                    :options="filteredFields"
                    class="no-case q-py-none q-mb-sm"
                    borderless
                    dense
                    use-input
                    emit-value
                    hide-selected
                    :placeholder="t('alerts.placeholders.selectColumn')"
                    fill-input
                    :input-debounce="400"
                    hide-bottom-space
                    @filter="(val: string, update: any) => filterFields(val, update)"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="width: 200px"
                    @update:model-value="emitAggregationUpdate"
                  />
                </div>
                <q-btn
                  icon="delete"
                  class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
                  :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                  padding="xs"
                  unelevated
                  size="sm"
                  round
                  flat
                  :title="t('alert_templates.delete')"
                  @click="deleteGroupByColumn(index)"
                  style="min-width: auto"
                />
              </div>
            </template>
            <q-btn
              icon="add"
              class="iconHoverBtn q-mb-sm q-mr-sm"
              :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
              padding="xs"
              unelevated
              size="sm"
              round
              flat
              :title="t('common.add')"
              @click="addGroupByColumn"
              style="min-width: auto"
            />
          </div>
        </div>

        <!-- Threshold -->
        <div class="flex justify-start items-start q-mb-xs no-wrap tw-pb-4 tw-mb-4">
          <div class="tw-font-semibold flex items-center" style="width: 190px">
            {{ t("alerts.threshold") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  The threshold above/below which the alert will trigger. <br />
                  e.g. if the threshold is >100 and the query returns a value of 101 then the alert will trigger.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- With Aggregation -->
            <template v-if="localIsAggregationEnabled && formData.query_condition.aggregation">
              <div class="flex tw-flex-col justify-start items-start tw-gap-2">
                <div class="tw-flex tw-items-center">
                  <div class="q-mr-xs">
                    <q-select
                      v-model="formData.query_condition.aggregation.function"
                      :options="aggFunctions"
                      class="no-case q-py-none q-mb-xs"
                      borderless
                      hide-bottom-space
                      dense
                      use-input
                      hide-selected
                      fill-input
                      style="width: 120px"
                      @update:model-value="emitAggregationUpdate"
                    />
                  </div>
                  <div class="q-mr-xs">
                    <q-select
                      v-model="formData.query_condition.aggregation.having.column"
                      :options="filteredNumericColumns"
                      class="no-case q-py-none q-mb-xs"
                      borderless
                      dense
                      use-input
                      emit-value
                      hide-selected
                      fill-input
                      @filter="filterNumericColumns"
                      style="width: 250px"
                      @update:model-value="emitAggregationUpdate"
                      hide-bottom-space
                      :error="formData.query_condition.aggregation.having.column.length === 0"
                      error-message="Field is required!"
                    />
                  </div>
                </div>
                <div class="flex items-center q-mt-xs">
                  <div class="monaco-editor-test q-mr-xs tw-pb-1">
                    <q-select
                      v-model="formData.query_condition.aggregation.having.operator"
                      :options="triggerOperators"
                      color="input-border"
                      class="no-case q-py-none"
                      borderless
                      dense
                      use-input
                      hide-selected
                      fill-input
                      style="width: 120px"
                      @update:model-value="emitAggregationUpdate"
                    />
                  </div>
                  <div class="flex items-center tw-pb-1">
                    <div style="width: 250px; margin-left: 0 !important">
                      <q-input
                        v-model="formData.query_condition.aggregation.having.value"
                        type="number"
                        dense
                        borderless
                        min="0"
                        :placeholder="t('alerts.placeholders.value')"
                        @update:model-value="emitAggregationUpdate"
                        hide-bottom-space
                        :rules="[(val: any) => !!val || 'Field is required!']"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Without Aggregation -->
            <template v-else>
              <div class="flex justify-start items-center">
                <div>
                  <q-select
                    v-model="formData.trigger_condition.operator"
                    :options="triggerOperators"
                    class="showLabelOnTop no-case q-py-none"
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    style="width: 88px"
                    @update:model-value="emitTriggerUpdate"
                  />
                </div>
                <div class="flex items-center" style="border-left: none">
                  <div style="width: 89px; margin-left: 0 !important">
                    <q-input
                      v-model="formData.trigger_condition.threshold"
                      type="number"
                      dense
                      borderless
                      min="1"
                      style="background: none"
                      debounce="300"
                      @update:model-value="emitTriggerUpdate"
                    />
                  </div>
                  <div
                    style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
                    :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c;' : ''"
                    :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
                    class="flex justify-center items-center"
                  >
                    {{ t("alerts.events") }}
                  </div>
                </div>
              </div>
              <div
                v-if="!formData.trigger_condition.operator || !Number(formData.trigger_condition.threshold)"
                class="text-red-8 q-pt-xs"
                style="font-size: 11px; line-height: 12px"
              >
                Field is required!
              </div>
            </template>
          </div>
        </div>

        <!-- Period -->
        <div class="flex items-center q-mr-sm tw-pb-4 tw-mb-4">
          <div class="tw-font-semibold flex items-center" style="width: 190px">
            {{ t("alerts.period") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Period for which the query should run.<br />
                  e.g. 10 minutes means that whenever the query will run it will use the last 10 minutes of data.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center q-mr-sm" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important" class="period-input-container">
                <q-input
                  v-model="formData.trigger_condition.period"
                  type="number"
                  dense
                  borderless
                  min="1"
                  style="background: none"
                  debounce="300"
                  @update:model-value="emitTriggerUpdate"
                />
              </div>
              <div
                style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
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

        <!-- Cron Toggle -->
        <div class="flex items-center q-mr-sm tw-pb-4 tw-mb-4">
          <div class="tw-font-semibold flex items-center" style="width: 172px">
            {{ t("alerts.crontitle") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">Configure the option to enable a cron job.</span>
              </q-tooltip>
            </q-icon>
          </div>
          <div class="tw-pb-2">
            <div class="flex items-center q-mr-sm" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important">
                <q-toggle
                  v-model="formData.trigger_condition.frequency_type"
                  :true-value="'cron'"
                  class="q-mt-sm o2-toggle-button-sm tw-h-[36px] tw-ml-1"
                  :false-value="'minutes'"
                  @update:model-value="emitTriggerUpdate"
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Frequency -->
        <div class="flex items-center q-mr-sm tw-pb-4 tw-mb-4" style="min-height: 78px">
          <div class="tw-font-semibold flex items-center" style="width: 190px">
            {{ t("alerts.frequency") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5 ' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="auto">
                <span style="font-size: 14px" v-if="formData.trigger_condition.frequency_type === 'minutes'">
                  How often the task should be executed.<br />
                  e.g., 2 minutes means that the task will run every 2 minutes.
                </span>
                <span style="font-size: 14px" v-else>
                  Pattern: * * * * * * means every second.
                  <br />
                  Format: [Second (optional) 0-59] [Minute 0-59] [Hour 0-23] [Day of Month 1-31, 'L'] [Month 1-12]
                  [Day of Week 0-7 or '1L-7L', 0 and 7 for Sunday].
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center" style="width: fit-content">
              <div
                :style="
                  formData.trigger_condition.frequency_type === 'minutes'
                    ? 'width: 87px; margin-left: 0 !important'
                    : 'width: fit-content !important'
                "
              >
                <q-input
                  v-if="formData.trigger_condition.frequency_type === 'minutes'"
                  v-model="formData.trigger_condition.frequency"
                  type="number"
                  dense
                  borderless
                  min="1"
                  style="background: none;"
                  debounce="300"
                  @update:model-value="emitTriggerUpdate"
                />
                <q-input
                  v-else
                  v-model="formData.trigger_condition.cron"
                  dense
                  borderless
                  style="width: 250px; background: none"
                  :placeholder="'0 * * * *'"
                  debounce="300"
                  @update:model-value="emitTriggerUpdate"
                />
              </div>
              <div
                v-if="formData.trigger_condition.frequency_type === 'minutes'"
                style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
                :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
                :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
                class="flex justify-center items-center"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
            <div
              v-if="
                formData.trigger_condition.frequency_type === 'minutes'
                  ? !Number(formData.trigger_condition.frequency)
                  : !formData.trigger_condition.cron
              "
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Silence Notification (Cooldown) for Scheduled Alerts -->
        <div class="flex items-start q-mr-sm tw-pb-4 tw-mb-4">
          <div class="tw-font-semibold flex items-center" style="width: 190px">
            {{ t("alerts.silenceNotification") + " *" }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">
                  Silences notifications after alert triggers for specified duration.<br />
                  e.g. if the alert triggers at 4:00 PM and the silence period is 30 minutes,
                  no notifications will be sent until 4:30 PM even if the alert triggers again.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center">
              <q-input
                v-model.number="formData.trigger_condition.silence"
                type="number"
                dense
                borderless
                min="0"
                style="width: 180px; background: none"
                suffix="Minutes"
                debounce="300"
                @update:model-value="emitTriggerUpdate"
              />
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
        <div class="flex items-start q-mr-sm tw-pb-4 tw-mb-4">
          <div class="tw-font-semibold flex items-center" style="width: 190px">
            {{ t("alerts.destination") }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              <q-tooltip anchor="center right" self="center left" max-width="300px">
                <span style="font-size: 14px">Select one or more destinations to send alert notifications.</span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center">
              <q-select
                v-model="localDestinations"
                :options="filteredDestinations"
                class="no-case q-py-none"
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
                  </div>
                </template>
                <template v-slot:option="option">
                  <q-list dense>
                    <q-item tag="label">
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
                label="Add New Destination"
                class="text-bold no-border q-ml-sm"
                color="primary"
                no-caps
                @click="routeToCreateDestination"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

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
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    // Local state for aggregation toggle
    const localIsAggregationEnabled = ref(props.isAggregationEnabled);
    const localDestinations = ref(props.destinations);

    // Watch for prop changes
    watch(
      () => props.isAggregationEnabled,
      (newVal) => {
        localIsAggregationEnabled.value = newVal;
      }
    );

    watch(
      () => props.destinations,
      (newVal) => {
        localDestinations.value = newVal;
      }
    );

    // Aggregation functions
    const aggFunctions = ["count", "min", "max", "avg", "sum", "median", "p50", "p75", "p90", "p95", "p99"];

    // Trigger operators
    const triggerOperators = ["=", "!=", ">=", ">", "<=", "<"];

    // Filtered fields for group by
    const filteredFields = ref([...props.columns]);
    const filterFields = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredFields.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredFields.value = props.columns.filter((v: any) => v.toLowerCase().indexOf(needle) > -1);
        }
      });
    };

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

    // Toggle aggregation
    const toggleAggregation = () => {
      emit("update:isAggregationEnabled", localIsAggregationEnabled.value);
    };

    // Add group by column
    const addGroupByColumn = () => {
      if (props.formData.query_condition.aggregation) {
        props.formData.query_condition.aggregation.group_by.push("");
        emitAggregationUpdate();
      }
    };

    // Delete group by column
    const deleteGroupByColumn = (index: number) => {
      if (props.formData.query_condition.aggregation) {
        props.formData.query_condition.aggregation.group_by.splice(index, 1);
        emitAggregationUpdate();
      }
    };

    // Emit updates
    const emitTriggerUpdate = () => {
      emit("update:trigger", props.formData.trigger_condition);
    };

    const emitAggregationUpdate = () => {
      emit("update:aggregation", props.formData.query_condition.aggregation);
    };

    const emitDestinationsUpdate = () => {
      emit("update:destinations", localDestinations.value);
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

    return {
      t,
      store,
      localIsAggregationEnabled,
      localDestinations,
      aggFunctions,
      triggerOperators,
      filteredFields,
      filterFields,
      filteredNumericColumns,
      filterNumericColumns,
      filteredDestinations,
      filterDestinations,
      toggleAggregation,
      addGroupByColumn,
      deleteGroupByColumn,
      emitTriggerUpdate,
      emitAggregationUpdate,
      emitDestinationsUpdate,
      routeToCreateDestination,
    };
  },
});
</script>

<style scoped lang="scss">
.step-alert-conditions {
  width: 100%;
  height: 100%;
  margin: 0 auto;
  overflow: auto;

  .step-content {
    border-radius: 8px;
    min-height: 100%;
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
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }

    .step-title {
      color: #ffffff;
    }

    .step-subtitle {
      color: #bdbdbd;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }

    .step-title {
      color: #1a1a1a;
    }

    .step-subtitle {
      color: #5c5c5c;
    }
  }
}
</style>
