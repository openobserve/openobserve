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
    form-id="secret-rename-form"
    :title="t('secrets.lifecycle.renameTitle', { name: detail.name })"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('secrets.lifecycle.renameConfirm')"
    primary-button-data-test="secret-rename-confirm"
    data-test="secret-rename-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      id="secret-rename-form"
      :schema="schema"
      :default-values="{ new_name: detail.name }"
      class="flex flex-col gap-3"
      @submit="onSubmit"
    >
      <OFormInput
        name="new_name"
        required
        autocomplete="off"
        :label="t('secrets.lifecycle.newName')"
        data-test="secret-rename-name"
      />
      <span class="text-text-secondary text-xs">
        {{ t("secrets.lifecycle.renameHint", { ref: oldRef }) }}
      </span>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { SecretDetail } from "@/services/secrets";
import { renameSecretMutation } from "@/services/secrets.queries";
import { makeRenameSchema, type RenameForm } from "./SecretForms.schema";
import { secretErrorText } from "./secretErrors";

const props = defineProps<{ open: boolean; detail: SecretDetail }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const schema = computed(() => makeRenameSchema(t, props.detail.name));
const oldRef = computed(() =>
  raw(`{{${props.detail.kind === "secret" ? "secrets" : "vars"}.${props.detail.name}}}`),
);
const rename = useMutation(() => renameSecretMutation(orgId.value));

const onSubmit = async (value: RenameForm) => {
  try {
    await rename.mutateAsync({ id: props.detail.id, newName: value.new_name.trim() });
    toast({ variant: "success", message: t("secrets.lifecycle.renamed") });
    emit("update:open", false);
  } catch (e) {
    toast({
      variant: "error",
      message: secretErrorText(t, e, t("secrets.lifecycle.renameFailed")),
    });
  }
};
</script>
