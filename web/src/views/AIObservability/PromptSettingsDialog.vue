<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="t('aiObservability.promptManagement.promptSettings')"
    :primary-button-label="t('aiObservability.promptManagement.saveSettings')"
    :secondary-button-label="t('aiObservability.promptManagement.cancel')"
    :primary-button-loading="saving"
    :primary-button-disabled="!canSave"
    data-test="prompt-settings-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
    @click:primary="save"
  >
    <div class="flex flex-col gap-4">
      <OInput
        v-model="protectedLabelsText"
        :label="t('aiObservability.promptManagement.protectedLabels')"
        :help-text="t('aiObservability.promptManagement.protectedLabelsHelp')"
        :placeholder="raw('production')"
      />

      <section class="rounded-default border-border-default flex flex-col gap-3 border p-3">
        <div class="flex items-center justify-between">
          <h4 class="text-text-heading m-0 text-sm font-semibold">
            {{ t("aiObservability.promptManagement.webhook") }}
          </h4>
          <OSwitch
            v-model="webhookEnabled"
            :label="t('aiObservability.promptManagement.enabled')"
          />
        </div>
        <template v-if="webhookEnabled">
          <OInput
            v-model="endpoint"
            :label="t('aiObservability.promptManagement.endpoint')"
            type="url"
            :placeholder="raw('https://example.com/openobserve/prompts')"
            data-test="prompt-settings-webhook-endpoint"
          />
          <OSelect
            v-model="events"
            :label="t('aiObservability.promptManagement.subscriptions')"
            :options="eventOptions"
            label-key="label"
            value-key="value"
            multiple
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
              <div class="text-text-secondary text-2xs">
                {{
                  secretConfigured
                    ? t("aiObservability.promptManagement.secretConfigured")
                    : t("aiObservability.promptManagement.secretNotConfigured")
                }}
              </div>
            </div>
          </div>
          <OInput
            v-model="secret"
            type="password"
            :label="t('aiObservability.promptManagement.rotateSigningSecret')"
            :help-text="t('aiObservability.promptManagement.rotateSigningSecretHelp')"
            autocomplete="new-password"
            data-test="prompt-settings-secret"
          />
        </template>
      </section>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import llmPromptsService, {
  type PromptSettings,
  type PromptWebhookEvent,
} from "@/services/llm-prompts.service";

const { t } = useI18nTyped();
const props = defineProps<{ open: boolean; orgId: string }>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  updated: [settings: PromptSettings];
}>();

const protectedLabelsText = ref("production");
const webhookEnabled = ref(false);
const endpoint = ref("");
const events = ref<PromptWebhookEvent[]>([]);
const secret = ref("");
const secretConfigured = ref(false);
const saving = ref(false);
const eventOptions: Array<{ label: ReturnType<typeof t>; value: PromptWebhookEvent }> = [
  {
    label: t("aiObservability.promptManagement.webhookEvent.versionCreated"),
    value: "version_created",
  },
  {
    label: t("aiObservability.promptManagement.webhookEvent.labelMoved"),
    value: "label_moved",
  },
  {
    label: t("aiObservability.promptManagement.webhookEvent.labelDeleted"),
    value: "label_deleted",
  },
  {
    label: t("aiObservability.promptManagement.webhookEvent.promptArchived"),
    value: "archived",
  },
];
const canSave = computed(() => {
  if (!webhookEnabled.value) return true;
  if (!events.value.length) return false;
  try {
    const url = new URL(endpoint.value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
});

async function load() {
  if (!props.open) return;
  try {
    const settings = await llmPromptsService.getSettings(props.orgId);
    protectedLabelsText.value = settings.protectedLabels.join(", ");
    webhookEnabled.value = Boolean(settings.webhook);
    endpoint.value = settings.webhook?.endpoint ?? "";
    events.value = settings.webhook?.events ?? [];
    secretConfigured.value = settings.webhook?.secretConfigured ?? false;
    secret.value = "";
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to load settings."),
    });
  }
}

async function save() {
  saving.value = true;
  try {
    const settings = await llmPromptsService.updateSettings(props.orgId, {
      protectedLabels: protectedLabelsText.value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      webhook: webhookEnabled.value
        ? { endpoint: endpoint.value.trim(), events: events.value }
        : null,
    });
    if (webhookEnabled.value && secret.value) {
      const rotated = await llmPromptsService.rotateSecret(props.orgId, secret.value);
      secretConfigured.value = rotated.secretConfigured;
    }
    emit("updated", {
      ...settings,
      webhook: settings.webhook
        ? { ...settings.webhook, secretConfigured: secretConfigured.value }
        : null,
    });
    emit("update:open", false);
    toast({ variant: "success", message: raw("Prompt settings saved.") });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to save settings."),
    });
  } finally {
    saving.value = false;
  }
}

watch(() => props.open, load, { immediate: true });
</script>
