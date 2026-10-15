<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <!-- h-full keeps the footer on screen inside the AI shell's scrolling section. -->
  <OForm :form="form" class="h-full w-full">
    <OPageLayout
      :back="{
        label: t('aiObservability.nav.prompts'),
        onClick: goBack,
        dataTest: 'prompt-editor-back-btn',
      }"
      :title="
        prompt
          ? t('aiObservability.promptManagement.createVersion', {
              version: prompt.latestVersion + 1,
            })
          : t('aiObservability.promptManagement.newPrompt')
      "
      bleed
      data-test="prompt-editor-page"
    >
      <div class="flex min-h-0 flex-1 gap-0 overflow-hidden max-[68.75rem]:flex-col">
        <div
          class="flex min-h-0 min-w-0 flex-[6.5] flex-col gap-2 overflow-auto p-2 max-[68.75rem]:flex-[1_1_auto]"
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
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="prompt-editor-details-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.promptManagement.form.detailsSection") }}
              </span>
            </div>
            <div class="flex flex-col gap-3 px-4 py-3.5">
              <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                <OFormInput
                  name="name"
                  :label="t('aiObservability.promptManagement.name')"
                  :placeholder="t('aiObservability.promptManagement.namePlaceholder')"
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
              >
                <template #tooltip>
                  <OTooltip :content="t('aiObservability.promptManagement.tagsHelp')" />
                </template>
              </OFormInput>
            </div>
          </section>
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="prompt-editor-configuration-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.promptManagement.configuration") }}
              </span>
            </div>
            <div class="flex flex-col gap-3 px-4 py-3.5">
              <div class="flex flex-col gap-1">
                <span
                  class="text-compact text-input-label-text flex items-center gap-1 leading-tight font-medium"
                >
                  {{ t("aiObservability.promptManagement.promptBody")
                  }}<span aria-hidden="true" class="select-none">*</span>
                  <OIcon
                    name="info-outline"
                    size="sm"
                    class="cursor-help"
                    data-test="prompt-editor-body-info"
                  >
                    <OTooltip :content="t('aiObservability.promptManagement.variableHint')" />
                  </OIcon>
                </span>
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
                <p
                  v-if="type === 'chat' && submitted && !hasBody"
                  role="alert"
                  class="text-status-error-text text-xs"
                >
                  {{ t("aiObservability.promptManagement.bodyRequired") }}
                </p>
              </div>
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
            </div>
          </section>
        </div>

        <aside
          class="border-border-default min-w-0 flex-[3.5] overflow-auto border-s p-3 max-[68.75rem]:border-s-0 max-[68.75rem]:border-t"
          data-test="prompt-editor-rail"
        >
          <section class="border-dialog-header-border rounded-default border px-4 py-3.5">
            <header class="text-text-secondary mb-1.5 flex items-center gap-1.5">
              <OIcon name="info-outline" size="xs" />
              <span class="text-compact text-text-heading m-0 font-semibold">
                {{ t("aiObservability.promptManagement.form.summaryTitle") }}
              </span>
            </header>
            <dl
              class="[&_dt]:text-text-secondary [&_dd]:text-text-body m-0 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-xs [&_dd]:m-0"
            >
              <dt>{{ t("aiObservability.promptManagement.type") }}</dt>
              <dd>{{ typeOptions.find((option) => option.value === type)?.label }}</dd>
              <dt>{{ t("aiObservability.promptManagement.version") }}</dt>
              <dd class="tabular-nums">
                {{
                  t("aiObservability.promptManagement.versionNumber", {
                    version: handoffVersion.version,
                  })
                }}
              </dd>
              <dt>{{ t("aiObservability.promptManagement.model") }}</dt>
              <dd>{{ model ? raw(model) : t("aiObservability.promptManagement.form.notSet") }}</dd>
              <dt>{{ t("aiObservability.promptManagement.form.variables") }}</dt>
              <dd>
                <div v-if="variables.length" class="flex flex-wrap gap-1">
                  <OTag
                    v-for="variable in variables"
                    :key="variable"
                    variant="default-soft"
                    shape="rounded"
                    >{{ variable }}</OTag
                  >
                </div>
                <template v-else>{{ t("aiObservability.promptManagement.form.notSet") }}</template>
              </dd>
            </dl>
            <p class="text-text-secondary mt-3 mb-0 text-xs leading-normal">
              {{ t("aiObservability.promptManagement.form.immutableNote") }}
            </p>
          </section>
        </aside>
      </div>

      <footer
        class="bg-surface-base border-border-default sticky bottom-0 z-1 flex shrink-0 items-center justify-end gap-2 border-t px-5.5 py-3"
      >
        <OButton
          type="button"
          variant="outline"
          size="sm-action"
          :disabled="Boolean(testDisabledReason)"
          data-test="prompt-editor-test-btn"
          @click="openPlayground"
        >
          <OTooltip v-if="testDisabledReason" :content="testDisabledReason" />
          {{ t("aiObservability.promptManagement.testInPlayground") }}
        </OButton>
        <OButton
          type="button"
          variant="outline"
          size="sm-action"
          :disabled="saving"
          data-test="prompt-editor-cancel-btn"
          @click="goBack"
        >
          {{ t("aiObservability.promptManagement.cancel") }}
        </OButton>
        <OButton
          type="submit"
          variant="primary"
          size="sm-action"
          :loading="saving"
          data-test="prompt-editor-submit-btn"
        >
          {{
            duplicateConfirmed
              ? prompt
                ? t("aiObservability.promptManagement.saveDuplicate")
                : t("aiObservability.promptManagement.createDuplicate")
              : prompt
                ? t("aiObservability.promptManagement.saveVersion")
                : t("aiObservability.promptManagement.createPrompt")
          }}
        </OButton>
      </footer>
    </OPageLayout>
  </OForm>

  <ConfirmDialog
    v-model="leaveDialog.show"
    :title="t('aiObservability.promptManagement.discardChangesTitle')"
    :message="t('aiObservability.promptManagement.discardChangesMessage')"
    @update:ok="leaveDialog.onConfirm"
    @update:cancel="leaveDialog.show = false"
  />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import onlineEvalsService from "@/services/online-evals.service";
