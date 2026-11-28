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
    form-id="secret-delete-form"
    :title="t('secrets.lifecycle.deleteTitle', { name: detail.name })"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('secrets.lifecycle.deleteConfirm')"
    primary-button-variant="destructive"
    primary-button-data-test="secret-delete-confirm"
    data-test="secret-delete-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      id="secret-delete-form"
      :schema="schema"
      :default-values="{ force: false }"
      class="flex flex-col gap-3"
      @submit="onSubmit"
    >
      <template v-if="inUse">
        <span class="text-text-body text-sm">{{ t("secrets.lifecycle.deleteInUse") }}</span>
        <ul
          class="border-border-default divide-border-default rounded-surface flex flex-col divide-y border"
          data-test="secret-delete-consumers"
        >
          <li v-for="(entry, i) in usageEntries" :key="i" class="text-compact px-3 py-2">
            {{ entry.path.map((hop) => hop.consumer_name).join(" › ") }}
          </li>
        </ul>
      </template>
      <span class="text-text-secondary text-xs">{{
        t("secrets.lifecycle.deleteRestoreHint")
      }}</span>
      <OFormCheckbox
        v-if="inUse"
        name="force"
        :label="t('secrets.lifecycle.deleteForce', { count: usageCount }, usageCount)"
        data-test="secret-delete-force"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { SecretDetail } from "@/services/secrets";
import { deleteSecretMutation, secretUsageQuery } from "@/services/secrets.queries";
import { makeDeleteSchema, type DeleteForm } from "./SecretForms.schema";
import { secretErrorText } from "./secretErrors";

const props = defineProps<{ open: boolean; detail: SecretDetail }>();
const emit = defineEmits<{ "update:open": [value: boolean]; deleted: [] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();

const usage = useQuery(() =>
  Object.assign(secretUsageQuery(orgId.value, props.detail.id), {
    enabled: props.open && !!orgId.value,
  }),
);
const usageEntries = computed(() => usage.data.value ?? []);
const usageCount = computed(() => Math.max(usageEntries.value.length, props.detail.usage_count));
const inUse = computed(() => usageCount.value > 0);
const schema = computed(() => makeDeleteSchema(t, inUse.value));

const remove = useMutation(() => deleteSecretMutation(orgId.value));

const onSubmit = async (value: DeleteForm) => {
  try {
    await remove.mutateAsync({ id: props.detail.id, force: value.force });
    toast({
      variant: "success",
      message: t("secrets.lifecycle.deleted", { name: props.detail.name }),
    });
    emit("deleted");
    emit("update:open", false);
  } catch (e) {
    toast({
      variant: "error",
      message: secretErrorText(t, e, t("secrets.lifecycle.deleteFailed")),
    });
  }
};
</script>
