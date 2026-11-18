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
  <div
    :class="[
      'step-alert-conditions mx-auto w-full',
      sectionTargets ? '' : 'rounded-default bg-surface-overlay border-border-default border',
    ]"
  >
    <!-- Section header -->
    <div
      v-if="!sectionTargets"
      class="border-border-default flex items-center border-b px-3 py-2.5"
    >
      <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
      <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">{{
        t("alerts.alertSettings.sectionTitle")
      }}</span>
    </div>

    <!-- The AddAlert orchestrator owns the ONE <OForm> and provides
         FORM_CONTEXT_KEY. The OForm* fields below inject that form and bind by
         nested `name=` (trigger_condition.*, destinations, creates_incident); the
         composed schema in AddAlert.schema.ts validates them on save. -->
    <div :class="sectionTargets ? '' : 'px-3 py-2'">
      <div>
        <Teleport
          v-if="isScheduled && !isForecastMode"
          :to="sectionTargets?.settingsSchedule"
          :disabled="!sectionTargets?.settingsSchedule"
        >
          <!-- Without cron the look-back is the second half of the Check every row the page draws. -->
          <component
            :is="periodInline ? 'div' : 'OSettingRow'"
            ref="periodFieldRef"
            v-bind="periodWrapper"
          >
            <div class="flex w-fit flex-col gap-1" :class="periodInline ? '' : 'me-2'">
              <div class="flex items-center gap-2">
                <span v-if="periodInline" class="text-text-body text-sm">{{
                  t("alerts.form.schedule.lookingAt")
                }}</span>
                <div class="flex items-center gap-2">
                  <div>
                    <OFormInput
                      :aria-label="t('alerts.period')"
                      name="trigger_condition.period"
                      type="number"
                      fit-content
                      class="max-w-32! min-w-16"
                      min="1"
                      :debounce="300"
                      data-test="alert-settings-period-input"
                      @update:model-value="handlePeriodChange"
                    >
                      <!-- Message rendered below at pair width — see periodError. -->
                      <template #error />
                    </OFormInput>
                  </div>
                  <span class="text-text-body text-sm">{{ t("alerts.form.units.minutes") }}</span>
                </div>
              </div>
              <div
                v-if="periodError"
                class="text-input-error-text w-0 min-w-full text-xs"
                data-test="alert-settings-period-error"
                role="alert"
              >
                {{ periodError }}
              </div>
              <div
                v-if="isCron"
                class="text-text-secondary text-xs"
                data-test="alert-settings-period-cron-note"
              >
                {{ t("alerts.form.schedule.cron", { period: fv("trigger_condition.period") }) }}
              </div>
            </div>
          </component>
        </Teleport>

        <Teleport
          v-if="isScheduled || isComposite"
          :to="sectionTargets?.settingsHold"
          :disabled="!sectionTargets?.settingsHold"
        >
          <AlertSentenceRow
            v-if="tierShows('holdFor')"
            ref="pendingPeriodFieldRef"
            :label="t('alerts.form.holdFor.label')"
            data-test="add-alert-hold-for-row"
            removable
            @remove="removeHoldFor"
          >
            <div class="flex flex-col gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <span>{{ t("alerts.form.holdFor.sentence") }}</span>
                <div class="flex items-center gap-2">
                  <OFormInput
                    :aria-label="t('alerts.plain.forAtLeast')"
                    name="_ui.pendingPeriod"
                    type="number"
                    min="0"
                    fit-content
                    class="max-w-32! min-w-16"
                    data-test="alert-settings-pending-period-input"
                    @update:model-value="onPendingPeriodChange"
                  >
                    <template #error />
                  </OFormInput>
                  <OSelect
                    :aria-label="t('common.unitFor', { label: t('alerts.plain.forAtLeast') })"
                    class="w-32!"
                    :model-value="pendingPeriodUnit"
                    :options="pendingPeriodUnitOptions"
                    labelKey="label"
                    valueKey="value"
                    :searchable="false"
                    data-test="alert-settings-pending-period-unit"
                    @update:model-value="onPendingPeriodUnitChange"
                  />
                </div>
              </div>
              <div
                v-if="pendingPeriodError"
                class="text-input-error-text w-0 min-w-full text-xs"
                data-test="alert-settings-pending-period-error"
                role="alert"
              >
                {{ pendingPeriodError }}
              </div>
              <div
                v-if="!pendingPeriodError && pendingPeriodWarning"
                class="text-status-warning-text w-0 min-w-full text-xs"
                data-test="alert-settings-pending-period-warning"
                role="alert"
              >
                {{ pendingPeriodWarning }}
              </div>
            </div>
          </AlertSentenceRow>
        </Teleport>

        <Teleport :to="sectionTargets?.settingsNotify" :disabled="!sectionTargets?.settingsNotify">
          <!-- Destinations. Deliberately NOT name=-bound: one control writes two
             form fields, so both go up through the parent's setFieldValue via
             the events below. -->
          <AlertDestinationsField
            :wrap="!!sectionTargets"
            :setting-row="!!sectionTargets"
            :list="!!sectionTargets"
            ref="destinationsFieldRef"
            :class="sectionTargets ? '' : isScheduled ? 'me-2 mb-4!' : 'mb-4 pb-4'"
            :destinations="destinations"
            :workflows="workflows"
            :destination-options="formattedDestinations"
            :error="destinationsError"
            :notifies-nobody="notifiesNobody"
            :oncall-team="formData?.oncall_team"
            :locked-target-names="formData?._ui?.lockedTargetNames"
            :target-required="destinationRequired"
            show-status
            tooltip=""
            :placeholder="t('alerts.summary.noDestination')"
            @update:destinations="$emit('update:destinations', $event)"
            @update:workflows="$emit('update:workflows', $event)"
            @refresh="$emit('refresh:destinations')"
          />

          <OSettingRow ref="silenceFieldRef" :label="t('alerts.form.remind.label')" fill>
            <div class="me-2 flex w-fit flex-col gap-1">
              <div class="flex items-center gap-2">
                <div>
                  <component :is="formField" v-if="formField" name="trigger_condition.silence">
                    <template #default="{ field }">
                      <OInput
                        :aria-label="t('alerts.form.remind.label')"
                        type="number"
                        fit-content
                        class="max-w-32! min-w-16"
                        min="0"
                        :debounce="isScheduled ? 300 : undefined"
                        :model-value="silence.amount"
                        :error="fieldInvalid(field)"
                        data-test="alert-settings-silence-duration-input"
                        @update:model-value="(v: unknown) => silence.onAmount(v, field)"
                        @blur="field.handleBlur"
                      />
                    </template>
                  </component>
                </div>
                <OSelect
                  :aria-label="t('common.unitFor', { label: t('alerts.form.remind.label') })"
                  class="w-32!"
                  :model-value="silence.unit"
                  :options="silence.options"
                  labelKey="label"
                  valueKey="value"
                  :searchable="false"
                  data-test="alert-settings-silence-unit-select"
                  @update:model-value="silence.onUnit"
                />
              </div>
              <div
                v-if="silenceError"
                class="text-input-error-text w-0 min-w-full text-xs"
                data-test="alert-settings-silence-error"
                role="alert"
              >
                {{ silenceError }}
              </div>
            </div>
          </OSettingRow>
        </Teleport>

        <Teleport
          :to="sectionTargets?.settingsNotifyMore"
          :disabled="!sectionTargets?.settingsNotifyMore"
        >
          <!-- Creates Incident — all alert types, enterprise/cloud with Incidents on -->
          <template v-if="incidentsEnabled && tierShows('createsIncident')">
            <AlertSentenceRow
              v-if="createsIncident && !incidentSwitchOpen"
              :label="t('alerts.form.incident.label')"
              data-test="add-alert-incident-row"
              changeable
              removable
              @change="incidentSwitchOpen = true"
              @remove="removeIncident"
            >
              {{ t("alerts.form.incident.on") }}
            </AlertSentenceRow>
            <OSettingRow
              v-else
              :label="t('alerts.plain.openIncident')"
              :info="t('alerts.alertSettings.createsIncidentTooltip')"
              fill
            >
              <OFormSwitch
                name="creates_incident"
                off-tone="neutral"
                state-text
                :aria-label="t('alerts.alertSettings.createsIncident')"
                data-test="alert-creates-incident-toggle"
              />
            </OSettingRow>

            <template v-if="createsIncident">
              <AlertSentenceRow
                v-if="!incidentTitleOpen"
                data-test="add-alert-incident-title-row"
                changeable
                @change="openIncidentTitle"
              >
                {{ t("alerts.form.incident.titleLabel") }}{{ " "
                }}<strong class="text-text-heading font-semibold">{{
                  incidentTitleTemplate || t("alerts.form.incident.titleDefault")
                }}</strong
                ><template v-if="!incidentTitleTemplate"
                  >{{ " "
                  }}<span class="text-text-secondary">{{
                    t("alerts.form.incident.defaultTag")
                  }}</span></template
                >
              </AlertSentenceRow>
              <OSettingRow
                v-else
                ref="incidentTitleRowRef"
                :label="t('alerts.alertSettings.incidentTitleTemplate')"
                :info="t('alerts.alertSettings.incidentTitleTemplateTooltip')"
                fill
              >
                <div class="flex w-100 flex-col gap-1 max-md:w-full">
                  <OFormInput
                    name="incident_title_template"
                    :placeholder="t('alerts.alertSettings.incidentTitleTemplatePlaceholder')"
                    :debounce="300"
                    data-test="alert-incident-title-template-input"
                  />
                  <div
                    v-if="incidentTitlePreview.length"
                    class="text-xs break-words"
                    data-test="alert-incident-title-preview"
                  >
                    <span class="text-text-secondary me-1"
                      >{{ t("alerts.alertSettings.incidentTitlePreview") }}:</span
                    ><template v-for="(s, i) in incidentTitlePreview" :key="i"
                      ><span :class="segmentClass(s.kind)">{{ s.text }}</span></template
                    >
                  </div>
                  <div v-if="incidentTitlePreview.length" class="text-text-secondary text-xs">
                    {{ t("alerts.alertSettings.incidentTitlePreviewHint") }}
                  </div>
                </div>
              </OSettingRow>
            </template>
          </template>

          <!-- Scheduled only: realtime, composite and anomaly alerts keep no episode, so neither field can act. -->
          <template v-if="isScheduled">
            <OSettingRow
              v-if="tierShows('recovery')"
              :label="t('alerts.plain.notifyOnRecovery')"
              :description="
                notifiesNobody ? undefined : t('alerts.alertSettings.notifyOnRecoveryTooltip')
              "
              fill
            >
              <div class="flex flex-col gap-1">
                <!-- A recovery closes what a firing delivered; with no target nothing is
                   delivered, so it cannot be turned on. It can still be turned off. -->
                <OFormSwitch
                  name="notify_on_recovery"
                  off-tone="neutral"
                  state-text
                  :aria-label="t('alerts.alertSettings.notifyOnRecovery')"
                  :disabled="notifiesNobody && !formData?.notify_on_recovery"
                  data-test="alert-notify-on-recovery-toggle"
                />
                <span
                  v-if="notifiesNobody && !formData?.notify_on_recovery"
                  class="text-text-secondary text-xs"
                  data-test="alert-notify-on-recovery-disabled-reason"
                >
                  {{ t("alerts.alertSettings.notifyOnRecoveryNeedsDestination") }}
                </span>
                <template v-if="formData?.notify_on_recovery && !notifiesNobody">
                  <div
                    v-for="row in recoveryPlan"
                    :key="row.name"
                    class="text-text-secondary text-xs"
                    :data-test="`alert-notify-on-recovery-plan-${row.name}`"
                  >
                    {{ row.name }} — {{ row.action }}
                  </div>
                  <div
                    v-if="hasChatRecovery"
                    class="text-text-secondary text-xs"
                    data-test="alert-notify-on-recovery-hint"
                  >
                    {{ t("alerts.alertSettings.notifyOnRecoveryTemplateHint") }}
                  </div>
                </template>
              </div>
            </OSettingRow>

            <AlertDestinationsField
              :wrap="!!sectionTargets"
              :setting-row="!!sectionTargets"
              v-if="formData?.notify_on_recovery && !notifiesNobody && tierShows('recovery')"
              :class="sectionTargets ? '' : 'me-2 mb-4!'"
              data-test="alert-settings-recovery-destinations"
              :destinations="recoveryDestinations"
              :workflows="[]"
              :destination-options="formattedDestinations"
              :label="t('alerts.alertSettings.recoveryDestinations')"
              :tooltip="t('alerts.alertSettings.recoveryDestinationsTooltip')"
              :supports-workflows="false"
              @update:destinations="$emit('update:recoveryDestinations', $event)"
              @refresh="$emit('refresh:destinations')"
            />

            <!-- The hold delays on-call and incident closure too, not only the message. -->
            <OSettingRow
              v-if="tierShows('keepFiring')"
              ref="keepFiringForFieldRef"
              :label="t('alerts.form.keepFiring.label')"
              :description="t('alerts.form.keepFiring.help')"
              fill
            >
              <div class="flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <div>
                    <component :is="formField" v-if="formField" name="keep_firing_for">
                      <template #default="{ field }">
                        <OInput
                          :aria-label="t('alerts.alertSettings.keepFiringFor')"
                          type="number"
                          fit-content
                          class="max-w-32! min-w-16"
                          min="0"
                          :debounce="300"
                          :model-value="keepFiring.amount"
                          :error="fieldInvalid(field)"
                          data-test="alert-settings-keep-firing-for-input"
                          @update:model-value="(v: unknown) => keepFiring.onAmount(v, field)"
                          @blur="field.handleBlur"
                        />
                      </template>
                    </component>
                  </div>
                  <OSelect
                    :aria-label="
                      t('common.unitFor', { label: t('alerts.alertSettings.keepFiringFor') })
                    "
                    class="w-32!"
                    :model-value="keepFiring.unit"
                    :options="keepFiring.options"
                    labelKey="label"
                    valueKey="value"
                    :searchable="false"
                    data-test="alert-settings-keep-firing-unit-select"
                    @update:model-value="keepFiring.onUnit"
                  />
                </div>
                <div
                  v-if="keepFiringError"
                  class="text-input-error-text w-0 min-w-full text-xs"
                  data-test="alert-settings-keep-firing-error"
                  role="alert"
                >
                  {{ keepFiringError }}
                </div>
              </div>
            </OSettingRow>

            <OSettingRow
              v-if="repeatSuppressionAvailable && tierShows('suppressRepeats')"
              :label="t('alerts.alertSettings.suppressRepeats')"
              :info="t('alerts.alertSettings.suppressRepeatsTooltip')"
              fill
            >
              <OFormSwitch
                name="suppress_repeats"
                off-tone="neutral"
                state-text
                :aria-label="t('alerts.alertSettings.suppressRepeats')"
                data-test="alert-suppress-repeats-toggle"
              />
            </OSettingRow>
          </template>
        </Teleport>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type PropType,
} from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";
import AlertSentenceRow from "@/components/alerts/AlertSentenceRow.vue";
import type { AlertSectionTargets } from "@/components/alerts/alertFormSections";
import { hasDeliveryTarget } from "@/utils/alerts/deliveryTarget";
import {
  ALERT_SETTING_TIERS_KEY,
  useTierVisibility,
} from "@/composables/alerts/useAlertSettingTiers";
import { ALERT_SUGGESTIONS_KEY } from "@/composables/alerts/useAlertSuggestions";
import { fromBase, pickUnit, toBase, type DurationUnit } from "@/utils/alerts/durationUnits";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import { renderTemplate, segmentClass } from "@/composables/alerts/useTemplatePreview";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { visibleFieldError } from "@/lib/forms/Form/fieldError";
import { shownFieldError } from "@/composables/alerts/shownFieldError";
import { convertMinutesToCron, getCronIntervalDifferenceInSeconds } from "@/utils/zincutils";

