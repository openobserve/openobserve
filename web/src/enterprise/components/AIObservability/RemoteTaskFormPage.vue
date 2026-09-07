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
        onClick: goBack,
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
          @click="goBack"
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
  </OForm>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import remoteTasksService, {
  type RemoteTask,
  type RemoteTaskVerificationReport,
} from "@/services/remote-tasks.service";
import RemoteTaskTestPanel from "./RemoteTaskTestPanel.vue";
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

const canRunTest = computed(() => Boolean(nameValue.value.trim() && endpointValue.value.trim()));

const signingKey = form.useStore((state: any) => String(state.values.signingKey ?? ""));
const signingKeyCopied = ref(false);
const headerShape = raw(SIGNATURE_HEADER_SHAPE);

// A key exists from the instant signing is switched on, so the operator can put
// it in their own service before the (signed) test connection runs.
watch(signingEnabled, (enabled) => {
  if (mode.value === "edit") return;
  if (enabled && !signingKey.value) form.setFieldValue("signingKey", generateSigningKey());
  if (!enabled) {
    form.setFieldValue("signingKey", "");
    signingKeyCopied.value = false;
  }
});

function regenerateSigningKey() {
  form.setFieldValue("signingKey", generateSigningKey());
  signingKeyCopied.value = false;
}

async function copySigningKey() {
  try {
    await navigator.clipboard.writeText(signingKey.value);
    signingKeyCopied.value = true;
  } catch {
    signingKeyCopied.value = false;
  }
}

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

  try {
    if (!entityId) {
      const created = await remoteTasksService.create(orgId.value, toCreatePayload(values));
      entityId = created.entityId;
      draftEntityId.value = entityId;
      draftHasSecret.value = valuesHaveSecret(values);
    } else if (!draftHasSecret.value) {
      await remoteTasksService.saveDraft(
        orgId.value,
        entityId,
        toDraftPayload(values, draftFromVersion.value),
      );
    }

    const result = await remoteTasksService.testConnection(orgId.value, entityId, currentSample());
    testReport.value = result.report ?? null;

    if (!result.published) {
      testState.value = "failed";
      testError.value = raw(result.error) || t("aiObservability.remoteTasks.form.publishFailed");
      toast({
        variant: "error",
        message: t("aiObservability.remoteTasks.form.publishFailed"),
      });
      if (mode.value === "create" && draftHasSecret.value) await rollbackDraft(entityId);
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
  }
}

/** Best effort: leaving debris is worse than a silent failure here, but a failed
 *  cleanup must not overwrite the test error the operator needs to read. */
async function rollbackDraft(entityId: string) {
  try {
    await remoteTasksService.delete(orgId.value, entityId);
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
      await remoteTasksService.saveDraft(
        orgId.value,
        draftEntityId.value,
        toDraftPayload(values, draftFromVersion.value),
      );
    } else {
      const created = await remoteTasksService.create(orgId.value, toCreatePayload(values));
      draftEntityId.value = created.entityId;
      draftHasSecret.value = valuesHaveSecret(values);
    }
    toast({ variant: "success", message: t("aiObservability.remoteTasks.form.draftSuccess") });
    void router.push(aiRemoteTaskDetailRoute(orgId.value, draftEntityId.value));
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.form.draftError"),
    });
  }
}

async function loadForEdit() {
  if (mode.value !== "edit" || !orgId.value) return;
  try {
    const task: RemoteTask = await remoteTasksService.get(orgId.value, routeEntityId.value);
    if (!canEditRemoteTask(task)) {
      toast({ variant: "error", message: t("aiObservability.remoteTasks.statusHint.retired") });
      goBack();
      return;
    }
    draftFromVersion.value = task.isDraft ? undefined : task.version;
    form.reset(remoteTaskToFormValues(task));
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.detail.loadError"),
    });
    goBack();
  }
}

onMounted(loadForEdit);
</script>
