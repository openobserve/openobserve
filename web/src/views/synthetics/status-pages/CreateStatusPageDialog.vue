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
  <ODialog
    :open="open"
    persistent
    size="sm"
    :title="t('statusPages.createTitle')"
    :form-id="FORM_ID"
    :primary-button-label="t('common.create')"
    :secondary-button-label="t('common.cancel')"
    data-test="status-pages-create-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      :id="FORM_ID"
      :schema="schema"
      :default-values="defaults"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormInput
        name="name"
        :label="t('statusPages.fields.name')"
        :placeholder="t('statusPages.fields.namePlaceholder')"
        required
        data-test="status-pages-create-name-input"
      />
      <OFormInput
        name="description"
        type="textarea"
        :rows="3"
        :label="t('statusPages.fields.description')"
        :placeholder="t('statusPages.fields.descriptionPlaceholder')"
        data-test="status-pages-create-description-input"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import statusPagesService, { type StatusPageListItem } from "@/services/status_pages";
import {
  makeCreateStatusPageSchema,
  createStatusPageDefaults,
  type CreateStatusPageForm,
} from "./CreateStatusPage.schema";

const FORM_ID = "status-page-create-form";

const props = defineProps<{
  open: boolean;
  orgIdentifier: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  created: [page: StatusPageListItem];
}>();

const { t } = useI18nTyped();
const schema = computed(() => makeCreateStatusPageSchema(t));
const defaults = createStatusPageDefaults();

async function onSubmit(values: CreateStatusPageForm) {
  const dismiss = toast({
    variant: "loading",
    message: t("statusPages.toast.creating"),
    timeout: 0,
  });
  try {
    const res = await statusPagesService.create(props.orgIdentifier, {
      name: values.name,
      description: values.description || undefined,
    });
    dismiss();
    toast({ variant: "success", message: t("statusPages.toast.created") });
    emit("update:open", false);
    emit("created", res.data as StatusPageListItem);
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.toast.createFailed"),
    });
    console.error("[status-pages] create failed", err);
  }
}
</script>
