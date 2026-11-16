<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import {
  SUPPRESS_DURATIONS,
  TRIAGE_MAX_SUPPRESS_MINUTES,
  makeCaseSuppressSchema,
  type CaseSuppressForm,
  type CaseSuppressValues,
} from "./SecurityCaseSuppressDialog.schema";

const props = defineProps<{
  open: boolean;
  /** Resolves true once the server stored the suppression. */
  suppress: (values: CaseSuppressForm) => Promise<boolean>;
  /** Suppressions past the triage maximum need the Security write grant. */
  allowLong?: boolean;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const FORM_ID = "security-case-suppress-form";
const schema = makeCaseSuppressSchema(t);
const defaults: CaseSuppressValues = { duration: 1440, reason: "", closeCase: false };
const durationOptions = computed(() =>
  SUPPRESS_DURATIONS.filter((m) => props.allowLong || m <= TRIAGE_MAX_SUPPRESS_MINUTES).map(
    (m) => ({ label: t(`siem.cases.suppress.duration_${m}`), value: m }),
  ),
);

async function onSubmit(value: CaseSuppressValues) {
  if (await props.suppress(schema.parse(value))) emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('siem.cases.suppress.title')"
    :sub-title="t('siem.cases.suppress.hint')"
    :form-id="FORM_ID"
    :primary-button-label="t('siem.cases.suppress.submit')"
    :secondary-button-label="t('siem.cases.suppress.cancel')"
    data-test="security-case-suppress-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="open"
      :id="FORM_ID"
      :schema="schema"
      :default-values="defaults"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormSelect
        name="duration"
        :label="t('siem.cases.suppress.duration')"
        :options="durationOptions"
        required
        data-test="security-case-suppress-duration"
      />
      <OFormTextarea
        name="reason"
        :label="t('siem.cases.suppress.reason')"
        :placeholder="t('siem.cases.suppress.reasonPlaceholder')"
        :rows="3"
        required
        data-test="security-case-suppress-reason"
      />
      <OFormCheckbox
        name="closeCase"
        :label="t('siem.cases.suppress.closeCase')"
        data-test="security-case-suppress-close"
      />
    </OForm>
  </ODialog>
</template>
