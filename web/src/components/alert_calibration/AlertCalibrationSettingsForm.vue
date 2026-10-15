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
  <OForm
    id="alert-calibration-settings-form"
    :form="form"
    data-test="alert-calibration-settings-form"
  >
    <OFormSection :title="t('alertCalibration.settings.schedule')">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <OFormSwitch
            name="enabled"
            size="md"
            label-position="left"
            :label="t('alertCalibration.settings.enabled')"
            class="w-full justify-between"
            data-test="alert-calibration-settings-enabled"
          />
          <OText variant="meta" as="span">{{ t("alertCalibration.settings.enabledHelp") }}</OText>
        </div>

        <OSeparator />

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <OFormSelect
            name="frequency_minutes"
            :label="t('alertCalibration.settings.frequency')"
            :options="frequencyOptions"
            :searchable="false"
            :help-text="t('alertCalibration.settings.frequencyHelp')"
            data-test="alert-calibration-settings-frequency"
          />
          <OFormSelect
            name="window_minutes"
            :label="t('alertCalibration.settings.window')"
            :options="windowOptions"
            :searchable="false"
            :help-text="t('alertCalibration.settings.windowHelp')"
            data-test="alert-calibration-settings-window"
          />
        </div>

        <OBanner
          v-for="warning in warnings"
          :key="warning"
          variant="warning"
          dense
          data-test="alert-calibration-settings-warning"
        >
          {{ warning }}
        </OBanner>

        <div class="flex flex-wrap items-center gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!dirty || isSubmitting"
            data-test="alert-calibration-settings-discard"
            @click="discard"
          >
            {{ t("alertCalibration.settings.discard") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
            :disabled="!dirty"
            data-test="alert-calibration-settings-save"
          >
            {{ t("alertCalibration.settings.save") }}
          </OButton>
          <OText v-if="config" variant="meta" as="span" class="ms-2">
            {{ t("alertCalibration.settings.lastSaved", { time: lastSaved }) }}
          </OText>
        </div>
      </div>
    </OFormSection>
  </OForm>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { formatDistanceToNowStrict } from "date-fns";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { errorMessage, type AlertCalibrationConfig } from "@/services/alert_calibration";
import { updateAlertCalibrationConfigMutation } from "@/services/alert_calibration.queries";
import { formatMinutes } from "./format";
import {
  CONFIG_DEFAULTS,
  makeAlertCalibrationSettingsSchema,
  type AlertCalibrationSettingsForm,
} from "./AlertCalibrationSettings.schema";
import { changedFields, scheduleWarnings } from "./alertCalibrationSettings";

const props = defineProps<{ config: AlertCalibrationConfig | null }>();

const FREQUENCY_PRESETS = [15, 60, 360, 720, 1440, 10_080, 43_200];
const WINDOW_PRESETS = [1440, 10_080, 20_160, 43_200, 129_600, 525_600];

const { t } = useI18nTyped();
const orgId = useOrgId();
const update = useMutation(() => updateAlertCalibrationConfigMutation(orgId.value));

const baseline: AlertCalibrationSettingsForm = {
  enabled: props.config?.enabled ?? CONFIG_DEFAULTS.enabled,
  frequency_minutes: props.config?.frequency_minutes ?? CONFIG_DEFAULTS.frequency_minutes,
  window_minutes: props.config?.window_minutes ?? CONFIG_DEFAULTS.window_minutes,
};

const form = useOForm<AlertCalibrationSettingsForm>({
  defaultValues: { ...baseline },
  schema: makeAlertCalibrationSettingsSchema(t),
  onSubmit: save,
});
const values = form.useStore((s) => s.values);
const isSubmitting = form.useStore((s) => s.isSubmitting);

const patch = computed(() => changedFields(baseline, values.value));
const dirty = computed(() => Object.keys(patch.value).length > 0);

/** A value set through the API is still offered, so the select never shows blank. */
const optionsFor = (presets: number[], current: number) =>
  [...new Set([...presets, current])]
    .sort((a, b) => a - b)
    .map((value) => ({ label: formatMinutes(t, value), value }));
const frequencyOptions = optionsFor(FREQUENCY_PRESETS, baseline.frequency_minutes);
const windowOptions = optionsFor(WINDOW_PRESETS, baseline.window_minutes);

const warnings = computed(() =>
  scheduleWarnings(t, Number(values.value.frequency_minutes), Number(values.value.window_minutes)),
);

const lastSaved = computed(() =>
  props.config
    ? raw(formatDistanceToNowStrict(props.config.updated_at / 1000, { addSuffix: true }))
    : "",
);

function savedMessage(saved: AlertCalibrationConfig): I18nText {
  if (!saved.enabled) return t("alertCalibration.settings.savedOff");
  if (!baseline.enabled) return t("alertCalibration.settings.savedFirstRun");
  if (saved.frequency_minutes !== baseline.frequency_minutes) {
    return t("alertCalibration.settings.savedCadence");
  }
  return t("alertCalibration.settings.saved");
}

async function save() {
  try {
    const saved = await update.mutateAsync(patch.value);
    toast({ message: savedMessage(saved), variant: "success" });
  } catch (error) {
    toast({
      message: t("alertCalibration.settings.saveFailed", { message: errorMessage(error) }),
      variant: "error",
    });
  }
}

const discard = () => form.reset();
</script>
