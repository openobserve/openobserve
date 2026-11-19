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
  <div :class="['step-anomaly-config', sectionTargets ? '' : 'h-full']">
    <div
      :class="[
        'step-content',
        sectionTargets
          ? ''
          : 'rounded-default bg-surface-overlay border-border-default h-full overflow-x-hidden overflow-y-auto border px-3 py-4',
      ]"
    >
      <OForm :form="form">
        <OSettingRow :label="t('alerts.sections.rows.whichEvents')" data-test="anomaly-events-row">
          <OFormToggleGroup name="query_mode" data-test="anomaly-query-tabs">
            <OToggleGroupItem
              v-for="tab in queryTabOptions"
              :key="tab.value"
              :value="tab.value"
              size="sm"
              :data-test="`anomaly-query-tab-${tab.value}`"
            >
              <template #icon-left>
                <OIcon :name="tab.value === 'filters' ? 'filter-alt' : 'database'" size="sm" />
              </template>
              {{ tab.label }}
            </OToggleGroupItem>
          </OFormToggleGroup>
          <template v-if="storedIntervals" #note>
            <span data-test="anomaly-retrain-note">{{
              t("alerts.anomaly.retrainOnEditNote")
            }}</span>
          </template>
        </OSettingRow>

        <AlertFilterSentence
          v-if="queryMode === 'filters' && !filtersOpen"
          :label="t('alerts.form.filter.label')"
          :group="filterGroup"
          :stream-name="config.stream_name || ''"
          :stream-type="config.stream_type"
          dialect="sql"
          data-test="add-alert-filter-sentence"
          @add="addFilter"
          @change="openFilters"
          @edit="openFilters"
          @toggle-connector="openFilters"
          @remove="onFiltersChange([])"
        />
        <OSettingRow
          v-if="queryMode === 'filters' && filtersOpen"
          :label="t('alerts.form.filter.label')"
          wide
          fill
          data-test="anomaly-filters-row"
        >
          <FilterBuilder
            ref="filterBuilderRef"
            profile="anomaly"
            :model-value="filterRows"
            :fields="filterFields"
            :fields-loading="loadingFields"
            :load-values="filterDiscovery.loadValues"
            :value-label="filterDiscovery.valueLabel"
            :value-hint="filterDiscovery.valueHint"
            :field-detail="filterDiscovery.fieldDetail"
            :value-empty-text="filterDiscovery.valueEmptyText"
            :value-note="
              t('alerts.intent.slots.valueHelpEvents', {
                noun: dataNoun(config.stream_type, 'custom', 2, t),
              })
            "
            :placeholder="
              config.stream_name
                ? t('alerts.form.filter.placeholder')
                : t('alerts.anomaly.selectStreamFirst')
            "
            :add-labels="{
              add: t('alerts.form.filter.add'),
              addBelow: t('alerts.form.filter.addBelow'),
            }"
            data-test="anomaly-filter-builder"
            @update:model-value="onFiltersChange"
          />
        </OSettingRow>

        <OSettingRow
          v-if="queryMode === 'custom_sql'"
          :label="t('alerts.sections.rows.query')"
          wide
          fill
          data-test="anomaly-query-row"
        >
          <div
            class="custom-sql-editor-wrapper rounded-default h-35 overflow-hidden border"
            :class="hasSqlError ? 'border-input-border-error' : 'border-border-default'"
          >
            <!-- Bare Monaco: value bridged into the form from the editor's
                 own change handler so the schema covers it. -->
            <QueryEditor
              data-test-prefix="anomaly-custom-sql"
              :query="customSql || ''"
              :keywords="effectiveKeywords"
              :suggestions="effectiveSuggestions"
              :field-value-resolver="resolveFieldValues"
              :show-auto-complete="true"
              :disable-ai="!config.stream_name"
              :disable-ai-reason="
                !config.stream_name ? t('alerts.anomaly.selectStreamFirst') : raw('')
              "
              editor-height="100%"
              data-test="anomaly-custom-sql"
              @update:query="onCustomSqlChange"
            />
          </div>
          <!-- `custom_sql` is a bare editor bridged in via setFieldValue with
               no name= binding, so the schema's issue has no field to route to
               and THIS div is the only surface. It must mirror the schema's
               condition exactly — the schema rejects on `!custom_sql.trim()`,
               so a whitespace-only query must light this up too. -->
          <div
            v-if="showSqlErrors && !customSql?.trim()"
            class="text-input-error-text pt-1 text-xs"
            data-test="anomaly-custom-sql-required-error"
          >
            {{ t("alerts.anomaly.sqlRequired") }}
          </div>
          <div
            v-if="showSqlErrors && hasTimestampAlias"
            class="text-input-error-text pt-1 text-xs"
            data-test="anomaly-custom-sql-timestamp-alias-error"
          >
            <!-- Can't reuse alerts.validation.timestampAliasBanned (which
                 bakes `time_bucket` into its text): the slotted variant needs
                 both the column AND time_bucket as params. -->
            <i18n-t keypath="alerts.anomaly.timestampAliasBanned" tag="span">
              <template #column>
                <code>{{ store.state.zoConfig.timestamp_column || raw("_timestamp") }}</code>
              </template>
              <template #timeBucket
                ><code>{{ raw("time_bucket") }}</code></template
              >
            </i18n-t>
          </div>
          <div
            v-if="showSqlErrors && missingValueColumn"
            class="text-input-error-text pt-1 text-xs"
            data-test="anomaly-custom-sql-value-column-error"
          >
            <i18n-t keypath="alerts.anomaly.valueColumnMissing" tag="span">
              <template #column>
                <code>{{ raw(missingValueColumn) }}</code>
              </template>
            </i18n-t>
          </div>
          <template #note>
            <i18n-t keypath="alerts.anomaly.sqlColumnsHint" tag="span">
              <template #timeBucket
                ><code>{{ raw("time_bucket") }}</code></template
              >
              <template #valueColumn
                ><code>{{ raw("value") }}</code></template
              >
            </i18n-t>
          </template>
        </OSettingRow>

        <Teleport
          :to="sectionTargets?.anomalyCondition"
          :disabled="!sectionTargets?.anomalyCondition"
        >
          <OSettingRow
            :label="t('alerts.form.anomaly.measure')"
            :info="
              t('alerts.anomaly.detectionFunctionTooltip', {
                noun: dataNoun(config.stream_type, 'custom', 2, t),
              })
            "
            fill
            data-test="anomaly-measure-row"
          >
            <!-- Each clause wraps whole, so a second line starts at the column: "[count] of [field]" / "per [5] [minutes]". -->
            <div class="text-text-body flex flex-wrap items-start gap-2 text-sm">
              <div class="flex max-w-full min-w-0 items-start gap-2">
                <template v-if="queryMode === 'filters'">
                  <OFormSelect
                    name="detection_function"
                    :options="detectionFunctions"
                    :aria-label="t('alerts.detectionFunction')"
                    data-test="anomaly-detection-function"
                    class="w-32! shrink-0"
                    @update:model-value="onDetectionFunctionChange"
                  />
                  <template v-if="detectionFunction && detectionFunction !== 'count'">
                    <span class="flex min-h-8.5 items-center">{{
                      t("alerts.form.anomaly.of")
                    }}</span>
                    <OFormSelect
                      name="detection_function_field"
                      :options="filteredDetectionFields"
                      :placeholder="
                        detectionFunctionField ? raw('') : t('alerts.anomaly.fieldPlaceholder')
                      "
                      :loading="loadingFields"
                      :aria-label="t('alerts.anomaly.detectionFunctionField')"
                      data-test="anomaly-detection-function-field"
                      class="w-50! min-w-0"
                    >
                      <template #empty>
                        <div class="text-muted-foreground px-3 py-2">
                          {{
                            config.stream_name
                              ? t("alerts.anomaly.noFieldsFound")
                              : t("alerts.anomaly.selectStreamFirst")
                          }}
                        </div>
                      </template>
                    </OFormSelect>
                  </template>
                </template>
                <code
                  v-else
                  class="flex min-h-8.5 items-center"
                  data-test="anomaly-measure-sql-value"
                  >{{ raw("value") }}</code
                >
              </div>
              <div class="flex min-w-0 items-start gap-2">
                <span class="flex min-h-8.5 items-center">{{ t("alerts.form.anomaly.per") }}</span>
                <OFormInput
                  name="histogram_interval_value"
                  type="number"
                  min="1"
                  fit-content
                  :aria-label="t('alerts.anomaly.detectionResolution')"
                  data-test="anomaly-histogram-interval-value"
                >
                  <!-- Message rendered below at row width — see histogramIntervalError. -->
                  <template #error />
                </OFormInput>
                <OFormSelect
                  name="histogram_interval_unit"
                  :options="intervalUnits"
                  label-key="label"
                  value-key="value"
                  class="w-32!"
                  :aria-label="
                    t('common.unitFor', { label: t('alerts.anomaly.detectionResolution') })
                  "
                  data-test="anomaly-histogram-interval-unit"
                />
              </div>
            </div>
            <div
              v-if="histogramIntervalError"
              class="text-input-error-text pt-1 text-xs"
              data-test="anomaly-histogram-interval-error"
              role="alert"
            >
              {{ histogramIntervalError }}
            </div>
          </OSettingRow>
        </Teleport>

        <Teleport
          :to="sectionTargets?.anomalySchedule"
          :disabled="!sectionTargets?.anomalySchedule"
        >
          <OSettingRow
            :label="t('alerts.anomaly.checkEvery')"
            fill
            data-test="anomaly-check-every-row"
          >
            <div class="flex items-center gap-2">
              <OFormInput
                name="schedule_interval_value"
                type="number"
                min="1"
                fit-content
                :aria-label="t('alerts.anomaly.checkEvery')"
                data-test="anomaly-schedule-interval-value"
              >
                <!-- Message rendered below at pair width — see scheduleIntervalError. -->
                <template #error />
              </OFormInput>
              <OFormSelect
                name="schedule_interval_unit"
                :options="intervalUnits"
                label-key="label"
                value-key="value"
                class="w-32!"
                :aria-label="t('common.unitFor', { label: t('alerts.anomaly.checkEvery') })"
                data-test="anomaly-schedule-interval-unit"
              />
            </div>
            <div
              v-if="scheduleIntervalError"
              class="text-input-error-text pt-1 text-xs"
              data-test="anomaly-schedule-interval-error"
              role="alert"
            >
              {{ scheduleIntervalError }}
            </div>
            <template v-if="scheduleDelayNote" #note>
              <span data-test="anomaly-schedule-delay-note">{{ scheduleDelayNote }}</span>
            </template>
          </OSettingRow>
          <OSettingRow
            :label="t('alerts.form.schedule.lookingAtRow')"
            :info="t('alerts.anomaly.lookBackWindowTooltip')"
            fill
            data-test="anomaly-look-back-row"
          >
            <div class="flex items-center gap-2">
              <OFormInput
                name="detection_window_value"
                type="number"
                min="1"
                fit-content
                :aria-label="t('alerts.anomaly.lookBackWindow')"
                data-test="anomaly-detection-window-value"
              >
                <!-- Message rendered below at pair width — see detectionWindowError. -->
                <template #error />
              </OFormInput>
              <OFormSelect
                name="detection_window_unit"
                :options="intervalUnits"
                label-key="label"
                value-key="value"
                class="w-32!"
                :aria-label="t('common.unitFor', { label: t('alerts.anomaly.lookBackWindow') })"
                data-test="anomaly-detection-window-unit"
              />
            </div>
            <div
              v-if="detectionWindowError"
              class="text-input-error-text pt-1 text-xs"
              data-test="anomaly-detection-window-error"
              role="alert"
            >
              {{ detectionWindowError }}
            </div>
            <template v-if="lookBackWindowHint" #note>
              <span data-test="anomaly-detection-window-hint">{{ lookBackWindowHint }}</span>
            </template>
            <div
              v-if="legacyWindowWarning"
              class="text-status-warning-text pt-1 text-xs"
              data-test="anomaly-detection-window-legacy-warning"
            >
              {{ legacyWindowWarning }}
            </div>
          </OSettingRow>
        </Teleport>

        <Teleport
          :to="sectionTargets?.anomalyTraining"
          :disabled="!sectionTargets?.anomalyTraining"
        >
          <OSettingRow
            :label="t('alerts.form.anomaly.learnFrom')"
            fill
            data-test="anomaly-training-window-row"
          >
            <div class="text-text-body flex items-center gap-2 text-sm">
              <span>{{ t("alerts.form.anomaly.theLast") }}</span>
              <OFormInput
                name="training_window_days"
                type="number"
                :min="1"
                :aria-label="t('alerts.trainingWindow')"
                data-test="anomaly-training-window"
                fit-content
              />
              <span>{{ t("alerts.form.units.days") }}</span>
            </div>
            <div
              class="mt-1 text-xs"
              :class="trainingNote.warn ? 'text-status-warning-text' : 'text-text-secondary'"
              data-test="anomaly-training-window-floor-hint"
            >
              {{ trainingNote.text }}
            </div>
            <div v-if="!tierShows('anomalyRetrain')">
              <OButton
                variant="ghost-primary"
                size="sm"
                icon-left="add"
                class="-ms-3.5 max-[85.5rem]:-ms-3"
                data-test="add-alert-add-anomalyRetrain"
                @click="tiers?.reveal('anomalyRetrain')"
              >
                {{ t("alerts.tiers.add.anomalyRetrain") }}
              </OButton>
            </div>
          </OSettingRow>
          <OSettingRow
            v-if="tierShows('anomalyRetrain')"
            :label="t('alerts.anomaly.retrainEvery')"
            :description="t('alerts.form.anomaly.retrainHelp')"
            data-test="anomaly-retrain-every-row"
          >
            <OFormSelect
              name="retrain_interval_days"
              :options="retrainIntervalOptions"
              label-key="label"
              value-key="value"
              :aria-label="t('alerts.anomaly.retrainEvery')"
              data-test="anomaly-retrain-interval"
              class="w-50!"
            />
          </OSettingRow>
          <AlertSentenceRow
            v-if="!sensitivityOpened"
            :label="t('alerts.sensitivity')"
            data-test="anomaly-sensitivity-row"
            changeable
            @change="sensitivityOpened = true"
          >
            <span class="text-text-heading font-medium">{{
              t("alerts.form.anomaly.sensitivityAuto")
            }}</span>
            {{ t("alerts.form.anomaly.learned") }}
          </AlertSentenceRow>
          <OSettingRow
            v-else
            :label="t('alerts.sensitivity')"
            :info="sensitivityTooltip"
            fill
            data-test="anomaly-sensitivity-row"
          >
            <div class="flex min-w-0 flex-col" :class="budgetMode ? 'gap-1' : 'gap-2'">
              <!-- In budget mode the budget IS the contract, so the control is the delivered-alert cap. -->
              <div v-if="budgetMode" class="flex flex-wrap items-start gap-3">
                <OToggleGroup
                  :model-value="budgetTier"
                  :aria-label="t('alerts.sensitivity')"
                  mobile-dropdown
                  data-test="anomaly-budget-tiers"
                  @update:model-value="onBudgetTier"
                >
                  <OToggleGroupItem
                    v-for="tier in budgetTiers"
                    :key="tier.value"
                    :value="tier.value"
                    size="sm"
                    :data-test="`anomaly-budget-tier-${tier.value}`"
                  >
                    {{ tier.label }}
                  </OToggleGroupItem>
                </OToggleGroup>
                <div class="flex items-center gap-2">
                  <OFormInput
                    name="budget_count"
                    type="number"
                    min="1"
                    :model-modifiers="{ number: true }"
                    :aria-label="t('alerts.anomaly.budgetLabel')"
                    fit-content
                    data-test="anomaly-budget-count"
                  >
                    <template #error />
                  </OFormInput>
                  <OFormSelect
                    name="budget_period"
                    :options="budgetPeriods"
                    label-key="label"
                    value-key="value"
                    class="w-32!"
                    :aria-label="t('alerts.anomaly.budgetPeriod')"
                    data-test="anomaly-budget-period"
                  />
                </div>
              </div>
              <div v-else class="flex flex-col items-start gap-2">
                <OToggleGroup
                  :model-value="bandTier"
                  :aria-label="t('alerts.sensitivity')"
                  mobile-dropdown
                  data-test="anomaly-sensitivity-tier"
                  @update:model-value="onBandTier"
                >
                  <OToggleGroupItem
                    v-for="tier in sensitivityTiers"
                    :key="tier.value"
                    :value="tier.value"
                    size="sm"
                    :data-test="`anomaly-sensitivity-tier-${tier.value}`"
                  >
                    {{ tier.label }}
                  </OToggleGroupItem>
                </OToggleGroup>
                <div
                  v-if="autoSensitivity"
                  class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
                  role="status"
                  aria-live="polite"
                  data-test="anomaly-sensitivity-auto-level"
                >
                  <span class="text-text-secondary text-xs">{{ autoLevelLabel }}</span>
                  <output class="text-text-heading text-sm font-medium tabular-nums">{{
                    autoLevelValue
                  }}</output>
                </div>
                <div
                  v-else
                  class="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1"
                >
                  <label
                    for="anomaly-manual-level"
                    class="text-text-secondary flex min-h-8.5 items-center text-xs"
                  >
                    {{ t("alerts.anomaly.level") }}
                  </label>
                  <div class="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                    <OFormInput
                      id="anomaly-manual-level"
                      name="band_width"
                      type="number"
                      suffix="σ"
                      :model-modifiers="{ number: true }"
                      :aria-label="t('alerts.anomaly.level')"
                      :aria-describedby="
                        sensitivityError ? 'anomaly-manual-level-error' : undefined
                      "
                      fit-content
                      data-test="anomaly-sensitivity-level"
                    >
                      <template #error />
                    </OFormInput>
                    <span
                      v-if="customSensitivity"
                      class="text-text-secondary flex min-h-8.5 items-center text-xs"
                      data-test="anomaly-sensitivity-custom"
                      >{{ t("alerts.anomaly.customSensitivity") }}</span
                    >
                  </div>
                  <div
                    v-if="sensitivityError"
                    id="anomaly-manual-level-error"
                    class="text-input-error-text col-start-2 text-xs"
                    data-test="anomaly-sensitivity-error"
                    role="alert"
                  >
                    {{ sensitivityError }}
                  </div>
                </div>
              </div>
              <div
                v-if="budgetMode && sensitivityError"
                class="text-input-error-text text-xs"
                data-test="anomaly-sensitivity-error"
                role="alert"
              >
                {{ sensitivityError }}
              </div>
              <span
                v-if="sensitivityHint"
                class="text-text-secondary text-xs"
                data-test="anomaly-sensitivity-hint"
                role="status"
                aria-live="polite"
              >
                {{ sensitivityHint }}
              </span>
            </div>
          </OSettingRow>
        </Teleport>

        <!-- SQL preview — in custom_sql mode the user's own editor is already on this form -->
        <AlertTierPlace id="anomalySqlPreview">
          <OSettingRow
            v-if="queryMode !== 'custom_sql' && tierShows('anomalySqlPreview')"
            :label="t('alerts.tiers.names.generatedSql')"
            wide
            fill
            data-test="anomaly-sql-preview-row"
          >
            <div class="border-border-default rounded-default h-32 overflow-hidden border">
              <QueryEditor
                data-test-prefix="anomaly-sql-preview"
                :read-only="true"
                :show-auto-complete="false"
                :hide-nl-toggle="true"
                :query="previewSql"
                editor-height="100%"
                data-test="anomaly-sql-preview"
              />
            </div>
          </OSettingRow>
        </AlertTierPlace>
      </OForm>
    </div>
  </div>
