<!-- Copyright 2026 OpenObserve Inc.

  Create an offline experiment. Single pane of glass, modeled on AddAlert: the
  name IS the page title, configuration runs down the left, and the right rail
  answers "what will actually run" live — so there is no terminal Review step.

  This component OWNS the one <OForm> (owner pattern): the form is built with
  useOForm and read back through form.useStore, so there is a single source of
  truth and no mirror ref. Every control binds by `name=` into the schema.
-->
<template>
  <!-- h-full, not flex-1: the AI shell renders router-view inside a plain
     `overflow-y-auto` section, so there is no flex parent for flex-1 to fill.
     Filling the height is what lets the columns scroll internally and keeps the
     action row on screen (AddAlert does the same). -->
  <OForm :form="form" class="h-full w-full" v-slot="{ isSubmitting }">
    <OPageLayout
      :back="{
        label: t('aiObservability.nav.experiments'),
        onClick: goBack,
        dataTest: 'ai-experiment-form-back-btn',
      }"
      title-overflow="visible"
      bleed
    >
      <!-- The name is the heading, not a boxed field: creating an experiment
         starts by naming the thing, and it stays editable in place. -->
      <template #title>
        <OFormInlineEdit
          name="name"
          size="md"
          :placeholder="t('aiObservability.experiments.form.namePlaceholder')"
          :aria-label="t('aiObservability.experiments.name')"
          :edit-hint="t('aiObservability.experiments.form.nameEditHint')"
          data-test="ai-experiment-form-name-input"
        />
      </template>

      <template #subtitle>
        <OFormInlineEdit
          name="description"
          tone="meta"
          :placeholder="t('aiObservability.experiments.form.descriptionPlaceholder')"
          :aria-label="t('aiObservability.experiments.form.descriptionLabel')"
          :edit-hint="t('aiObservability.experiments.form.descriptionEditHint')"
          data-test="ai-experiment-form-description-input"
        />
      </template>

      <div class="flex min-h-0 flex-1 gap-0 overflow-hidden max-[68.75rem]:flex-col">
        <div
          class="flex min-h-0 min-w-0 flex-[6.5] flex-col gap-2 overflow-auto p-2 max-[68.75rem]:flex-[1_1_auto]"
        >
          <!-- Dataset — the comparability anchor. It sits above the tabs and
             outside them because nothing below it means anything until a
             dataset is chosen, and only same-dataset experiments compare. -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-experiment-form-dataset-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.experiments.form.datasetSection") }}
              </span>
            </div>
            <div class="flex flex-col gap-2 px-4 py-3.5">
              <div class="flex flex-wrap items-start gap-4">
                <div class="min-w-0 flex-1">
                  <OFormSelect
                    name="datasetId"
                    :label="t('aiObservability.experiments.dataset')"
                    :options="datasetOptions"
                    :placeholder="t('aiObservability.experiments.form.datasetPlaceholder')"
                    searchable
                    required
                    data-test="ai-experiment-form-dataset-select"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <OFormSelect
                    name="sources"
                    :label="t('aiObservability.experiments.form.sourcesLabel')"
                    :options="sourceOptions"
                    :placeholder="t('aiObservability.experiments.form.sourcesPlaceholder')"
                    :help-text="t('aiObservability.experiments.form.sourcesHelp')"
                    multiple
                    clearable
                    :searchable="false"
                    :disabled="!datasetSelected"
                    data-test="ai-experiment-form-sources-select"
                  />
                </div>
              </div>

              <!-- Version is shown, never chosen: an experiment snapshots the
                 dataset as it is now, and no endpoint lists prior versions. -->
              <p
                v-if="datasetSelected"
                class="text-text-secondary m-0 text-xs leading-normal"
                data-test="ai-experiment-form-dataset-meta"
              >
                {{
                  t("aiObservability.experiments.form.datasetPinned", {
                    version: selectedDatasetVersion,
                  })
                }}
                {{
                  t("aiObservability.experiments.form.datasetRows", {
                    rows: selectedDataset?.itemCount ?? 0,
                  })
                }}
              </p>
            </div>
          </section>

          <!-- Task and Scorers are BOTH required, so neither hides behind a
             tab: a tab strip reads as "pick one", and a required section you
             never opened only announces itself as a validation error. -->
          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-experiment-form-task-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.experiments.form.tabTask") }}
              </span>
            </div>
            <div class="flex flex-col gap-4 px-4 py-3.5">
              <!-- Provider owns a full row with a refresh affordance and the
                   resolved endpoint underneath — the same treatment the LLM
                   judge scorer form gives it, because it is the same decision. -->
              <div>
                <div class="flex items-end gap-2">
                  <OFormSelect
                    name="providerId"
                    :label="t('aiObservability.experiments.provider')"
                    :options="providerOptions"
                    :placeholder="t('aiObservability.experiments.form.providerPlaceholder')"
                    searchable
                    required
                    class="min-w-0 flex-1"
                    data-test="ai-experiment-form-provider-select"
                    @update:model-value="onProviderChange"
                  />
                  <OButton
                    variant="ghost"
                    size="icon-md"
                    icon-left="refresh"
                    :loading="refreshingProviders"
                    :title="t('aiObservability.experiments.form.providerRefresh')"
                    data-test="ai-experiment-form-provider-refresh-btn"
                    @click="refreshProviders"
                  />
                </div>

                <div
                  v-if="selectedProvider"
                  class="border-status-info-text rounded-default bg-status-info-bg text-text-body mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border px-3 py-2 text-xs"
                  data-test="ai-experiment-form-provider-summary"
                >
                  <span class="bg-status-info-text h-2 w-2 shrink-0 rounded-full" />
                  <span class="text-text-secondary">
                    {{ t("aiObservability.experiments.form.providerEndpointLabel") }}
                    <span class="font-mono">{{ providerEndpoint(selectedProvider) }}</span>
                  </span>
                  <span class="text-text-secondary">{{ separator }}</span>
                  <span class="text-text-secondary">
                    {{ t("aiObservability.experiments.form.providerDefaultModelLabel") }}
                    <span class="font-mono">{{ defaultModelOf(selectedProvider) || dash }}</span>
                  </span>
                </div>

                <div class="text-2xs text-text-secondary mt-1">
                  <i18n-t keypath="aiObservability.experiments.form.providerHelp" tag="span">
                    <template #settingsLink>
                      <router-link
                        :to="{ name: 'llmProviders' }"
                        class="text-accent font-semibold no-underline hover:underline"
                        target="_blank"
                      >
                        {{ t("aiObservability.experiments.form.providerHelpSettingsLink") }}
                      </router-link>
                    </template>
                  </i18n-t>
                </div>
              </div>

              <div class="flex flex-wrap items-start gap-4">
                <div class="min-w-0 flex-1">
                  <OFormSelect
                    name="model"
                    :label="t('aiObservability.experiments.model')"
                    :options="modelOptions"
                    :placeholder="t('aiObservability.experiments.form.modelPlaceholder')"
                    searchable
                    creatable
                    clearable
                    :disabled="!providerSelected"
                    :help-text="t('aiObservability.experiments.form.modelHelp')"
                    data-test="ai-experiment-form-model-select"
                  />
                </div>
                <div class="w-40 shrink-0">
                  <OFormInput
                    name="temperature"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    :label="t('aiObservability.experiments.form.temperatureLabel')"
                    :help-text="
                      Number(temperature) === 0
                        ? t('aiObservability.experiments.form.temperatureDeterministic')
                        : t('aiObservability.experiments.form.temperatureHelp')
                    "
                    data-test="ai-experiment-form-temperature-input"
                  />
                </div>
                <div class="w-40 shrink-0">
                  <OFormInput
                    name="trialCount"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    :label="t('aiObservability.experiments.trials')"
                    :help-text="
                      Number(temperature) === 0 && Number(trialCount) > 1
                        ? t('aiObservability.experiments.form.trialsDeterministicWarning')
                        : t('aiObservability.experiments.form.trialsHelp')
                    "
                    data-test="ai-experiment-form-trials-input"
                  />
                </div>
              </div>

              <OFormTextarea
                name="systemPrompt"
                :label="t('aiObservability.experiments.form.systemPromptLabel')"
                :placeholder="t('aiObservability.experiments.form.systemPromptPlaceholder')"
                :rows="3"
                data-test="ai-experiment-form-system-prompt"
              />

              <div class="flex flex-col gap-2">
                <OFormTextarea
                  name="userPrompt"
                  :label="t('aiObservability.experiments.form.userPromptLabel')"
                  :placeholder="t('aiObservability.experiments.form.userPromptPlaceholder')"
                  :rows="6"
                  required
                  data-test="ai-experiment-form-user-prompt"
                />
                <!-- The variables a dataset row exposes. Clicking one
                       appends it, so the reference is also the input method. -->
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-text-secondary text-xs">
                    {{ t("aiObservability.experiments.form.variablesLabel") }}
                  </span>
                  <OButton
                    v-for="variable in promptVariables"
                    :key="variable.name"
                    type="button"
                    variant="outline"
                    size="xs"
                    :data-test="`ai-experiment-form-variable-${variable.name}`"
                    @click="insertVariable(variable.token)"
                  >
                    {{ variable.token }}
                  </OButton>
                </div>
              </div>
            </div>
          </section>

          <section
            class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
            data-test="ai-experiment-form-scorers-section"
          >
            <div class="border-border-default flex items-center border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
                {{ t("aiObservability.experiments.scorers") }}
              </span>
            </div>
            <div class="flex flex-col gap-4 px-4 py-3.5">
              <OFormSelect
                name="scorerIds"
                :label="t('aiObservability.experiments.scorers')"
                :options="scorerOptions"
                :placeholder="t('aiObservability.experiments.form.scorersPlaceholder')"
                :help-text="t('aiObservability.experiments.form.scorersHelp')"
                multiple
                searchable
                required
                :disabled="!scorers.length"
                data-test="ai-experiment-form-scorers-select"
              />

              <div
                v-if="!scorers.length"
                class="border-dialog-header-border rounded-default text-text-secondary border border-dashed px-3.5 py-3 text-center text-xs"
              >
                {{ t("aiObservability.experiments.form.scorersEmpty") }}
              </div>

              <!-- Per-scorer applicability, straight from preview(): which
                   rows this scorer can actually score, and how many lack the
                   reference answer it needs. -->
              <div
                v-if="scorerApplicability.length"
                class="border-dialog-header-border rounded-default flex flex-col gap-2 border px-3.5 py-3"
                data-test="ai-experiment-form-applicability"
              >
                <span class="text-compact text-text-heading font-semibold">
                  {{ t("aiObservability.experiments.form.applicabilityTitle") }}
                </span>
                <p
                  v-for="entry in scorerApplicability"
                  :key="`${entry.scorerId}:${entry.scorerVersion}`"
                  class="text-text-secondary m-0 text-xs leading-normal"
                >
                  {{
                    t("aiObservability.experiments.scorerApplicability", {
                      scorer: entry.scorerId,
                      version: entry.scorerVersion,
                      eligible: entry.eligibleSlotCount,
                      noReference: entry.noReferenceSlotCount,
                    })
                  }}
                </p>
              </div>
            </div>
          </section>
        </div>

        <ExperimentPreviewPanel
          :dataset-selected="datasetSelected"
          :preview-ready="previewReady"
          :preview="preview"
          :loading="previewing"
          :error="previewFailed"
          :error-message="previewErrorMessage"
          :dataset-label="datasetLabel"
          :temperature="Number(temperature) || 0"
          :scorer-count="scorerIds.length"
          :trial-count="Number(trialCount) || 1"
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
          data-test="ai-experiment-form-cancel-btn"
          @click="goBack"
        >
          {{ t("aiObservability.experiments.cancel") }}
        </OButton>
        <OButton
          type="submit"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting"
          data-test="ai-experiment-form-submit-btn"
        >
          {{ t("aiObservability.experiments.form.submit") }}
        </OButton>
      </footer>
    </OPageLayout>
  </OForm>

  <ConfirmDialog
    v-model="leaveDialog.show"
    :title="t('aiObservability.experiments.form.leaveTitle')"
    :message="t('aiObservability.experiments.form.leaveMessage')"
    @update:ok="leaveDialog.onConfirm"
    @update:cancel="leaveDialog.show = false"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInlineEdit from "@/lib/forms/InlineEdit/OFormInlineEdit.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import llmExperimentsService, {
  type ExperimentCreatePayload,
  type ExperimentPreview,
} from "@/services/llm-experiments.service";
import onlineEvalsService, { type Provider, type Scorer } from "@/services/online-evals.service";
import {
  defaultModelOf,
  entityId,
  scorerTypeOf,
  valueOf,
} from "@/enterprise/components/onlineEvals/utils/evalEntity";
import {
  createPreviewRequestGate,
  withPreviewScorers,
} from "../../views/AIObservability/experimentPreview";
import { aiExperimentsRoute } from "../../views/AIObservability/experimentRoutes";
import ExperimentPreviewPanel from "./ExperimentPreviewPanel.vue";
import {
  EXPERIMENT_ROW_SOURCES,
  experimentFormDefaults,
  makeExperimentSchema,
  type ExperimentForm,
} from "./ExperimentForm.schema";

