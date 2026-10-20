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
    :id="formId"
    v-slot="{ isSubmitting }"
    class="flex flex-col gap-5"
    :schema="schema"
    :default-values="toForm(initial)"
    :data-test="dataTest"
    @submit="onSubmit"
  >
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <OFormInput
        v-for="field in fields"
        :key="field.name"
        :name="field.name"
        type="number"
        :label="field.label"
        :help-text="field.help"
        :placeholder="field.placeholder"
        :disabled="disabled"
        :data-test="`${dataTest}-${field.name}`"
      />
    </div>
    <div v-if="inlineSubmit">
      <OButton
        type="submit"
        variant="primary"
        size="sm-action"
        :loading="isSubmitting"
        :disabled="disabled"
        :data-test="`${dataTest}-save`"
      >
        {{ t("fleet.settings.save") }}
      </OButton>
    </div>
  </OForm>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { FleetDefaults, FleetSettings } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  fromForm,
  makeSettingsSchema,
  toForm,
  type SettingsForm,
} from "./FleetSettingsForm.schema";

const props = withDefaults(
  defineProps<{
    initial: Partial<FleetSettings> | null;
    /** The organization defaults; shown as placeholders where a fleet inherits. */
    defaults: FleetDefaults | null;
    /** The organization form requires every value; a fleet form leaves blanks to inherit. */
    required?: boolean;
    formId?: string;
    inlineSubmit?: boolean;
    disabled?: boolean;
    dataTest?: string;
  }>(),
  {
    required: false,
    formId: undefined,
    inlineSubmit: false,
    disabled: false,
    dataTest: "fleet-settings-form",
  },
);
const emit = defineEmits<{ save: [body: FleetSettings] }>();

const { t } = useI18nTyped();
const schema = computed(() => makeSettingsSchema(t, props.required));

function onSubmit(values: Record<string, unknown>) {
  emit("save", fromForm(values as SettingsForm, props.defaults));
}

const inherit = (value: number | undefined) =>
  props.required || value === undefined
    ? undefined
    : t("fleet.settings.inheritPlaceholder", { value: raw(String(value)) });

const fields = computed<
  { name: keyof SettingsForm; label: I18nText; help?: I18nText; placeholder?: I18nText }[]
>(() => {
  const d = props.defaults;
  return [
    {
      name: "heartbeat",
      label: t("fleet.settings.heartbeat"),
      placeholder: inherit(d?.heartbeat_interval_secs),
    },
    {
      name: "offlineHeartbeats",
      label: t("fleet.settings.offlineHeartbeats"),
      help: t("fleet.settings.offlineHeartbeatsHelp"),
      placeholder: inherit(d?.offline_heartbeats),
    },
    {
      name: "retentionDays",
      label: t("fleet.settings.retentionDays"),
      help: t("fleet.settings.retentionDaysHelp"),
      placeholder: inherit(d?.retention_days),
    },
    {
      name: "offlineRatio",
      label: t("fleet.settings.offlineRatio"),
      help: t("fleet.settings.offlineRatioHelp"),
      placeholder: inherit(d?.offline_ratio_percent),
    },
    {
      name: "phaseTimeoutMin",
      label: t("fleet.settings.phaseTimeout"),
      help: t("fleet.settings.phaseTimeoutHelp"),
      placeholder: inherit(d ? d.phase_timeout_secs / 60 : undefined),
    },
    {
      name: "observeMin",
      label: t("fleet.settings.gateObserve"),
      placeholder: inherit(d ? d.gate.observe_secs / 60 : undefined),
    },
    {
      name: "windowMin",
      label: t("fleet.settings.gateWindow"),
      placeholder: inherit(d ? d.gate.window_secs / 60 : undefined),
    },
    {
      name: "passPercent",
      label: t("fleet.settings.gatePass"),
      help: t("fleet.settings.gatePassHelp"),
      placeholder: inherit(d?.gate.pass_percent),
    },
  ];
});
</script>
