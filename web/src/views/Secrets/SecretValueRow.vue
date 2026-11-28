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

<!-- One environment's value. A secret's value is write-only: the row says whether it is set, never what it is. -->
<template>
  <div class="flex flex-col gap-2 px-4 py-3" :data-test="`secret-value-row-${env.env}`">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <OTag
        size="xs"
        shape="rounded"
        :variant="isOrg ? 'default-soft' : 'teal-soft'"
        icon=""
        :label="envLabel(t, env.env)"
      />
      <span
        class="text-text-body min-w-0 flex-1 text-sm"
        :data-test="`secret-value-row-${env.env}-status`"
      >
        {{ statusText }}
      </span>
      <span
        v-if="kind === 'variable' && isOrg && value !== undefined"
        class="text-compact font-mono"
        :data-test="`secret-value-row-${env.env}-variable-value`"
        >{{ value }}</span
      >
      <template v-if="!editing && canManage">
        <OButton
          v-if="actionLabel"
          variant="outline"
          size="sm"
          :data-test="`secret-value-row-${env.env}-replace`"
          @click="editing = true"
        >
          {{ actionLabel }}
        </OButton>
        <OButton
          v-if="!isOrg && env.state !== 'inherit'"
          variant="ghost"
          size="sm"
          :loading="inherit.isPending.value"
          :data-test="`secret-value-row-${env.env}-remove-override`"
          @click="removeOverride"
        >
          {{ t("secrets.values.removeOverride") }}
        </OButton>
      </template>
    </div>

    <OForm
      v-if="editing"
      :schema="schema"
      :default-values="valueDefaults()"
      class="flex flex-col gap-2"
      @submit="save"
    >
      <SecretSourceFields :kind="kind">
        <OFormInput
          name="value"
          class="min-w-0"
          :type="kind === 'secret' ? 'password' : 'text'"
          autocomplete="new-password"
          autofocus
          :label="
            isOrg
              ? t('secrets.values.newOrgValue')
              : t('secrets.values.newEnvValue', { env: env.env })
          "
          :placeholder="t('secrets.values.typeNewValue')"
          :data-test="`secret-value-row-${env.env}-input`"
        />
      </SecretSourceFields>
      <SecretSaveRefusal v-if="refusal" :refusal="refusal" />
      <div class="flex items-center justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :data-test="`secret-value-row-${env.env}-cancel`"
          @click="stopEditing"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          :data-test="`secret-value-row-${env.env}-save`"
        >
          {{ t("common.save") }}
        </OButton>
      </div>
      <span v-if="kind === 'secret'" class="text-text-secondary text-xs">
        {{ t("secrets.values.writeOnlyHint") }}
      </span>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { relativeTimeText } from "@/lib/core/Table/cells/relativeTime";
import { ORG_ENV_ID, type SecretEnvDetail, type SecretKind } from "@/services/secrets";
import { inheritSecretValueMutation, putSecretValueMutation } from "@/services/secrets.queries";
import { envLabel } from "./secretBadges";
import {
  buildPointer,
  makeSecretValueSchema,
  valueDefaults,
  type SecretValueForm,
} from "./SecretForms.schema";
import SecretSourceFields from "./SecretSourceFields.vue";
import { secretErrorText } from "./secretErrors";
import SecretSaveRefusal from "./SecretSaveRefusal.vue";
import { refusalFrom, type SecretRefusal } from "./useSecretConsumer";

const props = withDefaults(
  defineProps<{
    secretId: string;
    kind: SecretKind;
    env: SecretEnvDetail;
    /** Variables only; a secret's value never reaches the browser. */
    value?: string;
    canManage?: boolean;
    /** Opens with the form, for an environment that has no value yet. */
    startEditing?: boolean;
  }>(),
  { value: undefined, canManage: true, startEditing: false },
);
const emit = defineEmits<{ done: [] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const schema = makeSecretValueSchema(t);
const editing = ref(props.startEditing);
// A refusal that names blocking consumers stays in the form so the list can be read.
const refusal = ref<SecretRefusal | null>(null);

const stopEditing = () => {
  editing.value = false;
  refusal.value = null;
  emit("done");
};
const isOrg = computed(() => props.env.env === ORG_ENV_ID);

const put = useMutation(() => putSecretValueMutation(orgId.value, props.secretId));
const inherit = useMutation(() => inheritSecretValueMutation(orgId.value, props.secretId));

const statusText = computed((): I18nText => {
  switch (props.env.state) {
    case "set":
      return t("secrets.values.setBy", {
        when: raw(relativeTimeText(props.env.updated_at / 1000, Date.now())),
        who: props.env.updated_by,
      });
    case "inherit":
      return t("secrets.values.usesOrg");
    default:
      return t("secrets.values.notSet");
  }
});

const actionLabel = computed((): I18nText | null => {
  if (props.env.state === "set") return t("secrets.values.replace");
  if (props.env.state === "inherit") return t("secrets.values.addValue");
  return t("secrets.values.setValue");
});

const save = async (value: SecretValueForm) => {
  refusal.value = null;
  try {
    await put.mutateAsync(
      value.source === "external"
        ? { env: props.env.env, source: buildPointer(value) }
        : { env: props.env.env, value: value.value },
    );
    stopEditing();
    toast({ variant: "success", message: t("secrets.values.saved") });
  } catch (e) {
    const named = refusalFrom(e);
    if (named?.usage?.length) refusal.value = named;
    else
      toast({ variant: "error", message: secretErrorText(t, e, t("secrets.values.saveFailed")) });
  } finally {
    put.reset();
  }
};

const removeOverride = async () => {
  try {
    await inherit.mutateAsync(props.env.env);
  } catch (e) {
    toast({ variant: "error", message: secretErrorText(t, e, t("secrets.values.saveFailed")) });
  }
};
</script>
