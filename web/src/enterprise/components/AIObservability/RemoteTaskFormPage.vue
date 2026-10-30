<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  Register (or edit) a Remote Task.

  This component OWNS the one <OForm> (owner pattern): the form is built with
  useOForm and read back through form.useStore, so auth and signing can swap
  their fields on the current values without a mirror ref.

  Registering is two calls, not one — POST /tasks produces an UNVERIFIED DRAFT
  that no Experiment can reference, and only a passing test connection publishes
  a version. So the primary action runs both, and the Test-connection rail is
  that button's other half rather than an optional extra.
-->
<template>
  <OForm :form="form" class="h-full w-full" v-slot="{ isSubmitting }">
    <OPageLayout
      :back="{
        label: t('aiObservability.remoteTasks.form.backTo'),
        onClick: cancel,
        dataTest: 'ai-remote-task-form-back-btn',
      }"
      title-overflow="visible"
      bleed
    >
      <template #title>
        <span data-test="ai-remote-task-form-title">{{ pageTitle }}</span>
      </template>

      <div
        class="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)] gap-0 overflow-hidden max-[68.75rem]:grid-cols-1"
      >
        <div class="flex min-h-0 min-w-0 flex-col gap-2 overflow-auto p-2">
          <!-- Identity -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-remote-task-form-identity-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.remoteTasks.form.identitySection") }}
              </span>
            </div>
            <div class="flex flex-col gap-3 px-4 py-3.5">
              <OFormInput
                name="name"
                :label="t('aiObservability.remoteTasks.form.nameLabel')"
                :placeholder="t('aiObservability.remoteTasks.form.namePlaceholder')"
                size="sm"
                required
                data-test="ai-remote-task-form-name-input"
              />
              <OFormTextarea
                name="description"
                :label="t('aiObservability.remoteTasks.form.descriptionLabel')"
                :placeholder="t('aiObservability.remoteTasks.form.descriptionPlaceholder')"
                size="sm"
                :rows="2"
                data-test="ai-remote-task-form-description-input"
              />
            </div>
          </section>

          <!-- Endpoint -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-remote-task-form-endpoint-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.remoteTasks.form.endpointSection") }}
              </span>
            </div>
            <!-- Width lives on the wrapper, never on the field: OInput and OSelect
                 set `w-full` on their own root, and that utility is emitted after
                 `w-32` in the stylesheet, so a width passed through loses. -->
            <div class="flex items-start gap-3 px-4 py-3.5">
              <div class="w-32 shrink-0">
                <OFormSelect
                  name="httpMethod"
                  :label="t('aiObservability.remoteTasks.form.methodLabel')"
                  :options="methodOptions"
                  :searchable="false"
                  data-test="ai-remote-task-form-method-select"
                />
              </div>
              <div class="min-w-0 flex-1">
                <OFormInput
                  name="endpoint"
                  :label="t('aiObservability.remoteTasks.form.endpointLabel')"
                  :placeholder="t('aiObservability.remoteTasks.form.endpointPlaceholder')"
                  :help-text="endpointHelp"
                  size="sm"
                  required
                  data-test="ai-remote-task-form-endpoint-input"
                />
              </div>
            </div>
          </section>

          <!-- Auth -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-remote-task-form-auth-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.remoteTasks.form.authSection") }}
              </span>
            </div>
            <div class="flex flex-col gap-3 px-4 py-3.5">
              <OFormSelect
                name="authType"
                :label="t('aiObservability.remoteTasks.form.authTypeLabel')"
                :options="authOptions"
                :searchable="false"
                :disabled="mode === 'edit'"
                data-test="ai-remote-task-form-auth-select"
              />

              <OFormInput
                v-if="authType === 'api_key_header'"
                name="authHeaderName"
                :label="t('aiObservability.remoteTasks.form.headerNameLabel')"
                :placeholder="t('aiObservability.remoteTasks.form.headerNamePlaceholder')"
                size="sm"
                :disabled="mode === 'edit'"
                :required="mode === 'create'"
                data-test="ai-remote-task-form-auth-header-input"
              />

              <OFormInput
                v-if="authType === 'bearer' || authType === 'api_key_header'"
                name="token"
                type="password"
                revealable
                :label="t('aiObservability.remoteTasks.form.tokenLabel')"
                :placeholder="t('aiObservability.remoteTasks.form.tokenPlaceholder')"
                size="sm"
                :disabled="mode === 'edit'"
                :required="mode === 'create'"
                data-test="ai-remote-task-form-token-input"
              />

              <!-- One credential, so one row. Width goes on the wrappers, never
                   on the fields — see the Endpoint row. -->
              <div v-if="authType === 'basic'" class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <OFormInput
                    name="username"
                    :label="t('aiObservability.remoteTasks.form.usernameLabel')"
                    size="sm"
                    :disabled="mode === 'edit'"
                    :required="mode === 'create'"
                    data-test="ai-remote-task-form-username-input"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <OFormInput
                    name="password"
                    type="password"
                    revealable
                    :label="t('aiObservability.remoteTasks.form.passwordLabel')"
                    size="sm"
                    :disabled="mode === 'edit'"
                    :required="mode === 'create'"
                    data-test="ai-remote-task-form-password-input"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Request contract -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-remote-task-form-contract-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.remoteTasks.form.contractSection") }}
              </span>
            </div>
            <div class="flex flex-col gap-4 px-4 py-3.5">
              <div class="flex flex-col gap-2">
                <span
                  class="o-input-label text-compact text-input-label-text leading-tight font-medium"
                >
                  {{ t("aiObservability.remoteTasks.form.headersLabel") }}
                </span>
                <!-- Index key, never a stable id: OForm resolves a field name once
                     at creation, so reordering on delete would leave each surviving
                     input bound to its old index. -->
                <div v-for="(header, index) in headers" :key="index" class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <OFormInput
                      :name="`headers[${index}].key`"
                      :placeholder="t('aiObservability.remoteTasks.form.headerKeyPlaceholder')"
                      size="sm"
                      :disabled="Boolean(header.usesSecret)"
                      :data-test="`ai-remote-task-form-header-key-${index}`"
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <OFormInput
                      :name="`headers[${index}].value`"
                      :placeholder="
                        header.usesSecret
                          ? raw('••••••••')
                          : t('aiObservability.remoteTasks.form.headerValuePlaceholder')
                      "
                      size="sm"
                      :disabled="Boolean(header.usesSecret)"
                      :data-test="`ai-remote-task-form-header-value-${index}`"
                    />
                  </div>
                  <OButton
                    variant="ghost-destructive"
                    size="icon-sm"
                    icon-left="delete"
                    :aria-label="t('aiObservability.remoteTasks.form.removeHeader')"
                    :disabled="Boolean(header.usesSecret)"
                    :data-test="`ai-remote-task-form-header-remove-${index}`"
                    @click="removeHeader(index)"
                  />
                </div>
                <OButton
                  variant="outline"
                  size="sm"
                  icon-left="add"
                  class="self-start"
                  data-test="ai-remote-task-form-header-add"
                  @click="addHeader"
                >
                  {{ t("aiObservability.remoteTasks.form.addHeader") }}
                </OButton>
              </div>

              <div class="flex flex-col gap-2">
                <div ref="templateFieldRef">
                  <OFormTextarea
                    name="requestTemplate"
                    :label="t('aiObservability.remoteTasks.form.templateLabel')"
                    :placeholder="raw(DEFAULT_REQUEST_TEMPLATE)"
                    :help-text="t('aiObservability.remoteTasks.form.templateHelp')"
                    size="sm"
                    :rows="4"
                    data-test="ai-remote-task-form-template-input"
                  />
                </div>
                <span class="text-text-secondary text-2xs">
                  {{ t("aiObservability.remoteTasks.form.templateVariables") }}
                </span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <OButton
                    v-for="placeholder in TEMPLATE_PLACEHOLDERS"
                    :key="placeholder"
                    variant="outline"
                    size="xs"
                    class="font-mono"
                    :data-test="`ai-remote-task-form-placeholder-${placeholder}`"
                    @click="appendPlaceholder(placeholder)"
                  >
                    {{ raw(placeholderToken(placeholder)) }}
                  </OButton>
                </div>
              </div>

              <OFormInput
                name="responseSchema"
                :label="t('aiObservability.remoteTasks.form.responsePathLabel')"
                :help-text="t('aiObservability.remoteTasks.form.responsePathHelp')"
                size="sm"
                required
                data-test="ai-remote-task-form-response-path-input"
              />
            </div>
          </section>

          <!-- Limits -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-remote-task-form-limits-section"
          >
            <div
              class="border-border-default flex items-center justify-between border-b px-3 py-2.5"
            >
              <div class="flex items-center">
                <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
                <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                  {{ t("aiObservability.remoteTasks.form.limitsSection") }}
                </span>
              </div>
              <span class="text-text-secondary text-2xs italic">
                {{ t("aiObservability.remoteTasks.form.limitsHelp") }}
              </span>
            </div>
            <div class="flex flex-wrap items-start gap-3 px-4 py-3.5">
              <div class="min-w-0 flex-1">
                <OFormInput
                  name="timeoutSeconds"
                  type="number"
                  :label="t('aiObservability.remoteTasks.form.timeoutLabel')"
                  :min="TIMEOUT_SECONDS_MIN"
                  :max="TIMEOUT_SECONDS_MAX"
                  size="sm"
                  data-test="ai-remote-task-form-timeout-input"
                />
              </div>
              <div class="min-w-0 flex-1">
                <OFormInput
                  name="maxAttempts"
                  type="number"
                  :label="t('aiObservability.remoteTasks.form.attemptsLabel')"
                  :min="ATTEMPTS_MIN"
                  :max="ATTEMPTS_MAX"
                  size="sm"
                  data-test="ai-remote-task-form-attempts-input"
                />
              </div>
              <div class="min-w-0 flex-1">
                <OFormInput
                  name="maxConcurrency"
                  type="number"
                  :label="t('aiObservability.remoteTasks.form.concurrencyLabel')"
                  :min="CONCURRENCY_MIN"
                  :max="CONCURRENCY_MAX"
                  size="sm"
                  data-test="ai-remote-task-form-concurrency-input"
                />
              </div>
            </div>
          </section>

          <!-- Signing -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-remote-task-form-signing-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.remoteTasks.form.signingSection") }}
              </span>
            </div>
            <div class="flex flex-col gap-3 px-4 py-3.5">
              <OFormSwitch
                name="signingEnabled"
                :label="t('aiObservability.remoteTasks.form.signingToggle')"
                :disabled="mode === 'edit'"
                data-test="ai-remote-task-form-signing-toggle"
              />
              <template v-if="signingEnabled && mode === 'create'">
                <!-- The key is shown BEFORE the register button, not after:
                     the test connection is signed with it, so it has to be in
                     the operator's own service before that call goes out. -->
                <div class="flex flex-col gap-1.5">
                  <span
                    class="o-input-label text-compact text-input-label-text leading-tight font-medium"
                  >
                    {{ t("aiObservability.remoteTasks.form.signingKeyLabel") }}
                  </span>
                  <div class="flex items-center gap-2">
                    <code
                      class="text-text-body rounded-default bg-card-bg border-border-default min-w-0 flex-1 overflow-x-auto border px-2 py-1.5 font-mono text-xs"
                      data-test="ai-remote-task-form-signing-key"
                      >{{ signingKey }}</code
                    >
                    <OButton
                      variant="outline"
                      size="icon-sm"
                      :icon-left="signingKeyCopied ? 'check' : 'content-copy'"
                      :aria-label="t('aiObservability.remoteTasks.generatedSigning.copy')"
                      data-test="ai-remote-task-form-signing-key-copy"
                      @click="copySigningKey"
                    >
                      <OTooltip
                        side="bottom"
                        :content="
                          signingKeyCopied
                            ? t('aiObservability.remoteTasks.generatedSigning.copied')
                            : t('aiObservability.remoteTasks.generatedSigning.copy')
                        "
                      />
                    </OButton>
                    <OButton
                      variant="outline"
                      size="icon-sm"
                      icon-left="autorenew"
                      :aria-label="t('aiObservability.remoteTasks.form.regenerateKey')"
                      data-test="ai-remote-task-form-signing-key-regenerate"
                      @click="regenerateSigningKey"
                    >
                      <OTooltip
                        side="bottom"
                        :content="t('aiObservability.remoteTasks.form.regenerateKey')"
                      />
                    </OButton>
                  </div>
                  <span class="text-text-secondary text-2xs">
                    {{ t("aiObservability.remoteTasks.form.signingKeyOnce") }}
                    <code class="text-text-body font-mono">{{ headerShape }}</code>
                  </span>
                  <OBanner
                    v-if="signingKeyRegenerated"
                    variant="warning"
                    dense
                    icon="key"
                    data-test="ai-remote-task-form-signing-key-regenerated"
                  >
                    {{ t("aiObservability.remoteTasks.form.signingKeyRegenerated") }}
                  </OBanner>
                </div>
              </template>
            </div>
          </section>
        </div>

        <RemoteTaskTestPanel
          v-model:input="sampleInput"
          v-model:metadata="sampleMetadata"
          :org-id="orgId"
          :can-run="canRunTest"
          :state="testState"
          :report="testReport"
          :error-message="testError"
          :hint="
            unpublishedSecret
              ? t('aiObservability.remoteTasks.testPanel.unpublishedSecretHint')
              : testsStoredVersion
                ? t('aiObservability.remoteTasks.testPanel.storedCredentialsHint', storedTarget)
                : null
          "
          @run="runCandidateTest"
        />
      </div>

      <footer
        class="bg-surface-base border-border-default sticky bottom-0 z-1 flex shrink-0 items-center justify-end gap-2 border-t px-5.5 py-3"
      >
        <OButton
          type="button"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          data-test="ai-remote-task-form-cancel-btn"
          @click="cancel"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          v-if="mode === 'create'"
          type="submit"
          variant="outline"
          size="sm-action"
          :loading="isSubmitting && submitIntent === 'draft'"
          :disabled="!canSaveDraft"
          data-test="ai-remote-task-form-draft-btn"
          @click="submitIntent = 'draft'"
        >
          {{ t("aiObservability.remoteTasks.form.saveDraft") }}
          <OTooltip
            v-if="!canSaveDraft"
            side="top"
            :content="t('aiObservability.remoteTasks.form.saveDraftBlocked')"
          />
        </OButton>
        <OButton
          type="submit"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting && submitIntent === 'publish'"
          data-test="ai-remote-task-form-submit-btn"
          @click="submitIntent = 'publish'"
        >
          {{ submitLabel }}
        </OButton>
      </footer>
    </OPageLayout>
    <EditorDraftDialogs :draft="taskDraft" />
  </OForm>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  createRemoteTaskMutation,
  saveRemoteTaskDraftMutation,
  testRemoteTaskConnectionMutation,
} from "@/services/llm-experiments.queries";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { remoteTaskKeys } from "@/services/llm-experiments.querykeys";
import remoteTasksService, {
  type RemoteTask,
  type RemoteTaskTestRunRow,
  type RemoteTaskVerificationReport,
} from "@/services/remote-tasks.service";
import RemoteTaskTestPanel from "./RemoteTaskTestPanel.vue";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import { useEditorDraft, useEditorDraftIds } from "@/composables/useEditorDraft";
import {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  DEFAULT_REQUEST_TEMPLATE,
  SIGNATURE_HEADER_SHAPE,
  TEMPLATE_PLACEHOLDERS,
  TIMEOUT_SECONDS_MAX,
  TIMEOUT_SECONDS_MIN,
  canEditRemoteTask,
  generateSigningKey,
  parseSampleInput,
  parseSampleMetadata,
  placeholderToken,
} from "./remoteTaskContent";
import {
  makeRemoteTaskSchema,
  remoteTaskFormDefaults,
  remoteTaskToFormValues,
  toCreatePayload,
  toDraftPayload,
  type RemoteTaskFormValues,
} from "./RemoteTaskForm.schema";
import {
  aiRemoteTaskDetailRoute,
  aiRemoteTasksRoute,
} from "@/enterprise/views/AIObservability/remoteTaskRoutes";

