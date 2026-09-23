<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="t('aiObservability.promptManagement.saveAsPrompt')"
    :primary-button-label="
      mode === 'create'
        ? t('aiObservability.promptManagement.createPrompt')
        : t('aiObservability.promptManagement.appendVersion')
    "
    :secondary-button-label="t('aiObservability.promptManagement.cancel')"
    :primary-button-disabled="!canSave"
    :primary-button-loading="saving"
    data-test="save-as-prompt-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
    @click:primary="save"
  >
    <div class="flex flex-col gap-4">
      <OSelect
        v-model="mode"
        :label="t('aiObservability.promptManagement.destination')"
        :options="modeOptions"
        label-key="label"
        value-key="value"
        data-test="save-as-prompt-mode"
      />
      <OInput
        v-if="mode === 'create'"
        v-model="name"
        :label="t('aiObservability.promptManagement.immutableName')"
        :placeholder="raw('support-answer')"
        data-test="save-as-prompt-name"
      />
      <OSelect
        v-else
        v-model="targetId"
        :label="t('aiObservability.promptManagement.prompt')"
        :options="promptOptions"
        label-key="label"
        value-key="value"
        searchable
        :loading="loadingPrompts"
        data-test="save-as-prompt-target"
      />
      <OTextarea
        v-model="commitMessage"
        :label="t('aiObservability.promptManagement.commitMessage')"
        :placeholder="t('aiObservability.promptManagement.explainChanges')"
        :rows="2"
        required
        data-test="save-as-prompt-commit"
      />
      <div v-if="matches.length" class="rounded-default border-border-default border p-3 text-xs">
        <div class="text-text-heading font-semibold">
          {{ t("aiObservability.promptManagement.matchingContentExists") }}
        </div>
        <div v-for="match in matches" :key="match.id" class="text-text-secondary mt-1">
          {{
            t("aiObservability.promptManagement.promptVersionReference", {
              name: match.name,
              version: match.version,
            })
          }}
        </div>
        <div class="text-text-secondary mt-2">
          {{ t("aiObservability.promptManagement.saveAgainToContinue") }}
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import llmPromptsService, {
  type Prompt,
  type PromptConfig,
  type PromptMatch,
  type PromptSource,
  type PromptType,
} from "@/services/llm-prompts.service";

const { t } = useI18nTyped();
const props = withDefaults(
  defineProps<{
    open: boolean;
    orgId: string;
    payload: unknown;
    config: PromptConfig;
    type?: PromptType;
    source?: PromptSource;
    folderId?: string;
  }>(),
  { type: "chat", source: "ui", folderId: "default" },
);

const emit = defineEmits<{
  "update:open": [open: boolean];
  saved: [prompt: Prompt];
}>();

const mode = ref<"create" | "append">("create");
const name = ref("");
const targetId = ref("");
const commitMessage = ref("");
const prompts = ref<Prompt[]>([]);
const matches = ref<PromptMatch[]>([]);
const confirmedFingerprint = ref("");
const loadingPrompts = ref(false);
const saving = ref(false);

const modeOptions = [
  { label: t("aiObservability.promptManagement.createNewPrompt"), value: "create" },
  { label: t("aiObservability.promptManagement.appendExistingPrompt"), value: "append" },
];
const promptOptions = computed(() =>
  prompts.value
    .filter((prompt) => prompt.status === "active" && prompt.type === props.type)
    .map((prompt) => ({
      label: raw(`${prompt.name} · v${prompt.latestVersion}`),
      value: prompt.entityId,
    })),
);
const fingerprint = computed(() =>
  JSON.stringify({ type: props.type, payload: props.payload, config: props.config }),
);
const canSave = computed(
  () =>
    Boolean(props.orgId) &&
    Boolean(props.folderId) &&
    commitMessage.value.trim().length > 0 &&
    (mode.value === "create" ? /^[a-z0-9_-]+$/.test(name.value) : Boolean(targetId.value)),
);

async function loadPrompts() {
  if (!props.open || !props.orgId) return;
  loadingPrompts.value = true;
  try {
    prompts.value = await llmPromptsService.list(props.orgId);
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to load prompts."),
    });
  } finally {
    loadingPrompts.value = false;
  }
}

function reset() {
  mode.value = "create";
  name.value = "";
  targetId.value = "";
  commitMessage.value = "";
  matches.value = [];
  confirmedFingerprint.value = "";
  void loadPrompts();
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const discovered = await llmPromptsService.match(props.orgId, {
      type: props.type,
      payload: props.payload,
      config: props.config,
    });
    matches.value = discovered;
    if (discovered.length && confirmedFingerprint.value !== fingerprint.value) {
      confirmedFingerprint.value = fingerprint.value;
      toast({
        variant: "warning",
        message: raw("Matching content exists. Review it, then save again to continue."),
      });
      return;
    }

    let saved: Prompt;
    if (mode.value === "create") {
      const result = await llmPromptsService.create(
        props.orgId,
        {
          name: name.value.trim(),
          folderId: props.folderId,
          type: props.type,
          payload: props.payload,
          config: props.config,
          commitMessage: commitMessage.value.trim(),
          source: props.source,
        },
        crypto.randomUUID(),
      );
      saved = result.prompt;
    } else {
      const target = prompts.value.find((prompt) => prompt.entityId === targetId.value);
      if (!target) throw new Error("Select an active Prompt.");
      const base = await llmPromptsService.getVersion(
        props.orgId,
        target.entityId,
        target.latestVersion,
      );
      const result = await llmPromptsService.createVersion(
        props.orgId,
        target.entityId,
        {
          payload: props.payload,
          config: props.config,
          commitMessage: commitMessage.value.trim(),
          source: props.source,
          baseVersion: base.version,
          baseHash: base.contentHash,
        },
        { ifHead: target.latestVersion, idempotencyKey: crypto.randomUUID() },
      );
      saved = result.prompt;
    }
    emit("saved", saved);
    emit("update:open", false);
    toast({ variant: "success", message: raw(`${saved.name}@v${saved.latestVersion} saved.`) });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to save Prompt."),
    });
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.open,
  (open) => open && reset(),
  { immediate: true },
);
</script>