</template>

<script lang="ts">
import useSqlSuggestions from "@/composables/useSuggestions";
import { computed, defineComponent, inject, nextTick, ref, watch, type PropType } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { streamSchemaQuery } from "@/services/stream.queries";
import { queryClient } from "@/composables/query/queryClient";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import {
  dataSpanDays,
  isIngestArtifact,
  useFilterDiscovery,
} from "@/composables/alerts/useStreamDiscovery";
import { dataNoun, durationText, everyDuration } from "@/utils/alerts/alertCopy";
import { toFilterFields, type FilterField } from "@/utils/query/filterBar";
import QueryEditor from "@/components/QueryEditor.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AlertSectionTargets } from "@/components/alerts/alertFormSections";
import AlertFilterSentence from "@/components/alerts/AlertFilterSentence.vue";
import AlertSentenceRow from "@/components/alerts/AlertSentenceRow.vue";
import {
  ALERT_SETTING_TIERS_KEY,
  useTierVisibility,
} from "@/composables/alerts/useAlertSettingTiers";
import { FILTER_PROFILES } from "@/components/filterBar/filterProfiles";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import AlertTierPlace from "@/components/alerts/AlertTierPlace.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import {
  ANOMALY_BALANCED_BAND_WIDTH,
  ANOMALY_HOURLY_PATTERN_DAYS,
  anomalyTrainingFact,
  createAnomalyDetectionConfigSchema,
  anomalyDetectionConfigDefaults,
  anomalyIntervalSeconds,
  anomalySensitivityModel,
  anomalyModelQuery,
  anomalyMissingValueColumn,
  hasTimestampAliasInSql,
  lookBackWindowFloorSeconds,
  type AnomalyDetectionConfigForm,
  type AnomalyFilterRow,
  type AnomalyStoredIntervals,
  type AnomalyStoredSqlFunction,
} from "./AnomalyDetectionConfig.schema";