defineOptions({ name: "RemoteTaskFormPage" });

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const routeEntityId = computed<string>(() => String(route.params.id ?? ""));
const mode = computed<"create" | "edit">(() => (routeEntityId.value ? "edit" : "create"));

const pageTitle = computed<I18nText>(() =>
  mode.value === "edit"
    ? t("aiObservability.remoteTasks.form.editTitle")
    : t("aiObservability.remoteTasks.form.createTitle"),
);

const methodOptions = computed(() => [
  { label: raw("POST"), value: "POST" },
  { label: raw("PUT"), value: "PUT" },
  { label: raw("PATCH"), value: "PATCH" },
]);

const authOptions = computed(() => [
  { label: t("aiObservability.remoteTasks.auth.none"), value: "none" },
  { label: t("aiObservability.remoteTasks.auth.bearer"), value: "bearer" },
  { label: t("aiObservability.remoteTasks.auth.basic"), value: "basic" },
  { label: t("aiObservability.remoteTasks.auth.apiKeyHeader"), value: "api_key_header" },
]);

const requireHttps = config.isCloud === "true";
const endpointHelp = computed<I18nText>(() =>
  requireHttps
    ? t("aiObservability.remoteTasks.form.endpointHelp")
    : t("aiObservability.remoteTasks.form.endpointHelpSelfHosted"),
);

