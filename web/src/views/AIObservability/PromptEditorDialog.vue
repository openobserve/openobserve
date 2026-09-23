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
      prompt
        ? t('aiObservability.promptManagement.saveVersion')
        : t('aiObservability.promptManagement.createPrompt')
    "
    :secondary-button-label="t('aiObservability.promptManagement.cancel')"
    :primary-button-loading="saving"
    :primary-button-disabled="!canSave"
    data-test="prompt-editor-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
    @click:primary="save"
  >
    <div class="flex max-h-[72vh] flex-col gap-4 overflow-auto p-0.5">
      <div
        v-if="prompt && baseVersion"
        class="rounded-default bg-info-subtle text-text-body px-3 py-2 text-xs"
      >
        {{
          t("aiObservability.promptManagement.editingVersion", {
            from: baseVersion.version,
            to: prompt.latestVersion + 1,
          })
        }}
      </div>

      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <OInput
          v-model="name"
          :label="t('aiObservability.promptManagement.name')"
          :placeholder="raw('support-answer')"
          :disabled="Boolean(prompt)"
          required
          data-test="prompt-editor-name"
        />
        <OSelect
          v-model="type"
          :label="t('aiObservability.promptManagement.type')"
          :options="typeOptions"
          label-key="label"
          value-key="value"
          :disabled="Boolean(prompt)"
          data-test="prompt-editor-type"
        />
      </div>

      <OTextarea
        v-if="!prompt"
        v-model="description"
        :label="t('aiObservability.promptManagement.description')"
        :rows="2"
      />
      <OInput
        v-if="!prompt"
        v-model="tagsText"
        :label="t('aiObservability.promptManagement.tags')"
        :placeholder="raw('support, production')"
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
        <OTextarea
          v-if="type === 'text'"
          v-model="textPayload"
          :rows="10"
          :placeholder="raw('Write the prompt…')"
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
      </section>

      <section class="rounded-default border-border-default flex flex-col gap-3 border p-3">
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("aiObservability.promptManagement.configuration") }}
        </h4>
        <OSelect
          v-if="enterpriseMode"
          v-model="model"
          :label="t('aiObservability.promptManagement.model')"
          :options="modelOptions"
          label-key="label"
          value-key="value"
          searchable
          clearable
          data-test="prompt-editor-model"
        />
        <OInput
          v-else
          v-model="model"
          :label="t('aiObservability.promptManagement.model')"
          :placeholder="raw('gpt-4o-mini')"
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
          <OTextarea
            v-model="paramsText"
            :label="t('aiObservability.promptManagement.parametersJson')"
            :rows="4"
          />
          <OTextarea
            v-model="toolsText"
            :label="t('aiObservability.promptManagement.toolsJson')"
            :rows="4"
          />
          <OTextarea
            v-model="responseFormatText"
            :label="t('aiObservability.promptManagement.responseFormatJson')"
            :rows="4"
          />
        </div>
      </section>

      <OTextarea
        v-model="commitMessage"
        :label="t('aiObservability.promptManagement.commitMessage')"
        :placeholder="t('aiObservability.promptManagement.explainChanges')"
        :rows="2"
        required
        data-test="prompt-editor-commit-message"
      />

      <div v-if="matches.length" class="rounded-default border-border-default border p-3 text-xs">
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
          :disabled="!hasBody"
          @click="emit('test', handoffVersion, name)"
        >
          {{ t("aiObservability.promptManagement.testInPlayground") }}
        </OButton>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import PlaygroundMessageList from "@/enterprise/components/AIObservability/PlaygroundMessageList.vue";
import type {
  PlaygroundMessage,
  PlaygroundRole,
  PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import llmPromptsService, {
  type Prompt,
  type PromptConfig,
  type PromptMatch,
  type PromptType,
  type PromptVersion,
} from "@/services/llm-prompts.service";

const { t } = useI18nTyped();
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
const name = ref("");
const type = ref<PromptType>("text");
const description = ref("");
const tagsText = ref("");
const textPayload = ref("");
const model = ref("");
const paramsText = ref("{}");
const toolsText = ref("");
const responseFormatText = ref("");
const commitMessage = ref("");
const saving = ref(false);
const matches = ref<PromptMatch[]>([]);
const confirmedMatchFingerprint = ref("");
const providers = ref<Provider[]>([]);
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
const canSave = computed(
  () =>
    Boolean(props.folderId) &&
    /^[a-z0-9_-]+$/.test(name.value) &&
    hasBody.value &&
    commitMessage.value.trim().length > 0 &&
    parseObjectJson(paramsText.value) !== null &&
    isJsonOrBlank(toolsText.value) &&
    isJsonOrBlank(responseFormatText.value),
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

function parseJson(value: string): unknown | null {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
function isJsonOrBlank(value: string): boolean {
  return !value.trim() || parseJson(value) !== null;
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
  name.value = props.prompt?.name ?? "";
  type.value = props.prompt?.type ?? "text";
  description.value = props.prompt?.description ?? "";
  tagsText.value = props.prompt?.tags.join(", ") ?? "";
  const version = props.baseVersion;
  textPayload.value = typeof version?.payload === "string" ? version.payload : "";
  variant.messages = chatMessages(version?.payload);
  model.value = version?.config.model ?? "";
  paramsText.value = version?.config.params ? JSON.stringify(version.config.params, null, 2) : "{}";
  toolsText.value = version?.config.tools ? JSON.stringify(version.config.tools, null, 2) : "";
  responseFormatText.value = version?.config.responseFormat
    ? JSON.stringify(version.config.responseFormat, null, 2)
    : "";
  commitMessage.value = "";
  matches.value = [];
  confirmedMatchFingerprint.value = "";
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const discoveredMatches = await llmPromptsService.match(props.orgId, {
      type: type.value,
      payload: payload.value,
      config: configValue.value,
    });
    matches.value = discoveredMatches;
    if (discoveredMatches.length && confirmedMatchFingerprint.value !== contentFingerprint.value) {
      confirmedMatchFingerprint.value = contentFingerprint.value;
      toast({
        variant: "warning",
        message: raw(
          "Matching content already exists. Review the matches, then save again to continue.",
        ),
      });
      return;
    }
    const result = props.prompt
      ? await llmPromptsService.createVersion(
          props.orgId,
          props.prompt.entityId,
          {
            payload: payload.value,
            config: configValue.value,
            commitMessage: commitMessage.value.trim(),
            source: "ui",
            baseVersion: props.baseVersion?.version ?? props.prompt.latestVersion,
          },
          { ifHead: props.prompt.latestVersion, idempotencyKey: crypto.randomUUID() },
        )
      : await llmPromptsService.create(
          props.orgId,
          {
            name: name.value.trim(),
            folderId: props.folderId,
            type: type.value,
            description: description.value.trim() || null,
            tags: tagsText.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
            payload: payload.value,
            config: configValue.value,
            commitMessage: commitMessage.value.trim(),
            source: "ui",
          },
          crypto.randomUUID(),
        );
    emit("saved", result.prompt);
    emit("update:open", false);
    toast({
      variant: "success",
      message: raw(props.prompt ? `Saved v${result.version.version}.` : "Prompt created."),
    });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to save prompt."),
    });
  } finally {
    saving.value = false;
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

watch(() => [props.open, props.prompt?.entityId, props.baseVersion?.id], reset, {
  immediate: true,
});
watch(
  () => props.open,
  async (open) => {
    if (open && enterpriseMode && !providers.value.length) {
      try {
        providers.value = await onlineEvalsService.providers.list(props.orgId);
      } catch {
        providers.value = [];
      }
    }
  },
  { immediate: true },
);
</script>
