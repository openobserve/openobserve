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
    :form-id="formId"
    :primary-button-label="confirmLabel"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="saving"
    :data-test="dataTest"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="open"
      :id="formId"
      class="flex flex-col gap-5"
      :schema="schema"
      :default-values="{ name: initial }"
      @submit="onSubmit"
    >
      <OFormInput
        name="name"
        :label="label"
        :help-text="helpText"
        required
        :data-test="`${dataTest}-name`"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, useId } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { makeNameSchema, type NameForm } from "./FleetNameDialog.schema";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: I18nText;
    label: I18nText;
    confirmLabel: I18nText;
    helpText?: I18nText;
    initial?: string;
    /** Resolves true when the name was saved, which closes the dialog. */
    save: (name: string) => Promise<boolean>;
    dataTest?: string;
  }>(),
  { initial: "", helpText: undefined, dataTest: "fleet-name-dialog" },
);
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const formId = `fleet-name-form-${useId()}`;
const schema = makeNameSchema(t);
const saving = ref(false);

async function onSubmit(value: NameForm) {
  if (saving.value) return;
  saving.value = true;
  try {
    if (await props.save(value.name.trim())) emit("update:open", false);
  } finally {
    saving.value = false;
  }
}
</script>