// Built once, not computed: useOForm hands the schema straight to TanStack.
const schema = makeRemoteTaskSchema(t as unknown as (_key: string) => string, {
  requireHttps,
  preserveSecrets: mode.value === "edit",
});

const form = useOForm<RemoteTaskFormValues>({
  defaultValues: remoteTaskFormDefaults(),
  schema,
  onSubmit: onSubmit,
});

/**
 * Which button was pressed. Both go through `handleSubmit` so they share one
 * validation pass and the automatic Save spinner; only the call at the end
 * differs.
 */
const submitIntent = ref<"publish" | "draft">("publish");

function onSubmit(values: RemoteTaskFormValues) {
  if (taskDraft.pendingReentries().some((path) => secretInUse(path, values))) {
    toast({ variant: "error", message: t("common.editorDraft.reenterBeforeSave") });
    return;
  }
  return submitIntent.value === "draft" ? saveDraftOnly(values) : publish(values);
}

const authType = form.useStore((state: any) => state.values.authType as string);
const signingEnabled = form.useStore((state: any) => state.values.signingEnabled as boolean);
const headers = form.useStore(
  (state: any) => state.values.headers as { key: string; value: string; usesSecret?: boolean }[],
);
const nameValue = form.useStore((state: any) => String(state.values.name ?? ""));
const endpointValue = form.useStore((state: any) => String(state.values.endpoint ?? ""));
const templateValue = form.useStore((state: any) => String(state.values.requestTemplate ?? ""));
const templateFieldRef = ref<HTMLElement | null>(null);

