<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="t('aiObservability.promptManagement.saveAsPrompt')"
    :primary-button-label="
      matches.length
        ? t('aiObservability.promptManagement.saveDuplicate')
        : values.mode === 'create'
          ? t('aiObservability.promptManagement.createPrompt')
          : t('aiObservability.promptManagement.appendVersion')
    "
    :secondary-button-label="t('aiObservability.promptManagement.cancel')"
    form-id="save-as-prompt-form"
    data-test="save-as-prompt-dialog"
    @update:open="requestClose"
    @click:secondary="requestClose(false)"
  >
    <OForm id="save-as-prompt-form" :form="form" class="flex flex-col gap-4">
      <OFormSelect
        name="mode"
        :label="t('aiObservability.promptManagement.destination')"
        :options="modeOptions"
        data-test="save-as-prompt-mode"
      />
      <OFormInput
        v-if="values.mode === 'create'"
        name="name"
        :label="t('aiObservability.promptManagement.immutableName')"
        :placeholder="raw('support-answer')"
        required
        data-test="save-as-prompt-name"
      />
      <template v-else>
        <OEmptyState
          v-if="promptQuery.isError.value"
          preset="load-error"
          size="block"
          :description="t('aiObservability.promptManagement.loadError')"
          @action="promptQuery.refetch()"
        />
        <OFormSelect
          name="targetId"
          :label="t('aiObservability.promptManagement.prompt')"
          :options="promptOptions"
          searchable
          :loading="promptQuery.isFetching.value"
          required
          data-test="save-as-prompt-target"
        />
        <p
          v-if="!promptQuery.isPending.value && !promptQuery.isError.value && !promptOptions.length"
          class="text-text-secondary text-xs"
        >
          {{ t("aiObservability.promptManagement.noCompatiblePrompts") }}
        </p>
      </template>
      <OFormTextarea
        name="commitMessage"
        :label="t('aiObservability.promptManagement.commitMessage')"
        :placeholder="t('aiObservability.promptManagement.explainChanges')"
        :rows="2"
        required
        data-test="save-as-prompt-commit"
      />
      <div
        v-if="matches.length"
        role="status"
        class="rounded-default border-border-default border p-3 text-xs"
      >
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
      <p v-if="saveError" role="alert" class="text-status-error-text text-sm">{{ saveError }}</p>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { promptErrorText } from "./promptUx";
import {
  makeSaveAsPromptSchema,
  saveAsPromptDefaults,
  type SaveAsPromptForm,
} from "./SaveAsPrompt.schema";
import {
  llmPromptsQuery,
  createPromptMutation,
  createPromptVersionMutation,
} from "@/services/llm-prompts.service.queries";
import llmPromptsService, {
  type Prompt,
  type PromptConfig,
  type PromptMatch,
  type PromptSource,
  type PromptType,
} from "@/services/llm-prompts.service";

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
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
const emit = defineEmits<{ "update:open": [open: boolean]; saved: [prompt: Prompt] }>();
const form = useOForm<SaveAsPromptForm>({
  defaultValues: saveAsPromptDefaults(),
  schema: makeSaveAsPromptSchema(t),
  onSubmit: save,
});
const values = form.useStore((state) => state.values);
const saving = form.useStore((state) => state.isSubmitting);
const dirty = form.useStore((state) => state.isDirty);
const matches = ref<PromptMatch[]>([]);
const confirmedFingerprint = ref("");
const saveError = ref<I18nText>();
const promptQuery = useQuery(() => ({
  ...llmPromptsQuery(props.orgId),
  enabled: props.open && Boolean(props.orgId) && values.value.mode === "append",
}));
const createPrompt = useMutation(() => createPromptMutation(props.orgId));
const createVersion = useMutation(() => createPromptVersionMutation(props.orgId));
const modeOptions = [
  { label: t("aiObservability.promptManagement.createNewPrompt"), value: "create" },
  { label: t("aiObservability.promptManagement.appendExistingPrompt"), value: "append" },
];
const promptOptions = computed(() =>
  (promptQuery.data.value ?? [])
    .filter((prompt) => prompt.status === "active" && prompt.type === props.type)
    .map((prompt) => ({
      label: raw(`${prompt.name} · v${prompt.latestVersion}`),
      value: prompt.entityId,
    })),
);
const fingerprint = computed(() =>
  JSON.stringify({
    orgId: props.orgId,
    type: props.type,
    payload: props.payload,
    config: props.config,
    mode: values.value.mode,
    name: values.value.name,
    targetId: values.value.targetId,
  }),
);
let generation = 0;

async function requestClose(open: boolean) {
  if (open || saving.value) return;
  if (
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

async function save(value: SaveAsPromptForm) {
  const currentGeneration = generation;
  const orgId = props.orgId;
  const content = { type: props.type, payload: props.payload, config: props.config };
  const source = props.source;
  const folderId = props.folderId;
  const contentFingerprint = fingerprint.value;
  saveError.value = undefined;
  try {
    const discovered = await llmPromptsService.match(orgId, content);
    if (currentGeneration !== generation || contentFingerprint !== fingerprint.value) return;
    matches.value = discovered;
    if (discovered.length && confirmedFingerprint.value !== contentFingerprint) {
      confirmedFingerprint.value = contentFingerprint;
      return;
    }
    let saved: Prompt;
    if (value.mode === "create") {
      const result = await createPrompt.mutateAsync({
        input: {
          ...content,
          name: value.name.trim(),
          folderId,
          commitMessage: value.commitMessage.trim(),
          source,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      saved = result.prompt;
    } else {
      // Read the current head before appending so concurrent edits are detected.
      const target = await llmPromptsService.get(orgId, value.targetId);
      if (currentGeneration !== generation) return;
      if (target.status !== "active" || target.type !== content.type)
        throw new Error(t("aiObservability.promptManagement.selectActivePrompt"));
      const base = await llmPromptsService.getVersion(orgId, target.entityId, target.latestVersion);
      if (currentGeneration !== generation) return;
      const result = await createVersion.mutateAsync({
        entityId: target.entityId,
        input: {
          payload: content.payload,
          config: content.config,
          commitMessage: value.commitMessage.trim(),
          source,
          baseVersion: base.version,
          baseHash: base.contentHash,
        },
        ifHead: target.latestVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      saved = result.prompt;
    }
    if (currentGeneration !== generation) return;
    emit("saved", saved);
    form.reset(saveAsPromptDefaults());
    emit("update:open", false);
    toast({
      variant: "success",
      message: t("aiObservability.promptManagement.savedPromptVersion", {
        name: saved.name,
        version: saved.latestVersion,
      }),
    });
  } catch (error: unknown) {
    if (currentGeneration === generation)
      saveError.value = promptErrorText(error, t("aiObservability.promptManagement.saveError"));
  }
}
watch(fingerprint, () => {
  matches.value = [];
  confirmedFingerprint.value = "";
});
watch(
  () => [props.open, props.orgId, props.type],
  () => {
    generation++;
    form.reset(saveAsPromptDefaults());
    matches.value = [];
    confirmedFingerprint.value = "";
    saveError.value = undefined;
  },
  { immediate: true },
);
</script>