export default defineComponent({
  name: "Step3AlertConditions",
  components: {
    OFormInput,
    OInput,
    OFormSwitch,
    OSelect,
    OSettingRow,
    AlertDestinationsField,
    AlertSentenceRow,
  },
  props: {
    // Opt-in: the sectioned alert editor renders each slice of these settings in its own section.
    sectionTargets: {
      type: Object as PropType<AlertSectionTargets | null>,
      default: null,
    },
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    isRealTime: {
      type: String,
      default: "false",
    },
    // Passed by the parent but not consumed here (kept to avoid attr fallthrough).
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
    // Enterprise-only: workflow ids linked to this alert. Read-view off the ONE
    // form (AddAlert passes `formData.workflows`); writes go back up through
    // `update:workflows` → the parent's setFieldValue, never mutated here.
    workflows: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    // The parent refuses to save without a target (an AutoObserve draft), so the hint must not call it optional.
    destinationRequired: {
      type: Boolean,
      default: false,
    },
    formattedDestinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    // The org's destination OBJECTS (`destinations` above holds only the
    // selected names). Read-only here — the recovery list needs each selected
    // destination's platform, which lives on the object.
    destinationObjects: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    // Empty = the recovery follows the firing's destinations.
    recoveryDestinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: [
    "update:trigger",
    "update:aggregation",
    "update:isAggregationEnabled",
    "update:destinations",
    "update:recoveryDestinations",
    "refresh:destinations",
    "update:workflows",
    "update:promqlCondition",
  ],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    // Same gate as the Incidents menu: enterprise/cloud build AND the backend
    // /config flag. `=== true` keeps it hidden while /config is still loading.
    const incidentsEnabled = computed(
      () =>
        (config.isEnterprise === "true" || config.isCloud === "true") &&
        store.state.zoConfig?.incidents_enabled === true,
    );
    // The backend honours the switch only in enterprise builds.
    const repeatSuppressionAvailable = config.isEnterprise === "true" || config.isCloud === "true";

    // Field refs consumed by the parent's AlertFocusManager (registered off the
    // step ref). Scheduled-only.
    const periodFieldRef = ref<any>(null);
    const silenceFieldRef = ref<any>(null);
    const destinationsFieldRef = ref<any>(null);
    const pendingPeriodFieldRef = ref<any>(null);
    const keepFiringForFieldRef = ref<HTMLElement | null>(null);

    // Period / silence are composite "number + Minutes addon" fields: a 5.4rem
    // OFormInput glued to a unit block. OFormInput renders its message INSIDE
    // that narrow width, wrapping it into a ragged column and growing the field,
    // which pushes the addon out of line. Empty #error slot suppresses the inline
    // text (the field keeps its red border) and we render the message in a
    // full-width sibling below the pair. Reads the same R3-timed field errors
    // OFormInput would have surfaced — single source of truth, wider display.
    const form: any = inject(FORM_CONTEXT_KEY, null);
    const fieldError = (path: string) => shownFieldError(form, path);
    const periodError = fieldError("trigger_condition.period");
    const silenceError = fieldError("trigger_condition.silence");
    // AlertDestinationsField is not an OForm* wrapper, so it cannot render its own schema error.
    const destinationsError = fieldError("destinations");
    const notifiesNobody = computed(
      () =>
        !hasDeliveryTarget({
          destinations: props.destinations,
          workflows: props.workflows,
          oncall_team: props.formData?.oncall_team,
        }),
    );
    const pendingPeriodError = fieldError("_ui.pendingPeriod");
    // Forecast mode fixes the period and reads its own history window, so a period field would only compete with it.
    const isForecastMode = form
      ? form.useStore((s: any) => !!s.values?._ui?.forecast)
      : computed(() => false);

    // General field get/set — same shape as QueryConfig's `fv`/`setFV`: a
    // reactive snapshot registers the dependency, the synchronous
    // `getFieldValue` read stays fresh (same-tick read-after-write).
    const formValuesSnapshot: any = form?.useStore?.((s: any) => s.values);
    const fv = (name: string): any => {
      void formValuesSnapshot?.value;
      return form?.getFieldValue?.(name);
    };
    const setFV = (name: string, value: any): void => {
      form?.setFieldValue?.(name, value);
    };

    // Pending period — TWO values, same split as QueryConfig's Check every:
    //   • pendingPeriodUnit + `_ui.pendingPeriod` → the DISPLAY unit/value.
    //   • `pending_period_sec` (misnomer kept for wire compatibility) → the
    //     STORED value, ALWAYS MINUTES, same convention frequency uses. Only
    //     alertPayload.ts's existing ×60 conversion ever turns it into real
    //     seconds, so keeping it minutes here means that conversion — and the
    //     composite hand-built payload's own ×60 — need no changes.
    // Initial unit mirrors useAlertForm's `pendingPeriodDisplay`: independently
    // derived from props here (not shared code), matching how QueryConfig's
    // `frequencyMode` and useAlertForm's `frequencyDisplay` stay independent.
    const initialPendingPeriodRaw = Number(props.formData?.pending_period_sec ?? 0);
    const initialPendingPeriodUnit: "minutes" | "hours" =
      initialPendingPeriodRaw >= 60 && initialPendingPeriodRaw % 60 === 0 ? "hours" : "minutes";
    const pendingPeriodUnit = ref<"minutes" | "hours">(initialPendingPeriodUnit);

    const pendingPeriodUnitOptions = computed(() => [
      { label: t("alerts.form.units.minutes"), value: "minutes" },
      { label: t("alerts.form.units.hours"), value: "hours" },
    ]);

    /** Bridge DISPLAY → STORED MINUTES. The single writer of
     *  `pending_period_sec` in this component. */
    const setStoredPendingPeriod = (display: number | null): void => {
      const mins =
        display == null || Number.isNaN(display)
          ? 0
          : pendingPeriodUnit.value === "hours"
            ? display * 60
            : display;
      setFV("pending_period_sec", mins);
    };

    const onPendingPeriodChange = (value: any) => {
      const parsed = value === "" || value === null || value === undefined ? null : Number(value);
      setStoredPendingPeriod(parsed);
    };

    const onPendingPeriodUnitChange = (modelValue: SelectModelValue) => {
      const unit = typeof modelValue === "string" ? modelValue : "";
      const prevUnit = pendingPeriodUnit.value;
      pendingPeriodUnit.value = unit as "minutes" | "hours";
      if (unit === prevUnit) return;

      const currentDisplay = Number(fv("_ui.pendingPeriod")) || 0;
      if (unit === "hours" && prevUnit === "minutes") {
        const hrs = currentDisplay / 60;
        setFV("_ui.pendingPeriod", hrs);
        setStoredPendingPeriod(hrs);
      } else if (unit === "minutes" && prevUnit === "hours") {
        const mins = currentDisplay * 60;
        setFV("_ui.pendingPeriod", mins);
        setStoredPendingPeriod(mins);
      }
    };

    // Not-a-multiple-of-Check-every hint, moved here from QueryConfig.vue.
    // Purely presentational — never blocks save, the backend doesn't enforce
    // this relationship either (a non-multiple value just rounds up to the
    // next evaluation). Scheduled-only: composite has no per-alert frequency
    // to compare against (§2b), so it returns "" unconditionally.
    const frequencyMinutes = (): number => {
      if (fv("trigger_condition.frequency_type") !== "cron")
        return Number(fv("trigger_condition.frequency"));
      const cronExpression = fv("trigger_condition.cron");
      if (!cronExpression) return NaN;
      try {
        return getCronIntervalDifferenceInSeconds(cronExpression) / 60;
      } catch {
        return NaN;
      }
    };

    const pendingPeriodWarning = computed<string>(() => {
      if (props.isRealTime !== "false") return "";
      const pendingMinutes = Number(fv("pending_period_sec"));
      if (!Number.isFinite(pendingMinutes) || pendingMinutes <= 0) return "";

      const freqMinutes = frequencyMinutes();
      if (!Number.isFinite(freqMinutes) || freqMinutes <= 0) return "";

      // Float-safe "is a multiple of" — see QueryConfig's original comment:
      // a cron interval can be fractional minutes, where exact `%` comparisons
      // can miss by floating-point dust at either edge of the wrap.
      const remainder = pendingMinutes % freqMinutes;
      const EPSILON = 1e-6;
      if (remainder < EPSILON || freqMinutes - remainder < EPSILON) return "";
      return t("alerts.validation.pendingPeriodNotMultiple", {
        minutes: Math.round(freqMinutes * 100) / 100,
      });
    });

    // ── Workflows (enterprise/cloud only) ────────────────────────────────────
    const getBrowserTimezone = (): string => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    };

    // Baseline the linked fields are measured against; re-taken whenever the period changes from outside the handler.
    let baselinePeriod = Number(props.formData?.trigger_condition?.period);
    let lastHandledPeriod: unknown;
    let followedFrequency: number | null = null;
    let followedSilence: number | null = null;
    // Runs after the handler (pre-flush), so a user edit is recognised by lastHandledPeriod and kept as ours.
    watch(
      () => props.formData?.trigger_condition?.period,
      (period) => {
        if (String(period) === String(lastHandledPeriod)) return;
        baselinePeriod = Number(period);
        followedFrequency = null;
        followedSilence = null;
      },
    );
    // A baseline taken while the period was unset is not finite and leaves nothing to compare, so the field still follows.
    const isLinked = (value: unknown, followed: number) =>
      !Number.isFinite(followed) ||
      value === undefined ||
      value === null ||
      value === "" ||
      Number(value) === followed;

    // Check every / Quiet after alerting follow the period only while still linked, so user-set and saved values survive.
    const handlePeriodChange = (val: unknown) => {
      const periodValue = Number(val);
      // Spread the FRESH form value, not `props.formData.trigger_condition`.
      // The prop is a `form.useStore` read-view that only refreshes on the next
      // render, and the parent's @update:trigger handler is a WHOLE-OBJECT
      // `setFieldValue("trigger_condition", …)` — so spreading the stale prop
      // round-trips a pre-write snapshot and silently clobbers any field written
      // earlier in the same tick.
      const currentTrigger =
        form?.getFieldValue?.("trigger_condition") ?? props.formData.trigger_condition;
      const nextTrigger: Record<string, any> = {
        ...currentTrigger,
        period: val,
      };
      lastHandledPeriod = val;
      const minFrequency = Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60) || 10;
      // A new alert's default frequency is raised to the refresh floor, so that raised value is still linked.
      followedFrequency ??= Math.max(baselinePeriod, minFrequency);
      followedSilence ??= baselinePeriod;
      if (periodValue && periodValue > 0) {
        if (periodValue >= minFrequency && isLinked(nextTrigger.frequency, followedFrequency)) {
          nextTrigger.frequency = periodValue;
          followedFrequency = periodValue;
        }
        // A cron schedule the user wrote is what runs the alert, so the period must not replace it.
        if (nextTrigger.frequency_type !== "cron")
          nextTrigger.cron = convertMinutesToCron(periodValue);
        if (!nextTrigger.timezone) nextTrigger.timezone = getBrowserTimezone();
        if (isLinked(nextTrigger.silence, followedSilence)) {
          nextTrigger.silence = periodValue;
          followedSilence = periodValue;
        }
      }
      emit("update:trigger", nextTrigger);
    };

    // ── Recovery ────────────────────────────────────────────────────────────
    // Platform destinations are resolved by the server itself (it closes the
    // incident/alert it opened); everything else gets an ordinary rendered
    // message, so only those still depend on the user's template.
    const { detectPrebuiltType } = usePrebuiltDestinations();
    const platformRecoveryKeys: Record<string, I18nKey> = {
      pagerduty: "alerts.alertSettings.recoveryResolvesIncident",
      opsgenie: "alerts.alertSettings.recoveryClosesAlert",
      servicenow: "alerts.alertSettings.recoveryResolvesIncident",
    };

    const platformOf = (destination: any): string => detectPrebuiltType(destination) ?? "";

    const platformKeyFor = (name: any): string | undefined => {
      const destination = props.destinationObjects.find((d: any) => d?.name === name);
      return destination ? platformRecoveryKeys[platformOf(destination)] : undefined;
    };

    const isJira = (name: any): boolean => {
      const destination = props.destinationObjects.find((d: any) => d?.name === name);
      return !!destination && platformOf(destination) === "jira";
    };

    // Jira keeps one ticket per alert, so its recovery is a comment there, not a new message.
    const messageKeyFor = (name: any): I18nKey =>
      isJira(name)
        ? "alerts.alertSettings.recoveryJiraComment"
        : "alerts.alertSettings.recoveryChatMessage";

    // Ticket closes always go to the firing's own destinations; only the message can be
    // redirected, so an override lists both halves rather than replacing the first.
    const recoveryPlan = computed(() => {
      const redirected = props.recoveryDestinations.length > 0;
      const rows = props.destinations
        .filter((name: any) => !redirected || platformKeyFor(name))
        .map((name: any) => {
          const platformKey = platformKeyFor(name);
          return {
            name: String(name),
            isPlatform: !!platformKey || isJira(name),
            action: t(platformKey ?? messageKeyFor(name)),
          };
        });
      if (!redirected) return rows;
      return rows.concat(
        props.recoveryDestinations.map((name: any) => ({
          name: String(name),
          isPlatform: isJira(name),
          action: t(messageKeyFor(name)),
        })),
      );
    });
    const hasChatRecovery = computed(() => recoveryPlan.value.some((row) => !row.isPlatform));

    // Row and group-by values exist only at fire time, so their placeholders stay as chips.
    const incidentTitlePreview = computed(() => {
      const template = props.formData?.incident_title_template?.trim();
      if (!template) return [];
      const live: Record<string, string> = {};
      for (const attr of props.formData?.context_attributes ?? []) {
        if (attr?.key) live[attr.key] = String(attr.value ?? "");
      }
      const alertFields: Record<string, unknown> = {
        alert_name: props.formData?.name,
        stream_name: props.formData?.stream_name,
        stream_type: props.formData?.stream_type,
        org_name: store.state.selectedOrganization?.label,
      };
      for (const [key, value] of Object.entries(alertFields)) {
        if (value) live[key] = String(value);
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const sample = {
        alert_time: now,
        alert_trigger_time_str: now,
        alert_start_time: now,
        alert_end_time: now,
      };
      return renderTemplate(template, { live, sample });
    });

    const tierShows = useTierVisibility();
    const tiers = inject(ALERT_SETTING_TIERS_KEY, null);
    const suggestions = inject(ALERT_SUGGESTIONS_KEY, null);

    const isScheduled = computed(() => props.isRealTime === "false");
    const isComposite = computed(() => props.isRealTime === "composite");
    const isCron = computed(() => fv("trigger_condition.frequency_type") === "cron");
    const periodInline = computed(() => !!props.sectionTargets?.settingsSchedule && !isCron.value);
    const periodWrapper = computed(() =>
      periodInline.value
        ? { class: "flex", "data-test": "alert-settings-period-inline" }
        : {
            label: t("alerts.form.schedule.lookingAtRow"),
            required: true,
            fill: true,
            "data-test": "alert-settings-period-row",
          },
    );

    // ── Typed interval + unit ───────────────────────────────────────────────
    const formField = form?.Field ?? null;
    const fieldInvalid = (field: any): boolean =>
      form ? visibleFieldError(form, field).invalid : false;
    const UNIT_LABEL: Record<DurationUnit, I18nKey> = {
      seconds: "alerts.form.units.seconds",
      min: "alerts.form.units.min",
      h: "alerts.form.units.h",
    };
    const isNumber = (v: unknown) =>
      v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));

    // The unit only changes how the stored value reads; the field keeps its own unit.
    const useDurationField = (
      name: string,
      base: "seconds" | "min",
      units: readonly DurationUnit[],
    ) => {
      const stored = computed(() => fv(name));
      const unitFor = (v: unknown) => pickUnit(isNumber(v) ? Number(v) : 0, base, units).unit;
      const unit = ref<DurationUnit>(unitFor(stored.value));
      const draft = ref<unknown>(null);
      let written: unknown = stored.value;
      // A value written from outside (a load, a suggestion, the period cascade) reads in its own best unit.
      watch(stored, (next) => {
        if (next === written) return;
        written = next;
        draft.value = null;
        unit.value = unitFor(next);
      });
      const amount = computed(() => {
        if (draft.value !== null) return draft.value;
        return isNumber(stored.value)
          ? fromBase(Number(stored.value), unit.value, base)
          : stored.value;
      });
      const onAmount = (value: unknown, field: { handleChange: (v: unknown) => void }) => {
        draft.value = value;
        written = isNumber(value) ? toBase(Number(value), unit.value, base) : value;
        field.handleChange(written);
      };
      const onUnit = (value: SelectModelValue) => {
        const next = units.find((u) => u === value);
        if (!next) return;
        unit.value = next;
        draft.value = null;
      };
      const options = computed(() => units.map((u) => ({ label: t(UNIT_LABEL[u]), value: u })));
      return reactive({ unit, amount, onAmount, onUnit, options });
    };
    const silence = useDurationField("trigger_condition.silence", "min", ["min", "h"]);
    const keepFiring = useDurationField("keep_firing_for", "seconds", ["seconds", "min", "h"]);
    const keepFiringError = fieldError("keep_firing_for");

    // ── Sentence rows ───────────────────────────────────────────────────────
    const createsIncident = computed(() => fv("creates_incident") === true);
    const incidentTitleTemplate = computed(() =>
      String(fv("incident_title_template") ?? "").trim(),
    );
    const incidentSwitchOpen = ref(false);
    const incidentTitleOpen = ref(false);
    const incidentTitleRowRef = ref<any>(null);

    const removeIncident = () => {
      setFV("creates_incident", false);
      incidentSwitchOpen.value = false;
      incidentTitleOpen.value = false;
      tiers?.conceal("createsIncident");
    };
    const openIncidentTitle = async () => {
      incidentTitleOpen.value = true;
      await nextTick();
      const root: HTMLElement | undefined = incidentTitleRowRef.value?.$el;
      root?.querySelector<HTMLElement>("input")?.focus();
    };

    const setPendingPeriodMinutes = (minutes: number) => {
      pendingPeriodUnit.value = "minutes";
      setFV("_ui.pendingPeriod", minutes);
      setFV("pending_period_sec", minutes);
    };
    const removeHoldFor = () => {
      setPendingPeriodMinutes(0);
      tiers?.conceal("holdFor");
    };

    const checkMinutes = () => {
      const minutes = frequencyMinutes();
      return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    };
    // Suggestions name two checks' worth of time, so their Add writes the same span.
    const twoChecksMinutes = () => 2 * checkMinutes();
    // An added row starts at one check: 0 would read as a value, yet it means the setting is off.
    watch(
      () => [tiers?.isRevealed("holdFor"), tiers?.isRevealed("keepFiring")] as const,
      ([hold, keep], [heldBefore, keptBefore]) => {
        if (hold && !heldBefore && !(Number(fv("pending_period_sec")) > 0))
          setPendingPeriodMinutes(checkMinutes());
        if (keep && !keptBefore && !(Number(fv("keep_firing_for")) > 0))
          setFV("keep_firing_for", checkMinutes() * 60);
      },
    );
    const unregister = suggestions
      ? [
          suggestions.onApply("recovery", () => setFV("notify_on_recovery", true)),
          suggestions.onApply("keepFiring", () =>
            setFV("keep_firing_for", twoChecksMinutes() * 60),
          ),
          suggestions.onApply("holdFor", () => setPendingPeriodMinutes(twoChecksMinutes())),
        ]
      : [];
    onBeforeUnmount(() => unregister.forEach((off) => off()));
    // Section 3 stacks up to ten rows, so its rows sit closer than a bare row's default.

    return {
      tierShows,
      fv,
      isScheduled,
      isComposite,
      isCron,
      periodInline,
      periodWrapper,
      formField,
      fieldInvalid,
      silence,
      keepFiring,
      keepFiringError,
      createsIncident,
      incidentTitleTemplate,
      incidentSwitchOpen,
      incidentTitleOpen,
      incidentTitleRowRef,
      removeIncident,
      openIncidentTitle,
      removeHoldFor,
      incidentTitlePreview,
      segmentClass,
      recoveryPlan,
      hasChatRecovery,
      t,
      store,
      incidentsEnabled,
      repeatSuppressionAvailable,
      handlePeriodChange,
      // Field refs for the parent focus manager
      periodFieldRef,
      silenceFieldRef,
      destinationsFieldRef,
      pendingPeriodFieldRef,
      keepFiringForFieldRef,
      periodError,
      isForecastMode,
      silenceError,
      destinationsError,
      notifiesNobody,
      pendingPeriodError,
      pendingPeriodWarning,
      pendingPeriodUnit,
      pendingPeriodUnitOptions,
      onPendingPeriodChange,
      onPendingPeriodUnitChange,
    };
  },
});
</script>