// ── The test sample. It lives here rather than in the panel because the footer's
// primary button runs the same test the panel's button does.
const sampleInput = ref("");
const sampleMetadata = ref("");
const testState = ref<"idle" | "running" | "passed" | "failed">("idle");
const testReport = ref<RemoteTaskVerificationReport | null>(null);
const testError = ref<I18nText | null>(null);

const canRunTest = computed(
  () => Boolean(nameValue.value.trim() && endpointValue.value.trim()) && !unpublishedSecret.value,
);

/**
 * Whether the task being edited holds a write-only secret. The form can never
 * repopulate one, so a candidate test would send it blank; such a task is
 * tested through `test_run`, which uses the published version's stored secrets.
 */
const testsStoredVersion = ref(false);
/** A secret-holding task that was never published: nothing to test until Publish. */
const unpublishedSecret = ref(false);
/** What a stored-version test calls, named in the hint so a pass is not read as one for the form. */
const storedTarget = reactive({ version: 0, endpoint: "" });

const signingKey = form.useStore((state: any) => String(state.values.signingKey ?? ""));
const signingKeyCopied = ref(false);
/** Set when a continued draft got a new key, since drafts never keep the one the operator may have copied. */
const signingKeyRegenerated = ref(false);
const headerShape = raw(SIGNATURE_HEADER_SHAPE);

