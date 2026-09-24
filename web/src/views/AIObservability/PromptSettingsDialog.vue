<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="t('aiObservability.promptManagement.promptSettings')"
    :primary-button-label="ready ? t('aiObservability.promptManagement.saveSettings') : undefined"
    :secondary-button-label="t('aiObservability.promptManagement.cancel')"
    form-id="prompt-settings-form"
    data-test="prompt-settings-dialog"
    @update:open="requestClose"
    @click:secondary="requestClose(false)"
  >
    <div v-if="loading" role="status" class="flex flex-col gap-4">
      <span class="text-text-secondary text-sm">{{
        t("aiObservability.promptManagement.settingsLoading")
      }}</span>
      <OSkeleton class="h-12" /><OSkeleton class="h-24" />
    </div>
    <OEmptyState
      v-else-if="loadError"
      preset="load-error"
      size="block"
      :description="loadError"
      @action="load"
    />
    <OForm v-else-if="ready" id="prompt-settings-form" :form="form" class="flex flex-col gap-5">
      <OFormSelect
        name="protectedLabels"
        :label="t('aiObservability.promptManagement.protectedLabels')"
        :help-text="t('aiObservability.promptManagement.protectedLabelsHelp')"
        :options="protectedLabelOptions"
        multiple
        searchable
        creatable
        data-test="prompt-settings-protected-labels"
        @create="addProtectedLabel"
      />
      <section class="rounded-default border-border-default flex flex-col gap-3 border p-3">
        <div class="flex items-center justify-between gap-3">
          <h4 class="text-text-heading m-0 text-sm font-semibold">
            {{ t("aiObservability.promptManagement.webhook") }}
          </h4>
          <OFormSwitch
            name="webhookEnabled"
            :label="t('aiObservability.promptManagement.enabled')"
            data-test="prompt-settings-webhook-enabled"
          />
        </div>
        <template v-if="values.webhookEnabled">
          <OFormInput
            name="endpoint"
            :label="t('aiObservability.promptManagement.endpoint')"
            :placeholder="raw('https://example.com/openobserve/prompts')"
            required
            data-test="prompt-settings-webhook-endpoint"
          />
          <OFormSelect
            name="events"
            :label="t('aiObservability.promptManagement.subscriptions')"
            :options="eventOptions"
            multiple
            required
            data-test="prompt-settings-webhook-events"
          />
          <div
            class="rounded-default bg-surface-base border-border-default flex items-center gap-2 border p-3"
          >
            <OIcon :name="secretConfigured ? 'lock' : 'lock-open'" size="sm" />
            <div class="min-w-0 flex-1">
              <div class="text-text-heading text-xs font-semibold">
                {{ t("aiObservability.promptManagement.signingSecret") }}
              </div>
              <div class="text-text-secondary text-xs">
                {{
                  secretConfigured
                    ? t("aiObservability.promptManagement.secretConfigured")
                    : t("aiObservability.promptManagement.secretNotConfigured")
                }}
              </div>
            </div>
          </div>
          <OFormInput
            name="secret"
            type="password"
            :label="t('aiObservability.promptManagement.rotateSigningSecret')"
            :help-text="t('aiObservability.promptManagement.rotateSigningSecretHelp')"
            autocomplete="new-password"
            data-test="prompt-settings-secret"
          />
        </template>
      </section>
      <p
        v-if="saveError"
        role="alert"
        class="text-status-error-text text-sm"
        data-test="prompt-settings-save-error"
      >
        {{ saveError }}
      </p>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { promptErrorText } from "./promptUx";
