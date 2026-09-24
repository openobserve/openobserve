<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="open"
    size="xl"
    :title="
      prompt
        ? t('aiObservability.promptManagement.createVersion', { version: prompt.latestVersion + 1 })
        : t('aiObservability.promptManagement.newPrompt')
    "
    :primary-button-label="
      duplicateConfirmed
        ? prompt
          ? t('aiObservability.promptManagement.saveDuplicate')
          : t('aiObservability.promptManagement.createDuplicate')
        : prompt
          ? t('aiObservability.promptManagement.saveVersion')
          : t('aiObservability.promptManagement.createPrompt')
    "
    :secondary-button-label="t('aiObservability.promptManagement.cancel')"
    form-id="prompt-editor-form"
    data-test="prompt-editor-dialog"
    @update:open="requestClose"
    @click:secondary="requestClose(false)"
  >
    <OForm
      id="prompt-editor-form"
      :form="form"
      class="flex max-h-[72vh] flex-col gap-4 overflow-auto p-0.5"
    >
      <div
        v-if="prompt && baseVersion"
        class="rounded-default bg-status-info-bg text-text-body px-3 py-2 text-xs"
      >
        {{
          t("aiObservability.promptManagement.editingVersion", {
            from: baseVersion.version,
            to: prompt.latestVersion + 1,
          })
        }}
      </div>

      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <OFormInput
          name="name"
          :label="t('aiObservability.promptManagement.name')"
          :placeholder="t('aiObservability.promptManagement.namePlaceholder')"
          :help-text="t('aiObservability.promptManagement.nameHelp')"
          :disabled="Boolean(prompt)"
          required
          data-test="prompt-editor-name"
        />
        <OFormSelect
          name="type"
          :label="t('aiObservability.promptManagement.type')"
          :options="typeOptions"
          label-key="label"
          value-key="value"
          :disabled="Boolean(prompt)"
          data-test="prompt-editor-type"
        />
      </div>

      <OFormTextarea
        v-if="!prompt"
        name="description"
        :label="t('aiObservability.promptManagement.description')"
        :rows="2"
      />
      <OFormInput
        v-if="!prompt"
        name="tagsText"
        :label="t('aiObservability.promptManagement.tags')"
        :placeholder="t('aiObservability.promptManagement.tagsPlaceholder')"
        :help-text="t('aiObservability.promptManagement.tagsHelp')"
      />

      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-text-heading text-xs font-semibold">
            {{ t("aiObservability.promptManagement.promptBody") }}
          </label>
          <span class="text-text-secondary text-2xs">
            {{ t("aiObservability.promptManagement.variableHint") }}
          </span>
        </div>
        <OFormTextarea
          v-if="type === 'text'"
          name="textPayload"
          :aria-label="t('aiObservability.promptManagement.promptBody')"
          :rows="10"
          :placeholder="t('aiObservability.promptManagement.bodyPlaceholder')"
          data-test="prompt-editor-text"
        />
        <PlaygroundMessageList
          v-else
          :variant="variant"
          :var-names="variables"
          :vars="variableValues"
          @update="updateMessage"
          @remove="removeMessage"
          @add="addMessage"
          @set-role="setRole"
          @set-tool="setTool"
          @set-tool-arguments="setToolArguments"
          @move="moveMessage"
        />
        <div v-if="variables.length" class="flex flex-wrap gap-1">
          <OTag
            v-for="variable in variables"
            :key="variable"
            variant="default-soft"
            shape="rounded"
            >{{ variable }}</OTag
          >
        </div>
        <p
          v-if="type === 'chat' && submitted && !hasBody"
          role="alert"
          class="text-status-error-text text-xs"
        >
          {{ t("aiObservability.promptManagement.bodyRequired") }}
        </p>
      </section>

      <section class="rounded-default border-border-default flex flex-col gap-3 border p-3">
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("aiObservability.promptManagement.configuration") }}
        </h4>
        <p class="text-text-secondary text-xs">
          {{ t("aiObservability.promptManagement.optionalConfiguration") }}
        </p>
        <OFormSelect
          v-if="enterpriseMode"
          name="model"
          :label="t('aiObservability.promptManagement.model')"
          :options="modelOptions"
          label-key="label"
          value-key="value"
          searchable
          clearable
          data-test="prompt-editor-model"
        />
        <OFormInput
          v-else
          name="model"
          :label="t('aiObservability.promptManagement.model')"
          :placeholder="t('aiObservability.promptManagement.modelPlaceholder')"
          data-test="prompt-editor-model"
        />
        <span v-if="capableProviders.length" class="text-text-secondary text-2xs">
          {{
            t("aiObservability.promptManagement.availableProviders", {
              providers: capableProviders.join(", "),
            })
          }}
        </span>
        <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <OFormTextarea
            name="paramsText"
            :label="t('aiObservability.promptManagement.parametersJson')"
            :rows="4"
          />
          <OFormTextarea
            name="toolsText"
            :label="t('aiObservability.promptManagement.toolsJson')"
            :rows="4"
          />
          <OFormTextarea
            name="responseFormatText"
            :label="t('aiObservability.promptManagement.responseFormatJson')"
            :rows="4"
          />
        </div>
      </section>

      <OFormTextarea
        name="commitMessage"
        :label="t('aiObservability.promptManagement.commitMessage')"
        :placeholder="t('aiObservability.promptManagement.explainChanges')"
        :rows="2"
        required
        data-test="prompt-editor-commit-message"
      />

      <div
        v-if="duplicateConfirmed"
        role="status"
        class="rounded-default border-border-default border p-3 text-xs"
      >
        <div class="text-text-heading mb-1 font-semibold">
          {{ t("aiObservability.promptManagement.sameContentExists") }}
        </div>
        <div v-for="match in matches" :key="match.id" class="text-text-secondary">
          {{
            t("aiObservability.promptManagement.promptVersionReference", {
              name: match.name,
              version: match.version,
            })
          }}
        </div>
      </div>

      <div class="flex justify-end">
        <OButton
          variant="outline"
          size="sm"
          :disabled="!hasBody || !validConfiguration"
          @click="emit('test', handoffVersion, name)"
        >
          {{ t("aiObservability.promptManagement.testInPlayground") }}
        </OButton>
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { providersQuery } from "@/services/online-evals.service.queries";
import {
  createPromptMutation,
  createPromptVersionMutation,
} from "@/services/llm-prompts.service.queries";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import {
  makePromptEditorSchema,
  promptEditorDefaults,
  isPromptJson,
  type PromptEditorForm,
} from "./PromptEditor.schema";
import { promptErrorText } from "./promptUx";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import PlaygroundMessageList from "@/enterprise/components/AIObservability/PlaygroundMessageList.vue";
import type {
  PlaygroundMessage,
  PlaygroundRole,
  PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

import llmPromptsService, {
  type Prompt,
  type PromptConfig,
  type PromptMatch,
  type PromptVersion,
} from "@/services/llm-prompts.service";

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const props = withDefaults(
  defineProps<{
    open: boolean;
    orgId: string;
    folderId: string;
    prompt?: Prompt | null;
    baseVersion?: PromptVersion | null;
  }>(),
  { prompt: null, baseVersion: null },
);

const createPrompt = useMutation(() => createPromptMutation(props.orgId));
const createVersion = useMutation(() => createPromptVersionMutation(props.orgId));

const emit = defineEmits<{
  "update:open": [open: boolean];
  saved: [prompt: Prompt];
  test: [version: PromptVersion, draftName: string];
}>();

const typeOptions = [
  { label: t("aiObservability.promptManagement.text"), value: "text" },
  { label: t("aiObservability.promptManagement.chat"), value: "chat" },
];
const enterpriseMode = config.isEnterprise === "true" || config.isCloud === "true";
const form = useOForm<PromptEditorForm>({
  defaultValues: promptEditorDefaults(),
  schema: makePromptEditorSchema(t),
  onSubmit: save,
});
const name = form.useStore((state) => state.values.name);
const type = form.useStore((state) => state.values.type);
const textPayload = form.useStore((state) => state.values.textPayload);
const model = form.useStore((state) => state.values.model ?? "");
const paramsText = form.useStore((state) => state.values.paramsText);
const toolsText = form.useStore((state) => state.values.toolsText);
const responseFormatText = form.useStore((state) => state.values.responseFormatText);
const commitMessage = form.useStore((state) => state.values.commitMessage);
const saving = form.useStore((state) => state.isSubmitting);
const submitted = form.useStore((state) => state.submissionAttempts > 0);
const dirty = form.useStore((state) => state.isDirty);
const matches = ref<PromptMatch[]>([]);
const confirmedMatchFingerprint = ref("");
const providerQuery = useQuery(() => ({
  ...providersQuery(props.orgId),
  enabled: props.open && enterpriseMode && Boolean(props.orgId),
}));
const providers = computed(() => providerQuery.data.value ?? []);
const variableValues = reactive<Record<string, string>>({});
const variant = reactive<PlaygroundVariant>({
  id: "prompt-editor",
  providerId: "",
  model: "",
  temperature: "",
  messages: [],
  tools: [],
  responseSchema: null,
});

const payload = computed(() =>
  type.value === "text"
    ? textPayload.value
    : variant.messages.map(({ role, content }) => ({ role, content })),
);
const variables = computed(() => {
  const found = new Set<string>();
  const text =
    type.value === "text" ? textPayload.value : variant.messages.map((m) => m.content).join("\n");
  for (const match of text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) found.add(match[1]);
  return [...found].sort();
});
const hasBody = computed(() =>
  type.value === "text"
    ? textPayload.value.trim().length > 0
    : variant.messages.some((message) => message.content.trim().length > 0),
);
const validConfiguration = computed(
  () =>
    isPromptJson(paramsText.value, true) &&
    isPromptJson(toolsText.value) &&
    isPromptJson(responseFormatText.value),
);
const modelOptions = computed(() => {
  const models = new Set<string>();
  for (const provider of providers.value) {
    for (const available of provider.availableModels ?? provider.available_models ?? [])
      models.add(available);
    const preferred = provider.defaultModel ?? provider.default_model;
    if (preferred) models.add(preferred);
  }
  if (model.value) models.add(model.value);
  return [...models].sort().map((value) => ({ label: raw(value), value }));
});
const capableProviders = computed(() =>
  providers.value
    .filter((provider) => {
      const models = provider.availableModels ?? provider.available_models ?? [];
      return (
        models.includes(model.value) ||
        (provider.defaultModel ?? provider.default_model) === model.value
      );
    })
    .map((provider) => provider.name),
);
const configValue = computed<PromptConfig>(() => ({
  model: model.value.trim() || null,
  params: parseObjectJson(paramsText.value),
  tools: parseJson(toolsText.value),
  responseFormat: parseJson(responseFormatText.value),
}));
const handoffVersion = computed<PromptVersion>(() => ({
  id: props.baseVersion?.id ?? "draft",
  entityId: props.prompt?.entityId ?? "draft",
  version: props.prompt ? props.prompt.latestVersion + 1 : 1,
  payload: payload.value,
  config: configValue.value,
  commitMessage: commitMessage.value,
  source: "ui",
  baseVersion: props.baseVersion?.version ?? null,
  contentHash: "",
  createdBy: "",
  createdAt: 0,
}));
const contentFingerprint = computed(() =>
  JSON.stringify({ type: type.value, payload: payload.value, config: configValue.value }),
);
const duplicateConfirmed = computed(
  () => matches.value.length > 0 && confirmedMatchFingerprint.value === contentFingerprint.value,
);

function parseJson(value: string): unknown | null {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseObjectJson(value: string): Record<string, unknown> | null {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

const PLAYGROUND_ROLES: PlaygroundRole[] = ["system", "user", "assistant", "tool"];
function isPlaygroundRole(value: unknown): value is PlaygroundRole {
  return typeof value === "string" && PLAYGROUND_ROLES.some((role) => role === value);
}

function chatMessages(payload: unknown): PlaygroundMessage[] {
  const defaults: PlaygroundMessage[] = [
    { id: "prompt-system", role: "system", content: "" },
    { id: "prompt-user", role: "user", content: "" },
  ];
  if (!Array.isArray(payload)) return defaults;
  const messages = payload.flatMap((entry, index): PlaygroundMessage[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const roleValue = "role" in entry ? entry.role : "user";
    const role = isPlaygroundRole(roleValue) ? roleValue : "user";
    const contentValue = "content" in entry ? entry.content : "";
    return [{ id: `prompt-message-${index}`, role, content: String(contentValue ?? "") }];
  });
  return messages.length ? messages : defaults;
}

function reset() {
  const version = props.baseVersion;
  variant.messages = chatMessages(version?.payload);
  form.reset({
    name: props.prompt?.name ?? "",
    type: props.prompt?.type ?? "text",
    description: props.prompt?.description ?? "",
    tagsText: props.prompt?.tags.join(", ") ?? "",
    textPayload: typeof version?.payload === "string" ? version.payload : "",
    chatContent: variant.messages.map((message) => message.content),
    model: version?.config.model ?? "",
    paramsText: version?.config.params ? JSON.stringify(version.config.params, null, 2) : "{}",
    toolsText: version?.config.tools ? JSON.stringify(version.config.tools, null, 2) : "",
    responseFormatText: version?.config.responseFormat
      ? JSON.stringify(version.config.responseFormat, null, 2)
      : "",
    commitMessage: "",
  });
  matches.value = [];
  confirmedMatchFingerprint.value = "";
}

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

async function save(value: PromptEditorForm) {
  const orgId = props.orgId;
  const entityId = props.prompt?.entityId;
  const fingerprint = contentFingerprint.value;
  try {
    const discoveredMatches = await llmPromptsService.match(props.orgId, {
      type: type.value,
      payload: payload.value,
      config: configValue.value,
    });
    if (
      !props.open ||
      orgId !== props.orgId ||
      entityId !== props.prompt?.entityId ||
      fingerprint !== contentFingerprint.value
    )
      return;
    matches.value = discoveredMatches;
    if (discoveredMatches.length && confirmedMatchFingerprint.value !== contentFingerprint.value) {
      confirmedMatchFingerprint.value = contentFingerprint.value;
      toast({
        variant: "warning",
        message: t("aiObservability.promptManagement.matchingContentWarning"),
      });
      return;
    }
    const result = props.prompt
      ? await createVersion.mutateAsync({
          entityId: props.prompt.entityId,
          input: {
            payload: payload.value,
            config: configValue.value,
            commitMessage: commitMessage.value.trim(),
            source: "ui",
            baseVersion: props.baseVersion?.version ?? props.prompt.latestVersion,
          },
          ifHead: props.prompt.latestVersion,
          idempotencyKey: crypto.randomUUID(),
        })
      : await createPrompt.mutateAsync({
          input: {
            name: name.value.trim(),
            folderId: props.folderId,
            type: type.value,
            description: value.description.trim() || null,
            tags: value.tagsText
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
            payload: payload.value,
            config: configValue.value,
            commitMessage: commitMessage.value.trim(),
            source: "ui",
          },
          idempotencyKey: crypto.randomUUID(),
        });
    if (!props.open || orgId !== props.orgId || entityId !== props.prompt?.entityId) return;
    emit("saved", result.prompt);
    emit("update:open", false);
    toast({
      variant: "success",
      message: props.prompt
        ? t("aiObservability.promptManagement.versionSaveSuccess", {
            version: result.version.version,
          })
        : t("aiObservability.promptManagement.createSuccess"),
    });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: promptErrorText(error, t("aiObservability.promptManagement.saveError")),
    });
  }
}

function updateMessage(id: string, content: string) {
  const message = variant.messages.find((entry) => entry.id === id);
  if (message) message.content = content;
}
function removeMessage(id: string) {
  variant.messages = variant.messages.filter((message) => message.id !== id);
}
function addMessage(role: PlaygroundRole) {
  variant.messages.push({ id: crypto.randomUUID(), role, content: "" });
}
function setRole(id: string, role: PlaygroundRole) {
  const message = variant.messages.find((entry) => entry.id === id);
  if (message) message.role = role;
}
function setTool(id: string, toolName: string) {
  const message = variant.messages.find((entry) => entry.id === id);
  if (message) message.toolName = toolName;
}
function setToolArguments(id: string, toolArguments: string) {
  const message = variant.messages.find((entry) => entry.id === id);
  if (message) message.toolArguments = toolArguments;
}
function moveMessage(from: number, to: number) {
  const [message] = variant.messages.splice(from, 1);
  if (message) variant.messages.splice(to, 0, message);
}

watch(
  () => variant.messages.map((message) => message.content),
  (content) => form.setFieldValue("chatContent", content),
  { flush: "sync" },
);
watch(() => [props.open, props.orgId, props.prompt?.entityId, props.baseVersion?.id], reset, {
  immediate: true,
});
</script>