// A key exists from the instant signing is switched on, so the operator can put
// it in their own service before the (signed) test connection runs.
watch(signingEnabled, (enabled) => {
  if (mode.value === "edit") return;
  if (enabled && !signingKey.value) form.setFieldValue("signingKey", generateSigningKey());
  if (!enabled) {
    form.setFieldValue("signingKey", "");
    signingKeyCopied.value = false;
    signingKeyRegenerated.value = false;
  }
});

function regenerateSigningKey() {
  form.setFieldValue("signingKey", generateSigningKey());
  signingKeyCopied.value = false;
  signingKeyRegenerated.value = false;
}

async function copySigningKey() {
  try {
    await navigator.clipboard.writeText(signingKey.value);
    signingKeyCopied.value = true;
    signingKeyRegenerated.value = false;
  } catch {
    signingKeyCopied.value = false;
  }
}

// Registering is create + test-connection; a draft save is its own write, and each declares the scope it drops.
const createRemoteTask = useMutation(() => createRemoteTaskMutation(orgId.value));
const saveRemoteTaskDraft = useMutation(() => saveRemoteTaskDraftMutation(orgId.value));
const testRemoteTaskConnection = useMutation(() => testRemoteTaskConnectionMutation(orgId.value));

/** The head this form is writing to. Set by the first successful create, so a
 *  retry after a failed test edits the draft rather than registering twice. */
const draftEntityId = ref("");
const draftFromVersion = ref<number | undefined>(undefined);
/** Whether the registered head holds any secret. A secret-bearing draft cannot
 *  be re-sent (its reference is write-only), so a retry re-registers instead. */
const draftHasSecret = ref(false);

const submitLabel = computed<I18nText>(() => {
  if (mode.value === "edit") return t("aiObservability.remoteTasks.form.submitEdit");
  return draftEntityId.value
    ? t("aiObservability.remoteTasks.form.submitRetry")
    : t("aiObservability.remoteTasks.form.submit");
});

function addHeader() {
  form.setFieldValue("headers", [
    ...(headers.value ?? []),
    { key: "", value: "", usesSecret: false },
  ]);
}

function removeHeader(index: number) {
  form.setFieldValue(
    "headers",
    (headers.value ?? []).filter((_, position) => position !== index),
  );
}