import { isPromptLabelName } from "./PromptLabel.schema";
import {
  makePromptSettingsSchema,
  promptSettingsDefaults,
  type PromptSettingsForm,
} from "./PromptSettings.schema";
import {
  updatePromptSettingsMutation,
  rotatePromptSecretMutation,
} from "@/services/llm-prompts.service.queries";
import llmPromptsService, {
  type PromptSettings,
  type PromptWebhookEvent,
} from "@/services/llm-prompts.service";

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const props = defineProps<{ open: boolean; orgId: string }>();
const emit = defineEmits<{ "update:open": [open: boolean]; updated: [settings: PromptSettings] }>();
const form = useOForm<PromptSettingsForm>({
  defaultValues: promptSettingsDefaults(),
  schema: makePromptSettingsSchema(t),
  onSubmit: save,
});
const values = form.useStore((state) => state.values);
const saving = form.useStore((state) => state.isSubmitting);
const dirty = form.useStore((state) => state.isDirty);
const loading = ref(false);
const ready = ref(false);
const loadError = ref<I18nText>();
const saveError = ref<I18nText>();
const secretConfigured = ref(false);
const updateSettings = useMutation(() => updatePromptSettingsMutation(props.orgId));
const rotateSecret = useMutation(() => rotatePromptSecretMutation(props.orgId));
let loadGeneration = 0;
const protectedLabelOptions = computed(() =>
  [...new Set(["production", "staging", ...values.value.protectedLabels])].map((value) => ({
    label: raw(value),
    value,
  })),
);
const eventOptions: Array<{ label: I18nText; value: PromptWebhookEvent }> = [
  {
    label: t("aiObservability.promptManagement.webhookEvent.versionCreated"),
    value: "version_created",
  },
  { label: t("aiObservability.promptManagement.webhookEvent.labelMoved"), value: "label_moved" },
  {
    label: t("aiObservability.promptManagement.webhookEvent.labelDeleted"),
    value: "label_deleted",
  },
  { label: t("aiObservability.promptManagement.webhookEvent.promptArchived"), value: "archived" },
];

function addProtectedLabel(value: string) {
  const name = value.trim();
  if (name === "latest" || !isPromptLabelName(name)) {
    toast({
      variant: "error",
      message: t("aiObservability.promptManagement.protectedLabelsInvalid"),
    });
    return;
  }
  form.setFieldValue("protectedLabels", [...new Set([...values.value.protectedLabels, name])]);
}

async function load() {
  const generation = ++loadGeneration;
  ready.value = false;
  saveError.value = undefined;
  loadError.value = undefined;
  form.reset(promptSettingsDefaults());
  if (!props.open || !props.orgId) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    // This read-modify-write form must start from the current server settings.
    const settings = await llmPromptsService.getSettings(props.orgId);
    if (generation !== loadGeneration) return;
    form.reset(promptSettingsDefaults(settings));
    secretConfigured.value = Boolean(settings.webhook?.secretConfigured);
    ready.value = true;
  } catch (error: unknown) {
    if (generation === loadGeneration)
      loadError.value = promptErrorText(
        error,
        t("aiObservability.promptManagement.settingsLoadError"),
      );
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

async function requestClose(open: boolean) {
  if (open || saving.value) return;
  if (
    ready.value &&
    dirty.value &&
    !(await confirm({
      title: t("aiObservability.promptManagement.discardChangesTitle"),
      message: t("aiObservability.promptManagement.discardChangesMessage"),
      confirmLabel: t("aiObservability.promptManagement.discardChanges"),
    }))
  )
    return;
  emit("update:open", false);
}

async function save(value: PromptSettingsForm) {
  if (!ready.value) return;
  const orgId = props.orgId;
  saveError.value = undefined;
  let saved: PromptSettings | undefined;
  try {
    saved = await updateSettings.mutateAsync({
      protectedLabels: value.protectedLabels.map((label) => label.trim()),
      webhook: value.webhookEnabled
        ? { endpoint: value.endpoint.trim(), events: value.events }
        : null,
    });
    if (props.orgId !== orgId) return;
    emit("updated", saved);
    if (value.webhookEnabled && value.secret) {
      const rotated = await rotateSecret.mutateAsync(value.secret);
      if (props.orgId !== orgId) return;
      secretConfigured.value = rotated.secretConfigured;
      if (saved.webhook)
        saved = {
          ...saved,
          webhook: { ...saved.webhook, secretConfigured: rotated.secretConfigured },
        };
      emit("updated", saved);
    }
    form.reset(promptSettingsDefaults(saved));
    emit("update:open", false);
    toast({ variant: "success", message: t("aiObservability.promptManagement.settingsSaved") });
  } catch (error: unknown) {
    if (props.orgId !== orgId) return;
    saveError.value = saved
      ? t("aiObservability.promptManagement.secretSavePartial")
      : promptErrorText(error, t("aiObservability.promptManagement.settingsSaveError"));
  }
}

watch(() => [props.open, props.orgId], load, { immediate: true });
</script>
