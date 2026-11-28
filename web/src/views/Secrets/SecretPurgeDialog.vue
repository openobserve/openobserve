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
    size="md"
    form-id="secret-purge-form"
    :title="t('secrets.lifecycle.purgeTitle', { name: detail.name })"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('secrets.lifecycle.purgeConfirm')"
    primary-button-variant="destructive"
    primary-button-data-test="secret-purge-confirm"
    data-test="secret-purge-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      id="secret-purge-form"
      :schema="schema"
      :default-values="{ confirm: '' }"
      class="flex flex-col gap-3"
      @submit="onSubmit"
    >
      <span class="text-text-body text-sm">{{ t("secrets.lifecycle.purgeBody") }}</span>
      <span class="text-text-secondary text-xs">{{
        t("secrets.lifecycle.purgeRecreateHint")
      }}</span>
      <OFormInput
        name="confirm"
        autocomplete="off"
        :label="t('secrets.lifecycle.purgeTypeLabel')"
        data-test="secret-purge-name"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { SecretDetail } from "@/services/secrets";
import { purgeSecretMutation } from "@/services/secrets.queries";
import { makePurgeSchema } from "./SecretForms.schema";
import { secretErrorText } from "./secretErrors";

const props = defineProps<{ open: boolean; detail: SecretDetail }>();
const emit = defineEmits<{ "update:open": [value: boolean]; purged: [] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const schema = computed(() => makePurgeSchema(t, props.detail.name));
const purge = useMutation(() => purgeSecretMutation(orgId.value));

const onSubmit = async () => {
  try {
    await purge.mutateAsync(props.detail.id);
    toast({
      variant: "success",
      message: t("secrets.lifecycle.purged", { name: props.detail.name }),
    });
    emit("purged");
    emit("update:open", false);
  } catch (e) {
    toast({ variant: "error", message: secretErrorText(t, e, t("secrets.lifecycle.purgeFailed")) });
  }
};
</script>
