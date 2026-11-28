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
  <ODrawer
    :open="!!kind"
    size="lg"
    form-id="secret-create-form"
    :title="kind === 'variable' ? t('secrets.newVariable') : t('secrets.newSecret')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="
      kind === 'variable' ? t('secrets.create.createVariable') : t('secrets.create.createSecret')
    "
    primary-button-data-test="secret-create-submit"
    data-test="secret-create-drawer"
    @update:open="(v: boolean) => !v && emit('close')"
    @click:secondary="emit('close')"
  >
    <OForm
      v-if="kind"
      id="secret-create-form"
      :key="kind"
      :schema="makeCreateSchema(t, kind)"
      :default-values="createDefaults(kind)"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormInput
        name="name"
        required
        autocomplete="off"
        :label="t('secrets.create.name')"
        :help-text="t('secrets.create.nameHint')"
        data-test="secret-create-name"
      />
      <SecretSourceFields :kind="kind">
        <OFormInput
          name="value"
          required
          :type="kind === 'secret' ? 'password' : 'text'"
          autocomplete="new-password"
          :label="t('secrets.create.value')"
          :placeholder="t('secrets.create.valuePlaceholder')"
          :help-text="kind === 'secret' ? t('secrets.values.writeOnlyHint') : undefined"
          data-test="secret-create-value"
        />
      </SecretSourceFields>
      <OFormInput
        name="description"
        :label="t('secrets.create.description')"
        data-test="secret-create-description"
      />
      <OFormCheckboxGroup name="types" class="flex flex-col gap-2" data-test="secret-create-types">
        <span class="text-text-heading text-sm font-medium">{{
          t("secrets.create.whoCanUse")
        }}</span>
        <OCheckbox
          v-for="type in CONSUMER_TYPES"
          :key="type"
          :value="type"
          :label="consumerTypeLabel(t, type)"
          :data-test="`secret-create-type-${type}`"
        />
      </OFormCheckboxGroup>
      <span v-if="!fgaOn" class="text-text-secondary text-xs" data-test="secret-create-fga-off">
        {{ t("secrets.create.fgaOffNotice") }}
      </span>
      <div v-else class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <OFormTagInput
          name="use_roles"
          :label="t('secrets.create.rolesUse')"
          data-test="secret-create-roles-use"
        />
        <OFormTagInput
          name="manage_roles"
          :label="t('secrets.create.rolesManage')"
          data-test="secret-create-roles-manage"
        />
      </div>
      <div v-if="kind === 'secret'" class="flex flex-col gap-1">
        <OFormTagInput
          name="hosts"
          :label="t('secrets.policy.hostPin')"
          :placeholder="t('secrets.policy.hostsPlaceholder')"
          data-test="secret-create-hosts"
        />
        <span class="text-text-secondary text-xs">{{ t("secrets.create.hostsHint") }}</span>
      </div>
      <span class="text-text-secondary text-xs">{{ t("secrets.create.envHint") }}</span>
    </OForm>
  </ODrawer>
</template>

<script setup lang="ts">
import { useMutation } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckboxGroup from "@/lib/forms/Checkbox/OFormCheckboxGroup.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { CONSUMER_TYPES, type SecretKind } from "@/services/secrets";
import { createSecretMutation } from "@/services/secrets.queries";
import { consumerTypeLabel } from "./secretBadges";
import { createErrorText } from "./secretErrors";
import SecretSourceFields from "./SecretSourceFields.vue";
import {
  buildCreateRequest,
  createDefaults,
  makeCreateSchema,
  type CreateSecretForm,
} from "./SecretForms.schema";

const props = defineProps<{ kind: SecretKind | null; fgaOn: boolean }>();
const emit = defineEmits<{ close: []; created: [id: string] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const create = useMutation(() => createSecretMutation(orgId.value));

const onSubmit = async (value: CreateSecretForm) => {
  if (!props.kind) return;
  try {
    const res = await create.mutateAsync(buildCreateRequest(props.kind, value, props.fgaOn));
    toast({
      variant: "success",
      message: t("secrets.create.created", { name: value.name.trim() }),
    });
    emit("created", res.data.id);
  } catch (e) {
    toast({ variant: "error", message: createErrorText(t, e, t("secrets.create.failed")) });
  } finally {
    // The page keeps this drawer mounted, so the observed mutation would still hold the value.
    create.reset();
  }
};
</script>
