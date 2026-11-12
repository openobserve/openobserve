<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { caseSettingsQuery, saveCaseSettingsMutation } from "@/services/securityCases.queries";
import {
  MAX_AUTO_CLOSE_DAYS,
  MAX_GROUP_WINDOW_MINUTES,
  makeCaseSettingsSchema,
  type CaseSettingsValues,
} from "./SecurityCaseSettingsDialog.schema";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const FORM_ID = "security-case-settings-form";
const schema = makeCaseSettingsSchema(t);

const settings = useQuery(() => ({
  ...caseSettingsQuery(org.value),
  enabled: props.open && !!org.value,
}));
const defaults = computed<CaseSettingsValues | null>(() => {
  const current = settings.data.value;
  return current
    ? {
        auto_close_days: current.auto_close_days,
        group_window_minutes: current.group_window_minutes,
      }
    : null;
});
const save = useMutation(() => saveCaseSettingsMutation(org.value));
const saveError = ref<I18nText | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) saveError.value = null;
  },
);

const serverMessage = (err: unknown): I18nText | null => {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response
    ?.data;
  return raw(data?.message ?? data?.error) || null;
};

const loadError = computed<I18nText | null>(() =>
  settings.isError.value
    ? serverMessage(settings.error.value) || t("siem.cases.settings.loadFailed")
    : null,
);

async function onSubmit(value: CaseSettingsValues) {
  const parsed = schema.parse(value);
  saveError.value = null;
  try {
    await save.mutateAsync(parsed);
  } catch (err) {
    saveError.value = serverMessage(err) || t("siem.cases.settings.saveFailed");
    return;
  }
  toast({ variant: "success", message: t("siem.cases.settings.saved") });
  emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('siem.cases.settings.title')"
    :form-id="FORM_ID"
    :primary-button-label="t('siem.cases.settings.save')"
    :primary-button-disabled="!defaults"
    :secondary-button-label="t('siem.cases.close.cancel')"
    data-test="security-case-settings-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <OBanner
        v-if="saveError"
        variant="error-soft"
        icon="error-outline"
        dense
        data-test="security-case-settings-save-error"
        >{{ saveError }}</OBanner
      >
      <OBanner
        v-if="loadError"
        variant="error-soft"
        icon="error-outline"
        dense
        data-test="security-case-settings-load-error"
        >{{ loadError }}</OBanner
      >
      <div
        v-else-if="!defaults"
        class="flex justify-center py-6"
        data-test="security-case-settings-loading"
      >
        <OSpinner />
      </div>
      <OForm
        v-else-if="open"
        :id="FORM_ID"
        :schema="schema"
        :default-values="defaults"
        class="flex flex-col gap-5"
        @submit="onSubmit"
      >
        <OFormInput
          name="auto_close_days"
          type="number"
          :min="0"
          :max="MAX_AUTO_CLOSE_DAYS"
          :label="t('siem.cases.settings.autoCloseDays')"
          :help-text="t('siem.cases.settings.autoCloseDaysHint', { max: MAX_AUTO_CLOSE_DAYS })"
          required
          data-test="security-case-settings-auto-close"
        />
        <OFormInput
          name="group_window_minutes"
          type="number"
          :min="0"
          :max="MAX_GROUP_WINDOW_MINUTES"
          :label="t('siem.cases.settings.groupWindowMinutes')"
          :help-text="
            t('siem.cases.settings.groupWindowMinutesHint', { max: MAX_GROUP_WINDOW_MINUTES })
          "
          required
          data-test="security-case-settings-group-window"
        />
      </OForm>
    </div>
  </ODialog>
</template>
