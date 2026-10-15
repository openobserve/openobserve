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

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { updateCredentialsMutation } from "@/services/slack.queries";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { InstallationView, SlackCredentialsRequest } from "@/types/slack";
import {
  credentialsDefaults,
  makeCredentialsSchema,
  type CredentialsForm,
} from "./SlackSettings.schema";

type Field = keyof CredentialsForm;

const props = defineProps<{
  open: boolean;
  installation: InstallationView;
}>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const FORM_ID = "slack-credentials-form";

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const update = useMutation(() => updateCredentialsMutation(org.value, props.installation.id));

// The mode decides which secret Slack verifies with: Socket Mode's app token or HTTP's signing secret.
const fields = computed<{ name: Field; label: I18nText }[]>(() => [
  props.installation.mode === "socket"
    ? { name: "app_token", label: t("slackApp.wizard.create.appToken") }
    : { name: "signing_secret", label: t("slackApp.wizard.create.signingSecret") },
  { name: "client_id", label: t("slackApp.wizard.create.clientId") },
  { name: "client_secret", label: t("slackApp.wizard.create.clientSecret") },
  { name: "config_refresh_token", label: t("slackApp.credentials.configToken") },
]);

const schema = computed(() => makeCredentialsSchema(t, fields.value[0].name));

const submit = async (value: CredentialsForm): Promise<void> => {
  const body: SlackCredentialsRequest = {};
  for (const { name } of fields.value) {
    if (value[name]) body[name] = value[name];
  }
  await update.mutateAsync(body);
  emit("update:open", false);
  toast({ variant: "success", message: t("slackApp.credentials.saved") });
};
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('slackApp.credentials.title')"
    :sub-title="t('slackApp.credentials.description')"
    :form-id="FORM_ID"
    :primary-button-label="t('common.save')"
    :secondary-button-label="t('common.cancel')"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="open"
      :id="FORM_ID"
      :key="installation.mode"
      :schema="schema"
      :default-values="credentialsDefaults()"
      class="flex flex-col gap-5"
      @submit="submit"
    >
      <OBanner
        v-if="!installation.credentials_readable"
        variant="error-soft"
        dense
        icon="error-outline"
        data-test="slack-credentials-unreadable-note"
      >
        {{ t("slackApp.credentials.unreadable") }}
      </OBanner>
      <OFormInput
        v-for="field in fields"
        :key="field.name"
        :name="field.name"
        :label="field.label"
        :type="field.name === 'client_id' ? 'text' : 'password'"
        :revealable="field.name !== 'client_id'"
        autocomplete="off"
        :data-test="`slack-credentials-${field.name}`"
      />
      <p class="text-text-secondary m-0 text-xs">{{ t("slackApp.credentials.botTokenHint") }}</p>
    </OForm>
  </ODialog>
</template>