/** Appends to the template rather than inserting at the caret: OFormTextarea owns
 *  the element, and reaching into it for a selection range would be a second
 *  source of truth for the field's value. */
/**
 * Put a placeholder where the caret is.
 *
 * Two things this must NOT do. It must not fall back to
 * `DEFAULT_REQUEST_TEMPLATE`: that string is the field's placeholder attribute
 * — grey hint text, not a value — so treating it as the base materialised a
 * whole template the author never typed and glued the token onto its end. And
 * it must not append blindly: a body template is edited in the middle far more
 * often than at the end.
 */
function appendPlaceholder(placeholder: string) {
  const token = placeholderToken(placeholder);
  const element = templateInput();
  const current = templateValue.value;
  const start = element?.selectionStart ?? current.length;
  const end = element?.selectionEnd ?? current.length;

  form.setFieldValue("requestTemplate", current.slice(0, start) + token + current.slice(end));

  const caret = start + token.length;
  requestAnimationFrame(() => {
    element?.focus();
    element?.setSelectionRange(caret, caret);
  });
}

/** Reached through a wrapper element we own: the field is a form-bound
 *  component whose root is a fragment, so its `$el` is a text anchor rather
 *  than something that can be queried. */
function templateInput(): HTMLTextAreaElement | null {
  return templateFieldRef.value?.querySelector("textarea") ?? null;
}

function goBack() {
  void router.push(aiRemoteTasksRoute(orgId.value));
}

async function cancel() {
  if (await taskDraft.confirmLeave()) goBack();
}

/**
 * Test the form exactly as it stands. `POST /tasks/test` takes the whole
 * candidate, so nothing is registered, no secret row is written and no version
 * is published — which is what a button called "Test Connection" should do.
 *
 * Publishing still requires a passing test; that check moved to the Publish
 * button, which runs its own against the saved draft.
 */
async function runCandidateTest() {
  if (!orgId.value) return;
  testState.value = "running";
  testError.value = null;
  testReport.value = null;

  try {
    if (testsStoredVersion.value) {
      await runStoredVersionTest();
      return;
    }
    const values = form.state.values as RemoteTaskFormValues;
    const result = await remoteTasksService.testCandidate(orgId.value, {
      ...toCreatePayload(values),
      ...currentSample(),
    });
    testReport.value = result.report ?? null;
    testState.value = result.verified ? "passed" : "failed";
    if (!result.verified) {
      testError.value = raw(result.error) || t("aiObservability.remoteTasks.form.testFailed");
    }
  } catch (error: any) {
    testState.value = "failed";
    testError.value =
      raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.form.testFailed");
  }
}

async function runStoredVersionTest() {
  const [row] = await remoteTasksService.testRun(orgId.value, routeEntityId.value, [
    currentSample(),
  ]);
  testReport.value = row
    ? {
        rawRequest: row.rawRequest,
        rawResponse: row.rawResponse,
        statusCode: row.httpStatus,
        parsedOutput: row.parsedOutput,
        latencyMs: row.latencyMs,
      }
    : null;
  // An explicit skip is a well-formed answer, which verification also counts as a pass.
  testState.value = row && row.status !== "error" ? "passed" : "failed";
  if (testState.value === "failed") {
    testError.value = storedFailureMessage(row);
  }
}

/** test_run reports a failure as a reason code; say it as a sentence. An unknown code shows as sent. */
function storedFailureMessage(row?: RemoteTaskTestRunRow): I18nText {
  switch (row?.error) {
    case "transport":
      return t("aiObservability.remoteTasks.testPanel.failure.transport");
    case "deadline_exceeded":
      return t("aiObservability.remoteTasks.testPanel.failure.deadlineExceeded");
    case "http_status":
      return t("aiObservability.remoteTasks.testPanel.failure.httpStatus", {
        status: row.httpStatus ?? "?",
      });
    case "bad_response":
      return t("aiObservability.remoteTasks.testPanel.failure.badResponse");
    case "output_too_large":
      return t("aiObservability.remoteTasks.testPanel.failure.outputTooLarge");
    case "request_error":
      return t("aiObservability.remoteTasks.testPanel.failure.requestError");
    default:
      return raw(row?.error) || t("aiObservability.remoteTasks.form.testFailed");
  }
}

function currentSample() {
  return {
    input: parseSampleInput(sampleInput.value),
    metadata: parseSampleMetadata(sampleMetadata.value),
  };
}

function valuesHaveSecret(values: RemoteTaskFormValues) {
  return values.authType !== "none" || values.signingEnabled;
}

