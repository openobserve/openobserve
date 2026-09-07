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
    class="step-alert-conditions rounded-default bg-surface-overlay border-border-default mx-auto w-full border"
  >
    <!-- Section header -->
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
      <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">{{
        t("alerts.alertSettings.sectionTitle")
      }}</span>
    </div>

    <!-- The AddAlert orchestrator owns the ONE <OForm> and provides
         FORM_CONTEXT_KEY. The OForm* fields below inject that form and bind by
         nested `name=` (trigger_condition.*, destinations, creates_incident); the
         composed schema in AddAlert.schema.ts validates them on save. -->
    <div class="px-3 py-2">
      <div>
        <!-- For Real-Time Alerts -->
        <template v-if="isRealTime === 'true' || isRealTime === 'composite'">
          <!-- Silence Notification (Cooldown) -->
          <div class="mb-4 flex items-start justify-start pb-3">
            <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
              {{ t("alerts.silenceNotification") + " *" }}
              <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
              <OTooltip :content="t('alerts.alertSettings.cooldownTooltip')" side="right" />
            </div>
            <div class="me-2 flex w-fit flex-col gap-1">
              <div class="flex items-center">
                <div class="w-21.75">
                  <OFormInput
                    name="trigger_condition.silence"
                    type="number"
                    min="0"
                    data-test="alert-settings-silence-duration-input"
                  >
                    <!-- Message rendered below at pair width — see silenceError. -->
                    <template #error />
                  </OFormInput>
                </div>
                <div
                  class="bg-input-addon-bg text-input-addon-text text-compact flex h-8.5 min-w-22.5 items-center justify-center"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>
              <div
                v-if="silenceError"
                class="text-input-error-text text-xs whitespace-nowrap"
                data-test="alert-settings-silence-error"
                role="alert"
              >
                {{ silenceError }}
              </div>
            </div>
          </div>

          <!-- Pending period. Composite only — no per-alert frequency to warn
               against (§2b), so no not-a-multiple hint here, unlike the
               scheduled block below. Same field, label, and tooltip as the
               scheduled version, intentionally no visual distinction — the
               backend stores and evaluates it for composite alerts too
               (handle_composite_alert_trigger). -->
          <div v-if="isRealTime === 'composite'" class="mb-4 flex items-start justify-start pb-3">
            <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
              {{ t("alerts.queryConfig.pendingPeriod") }}
              <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
              <OTooltip :content="t('alerts.queryConfig.pendingPeriodTooltip')" side="right" />
            </div>
            <div class="me-2 flex w-fit flex-col gap-1">
              <div class="flex items-center gap-2">
                <div class="w-21.75">
                  <OFormInput
                    name="_ui.pendingPeriod"
                    type="number"
                    min="0"
                    data-test="alert-settings-pending-period-input"
                    @update:model-value="onPendingPeriodChange"
                  >
                    <template #error />
                  </OFormInput>
                </div>
                <OSelect
                  class="max-w-25 min-w-20"
                  :model-value="pendingPeriodUnit"
                  :options="pendingPeriodUnitOptions"
                  labelKey="label"
                  valueKey="value"
                  :searchable="false"
                  data-test="alert-settings-pending-period-unit"
                  @update:model-value="onPendingPeriodUnitChange"
                />
              </div>
              <div
                v-if="pendingPeriodError"
                class="text-input-error-text text-xs whitespace-nowrap"
                data-test="alert-settings-pending-period-error"
                role="alert"
              >
                {{ pendingPeriodError }}
              </div>
            </div>
          </div>

          <!-- Destinations. Deliberately NOT name=-bound: one control writes two
               form fields, so both go up through the parent's setFieldValue via
               the events below. -->
          <AlertDestinationsField
            class="mb-4 pb-4"
            :destinations="destinations"
            :workflows="workflows"
            :destination-options="formattedDestinations"
            :error="destinationsError"
            @update:destinations="$emit('update:destinations', $event)"
            @update:workflows="$emit('update:workflows', $event)"
            @refresh="$emit('refresh:destinations')"
          />
        </template>

        <!-- For Scheduled Alerts -->
        <template v-else>
          <!-- Period -->
          <div ref="periodFieldRef" class="me-2 mb-4! flex items-start">
            <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
              {{ t("alerts.period") + " *" }}
              <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
              <OTooltip :content="t('alerts.alertSettings.periodTooltip')" side="right" />
            </div>
            <div class="me-2 flex w-fit flex-col gap-1">
              <div class="flex items-center">
                <div class="w-21.75">
                  <OFormInput
                    name="trigger_condition.period"
                    type="number"
                    min="1"
                    :debounce="300"
                    data-test="alert-settings-period-input"
                    @update:model-value="handlePeriodChange"
                  >
                    <!-- Message rendered below at pair width — see periodError. -->
                    <template #error />
                  </OFormInput>
                </div>
                <div
                  class="bg-input-addon-bg text-input-addon-text text-compact flex h-8.5 min-w-22.5 items-center justify-center"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>
              <div
                v-if="periodError"
                class="text-input-error-text text-xs whitespace-nowrap"
                data-test="alert-settings-period-error"
                role="alert"
              >
                {{ periodError }}
              </div>
            </div>
          </div>

          <!-- Silence Notification (Cooldown) for Scheduled Alerts -->
          <div ref="silenceFieldRef" class="me-2 mb-4! flex items-start">
            <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
              {{ t("alerts.silenceNotification") + " *" }}
              <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
              <OTooltip :content="t('alerts.alertSettings.cooldownTooltip')" side="right" />
            </div>
            <div class="me-2 flex w-fit flex-col gap-1">
              <div class="flex items-center">
                <div class="w-21.75">
                  <OFormInput
                    name="trigger_condition.silence"
                    type="number"
                    min="0"
                    :debounce="300"
                    data-test="alert-settings-silence-duration-input"
                  >
                    <!-- Message rendered below at pair width — see silenceError. -->
                    <template #error />
                  </OFormInput>
                </div>
                <div
                  class="bg-input-addon-bg text-input-addon-text text-compact flex h-8.5 min-w-22.5 items-center justify-center"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>
              <div
                v-if="silenceError"
                class="text-input-error-text text-xs whitespace-nowrap"
                data-test="alert-settings-silence-error"
                role="alert"
              >
                {{ silenceError }}
              </div>
            </div>
          </div>

          <!-- Pending period for Scheduled Alerts. Moved here from
               QueryConfig.vue's condition section — same field, label, and
               tooltip as the composite version above, plus the
               not-a-multiple-of-Check-every warning (composite has no
               frequency to compare against, so it skips that row). -->
          <div ref="pendingPeriodFieldRef" class="me-2 mb-4! flex items-start">
            <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
              {{ t("alerts.queryConfig.pendingPeriod") }}
              <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
              <OTooltip :content="t('alerts.queryConfig.pendingPeriodTooltip')" side="right" />
            </div>
            <div class="me-2 flex w-fit flex-col gap-1">
              <div class="flex items-center gap-2">
                <div class="w-21.75">
                  <OFormInput
                    name="_ui.pendingPeriod"
                    type="number"
                    min="0"
                    data-test="alert-settings-pending-period-input"
                    @update:model-value="onPendingPeriodChange"
                  >
                    <template #error />
                  </OFormInput>
                </div>
                <OSelect
                  class="max-w-25 min-w-20"
                  :model-value="pendingPeriodUnit"
                  :options="pendingPeriodUnitOptions"
                  labelKey="label"
                  valueKey="value"
                  :searchable="false"
                  data-test="alert-settings-pending-period-unit"
                  @update:model-value="onPendingPeriodUnitChange"
                />
              </div>
              <div
                v-if="pendingPeriodError"
                class="text-input-error-text text-xs whitespace-nowrap"
                data-test="alert-settings-pending-period-error"
                role="alert"
              >
                {{ pendingPeriodError }}
              </div>
              <div
                v-if="!pendingPeriodError && pendingPeriodWarning"
                class="text-status-warning-text text-xs whitespace-nowrap"
                data-test="alert-settings-pending-period-warning"
                role="alert"
              >
                {{ pendingPeriodWarning }}
              </div>
            </div>
          </div>

          <!-- Destinations. Deliberately NOT name=-bound: one control writes two
               form fields, so both go up through the parent's setFieldValue via
               the events below. The focus manager resolves a component ref via
               $el, so the ref moves onto the field unchanged. -->
          <AlertDestinationsField
            ref="destinationsFieldRef"
            class="me-2 mb-4!"
            :destinations="destinations"
            :workflows="workflows"
            :destination-options="formattedDestinations"
            :error="destinationsError"
            @update:destinations="$emit('update:destinations', $event)"
            @update:workflows="$emit('update:workflows', $event)"
            @refresh="$emit('refresh:destinations')"
          />
        </template>

        <!-- Creates Incident toggle — shown for all alert types -->
        <div class="mb-4! flex items-start">
          <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
            {{ t("alerts.alertSettings.createsIncident") }}
            <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
            <OTooltip :content="t('alerts.alertSettings.createsIncidentTooltip')" side="right" />
          </div>
          <OFormSwitch name="creates_incident" data-test="alert-creates-incident-toggle" />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, inject, ref, type PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { convertMinutesToCron, getCronIntervalDifferenceInSeconds } from "@/utils/zincutils";

