// Copyright 2026 OpenObserve Inc.
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('synthetics.privateLocations.addTitle')"
    :sub-title="t('synthetics.privateLocations.addSubtitle')"
    form-id="synthetics-add-location-form"
    :primary-button-label="t('synthetics.privateLocations.addAction')"
    :secondary-button-label="t('common.cancel')"
    data-test="synthetics-add-location-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      id="synthetics-add-location-form"
      :schema="schema"
      :default-values="addLocationDefaults()"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormInput
        name="label"
        :label="t('synthetics.privateLocations.form.name')"
        :placeholder="t('synthetics.privateLocations.form.namePlaceholder')"
        required
        data-test="synthetics-add-location-name-input"
      />
      <OFormInput
        name="region"
        :label="t('synthetics.privateLocations.form.region')"
        :placeholder="t('synthetics.privateLocations.form.regionPlaceholder')"
        required
        data-test="synthetics-add-location-region-input"
      />
      <OFormInput
        name="provider"
        :label="t('synthetics.privateLocations.form.provider')"
        :placeholder="t('synthetics.privateLocations.form.providerPlaceholder')"
        data-test="synthetics-add-location-provider-input"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import {
  makeAddLocationSchema,
  addLocationDefaults,
  type AddLocationForm,
} from "./AddLocationDialog.schema";

defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "created", payload: { id: string; token?: string; install?: string }): void;
}>();

const { t } = useI18n();
const store = useStore();
const schema = makeAddLocationSchema(t);

async function onSubmit(value: AddLocationForm) {
  const org = store.state.selectedOrganization.identifier;
  try {
    const res = await syntheticsService.createLocation(org, {
      kind: "private",
      label: value.label,
      region: value.region,
      provider: value.provider || "custom",
    });
    toast({ variant: "success", message: t("synthetics.privateLocations.toast.created") });
    emit("update:open", false);
    emit("created", {
      id: res.data?.location?.id,
      token: res.data?.token,
      install: res.data?.install,
    });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.privateLocations.toast.createFailed"),
    });
  }
}
</script>