export default defineComponent({
  name: "AnomalyDetectionConfig",

  components: {
    FilterBuilder,
    QueryEditor,
    AlertTierPlace,
    OToggleGroup,
    OToggleGroupItem,
    OFormToggleGroup,
    OIcon,
    OForm,
    OSettingRow,
    OButton,
    OFormInput,
    OFormSelect,
    AlertFilterSentence,
    AlertSentenceRow,
  },

  props: {
    // Opt-in: the sectioned alert editor renders the detection, schedule and training rows in its own sections.
    sectionTargets: {
      type: Object as PropType<AlertSectionTargets | null>,
      default: null,
    },
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    previewSql: {
      type: String,
      default: "",
    },
    // From the edit fetch (useAlertForm.anomalyStoredIntervals), never derived from `config` (D4).
    storedIntervals: {
      type: Object as PropType<AnomalyStoredIntervals | null>,
      default: null,
    },
    // Same source and rule as storedIntervals: the function of a stored custom_sql row.
    storedSqlFunction: {
      type: Object as PropType<AnomalyStoredSqlFunction | null>,
      default: null,
    },
  },

  setup(props) {
    const { t } = useI18nTyped();
    const store = useStore();

    // Option labels go through t() inside a computed so they re-resolve on a
    // locale change (a plain const would freeze them at mount locale).
    // "SQL" stays a literal — a proper noun, not translatable copy.
    const queryTabOptions = computed(() => [
      { label: t("alerts.queryBuilder"), value: "filters" },
      { label: raw("SQL"), value: "custom_sql" },
    ]);

    const detectionFunctions = ["count", "avg", "sum", "min", "max", "p50", "p95", "p99"];
    // One s/m/h/d grammar shared with the server's parse_interval (§4.5) — "90s" and "1d" must render.
    const intervalUnits = computed(() => [
      { label: t("alerts.form.units.seconds"), value: "s" },
      { label: t("alerts.form.units.minutes"), value: "m" },
      { label: t("alerts.form.units.hours"), value: "h" },
      { label: t("alerts.form.units.days"), value: "d" },
    ]);
    // Fixed enum labels, not dynamic counts — plain keys, no pluralization.
    const retrainIntervalOptions = computed(() => [
      { label: t("alerts.anomaly.retrainNever"), value: 0 },
      { label: t("alerts.anomaly.retrainOneDay"), value: 1 },
      { label: t("alerts.anomaly.retrainSevenDays"), value: 7 },
      { label: t("alerts.anomaly.retrainFourteenDays"), value: 14 },
    ]);
    const modelQuery = ref(anomalyModelQuery(props.config));
    const modelState = computed(() => anomalySensitivityModel(props.config));
    const sensitivityTiers = computed(() => [
      { value: "auto" as const, label: t("alerts.anomaly.sensitivityAuto") },
      { value: 4, label: t("alerts.anomaly.sensitivityConservative") },
      { value: ANOMALY_BALANCED_BAND_WIDTH, label: t("alerts.anomaly.sensitivityBalanced") },
      { value: 2.5, label: t("alerts.anomaly.sensitivityAggressive") },
    ]);
    // 1/week is the burden gate's median target, 4/day the org-wide on-call ceiling.
    const budgetTiers = computed(() => [
      {
        value: "1_week",
        count: 1,
        period: "week",
        label: t("alerts.anomaly.sensitivityConservative"),
      },
      { value: "1_day", count: 1, period: "day", label: t("alerts.anomaly.sensitivityBalanced") },
      { value: "4_day", count: 4, period: "day", label: t("alerts.anomaly.sensitivityAggressive") },
    ]);
    const budgetPeriods = computed(() => [
      { label: t("alerts.anomaly.budgetPerDay"), value: "day" },
      { label: t("alerts.anomaly.budgetPerWeek"), value: "week" },
    ]);

    const getTimestampColumn = () => store.state.zoConfig.timestamp_column || "_timestamp";

    // The parent (useAlertForm.saveAnomalyDetection) owns the save + payload;
    // this step's submit exists purely to run the schema (the exposed
    // validate() drives form.handleSubmit()), so onSubmit is a no-op.
    const anomalyDetectionConfigSchema = createAnomalyDetectionConfigSchema(
      t,
      getTimestampColumn,
      () => props.storedIntervals,
      () => props.storedSqlFunction,
    );

    const form = useOForm<AnomalyDetectionConfigForm>({
      defaultValues: anomalyDetectionConfigDefaults(props.config),
      schema: anomalyDetectionConfigSchema,
      onSubmit: () => {},
    });

    // Reactive reads via form.useStore.
    const queryMode = form.useStore((s: any) => s.values.query_mode);
    const customSql = form.useStore((s: any) => s.values.custom_sql);
    const filterRows = form.useStore((s: any): AnomalyFilterRow[] => s.values.filters ?? []);
    const detectionFunction = form.useStore((s: any) => s.values.detection_function);
    const detectionFunctionField = form.useStore((s: any) => s.values.detection_function_field);
    const histogramIntervalValue = form.useStore((s: any) => s.values.histogram_interval_value);
    const histogramIntervalUnit = form.useStore((s: any) => s.values.histogram_interval_unit);
    const scheduleIntervalValue = form.useStore((s: any) => s.values.schedule_interval_value);
    const scheduleIntervalUnit = form.useStore((s: any) => s.values.schedule_interval_unit);
    const detectionWindowValue = form.useStore((s: any) => s.values.detection_window_value);
    const detectionWindowUnit = form.useStore((s: any) => s.values.detection_window_unit);
    const trainingWindowDays = form.useStore((s: any) => s.values.training_window_days);
    const bandWidth = form.useStore((s: any) => s.values.band_width);
    const sensitivityMode = form.useStore((s: any) => s.values.sensitivity_mode);
    const budgetCount = form.useStore((s: any) => s.values.budget_count);
    const budgetPeriod = form.useStore((s: any) => s.values.budget_period);
    // Bare-widget errors (Monaco custom_sql + the data-test div) render only
    // after the first submit attempt, same timing as the wrappers.
    const showSqlErrors = form.useStore((s: any) => s.submissionAttempts > 0);

    // The interval controls are composite "number + unit" fields: a ~5.5rem
    // OFormInput glued to a unit OFormSelect. OFormInput renders its message
    // INSIDE the number field's own width, which wraps it into a ragged column
    // and grows the field, pushing the unit select out of line. An empty #error
    // slot suppresses the built-in message and we render it in a full-width
    // sibling below the pair, reading the same field errors OFormInput surfaces.
    const fieldError = (path: string) =>
      form.useStore((s: any) => firstFieldError(s.fieldMeta?.[path]?.errors ?? []));
    const histogramIntervalError = fieldError("histogram_interval_value");
    const scheduleIntervalError = fieldError("schedule_interval_value");
    const detectionWindowError = fieldError("detection_window_value");
    const budgetCountError = fieldError("budget_count");
    const bandWidthError = fieldError("band_width");

    const budgetMode = computed(() => sensitivityMode.value === "budget");

    const tierShows = useTierVisibility();
    const tiers = inject(ALERT_SETTING_TIERS_KEY, null);

    // Auto reads as one sentence row; Change, a stored level or a stored budget opens the controls.
    const sensitivityOpened = ref(false);

    const sensitivityError = computed(() =>
      budgetMode.value ? budgetCountError.value : bandWidthError.value,
    );

    const sensitivityTooltip = computed(() =>
      budgetMode.value
        ? t("alerts.anomaly.sensitivityBudgetTooltip")
        : t("alerts.anomaly.sensitivityTooltip"),
    );

    // A plain toggle, not a form field: one preset value fans out into two form fields.
    const budgetTier = computed(() => {
      const match = budgetTiers.value.find(
        (tier) => tier.count === Number(budgetCount.value) && tier.period === budgetPeriod.value,
      );
      return match?.value ?? "";
    });

    const onBudgetTier = (value: unknown) => {
      const tier = budgetTiers.value.find((entry) => entry.value === value);
      if (!tier) return;
      form.setFieldValue("budget_count", tier.count);
      form.setFieldValue("budget_period", tier.period as "day" | "week");
    };

    const bandTier = computed(() => {
      const value = bandWidth.value;
      if (value === null || value === undefined) return "auto";
      return sensitivityTiers.value.find((tier) => tier.value === Number(value))?.value ?? "";
    });

    const onBandTier = (value: unknown) => {
      const tier = sensitivityTiers.value.find((entry) => entry.value === value);
      if (!tier) return;
      form.setFieldValue("band_width", tier.value === "auto" ? null : tier.value);
    };

    const autoSensitivity = computed(() => bandWidth.value == null);
    // Once open it stays open, so picking Auto again does not fold the row under the cursor.
    watch(
      () => !autoSensitivity.value || budgetMode.value,
      (open) => {
        if (open) sensitivityOpened.value = true;
      },
      { immediate: true },
    );
    const customSensitivity = computed(
      () =>
        !autoSensitivity.value &&
        bandTier.value === "" &&
        String(bandWidth.value).trim() !== "" &&
        Number.isFinite(Number(bandWidth.value)) &&
        Number(bandWidth.value) >= 1 &&
        Number(bandWidth.value) <= 10,
    );
    const autoLevelLabel = computed(() =>
      modelState.value.level === null
        ? t("alerts.anomaly.autoLevel")
        : modelState.value.current
          ? t("alerts.anomaly.currentLevel")
          : t("alerts.anomaly.lastTrainedLevel"),
    );
    const autoLevelValue = computed(() =>
      modelState.value.level === null
        ? t(
            modelState.value.state === "training"
              ? "alerts.anomaly.autoLearning"
              : modelState.value.state === "failed"
                ? "alerts.anomaly.autoUnavailable"
                : "alerts.anomaly.autoAfterTraining",
          )
        : raw(`${modelState.value.level}σ`),
    );
    const modelHelpKeys = {
      trained: "alerts.anomaly.autoLearnedHelp",
      untrained: "alerts.anomaly.autoUntrainedHelp",
      training: "alerts.anomaly.autoTrainingHelp",
      failed: "alerts.anomaly.autoFailedHelp",
      waitingForData: "alerts.anomaly.autoWaitingForDataHelp",
      notApplicable: "alerts.anomaly.autoNotApplicableHelp",
      retraining: "alerts.anomaly.autoRetrainingHelp",
      retrainFailed: "alerts.anomaly.autoRetrainFailedHelp",
      unconfirmed: "alerts.anomaly.autoUnconfirmedHelp",
    } as const;

    // Suppressed on bad input: the error is the feedback.
    const sensitivityHint = computed(() => {
      if (budgetMode.value) {
        const count = Number(budgetCount.value);
        if (!Number.isFinite(count) || count <= 0) return raw("");
        return budgetPeriod.value === "week"
          ? t("alerts.anomaly.budgetHintPerWeek", { count })
          : t("alerts.anomaly.budgetHintPerDay", { count });
      }
      if (autoSensitivity.value) return t(modelHelpKeys[modelState.value.state]);
      if (sensitivityError.value) return raw("");
      // The range error only renders after save, so an invalid draft must not show the model note.
      const k = Number(bandWidth.value);
      if (bandWidth.value === "" || !Number.isFinite(k) || k < 1 || k > 10) return raw("");
      if (!modelState.value.current) return t("alerts.anomaly.manualModelRequired");
      return t("alerts.anomaly.manualSensitivityHelp");
    });

    const WORD_UNITS = [
      [86400, "alerts.form.duration.days"],
      [3600, "alerts.form.duration.hours"],
      [60, "alerts.form.duration.minutes"],
      [1, "alerts.form.duration.seconds"],
    ] as const;
    const secondsInWords = (secs: number) => {
      let rest = Math.max(0, Math.floor(secs));
      const parts = WORD_UNITS.flatMap(([size, key]) => {
        const n = Math.floor(rest / size);
        rest -= n * size;
        return n > 0 ? [t(key, { count: n }, n)] : [];
      });
      return raw(parts.length ? parts.join(" ") : t(WORD_UNITS[3][1], { count: 0 }, 0));
    };

    // §4.6: the floor is computed locally from the form's own values — no server dependency.
    const currentWindowFloor = computed(() =>
      lookBackWindowFloorSeconds(
        Number(scheduleIntervalValue.value),
        String(scheduleIntervalUnit.value),
        Number(histogramIntervalValue.value),
        String(histogramIntervalUnit.value),
      ),
    );

    // Suppressed while the field is in error, so the floor is stated once, not twice.
    const lookBackWindowHint = computed(() => {
      if (detectionWindowError.value) return raw("");
      const floor = currentWindowFloor.value;
      if (floor === null) return raw("");
      return t("alerts.anomaly.lookBackWindowMinimum", {
        min: secondsInWords(floor),
        // Twice the floor plus the 10-minute absence allowance; absence detection is on by default.
        recommended: secondsInWords(2 * floor + 600),
      });
    });

    const storedTripleUntouched = computed(() => {
      const stored = props.storedIntervals;
      return (
        stored !== null &&
        Number(histogramIntervalValue.value) === stored.histogram.value &&
        String(histogramIntervalUnit.value) === stored.histogram.unit &&
        Number(scheduleIntervalValue.value) === stored.schedule.value &&
        String(scheduleIntervalUnit.value) === stored.schedule.unit &&
        Number(detectionWindowValue.value) === stored.window.value &&
        String(detectionWindowUnit.value) === stored.window.unit
      );
    });

    // §4.5: a grandfathered below-floor row saves verbatim but is warned; unparsable stored values stay warning-free.
    const legacyWindowWarning = computed(() => {
      const stored = props.storedIntervals;
      if (!stored || !stored.schedule.parsed || !stored.histogram.parsed) return raw("");
      if (!storedTripleUntouched.value) return raw("");
      const floor = lookBackWindowFloorSeconds(
        stored.schedule.value,
        stored.schedule.unit,
        stored.histogram.value,
        stored.histogram.unit,
      );
      const windowSecs =
        typeof stored.window.raw === "number"
          ? stored.window.raw
          : anomalyIntervalSeconds(stored.window.value, stored.window.unit);
      if (floor === null || windowSecs === null || windowSecs >= floor) return raw("");
      return t("alerts.anomaly.lookBackWindowLegacy", { min: secondsInWords(floor) });
    });

    // The save payload, the SQL preview and the chart all read props.config, so the form writes back into it
    const toModelNumber = (v: unknown) => {
      if (v === "" || v === null || v === undefined) return v;
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    };

    const formValues = form.useStore((s: any) => s.values);
    watch(
      formValues,
      (v: any) => {
        const cfg = props.config;
        if (!cfg || !v) return;
        cfg.query_mode = v.query_mode;
        // Replace the array only when its contents changed, so the preview's
        // deep refresh watcher doesn't refire on unrelated field edits.
        if (JSON.stringify(cfg.filters ?? []) !== JSON.stringify(v.filters ?? [])) {
          cfg.filters = (v.filters ?? []).map((f: any) => ({ ...f }));
        }
        cfg.custom_sql = v.custom_sql;
        cfg.detection_function = v.detection_function;
        cfg.detection_function_field = v.detection_function_field;
        cfg.histogram_interval_value = toModelNumber(v.histogram_interval_value);
        cfg.histogram_interval_unit = v.histogram_interval_unit;
        cfg.schedule_interval_value = toModelNumber(v.schedule_interval_value);
        cfg.schedule_interval_unit = v.schedule_interval_unit;
        cfg.detection_window_value = toModelNumber(v.detection_window_value);
        cfg.detection_window_unit = v.detection_window_unit;
        cfg.training_window_days = toModelNumber(v.training_window_days);
        cfg.retrain_interval_days = toModelNumber(v.retrain_interval_days);
        if (v.sensitivity_mode === "budget") {
          // threshold is controller-derived here; an invalid count writes nothing, or the config would flip back to band mode.
          const count = Number(v.budget_count);
          if (Number.isFinite(count) && count > 0) {
            cfg.alert_budget_per_day = v.budget_period === "week" ? count / 7 : count;
          }
        } else {
          // Switching to band mode must clear a previously stored budget, or the
          // save payload keeps sending the stale value.
          cfg.alert_budget_per_day = undefined;
          cfg.band_width = v.band_width == null ? null : toModelNumber(v.band_width);
        }
      },
      { deep: true },
    );

    // Async edit-prefill replaces the whole config object → re-seed via
    // form.reset(record).
    watch(
      () => props.config,
      (cfg) => {
        modelQuery.value = anomalyModelQuery(cfg);
        form.reset(anomalyDetectionConfigDefaults(cfg));
      },
    );

    watch(
      () => anomalyModelQuery(props.config),
      (query) => {
        const cfg = props.config;
        cfg.sensitivity_model_stale = query !== modelQuery.value;
      },
    );

    // Check if the custom SQL uses the timestamp column name as an alias
    // (display gating for the bare-editor error div; the schema enforces it).
    const hasTimestampAlias = computed(
      () =>
        queryMode.value === "custom_sql" &&
        hasTimestampAliasInSql(customSql.value || "", getTimestampColumn()),
    );

    // Mirrors the schema's third custom_sql rule, which runs only when the first two pass.
    const missingValueColumn = computed(() =>
      customSql.value?.trim() && !hasTimestampAlias.value
        ? anomalyMissingValueColumn(
            { query_mode: queryMode.value, custom_sql: customSql.value },
            props.storedSqlFunction,
          )
        : null,
    );

    // Bare Monaco has no field binding, so it never gets the red border the
    // OForm* wrappers paint from field state. This drives that border, post-
    // submit only, over the same conditions the two error divs render on.
    const hasSqlError = computed(
      () =>
        showSqlErrors.value &&
        (!customSql.value?.trim() || hasTimestampAlias.value || !!missingValueColumn.value),
    );

    // Bridge the bare Monaco editor's value into the form so the schema
    // covers it.
    const onCustomSqlChange = (sql: string) => {
      form.setFieldValue("custom_sql", sql);
    };

    // Build default SQL template for a given stream name and histogram interval
    const buildDefaultSql = (
      streamName: string,
      intervalValue: number | string,
      intervalUnit: string,
    ) =>
      `SELECT histogram(_timestamp, '${intervalValue}${intervalUnit}') AS time_bucket, count(*) AS value\nFROM "${streamName}"\nGROUP BY time_bucket\nORDER BY time_bucket`;

    // Stream fields for filter field selector and detection function field
    const allStreamFields = ref<string[]>([]);
    // Same completion machinery every other SQL editor in the app uses, so this
    // one also gets SQL keywords, the O2 functions and the server function
    // catalog rather than bare field names.
    const {
      autoCompleteData,
      effectiveKeywords,
      effectiveSuggestions,
      updateFieldKeywords,
      resolveFieldValues,
    } = useSqlSuggestions();
    const numericStreamFields = ref<string[]>([]); // only numeric types for avg/sum/min/max/pXX
    const filteredStreamFields = ref<string[]>([]);
    const filterFields = ref<FilterField[]>([]);
    // How many days of data the stream holds, so the training floor can say whether it is met.
    const streamDays = ref<number | undefined>(undefined);
    const filteredDetectionFields = ref<string[]>([]);
    const loadingFields = ref(false);

    const NUMERIC_FIELD_TYPES = new Set([
      "Int8",
      "Int16",
      "Int32",
      "Int64",
      "UInt8",
      "UInt16",
      "UInt32",
      "UInt64",
      "Float16",
      "Float32",
      "Float64",
    ]);

    const requiresNumericField = (fn: string) =>
      ["avg", "sum", "min", "max", "p50", "p95", "p99"].includes(fn);

    const loadStreamFields = async () => {
      const streamName = props.config.stream_name;
      const streamType = props.config.stream_type;

      // Field VALUES are looked up under "org|streamType|streamName|field", so
      // the resolver returns nothing at all until this is set.
      autoCompleteData.value.org = store.state.selectedOrganization?.identifier ?? "";
      autoCompleteData.value.streamType = String(streamType ?? "");
      autoCompleteData.value.streamName = String(streamName ?? "");

      streamDays.value = undefined;
      if (!streamName || !streamType) {
        allStreamFields.value = [];
        updateFieldKeywords([]);
        numericStreamFields.value = [];
        filteredStreamFields.value = [];
        filterFields.value = [];
        filteredDetectionFields.value = [];
        return;
      }
      loadingFields.value = true;
      try {
        const schema = await queryClient.fetchQuery(
          streamSchemaQuery(store.state.selectedOrganization.identifier, streamName, streamType),
        );
        streamDays.value = dataSpanDays(schema.stats, Date.now() * 1000);
        const fieldsArray = (
          schema.uds_schema && schema.uds_schema.length > 0
            ? schema.uds_schema
            : schema.schema || schema.fields || []
        ).filter((f: any) => !isIngestArtifact(String(f?.name ?? "")));
        allStreamFields.value = fieldsArray.map((f: any) => f.name).sort();
        // The two failure branches below already cleared the keywords; without
        // this the success branch never set them, so the SQL editor offered
        // functions and keywords but not one field of the selected stream.
        updateFieldKeywords(fieldsArray);
        numericStreamFields.value = fieldsArray
          .filter((f: any) => {
            const t: string = f.field_type || f.data_type || f.type || "";
            return NUMERIC_FIELD_TYPES.has(t);
          })
          .map((f: any) => f.name)
          .sort();
        filteredStreamFields.value = allStreamFields.value;
        filterFields.value = toFilterFields(
          fieldsArray.map((f: any) => ({
            name: f.name,
            type: f.field_type || f.data_type || f.type,
          })),
        ).sort((a, b) => a.name.localeCompare(b.name));
        filteredDetectionFields.value = requiresNumericField(detectionFunction.value as string)
          ? numericStreamFields.value
          : allStreamFields.value;
      } catch {
        allStreamFields.value = [];
        updateFieldKeywords([]);
        numericStreamFields.value = [];
        filteredStreamFields.value = [];
        filterFields.value = [];
        filteredDetectionFields.value = [];
      } finally {
        loadingFields.value = false;
      }
    };

    const onDetectionFunctionChange = (fn: string) => {
      if (fn === "count") {
        form.setFieldValue("detection_function_field", "");
      }
      // Refresh available fields based on whether the new function needs numeric fields.
      const base = requiresNumericField(fn) ? numericStreamFields.value : allStreamFields.value;
      filteredDetectionFields.value = base;
      // Clear the selected field if it's no longer valid for the new function.
      if (
        requiresNumericField(fn) &&
        form.state.values.detection_function_field &&
        !numericStreamFields.value.includes(form.state.values.detection_function_field as string)
      ) {
        form.setFieldValue("detection_function_field", "");
      }
    };

    watch(
      () => [props.config.stream_name, props.config.stream_type],
      ([streamName]) => {
        loadStreamFields();
        // Pre-fill default SQL when switching to custom_sql mode with a selected stream
        if (
          form.state.values.query_mode === "custom_sql" &&
          streamName &&
          !form.state.values.custom_sql
        ) {
          form.setFieldValue(
            "custom_sql",
            buildDefaultSql(
              streamName as string,
              (form.state.values.histogram_interval_value as any) ?? 5,
              (form.state.values.histogram_interval_unit as string) ?? "m",
            ),
          );
        }
      },
      { immediate: true },
    );

    // When switching to custom_sql mode, seed a default query if one isn't set
    watch(queryMode, (mode) => {
      if (mode === "custom_sql" && props.config.stream_name && !form.state.values.custom_sql) {
        form.setFieldValue(
          "custom_sql",
          buildDefaultSql(
            props.config.stream_name,
            (form.state.values.histogram_interval_value as any) ?? 5,
            (form.state.values.histogram_interval_unit as string) ?? "m",
          ),
        );
      }
    });

    // Sync histogram interval changes into the custom SQL histogram() call
    watch([histogramIntervalValue, histogramIntervalUnit], ([newValue, newUnit]) => {
      if (form.state.values.query_mode !== "custom_sql" || !form.state.values.custom_sql) return;
      form.setFieldValue(
        "custom_sql",
        (form.state.values.custom_sql as string).replace(
          /histogram\(\s*_timestamp\s*,\s*'[^']+'\s*\)/gi,
          `histogram(_timestamp, '${newValue}${newUnit}')`,
        ),
      );
    });

    const onFiltersChange = (next: unknown) => {
      form.setFieldValue("filters", next as AnomalyFilterRow[]);
    };

    const filtersOpen = ref(false);
    const filterBuilderRef = ref<{ focus(): void; activate(): void } | null>(null);
    const filterGroup = computed(() =>
      FILTER_PROFILES.anomaly.codec.parse(filterRows.value, { fields: filterFields.value }),
    );
    // The builder only allows "and", so every sentence phrase and connector opens it instead.
    const openFilters = async () => {
      filtersOpen.value = true;
      await nextTick();
      filterBuilderRef.value?.focus();
    };
    // "Add filter" goes straight to the field list rather than to a second "Add condition" click.
    const addFilter = async () => {
      filtersOpen.value = true;
      await nextTick();
      filterBuilderRef.value?.activate();
    };

    const trainingNote = computed(() => {
      const fact = anomalyTrainingFact(
        Number(trainingWindowDays.value),
        streamDays.value,
        anomalyIntervalSeconds(
          Number(histogramIntervalValue.value),
          String(histogramIntervalUnit.value),
        ),
      );
      if (fact.kind === "reads")
        return { warn: false, text: t("alerts.form.anomaly.trainingReads", { days: fact.days }) };
      if (fact.kind === "has")
        return {
          warn: false,
          text: t("alerts.form.anomaly.trainingHas", { count: fact.days }, fact.days),
        };
      if (fact.kind === "flat")
        return {
          warn: true,
          text: t(
            "alerts.form.anomaly.trainingFlat",
            { count: fact.days, pattern: ANOMALY_HOURLY_PATTERN_DAYS },
            fact.days,
          ),
        };
      return {
        warn: true,
        text: t("alerts.form.anomaly.trainingWaits", {
          measures: fact.measures,
          duration: durationText(fact.minutes * 60, t),
          pattern: ANOMALY_HOURLY_PATTERN_DAYS,
        }),
      };
    });

    // Detection runs only on a check, so an hourly check can hold a spike back for up to an hour.
    const scheduleDelayNote = computed(() => {
      const secs = anomalyIntervalSeconds(
        Number(scheduleIntervalValue.value),
        String(scheduleIntervalUnit.value),
      );
      if (secs === null || secs < 3600) return undefined;
      return t("alerts.guard.anomalyDelay", {
        every: everyDuration(secs, t),
        duration: durationText(secs, t),
      });
    });

    // No stream context means no value lookup; the picker then takes typed values only.
    const filterDiscovery = useFilterDiscovery(() => {
      const org = store.state.selectedOrganization?.identifier;
      const { stream_name: streamName, stream_type: streamType } = props.config;
      return org && streamName && streamType
        ? { org, streamType: String(streamType), streamName: String(streamName) }
        : null;
    }, t);

    // The parent (AddAlert wizard via useAlertForm) still calls
    // anomalyStep2Ref.validate() to gate Next/Save — drive it through
    // form.handleSubmit() so it runs the schema and flips submissionAttempts
    // so the post-submit errors render.
    const validate = async (): Promise<boolean> => {
      await form.handleSubmit();
      return form.state.isValid;
    };

    return {
      dataNoun,
      raw,
      t,
      store,
      form,
      queryTabOptions,
      detectionFunctions,
      intervalUnits,
      retrainIntervalOptions,
      allStreamFields,
      effectiveKeywords,
      resolveFieldValues,
      effectiveSuggestions,
      filteredStreamFields,
      filteredDetectionFields,
      loadingFields,
      onDetectionFunctionChange,
      filterFields,
      onFiltersChange,
      filterDiscovery,
      validate,
      hasTimestampAlias,
      missingValueColumn,
      hasSqlError,
      queryMode,
      customSql,
      filterRows,
      detectionFunction,
      detectionFunctionField,
      detectionWindowValue,
      trainingWindowDays,
      trainingNote,
      showSqlErrors,
      histogramIntervalError,
      scheduleIntervalError,
      detectionWindowError,
      lookBackWindowHint,
      legacyWindowWarning,
      sensitivityTiers,
      autoSensitivity,
      customSensitivity,
      autoLevelLabel,
      autoLevelValue,
      bandTier,
      onBandTier,
      sensitivityHint,
      budgetMode,
      budgetTiers,
      budgetPeriods,
      budgetTier,
      onBudgetTier,
      sensitivityError,
      sensitivityTooltip,
      streamDays,
      onCustomSqlChange,
      tierShows,
      tiers,
      sensitivityOpened,
      filtersOpen,
      addFilter,
      filterBuilderRef,
      filterGroup,
      openFilters,
      scheduleDelayNote,
    };
  },
});
</script>