export default defineComponent({
  name: "Step3AlertConditions",
  components: {
    OFormInput,
    OFormSwitch,
    OSelect,
    OTooltip,
    OIcon,
    AlertDestinationsField,
  },
  props: {
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
    "update:workflows",
    "update:promqlCondition",
  ],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    // Field refs consumed by the parent's AlertFocusManager (registered off the
    // step ref). Scheduled-only.
    const periodFieldRef = ref<any>(null);
    const silenceFieldRef = ref<any>(null);
    const destinationsFieldRef = ref<any>(null);
    const pendingPeriodFieldRef = ref<any>(null);

    // Period / silence are composite "number + Minutes addon" fields: a 5.4rem
    // OFormInput glued to a unit block. OFormInput renders its message INSIDE
    // that narrow width, wrapping it into a ragged column and growing the field,
    // which pushes the addon out of line. Empty #error slot suppresses the inline
    // text (the field keeps its red border) and we render the message in a
    // full-width sibling below the pair. Reads the same R3-timed field errors
    // OFormInput would have surfaced — single source of truth, wider display.
    const form: any = inject(FORM_CONTEXT_KEY, null);
    const fieldError = (path: string) =>
      form
        ? form.useStore((s: any) => firstFieldError(s.fieldMeta?.[path]?.errors ?? []))
        : computed(() => undefined);
    const periodError = fieldError("trigger_condition.period");
    const silenceError = fieldError("trigger_condition.silence");
    // Destinations is NOT an OFormSelect any more (AlertDestinationsField below
    // is a plain controlled component covering destinations + workflows), so its
    // schema error has no wrapper to render it — surface it the same way period
    // and silence do. The rule is "at least one destination OR workflow" and is
    // keyed on `destinations` in AddAlert.schema.ts, so it lands on this path.
    const destinationsError = fieldError("destinations");
    const pendingPeriodError = fieldError("_ui.pendingPeriod");

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
      { label: t("common.minutes"), value: "minutes" },
      { label: t("common.hours"), value: "hours" },
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
    const pendingPeriodWarning = computed<string>(() => {
      if (props.isRealTime !== "false") return "";
      const pendingMinutes = Number(fv("pending_period_sec"));
      if (!Number.isFinite(pendingMinutes) || pendingMinutes <= 0) return "";

      const frequencyType = fv("trigger_condition.frequency_type");
      let freqMinutes: number;
      if (frequencyType === "cron") {
        const cronExpression = fv("trigger_condition.cron");
        if (!cronExpression) return "";
        try {
          freqMinutes = getCronIntervalDifferenceInSeconds(cronExpression) / 60;
        } catch {
          return "";
        }
      } else {
        freqMinutes = Number(fv("trigger_condition.frequency"));
      }
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

    // Period typed → cross-step CASCADE (period drives frequency / cron /
    // timezone / silence). The ancestor AddAlert listens to @update:trigger
    // (updateTriggerCondition → setFieldValue) and writes the whole
    // trigger_condition into the ONE form, so the visible silence field
    // auto-fills. The period field value itself is already written into the form
    // by its own OFormInput binding; it rides on the emit so the parent write
    // does not revert it.
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
      if (periodValue && periodValue > 0) {
        const minFrequency = Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60) || 10;
        if (periodValue >= minFrequency) nextTrigger.frequency = periodValue;
        nextTrigger.cron = convertMinutesToCron(periodValue);
        if (!nextTrigger.timezone) nextTrigger.timezone = getBrowserTimezone();
        nextTrigger.silence = periodValue;
      }
      emit("update:trigger", nextTrigger);
    };

    return {
      t,
      store,
      handlePeriodChange,
      // Field refs for the parent focus manager
      periodFieldRef,
      silenceFieldRef,
      destinationsFieldRef,
      pendingPeriodFieldRef,
      periodError,
      silenceError,
      destinationsError,
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