defineOptions({ name: "ExperimentForm" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const datasets = ref<LlmDataset[]>([]);
const scorers = ref<Scorer[]>([]);
const providers = ref<Provider[]>([]);
const refreshingProviders = ref(false);
const preview = ref<ExperimentPreview | null>(null);
const previewing = ref(false);
const previewFailed = ref(false);
const previewErrorMessage = ref("");
const previewRequests = createPreviewRequestGate();
const nextIdempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
const idempotencyKey = ref(nextIdempotencyKey());
const leaveDialog = reactive({ show: false, onConfirm: () => {} });
let allowLeave = false;

// Built once, not computed: useOForm hands the schema straight to TanStack,
// which would receive an unwrapped-nothing Ref.
const schema = makeExperimentSchema(t);
const form = useOForm<ExperimentForm>({
  defaultValues: experimentFormDefaults(String(route.query.dataset ?? "")),
  schema,
  onSubmit,
});

// Reads the owner needs that form context cannot give it: the task branch,
// the rail's summary values, and the fields that change the slot maths.
const datasetId = form.useStore((s: any) => s.values.datasetId as string);
const providerId = form.useStore((s: any) => s.values.providerId as string);
const scorerIds = form.useStore((s: any) => (s.values.scorerIds ?? []) as string[]);
const trialCount = form.useStore((s: any) => s.values.trialCount as number);
const temperature = form.useStore((s: any) => s.values.temperature as number);
// Read through useStore, never form.state: the latter is an untracked snapshot,
// so a computed built on it silently serves a stale value.
const userPrompt = form.useStore((s: any) => s.values.userPrompt as string);
const sources = form.useStore((s: any) => (s.values.sources ?? []) as string[]);
const isDirty = form.useStore((s: any) => s.isDirty as boolean);

const datasetSelected = computed(() => !!datasetId.value);
const providerSelected = computed(() => !!providerId.value);
const selectedDataset = computed(
  () => datasets.value.find((d) => d.id === datasetId.value) ?? null,
);
const selectedDatasetVersion = computed(() => selectedDataset.value?.globalVersion ?? 0);

// preview() validates the entire create body, so it can only run once the task
// section is complete. Short of that the rail says what is missing rather than
// reporting a failure the user did not cause.
const previewReady = computed(() => {
  if (!datasetId.value) return false;
  return !!providerId.value && !!String(userPrompt.value ?? "").trim();
});
const datasetLabel = computed(() =>
  selectedDataset.value ? `${selectedDataset.value.name} @ v${selectedDatasetVersion.value}` : "",
);

const datasetOptions = computed(() =>
  datasets.value.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

const sourceOptions = computed(() =>
  EXPERIMENT_ROW_SOURCES.map((source) => ({
    label: t(`aiObservability.experiments.form.sources.${source}`),
    value: source,
  })),
);

const providerOptions = computed(() =>
  providers.value.map((provider) => ({ label: raw(provider.name), value: provider.id })),
);

const selectedProvider = computed(
  () => providers.value.find((p) => p.id === providerId.value) ?? null,
);

const modelOptions = computed(() => {
  const models =
    selectedProvider.value?.availableModels ?? selectedProvider.value?.available_models ?? [];
  return models.map((model) => ({ label: raw(model), value: model }));
});

// A reference-based scorer needs a golden answer, which only a dataset row
// carries — the opposite of eval jobs, where they are unusable.
const scorerOptions = computed(() =>
  scorers.value.map((scorer) => {
    const referenceBased = scorer.referenceBased ?? scorer.reference_based ?? false;
    const type = scorerTypeOf(scorer).replace("_", " ");
    return {
      label: raw(scorer.name),
      value: entityId(scorer),
      badge: referenceBased
        ? `${type} · v${scorer.version} · reference-based`
        : `${type} · v${scorer.version}`,
    };
  }),
);

const scorerApplicability = computed(() => preview.value?.applicability?.scorerApplicability ?? []);

const promptVariables = ["input", "expected_output"].map((name) => ({
  name,
  token: raw(`{{ ${name} }}`),
}));

function goBack() {
  router.push(aiExperimentsRoute(orgId.value));
}

// Punctuation, not prose — the endpoint strip separates facts the way the
// scorer form does.
const separator = raw("·");
const dash = raw("—");

function providerEndpoint(provider: Provider) {
  if (provider.endpoint) return provider.endpoint;
  const type = String(valueOf(provider, "providerType", "provider_type") || "").toLowerCase();
  if (type === "openai") return "api.openai.com";
  if (type === "anthropic") return "api.anthropic.com";
  return "—";
}

// A provider added in another tab should be reachable without reloading.
async function refreshProviders() {
  if (!orgId.value) return;
  refreshingProviders.value = true;
  try {
    providers.value = await onlineEvalsService.providers.list(orgId.value);
  } catch {
    toast({
      variant: "error",
      message: t("aiObservability.experiments.form.providerRefreshError"),
    });
  } finally {
    refreshingProviders.value = false;
  }
}

function onProviderChange() {
  // The model list is provider-scoped, so a stale model would silently 400.
  form.setFieldValue("model", "");
}

function insertVariable(token: string) {
  const current = String(userPrompt.value ?? "");
  form.setFieldValue("userPrompt", current ? `${current}\n${token}` : token);
}

/** Explicit keys — a spread would leak schema-only fields and ship the task
 *  branch's unused strings. */
function buildPayload(values: ExperimentForm): ExperimentCreatePayload {
  const messages = [
    ...(values.systemPrompt.trim()
      ? [{ role: "system", content: values.systemPrompt.trim() }]
      : []),
    { role: "user", content: values.userPrompt },
  ];

  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    datasetId: values.datasetId,
    datasetVersion: selectedDatasetVersion.value,
    datasetFilter: values.sources.length ? { sources: [...values.sources] } : null,
    task: {
      type: "inline_prompt",
      messages,
      providerId: values.providerId,
      model: values.model.trim() || null,
      params: { temperature: Number(values.temperature) },
    },
    scorers: values.scorerIds.map((id) => ({ id })),
    trialCount: Number(values.trialCount),
    idempotencyKey: idempotencyKey.value,
  };
}

async function onSubmit(values: ExperimentForm) {
  try {
    // The server pins scorer versions itself; reusing the preview's pins when
    // one is in hand just closes the gap if a version ships mid-edit.
    const payload = buildPayload(values);
    const result = await llmExperimentsService.create(
      orgId.value,
      preview.value ? withPreviewScorers(payload, preview.value) : payload,
    );
    idempotencyKey.value = nextIdempotencyKey();
    allowLeave = true;
    toast({ variant: "success", message: t("aiObservability.experiments.createSuccess") });
    router.push(aiExperimentsRoute(orgId.value, { selectedId: result.experiment.id }));
  } catch (error: any) {
    // An AxiosError IS an Error, so error.message is only ever "Request failed
    // with status code 400" — the server's reason lives on the response body.
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) ||
        raw(error?.response?.data?.error) ||
        t("aiObservability.experiments.createError"),
    });
  }
}