/**
 * A draft is only worth saving if it can be re-opened, and one holding a
 * credential cannot be: its secret reference is write-only, so the draft can
 * never be sent back. Rather than let the button strand a task that can be
 * neither edited nor published, it is shut off for exactly that case.
 */
const canSaveDraft = computed(() => authType.value === "none" && !signingEnabled.value);

/**
 * Register (or re-save) and then test. A pass is the only thing that publishes.
 *
 * A failed test in create mode rolls the head back when it carries a secret:
 * the draft would be stranded, because its secret reference never reaches the
 * client and so the draft can never be re-sent. Without a secret the draft is
 * kept, which is what the registry intends — the next attempt edits it.
 */
async function publish(values: RemoteTaskFormValues) {
  if (!orgId.value) return;
  testState.value = "running";
  testError.value = null;
  testReport.value = null;

  let entityId = draftEntityId.value || routeEntityId.value;
  // Only a head that took this attempt's values may stand in for the local draft.
  let headHoldsValues = false;

  try {
    if (!entityId) {
      const created = await createRemoteTask.mutateAsync(toCreatePayload(values));
      entityId = created.entityId;
      draftEntityId.value = entityId;
      draftHasSecret.value = valuesHaveSecret(values);
      headHoldsValues = true;
    } else if (!draftHasSecret.value) {
      await saveRemoteTaskDraft.mutateAsync({
        entityId,
        payload: toDraftPayload(values, draftFromVersion.value),
      });
      headHoldsValues = true;
    }

    const result = await testRemoteTaskConnection.mutateAsync({
      entityId,
      sample: currentSample(),
    });
    testReport.value = result.report ?? null;

    if (!result.published) {
      testState.value = "failed";
      testError.value = raw(result.error) || t("aiObservability.remoteTasks.form.publishFailed");
      toast({
        variant: "error",
        message: t("aiObservability.remoteTasks.form.publishFailed"),
      });
      if (mode.value === "create" && draftHasSecret.value) await rollbackDraft(entityId);
      if (headHoldsValues) keepDraftOnRegisteredHead();
      return;
    }

    testState.value = "passed";
    toast({
      variant: "success",
      message: result.versionBumped
        ? t("aiObservability.remoteTasks.form.publishedSuccess", { version: result.task.version })
        : t("aiObservability.remoteTasks.form.republishedSuccess", {
            version: result.task.version,
          }),
    });

    if (leaveSave) {
      leaveSave.saved = true;
      return;
    }
    taskDraft.markSaved();
    void router.push(aiRemoteTaskDetailRoute(orgId.value, entityId));
  } catch (error: any) {
    testState.value = "failed";
    testError.value =
      raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.form.createError");
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.form.createError"),
    });
    if (headHoldsValues) keepDraftOnRegisteredHead();
  }
}

/** A failed publish whose head kept these values moves the local draft to that task, or a later Continue would register the name twice. */
function keepDraftOnRegisteredHead() {
  if (mode.value === "create" && draftEntityId.value) taskDraft.markSaved();
}

/** Best effort: leaving debris is worse than a silent failure here, but a failed
 *  cleanup must not overwrite the test error the operator needs to read. */
async function rollbackDraft(entityId: string) {
  try {
    await remoteTasksService.delete(orgId.value, entityId);
    // A raw delete, so the list's cached copy would keep the draft until its next refetch.
    void queryClient.invalidateQueries({ queryKey: remoteTaskKeys.all(orgId.value) });
    draftEntityId.value = "";
    draftHasSecret.value = false;
  } catch {
    /* keep the id so a retry re-tests the stored draft rather than duplicating it */
  }
}

/** Register without testing. The result is a draft no Experiment can reference —
 *  said plainly in the toast, because a silent "Saved" would imply otherwise. */
async function saveDraftOnly(values: RemoteTaskFormValues) {
  if (!orgId.value || valuesHaveSecret(values)) return;
  try {
    if (draftEntityId.value) {
      await saveRemoteTaskDraft.mutateAsync({
        entityId: draftEntityId.value,
        payload: toDraftPayload(values, draftFromVersion.value),
      });
    } else {
      const created = await createRemoteTask.mutateAsync(toCreatePayload(values));
      draftEntityId.value = created.entityId;
      draftHasSecret.value = valuesHaveSecret(values);
    }
    toast({ variant: "success", message: t("aiObservability.remoteTasks.form.draftSuccess") });
    if (leaveSave) {
      leaveSave.saved = true;
      return;
    }
    taskDraft.markSaved();
    void router.push(aiRemoteTaskDetailRoute(orgId.value, draftEntityId.value));
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.form.draftError"),
    });
  }
}

