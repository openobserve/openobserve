<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Closing a case records why: the verdict feeds detection tuning, the reason the next analyst. -->
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { CASE_VERDICTS, type CaseVerdict } from "@/utils/security/cases";
import { makeCaseCloseSchema, type CaseCloseValues } from "./SecurityCaseCloseDialog.schema";

const props = defineProps<{
  open: boolean;
  /** Resolves true once the server closed the case. */
  close: (verdict: CaseVerdict, reason: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const FORM_ID = "security-case-close-form";
const schema = makeCaseCloseSchema(t);
const defaults: CaseCloseValues = { verdict: undefined, reason: "" };
const verdictOptions = computed(() =>
  CASE_VERDICTS.map((v) => ({ label: t(`siem.cases.verdict.${v}`), value: v })),
);

// OForm hands over raw field values; parsing yields the validated verdict and trimmed reason.
async function onSubmit(value: CaseCloseValues) {
  const { verdict, reason } = schema.parse(value);
  if (await props.close(verdict, reason)) emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('siem.cases.close.title')"
    :form-id="FORM_ID"
    :primary-button-label="t('siem.cases.transition.resolved')"
    :secondary-button-label="t('siem.cases.close.cancel')"
    data-test="security-case-close-dialog"
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
        name="verdict"
        :label="t('siem.cases.close.verdict')"
        :options="verdictOptions"
        required
        data-test="security-case-close-verdict"
      />
      <OFormTextarea
        name="reason"
        :label="t('siem.cases.close.reason')"
        :placeholder="t('siem.cases.close.reasonPlaceholder')"
        :rows="4"
        required
        data-test="security-case-close-reason"
      />
    </OForm>
  </ODialog>
</template>