async function runPreview() {
  if (!orgId.value || !previewReady.value) {
    preview.value = null;
    previewFailed.value = false;
    return;
  }
  const request = previewRequests.start();
  previewing.value = true;
  previewFailed.value = false;
  previewErrorMessage.value = "";
  try {
    const result = await llmExperimentsService.preview(
      orgId.value,
      buildPayload(form.state.values),
    );
    if (previewRequests.isCurrent(request)) preview.value = result;
  } catch (error: any) {
    if (previewRequests.isCurrent(request)) {
      preview.value = null;
      previewFailed.value = true;
      previewErrorMessage.value = String(
        error?.response?.data?.message ?? error?.response?.data?.error ?? "",
      );
    }
  } finally {
    if (previewRequests.isCurrent(request)) previewing.value = false;
  }
}

// Only the fields that change the slot maths re-request; typing a prompt does
// not. Every trigger here is a click, so there is nothing to debounce — the
// request gate inside runPreview is what keeps a slow response from landing on
// top of a newer one.
watch([datasetId, trialCount, scorerIds, sources], runPreview, { deep: true });

onBeforeRouteLeave((to, _from, next) => {
  if (allowLeave || !isDirty.value) {
    next();
    return;
  }
  // Cancel and ask in a dialog — browsers suppress confirm() during navigation.
  next(false);
  const destination = to.fullPath;
  leaveDialog.onConfirm = () => {
    leaveDialog.show = false;
    allowLeave = true;
    router.push(destination);
  };
  leaveDialog.show = true;
});

onMounted(async () => {
  if (!orgId.value) return;
  try {
    [datasets.value, scorers.value, providers.value] = await Promise.all([
      llmDatasetsService.list(orgId.value),
      onlineEvalsService.scorers.list(orgId.value),
      onlineEvalsService.providers.list(orgId.value),
    ]);
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
    return;
  }
  const preselected = providers.value.find((p) => p.isDefault ?? p.is_default);
  if (preselected && !providerId.value) form.setFieldValue("providerId", preselected.id);
  if (previewReady.value) runPreview();
});
</script>