async function loadForEdit(): Promise<boolean> {
  if (!orgId.value) return false;
  try {
    const task: RemoteTask = await remoteTasksService.get(orgId.value, routeEntityId.value);
    if (!canEditRemoteTask(task)) {
      toast({ variant: "error", message: t("aiObservability.remoteTasks.statusHint.retired") });
      goBack();
      return false;
    }
    draftFromVersion.value = task.isDraft ? undefined : task.version;
    const holdsSecret =
      task.auth.usesSecret ||
      task.signing.usesSecret ||
      task.customHeaders.some((header) => header.usesSecret);
    // test_run tests the published version, and a task never published has none.
    testsStoredVersion.value = holdsSecret && !task.isDraft;
    Object.assign(storedTarget, { version: task.version, endpoint: task.endpoint });
    unpublishedSecret.value = holdsSecret && task.isDraft;
    serverTask.value = remoteTaskToFormValues(task);
    form.reset(remoteTaskToFormValues(task));
    return true;
  } catch (error: any) {
    // Opening the draft of a task that is gone drops it and says so, in place of the load error.
    if (error?.response?.status === 404 && taskDrafts.ids.has(routeEntityId.value)) {
      await taskDraft.start();
    } else {
      toast({
        variant: "error",
        message:
          raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.detail.loadError"),
      });
    }
    goBack();
    return false;
  }
}

// Set while the leave dialog's Save runs, so a successful save stays on the page for the pending navigation.
let leaveSave: { saved: boolean } | null = null;
/** The loaded task in form shape: hashed for "changed on server", and null once it is gone. */
const serverTask = ref<RemoteTaskFormValues | null>(null);
const taskDrafts = useEditorDraftIds("remote_task");
const formValues = form.useStore((state) => state.values);

function secretFieldLabel(path: string, data: RemoteTaskFormValues): I18nText | null {
  const header = /^\/headers\/(\d+)\/value$/.exec(path);
  if (header) {
    return t("common.editorDraft.headerField", {
      name: data.headers[Number(header[1])]?.key ?? "",
    });
  }
  if (path === "/token") return t("common.editorDraft.tokenField");
  if (path === "/password") return t("common.editorDraft.passwordField");
  if (path === "/endpoint") return t("common.editorDraft.endpointUrlField");
  return null;
}

/** Whether a blanked secret is still sent with the current auth choice. */
function secretInUse(path: string, values: RemoteTaskFormValues): boolean {
  if (path === "/token")
    return values.authType === "bearer" || values.authType === "api_key_header";
  if (path === "/password") return values.authType === "basic";
  return true;
}

function describeRedacted(paths: string[], data: RemoteTaskFormValues): I18nText[] {
  return paths.flatMap((path) => secretFieldLabel(path, data) ?? []);
}

const taskDraft = useEditorDraft<RemoteTaskFormValues>({
  kind: "remote_task",
  entityLabel: () => t("common.editorDraft.entities.remote_task"),
  // "Draft" already names the registry's unpublished server version.
  serverDraftItem: true,
  restoreNote: (data) =>
    data.signingEnabled && mode.value === "create"
      ? t("aiObservability.remoteTasks.form.signingKeyNotKept")
      : null,
  // The leave dialog's Save runs the publish flow, not "Save as Draft".
  saveLabel: () => t("aiObservability.remoteTasks.form.submit"),
  entityId: () => routeEntityId.value || draftEntityId.value || null,
  // The HMAC signing key is never drafted; the signing watcher generates a new one on Continue.
  snapshot: () => ({
    ...formValues.value,
    headers: formValues.value.headers.map((header) => ({ ...header })),
    signingKey: "",
  }),
  apply: (data) => {
    form.reset({ ...remoteTaskFormDefaults(), ...data, signingKey: "" });
    signingKeyRegenerated.value = mode.value === "create" && data.signingEnabled;
  },
  base: () => (mode.value === "edit" ? serverTask.value : undefined),
  save: async () => {
    const run = { saved: false };
    leaveSave = run;
    submitIntent.value = "publish";
    try {
      await form.handleSubmit();
    } finally {
      leaveSave = null;
    }
    return run.saved;
  },
  describeRedacted,
  // Any header can carry a credential (Cookie, X-Auth, …), so no header value is drafted.
  secretLists: ["/headers"],
  secretUrls: ["/endpoint"],
});

onMounted(async () => {
  if (mode.value === "edit" && !(await loadForEdit())) return;
  await taskDraft.start();
});
</script>
