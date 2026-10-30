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
    size="sm"
    :title="title"
    :form-id="FORM_ID"
    :primary-button-label="t('fleet.common.create')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="creating"
    data-test="fleet-create-config-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="open"
      :id="FORM_ID"
      class="flex flex-col gap-5"
      :schema="schema"
      :default-values="{ id: initialId, description: initialDescription }"
      @submit="submit"
    >
      <OFormInput
        name="id"
        :label="t('fleet.configs.id')"
        :help-text="t('fleet.configs.idHelp')"
        required
        data-test="fleet-create-config-id"
      />
      <OFormInput
        name="description"
        :label="t('fleet.configs.description')"
        data-test="fleet-create-config-description"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { useMutation } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { createFleetConfigMutation } from "@/services/fleet.queries";
import { makeConfigSchema, type ConfigForm } from "./FleetCreateConfigDialog.schema";
import { serverMessage } from "./useFleetApi";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: I18nText;
    /** Sent unchanged as the new config's draft. */
    yaml: string;
    initialId?: string;
    initialDescription?: string;
  }>(),
  { initialId: "", initialDescription: "" },
);
const emit = defineEmits<{ "update:open": [open: boolean]; created: [id: string] }>();

const FORM_ID = "fleet-create-config-form";

const { t } = useI18nTyped();
const orgId = useOrgId();
const schema = makeConfigSchema(t);
const create = useMutation(() => createFleetConfigMutation(orgId.value));
const creating = create.isPending;

async function submit(value: ConfigForm) {
  if (creating.value) return;
  try {
    await create.mutateAsync({ id: value.id, description: value.description, yaml: props.yaml });
    toast({ variant: "success", message: t("fleet.configs.created", { name: raw(value.id) }) });
    emit("update:open", false);
    emit("created", value.id);
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
