<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  Replace a Remote Task's auth secret in place (PUT /tasks/{id}/auth).

  Secrets are write-only, so every field starts empty and nothing stored is
  ever shown. The auth type and an API-key header name are part of the
  published version and cannot change here — only the secret behind them.
-->
<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useMutation } from "@tanstack/vue-query";
import { replaceRemoteTaskAuthMutation } from "@/services/llm-experiments.queries";
import type { RemoteTaskAuthView } from "@/services/remote-tasks.service";
import {
  makeRemoteTaskCredentialsSchema,
  toSecretMaterial,
  type RemoteTaskCredentialsValues,
} from "./RemoteTaskCredentialsDialog.schema";

const FORM_ID = "ai-remote-task-credentials-form";

const props = defineProps<{
  open: boolean;
  orgId: string;
  entityId: string;
  auth: RemoteTaskAuthView;
}>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();

const replaceAuth = useMutation(() => replaceRemoteTaskAuthMutation(props.orgId));

const form = useOForm<RemoteTaskCredentialsValues>({
  defaultValues: { token: "", username: "", password: "" },
  schema: makeRemoteTaskCredentialsSchema(t, props.auth.type),
  onSubmit: async (values) => {
    try {
      await replaceAuth.mutateAsync({
        entityId: props.entityId,
        material: toSecretMaterial(props.auth.type, values),
      });
      toast({
        variant: "success",
        message: t("aiObservability.remoteTasks.credentialsDialog.success"),
      });
      close();
    } catch (error: any) {
      toast({
        variant: "error",
        message:
          raw(error?.response?.data?.message) ||
          t("aiObservability.remoteTasks.credentialsDialog.error"),
      });
    }
  },
});
const isSubmitting = form.useStore((s) => s.isSubmitting);

function close() {
  // Nothing typed outlives the dialog.
  form.reset();
  emit("update:open", false);
}

function onUpdateOpen(value: boolean) {
  if (isSubmitting.value) return;
  if (value) emit("update:open", true);
  else close();
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('aiObservability.remoteTasks.credentialsDialog.title')"
    :persistent="isSubmitting"
    :show-close="!isSubmitting"
    :primary-button-label="t('aiObservability.remoteTasks.credentialsDialog.submit')"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    :form-id="FORM_ID"
    data-test="ai-remote-task-credentials-dialog"
    @update:open="onUpdateOpen"
    @click:secondary="onUpdateOpen(false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-4">
      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.remoteTasks.credentialsDialog.body") }}
      </p>
      <dl
        v-if="auth.type === 'api_key_header' && auth.headerName"
        class="text-text-secondary m-0 grid grid-cols-[max-content_1fr] gap-x-3 text-xs"
      >
        <dt class="font-medium">{{ t("aiObservability.remoteTasks.form.headerNameLabel") }}</dt>
        <dd class="text-text-body m-0 font-mono" data-test="ai-remote-task-credentials-header-name">
          {{ auth.headerName }}
        </dd>
      </dl>
      <template v-if="auth.type === 'basic'">
        <OFormInput
          name="username"
          :label="t('aiObservability.remoteTasks.form.usernameLabel')"
          size="sm"
          required
          autocomplete="off"
          data-test="ai-remote-task-credentials-username"
        />
        <OFormInput
          name="password"
          type="password"
          revealable
          :label="t('aiObservability.remoteTasks.form.passwordLabel')"
          size="sm"
          required
          autocomplete="new-password"
          data-test="ai-remote-task-credentials-password"
        />
      </template>
      <OFormInput
        v-else
        name="token"
        type="password"
        revealable
        :label="t('aiObservability.remoteTasks.form.tokenLabel')"
        :placeholder="t('aiObservability.remoteTasks.form.tokenPlaceholder')"
        size="sm"
        required
        autocomplete="new-password"
        data-test="ai-remote-task-credentials-token"
      />
    </OForm>
  </ODialog>
</template>