import { onlineEvalKeys } from "@/services/online-evals.service.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import {
  createPromptMutation,
  createPromptVersionMutation,
} from "@/services/llm-prompts.service.queries";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useStore } from "vuex";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import {
  makePromptEditorSchema,
  promptEditorDefaults,
  isPromptJson,
  type PromptEditorForm,
} from "./PromptEditor.schema";
import { promptErrorText } from "./promptUx";
import { aiPromptsRoute } from "./promptRoutes";
import { storePromptPlaygroundHandoff } from "./promptPlaygroundHandoff";
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
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() =>
  String(store.state.selectedOrganization?.identifier ?? route.query.org_identifier ?? ""),
);
const folderId = computed(() => String(route.query.folder ?? "default"));
const entityIdParam = computed(() => String(route.params.entityId ?? ""));
const baseVersionParam = computed(() => Number(route.query.base_version) || null);
// Null on the create route; loaded from the route on the new-version route.
const prompt = ref<Prompt | null>(null);
const baseVersion = ref<PromptVersion | null>(null);
const leaveDialog = reactive({ show: false, onConfirm: () => {} });
let allowLeave = false;

const createPrompt = useMutation(() => createPromptMutation(orgId.value));
const createVersion = useMutation(() => createPromptVersionMutation(orgId.value));

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
  queryKey: onlineEvalKeys.providers(orgId.value),
  queryFn: () => onlineEvalsService.providers.list(orgId.value),
  staleTime: MEDIUM_STALE_TIME,
  enabled: enterpriseMode && Boolean(orgId.value),
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
const testDisabledReason = computed(() => {
  if (!hasBody.value) return t("aiObservability.promptManagement.form.testNeedsBody");
  if (!validConfiguration.value)
    return t("aiObservability.promptManagement.form.testNeedsValidJson");
  return null;
});
const handoffVersion = computed<PromptVersion>(() => ({
  id: baseVersion.value?.id ?? "draft",
  entityId: prompt.value?.entityId ?? "draft",
  version: prompt.value ? prompt.value.latestVersion + 1 : 1,
  payload: payload.value,
  config: configValue.value,
  commitMessage: commitMessage.value,
  source: "ui",
  baseVersion: baseVersion.value?.version ?? null,
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
  const version = baseVersion.value;
  variant.messages = chatMessages(version?.payload);
  form.reset({
    name: prompt.value?.name ?? "",
    type: prompt.value?.type ?? "text",
    description: prompt.value?.description ?? "",
    tagsText: prompt.value?.tags.join(", ") ?? "",
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

function goBack() {
  router.push(
    aiPromptsRoute(orgId.value, {
      entityId: prompt.value?.entityId,
      query: { folder: folderId.value },
    }),
  );
}

function openPlayground() {
  if (!router.hasRoute("aiPlayground")) {
    toast({
      variant: "info",
      message: t("aiObservability.promptManagement.enterprisePlaygroundOnly"),
    });
    return;
  }
  const version = handoffVersion.value;
  const promptName = prompt.value?.name ?? (name.value.trim() || "draft");
  storePromptPlaygroundHandoff({
    entityId: version.entityId,
    id: version.id,
    name: promptName,
    version: version.version,
    payload: version.payload,
    config: version.config,
    provenance: { type: "prompt", label: `${promptName}@v${version.version}` },
  });
  // The draft travels with the handoff, so leaving is not a discard.
  allowLeave = true;
  router.push({ name: "aiPlayground", query: { org_identifier: orgId.value, from: "prompt" } });
}

// Loads the prompt and the version being edited on the new-version route.
let loadGeneration = 0;
async function load() {
  const generation = ++loadGeneration;
  const requestedOrg = orgId.value;
  const entityId = entityIdParam.value;
  prompt.value = null;
  baseVersion.value = null;
  if (!entityId || !requestedOrg) return reset();
  try {
    const loaded = await llmPromptsService.get(requestedOrg, entityId);
    const version = await llmPromptsService.getVersion(
      requestedOrg,
      entityId,
      baseVersionParam.value ?? loaded.latestVersion,
    );
    if (generation !== loadGeneration) return;
    prompt.value = loaded;
    baseVersion.value = version;
    reset();
  } catch (error: unknown) {
    if (generation !== loadGeneration) return;
    toast({
      variant: "error",
      message: promptErrorText(error, t("aiObservability.promptManagement.versionLoadError")),
    });
    allowLeave = true;
    goBack();
  }
}

async function save(value: PromptEditorForm) {
  const requestedOrg = orgId.value;
  const entityId = prompt.value?.entityId;
  const fingerprint = contentFingerprint.value;
  try {
    const discoveredMatches = await llmPromptsService.match(
      orgId.value,
      {
        type: type.value,
        payload: payload.value,
        config: configValue.value,
      },
      folderId.value,
    );
    if (
      requestedOrg !== orgId.value ||
      entityId !== prompt.value?.entityId ||
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
    const result = prompt.value
      ? await createVersion.mutateAsync({
          entityId: prompt.value.entityId,
          input: {
            payload: payload.value,
            config: configValue.value,
            commitMessage: commitMessage.value.trim(),
            source: "ui",
            baseVersion: baseVersion.value?.version ?? prompt.value.latestVersion,
          },
          ifHead: prompt.value.latestVersion,
          idempotencyKey: crypto.randomUUID(),
        })
      : await createPrompt.mutateAsync({
          input: {
            name: name.value.trim(),
            folderId: folderId.value,
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
    if (requestedOrg !== orgId.value || entityId !== prompt.value?.entityId) return;
    toast({
      variant: "success",
      message: prompt.value
        ? t("aiObservability.promptManagement.versionSaveSuccess", {
            version: result.version.version,
          })
        : t("aiObservability.promptManagement.createSuccess"),
    });
    allowLeave = true;
    router.push(
      aiPromptsRoute(orgId.value, {
        entityId: result.prompt.entityId,
        version: result.version.version,
        query: { folder: result.prompt.folderId },
      }),
    );
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
watch([orgId, entityIdParam, baseVersionParam], load, { immediate: true });

onBeforeRouteLeave((to, _from, next) => {
  if (allowLeave || !dirty.value) {
    next();
    return;
  }
  // Cancel and ask in a dialog: browsers suppress confirm() during navigation.
  next(false);
  const destination = to.fullPath;
  leaveDialog.onConfirm = () => {
    leaveDialog.show = false;
    allowLeave = true;
    router.push(destination);
  };
  leaveDialog.show = true;
});
</script>
