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
            <div class="flex w-fit max-w-full flex-col gap-1" :class="periodInline ? '' : 'pe-2'">
              <div class="flex flex-wrap items-center gap-2">
                <span v-if="periodInline" class="text-text-body text-sm">{{
                  t("alerts.form.schedule.lookingAt")
                }}</span>
                <div class="flex min-w-0 items-center gap-2">
                  <div class="min-w-0">
                    <OFormInput
                      :aria-label="t('alerts.form.names.lookBack')"
                      name="trigger_condition.period"
                      type="number"
                      fit-content
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
              <AlertLinkNote
                v-if="!periodInline && scheduleNote"
                :text="scheduleNote.text"
                :action="scheduleNote.action"
                :separated="scheduleNote.separated"
                data-test="alert-settings-check-every-link"
                @action="scheduleNote.run"
              />
            </div>
          </component>
          <template v-if="periodInline">
            <AlertLinkNote
              v-if="scheduleNote"
              class="basis-full"
              :text="scheduleNote.text"
              :action="scheduleNote.action"
              :separated="scheduleNote.separated"
              data-test="alert-settings-check-every-link"
              @action="scheduleNote.run"
            />
            <p v-else class="m-0 min-h-4 basis-full" aria-hidden="true" />
          </template>
        </Teleport>

        <Teleport
          v-if="isScheduled || isComposite"
          :to="sectionTargets?.settingsHold"
          :disabled="!sectionTargets?.settingsHold"
        >
          <AlertTierPlace id="holdFor">
            <AlertSentenceRow
              v-if="tierShows('holdFor')"
              ref="pendingPeriodFieldRef"
              :label="t('alerts.form.holdFor.label')"
              :description="t('alerts.form.holdFor.help')"
              data-test="add-alert-hold-for-row"
              removable
              @remove="removeHoldFor"
            >
              <div class="flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span>{{ t("alerts.form.holdFor.sentence") }}</span>
                  <div class="flex min-w-0 items-center gap-2">
                    <component :is="formField" v-if="formField" name="_ui.pendingPeriod">
                      <template #default="{ field }">
                        <OInput
                          :aria-label="t('alerts.plain.forAtLeast')"
                          type="number"
                          min="0"
                          fit-content
                          :model-value="holdAmount(field.state.value)"
                          :placeholder="t('common.off')"
                          :error="fieldInvalid(field)"
                          data-test="alert-settings-pending-period-input"
                          @update:model-value="(v: unknown) => onHoldAmount(v, field)"
                          @blur="field.handleBlur"
                        />
                      </template>
                    </component>
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
                <AlertLinkNote
                  v-if="!pendingPeriodError && pendingPeriodWarning"
                  class="w-0 min-w-full"
                  :text="pendingPeriodWarning.text"
                  :action="pendingPeriodWarning.action"
                  warning
                  data-test="alert-settings-pending-period-warning"
                  @action="pendingPeriodWarning.run"
                />
                <AlertLinkNote
                  v-else-if="!pendingPeriodError && holdWindowNote"
                  class="w-0 min-w-full"
                  :text="holdWindowNote.text"
                  :action="holdWindowNote.action"
                  :warning="holdWindowNote.warning"
                  data-test="alert-settings-hold-window"
                  @action="setPendingPeriodMinutes(0)"
                />
              </div>
            </AlertSentenceRow>
          </AlertTierPlace>
          <AlertLinkNote
            v-if="breachWarning"
            :text="breachWarning.text"
            :action="breachWarning.action"
            warning
            data-test="alert-settings-breach-warning"
            @action="breachWarning.run"
          />
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
            :destination-details="destinationDetails"
            @update:destinations="$emit('update:destinations', $event)"
            @update:workflows="$emit('update:workflows', $event)"
            @refresh="$emit('refresh:destinations')"
          />

          <OSettingRow
            ref="silenceFieldRef"
            :label="t('alerts.form.remind.label')"
            :description="
              isRealTime === 'true' ? t('alerts.form.remind.realtimeHelp') : notifyLines.remind
            "
            fill
          >
            <div class="flex w-fit max-w-full flex-col gap-1 pe-2">
              <div class="flex items-center gap-2">
                <div class="min-w-0">
                  <component :is="formField" v-if="formField" name="trigger_condition.silence">
                    <template #default="{ field }">
                      <OInput
                        :aria-label="t('alerts.form.remind.label')"
                        type="number"
                        fit-content
                        min="0"
                        :debounce="isScheduled ? 300 : undefined"
                        :model-value="silence.amount"
                        :error="fieldInvalid(field)"
                        data-test="alert-settings-silence-duration-input"
                        @update:model-value="(v: unknown) => onSilenceAmount(v, field)"
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
              <template v-else-if="isScheduled">
                <AlertLinkNote
                  v-if="silenceHint"
                  :text="silenceHint.text"
                  :action="silenceHint.action"
                  warning
                  data-test="alert-settings-silence-hint"
                  @action="silenceHint.run"
                />
                <p v-else class="m-0 min-h-4" aria-hidden="true" />
              </template>
            </div>
          </OSettingRow>
        </Teleport>

        <Teleport
          :to="sectionTargets?.settingsNotifyMore"
          :disabled="!sectionTargets?.settingsNotifyMore"
        >
          <!-- Creates Incident — all alert types, enterprise/cloud with Incidents on -->
          <AlertTierPlace id="createsIncident">
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
                :description="t('alerts.alertSettings.createsIncidentHelp')"
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
          </AlertTierPlace>

          <!-- Scheduled only: realtime, composite and anomaly alerts keep no episode, so neither field can act. -->
          <template v-if="isScheduled">
            <AlertTierPlace id="recovery">
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
            </AlertTierPlace>

            <AlertTierPlace id="recovery">
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
                :destination-details="destinationDetails"
                @update:destinations="$emit('update:recoveryDestinations', $event)"
                @refresh="$emit('refresh:destinations')"
              />
            </AlertTierPlace>

            <!-- The hold delays on-call and incident closure too, not only the message. -->
            <AlertTierPlace id="keepFiring">
              <OSettingRow
                v-if="tierShows('keepFiring')"
                ref="keepFiringForFieldRef"
                :label="t('alerts.form.keepFiring.label')"
                :description="t('alerts.form.keepFiring.help')"
                fill
              >
                <div class="flex flex-col gap-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="min-w-0">
                      <component :is="formField" v-if="formField" name="keep_firing_for">
                        <template #default="{ field }">
                          <OInput
                            :aria-label="t('alerts.alertSettings.keepFiringFor')"
                            type="number"
                            fit-content
                            min="0"
                            :debounce="300"
                            :model-value="keepFiring.amount"
                            :placeholder="t('common.off')"
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
            </AlertTierPlace>

            <AlertTierPlace id="suppressRepeats">
              <OSettingRow
                v-if="repeatSuppressionAvailable && tierShows('suppressRepeats')"
                :label="t('alerts.alertSettings.suppressRepeats')"
                :description="notifyLines.suppress"
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
            </AlertTierPlace>
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
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
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
import AlertTierPlace from "@/components/alerts/AlertTierPlace.vue";
import AlertLinkNote from "@/components/alerts/AlertLinkNote.vue";
import { describeDestinations } from "@/utils/alerts/destinationDescription";
import { durationWords, everyWords, notifyHelp } from "@/utils/alerts/alertCopy";
import {
  crossesOnlyWhenEverySampleDoes,
  finerCheckMinutes,
  missedBreachMinutes,
} from "@/utils/alerts/checkCadence";
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
import { getCronIntervalDifferenceInSeconds } from "@/utils/zincutils";
import { useLookBackLink, type LinkedField } from "@/composables/alerts/useLookBackLink";

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
    AlertTierPlace,
    AlertLinkNote,
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
    const destinationDetails = computed(() => describeDestinations(props.destinationObjects, t));
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
    // 0 means Must last is off: the field reads empty with an "Off" placeholder until typed into.
    const holdDraft = ref<string | number | null>(null);
    const holdAmount = (value: unknown): string | number => {
      if (holdDraft.value !== null) return holdDraft.value;
      return Number(value) === 0 || value === null || value === undefined
        ? ""
        : (value as string | number);
    };
    const onHoldAmount = (value: unknown, field: { handleChange: (v: unknown) => void }) => {
      holdDraft.value = value as string | number;
      field.handleChange(value);
      onPendingPeriodChange(value);
    };

    const onPendingPeriodUnitChange = (modelValue: SelectModelValue) => {
      const unit = typeof modelValue === "string" ? modelValue : "";
      const prevUnit = pendingPeriodUnit.value;
      pendingPeriodUnit.value = unit as "minutes" | "hours";
      if (unit === prevUnit) return;
      holdDraft.value = null;

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

    const pendingPeriodWarning = computed<LinkNote | null>(() => {
      if (props.isRealTime !== "false") return null;
      const pendingMinutes = Number(fv("pending_period_sec"));
      if (!Number.isFinite(pendingMinutes) || pendingMinutes <= 0) return null;

      const freqMinutes = frequencyMinutes();
      if (!Number.isFinite(freqMinutes) || freqMinutes <= 0) return null;
      // The scheduler fires on the next check after Pending, so a span of one interval is never sampled in between.
      if (pendingMinutes <= freqMinutes) {
        const fix = isCron.value ? checkEveryFix(undefined) : checkEveryFix(pendingMinutes);
        const every = everyWords(freqMinutes, t);
        return {
          text: fix
            ? t("alerts.guard.mustLastOneCheckFix", { every })
            : t("alerts.guard.mustLastOneCheck", { every }),
          ...fix,
        };
      }

      // Float-safe "is a multiple of" — see QueryConfig's original comment:
      // a cron interval can be fractional minutes, where exact `%` comparisons
      // can miss by floating-point dust at either edge of the wrap.
      const remainder = pendingMinutes % freqMinutes;
      const EPSILON = 1e-6;
      if (remainder < EPSILON || freqMinutes - remainder < EPSILON) return null;
      return {
        text: t("alerts.validation.pendingPeriodNotMultiple", {
          minutes: Math.round(freqMinutes * 100) / 100,
        }),
        action: null,
        separated: false,
        run: () => {},
      };
    });

    // A lowest (or highest) value must cross the threshold over a whole window, so a breach that
    // straddles two non-overlapping checks is seen by neither.
    const breachWarning = computed<LinkNote | null>(() => {
      if (!isScheduled.value || isCron.value) return null;
      const query = fv("query_condition") ?? {};
      if ((query.type ?? "custom") !== "custom" || !query.aggregation) return null;
      const period = Number(fv("trigger_condition.period"));
      const missed = missedBreachMinutes({
        fn: query.aggregation.function,
        operator: query.aggregation.having?.operator,
        period,
        frequency: frequencyMinutes(),
      });
      if (missed === undefined) return null;
      return {
        text: t("alerts.guard.breachUnseen", { duration: durationWords(missed, t) }),
        ...checkEveryFix(period),
      };
    });

    // "Stays above for N minutes" is one path: a lowest value over the window already says it, so
    // Must last either is not needed or adds its own wait on top.
    const holdWindowNote = computed(() => {
      if (!isScheduled.value) return null;
      const query = fv("query_condition") ?? {};
      const aggregation = query.aggregation;
      if ((query.type ?? "custom") !== "custom" || !aggregation) return null;
      if (!crossesOnlyWhenEverySampleDoes(aggregation.function, aggregation.having?.operator))
        return null;
      const window = Number(fv("trigger_condition.period"));
      if (!(window > 0)) return null;
      const pending = Number(fv("pending_period_sec")) || 0;
      const words = { fn: raw(aggregation.function), window: durationWords(window, t) };
      return pending > 0
        ? {
            text: t("alerts.form.holdFor.windowStacks", {
              ...words,
              total: durationWords(window + pending, t),
            }),
            action: t("alerts.form.holdFor.turnOff"),
            warning: true,
          }
        : { text: t("alerts.form.holdFor.windowCovers", words), action: null, warning: false };
    });

    // The schema's floor: none when the org sets no minimum refresh interval.
    const minFrequency = () =>
      Math.ceil(Number(store.state?.zoConfig?.min_auto_refresh_interval) / 60) || 1;
    // Spread the FRESH form value, not `props.formData.trigger_condition`: the prop refreshes
    // only on the next render, and the parent writes back the whole trigger object.
    const lookBack = useLookBackLink({
      trigger: () => fv("trigger_condition") ?? props.formData?.trigger_condition ?? {},
      period: () => props.formData?.trigger_condition?.period,
      frequency: () => fv("trigger_condition.frequency"),
      formSeed: () => fv("query_condition"),
      minFrequency,
      emit: (trigger) => emit("update:trigger", trigger),
    });
    const { handlePeriodChange } = lookBack;
    // Checking more often never moves the look back, since that is the window the condition reads.
    const checkEveryFix = (spanMinutes: number | undefined) => {
      const minutes = spanMinutes ? finerCheckMinutes(spanMinutes, minFrequency()) : undefined;
      if (!minutes) return { action: null, separated: false, run: () => {} };
      return {
        action: t("alerts.guard.checkEvery", { every: everyWords(minutes, t) }),
        separated: false,
        run: () => lookBack.setCheckEvery(minutes),
      };
    };
    const LINKED_LABEL: Record<LinkedField, I18nKey> = {
      period: "alerts.form.names.lookBack",
      frequency: "alerts.queryConfig.checkEvery",
    };
    interface LinkNote {
      text: I18nText | null;
      action: I18nText | null;
      separated: boolean;
      run: () => void;
    }
    // Null while the look back is empty or a cron runs the alert: there is nothing to link.
    const scheduleNote = computed<LinkNote | null>(() => {
      const move = lookBack.lastMove.value;
      if (move)
        return {
          text: t("alerts.form.link.alsoSet", {
            fields: t(LINKED_LABEL[move.field]),
            duration: durationWords(move.value, t),
          }),
          action: t("alerts.form.link.undo"),
          separated: false,
          run: lookBack.undo,
        };
      if (isCron.value || !(Number(fv("trigger_condition.period")) > 0)) return null;
      return lookBack.isLinked()
        ? {
            text: t("alerts.form.link.linked"),
            action: t("alerts.form.link.unlink"),
            separated: true,
            run: lookBack.unlink,
          }
        : {
            text: t("alerts.form.link.separate"),
            action: t("alerts.form.link.link"),
            separated: true,
            run: lookBack.relink,
          };
    });
    const notifyLines = computed(() => notifyHelp(fv("query_condition"), t));
    // A wait shorter than the checks never holds a notification back, so it says so instead of moving it.
    const silenceHint = computed<LinkNote | null>(() => {
      const checkMinutes = frequencyMinutes();
      const silenceMinutes = Number(fv("trigger_condition.silence"));
      if (!(silenceMinutes > 0) || !(checkMinutes > silenceMinutes)) return null;
      const minutes = Math.ceil(checkMinutes);
      return {
        text: t("alerts.form.remind.noEffect", { every: everyWords(minutes, t) }),
        action: t("alerts.form.remind.matchChecks", { duration: durationWords(minutes, t) }),
        separated: false,
        run: () => setFV("trigger_condition.silence", minutes),
      };
    });

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
        ? { class: "flex min-w-0", "data-test": "alert-settings-period-inline" }
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
    // `offUnit`: 0 means the setting is off, so it reads as an empty "Off" field in that unit.
    const useDurationField = (
      name: string,
      base: "seconds" | "min",
      units: readonly DurationUnit[],
      offUnit?: DurationUnit,
    ) => {
      const stored = computed(() => fv(name));
      const isOff = (v: unknown) => offUnit !== undefined && !(Number(v) > 0) && !(Number(v) < 0);
      const unitFor = (v: unknown) =>
        isOff(v) ? offUnit! : pickUnit(isNumber(v) ? Number(v) : 0, base, units).unit;
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
        if (isOff(stored.value)) return "";
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
    // A wait nobody chose (not typed here, not saved) follows Check every up, and back down to
    // where it started, so it never reads amber; a chosen one stays put and the amber line says why.
    const silenceTyped = ref(false);
    const silenceChosen = () => silenceTyped.value || !!fv("id");
    const onSilenceAmount = (value: unknown, field: { handleChange: (v: unknown) => void }) => {
      silenceTyped.value = true;
      silence.onAmount(value, field);
    };
    let silenceFollow: { base: number; written: number } | null = null;
    watch(
      frequencyMinutes,
      (minutes) => {
        const current = Number(fv("trigger_condition.silence"));
        if (!isScheduled.value || silenceChosen() || !(current > 0) || !(minutes > 0)) return;
        const base = silenceFollow?.written === current ? silenceFollow.base : current;
        const next = Math.max(base, Math.ceil(minutes));
        silenceFollow = { base, written: next };
        if (next !== current) setFV("trigger_condition.silence", next);
      },
      { immediate: true },
    );
    const keepFiring = useDurationField(
      "keep_firing_for",
      "seconds",
      ["seconds", "min", "h"],
      "min",
    );
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
      holdDraft.value = null;
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
      onSilenceAmount,
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
      scheduleNote,
      silenceHint,
      holdWindowNote,
      setPendingPeriodMinutes,
      notifyLines,
      destinationDetails,
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
      breachWarning,
      pendingPeriodUnit,
      pendingPeriodUnitOptions,
      onPendingPeriodChange,
      holdAmount,
      onHoldAmount,
      onPendingPeriodUnitChange,
    };
  },
});
</script>
