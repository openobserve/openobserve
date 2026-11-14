<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { ALLOWLIST_PURPOSES, type AllowList } from "@/services/securitySigma";
import { saveAllowlistMutation } from "@/services/securitySigma.queries";
import { detectionSaveFailure } from "@/utils/security/detectionFolder";
import {
  NETWORK_PURPOSES,
  allowlistDefaults,
  allowlistPayload,
  makeAllowlistSchema,
  type AllowlistFormValues,
} from "./SecurityAllowlistForm.schema";

const props = defineProps<{
  orgId: string;
  /** The list being edited; absent creates one. */
  list?: AllowList | null;
  existingIds: readonly string[];
}>();
const emit = defineEmits<{ saved: [list: AllowList]; cancel: [] }>();

const { t } = useI18nTyped();
const FORM_ID = "security-allowlist-form";
const editing = computed(() => !!props.list);
const schema = makeAllowlistSchema(t, () => (editing.value ? [] : props.existingIds));
const save = useMutation(computed(() => saveAllowlistMutation(props.orgId)));
const saveError = ref<I18nText | null>(null);

const form = useOForm<AllowlistFormValues>({
  defaultValues: allowlistDefaults(props.list ?? undefined),
  schema,
  onSubmit,
});
const purpose = form.useStore((s: { values: AllowlistFormValues }) => s.values.purpose);

const purposeOptions = computed(() =>
  ALLOWLIST_PURPOSES.map((p) => ({ label: t(`siem.tuning.allowlists.purpose.${p}`), value: p })),
);
const valuesHint = computed(() =>
  NETWORK_PURPOSES.includes(purpose.value)
    ? t("siem.tuning.allowlists.valuesNetworkHint")
    : t("siem.tuning.allowlists.valuesHint"),
);

async function onSubmit(value: AllowlistFormValues) {
  saveError.value = null;
  try {
    const saved = await save.mutateAsync({
      id: props.list?.id ?? value.id.trim(),
      body: allowlistPayload(value),
    });
    toast({ variant: "success", message: t("siem.tuning.allowlists.saved") });
    emit("saved", saved);
  } catch (e) {
    const { reason, forbidden } = detectionSaveFailure(e);
    saveError.value = reason
      ? raw(reason)
      : forbidden
        ? t("siem.tuning.allowlists.forbidden")
        : t("siem.tuning.allowlists.saveFailed");
  }
}
</script>

<template>
  <div
    class="border-border-default rounded-surface flex flex-col gap-3 border p-3"
    data-test="security-allowlist-form"
  >
    <OBanner
      v-if="saveError"
      variant="error-soft"
      icon="error-outline"
      dense
      data-test="security-allowlist-form-error"
      >{{ saveError }}</OBanner
    >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <OFormInput
          name="name"
          :label="t('siem.tuning.allowlists.name')"
          required
          data-test="security-allowlist-form-name"
        />
        <OFormInput
          name="id"
          :label="t('siem.tuning.allowlists.id')"
          :help-text="
            editing ? t('siem.tuning.allowlists.idFixed') : t('siem.tuning.allowlists.idHint')
          "
          :disabled="editing"
          required
          data-test="security-allowlist-form-id"
        />
      </div>
      <OFormSelect
        name="purpose"
        :label="t('siem.tuning.allowlists.purposeLabel')"
        :options="purposeOptions"
        data-test="security-allowlist-form-purpose"
      />
      <OFormTextarea
        name="values"
        :label="t('siem.tuning.allowlists.values')"
        :help-text="valuesHint"
        :rows="6"
        class="font-mono"
        data-test="security-allowlist-form-values"
      />
      <OFormTextarea
        name="description"
        :label="t('siem.tuning.allowlists.description')"
        :rows="2"
        data-test="security-allowlist-form-description"
      />
      <div class="flex justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          data-test="security-allowlist-form-cancel"
          @click="emit('cancel')"
          >{{ t("siem.detections.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          data-test="security-allowlist-form-save"
          >{{ t("siem.tuning.allowlists.save") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>
