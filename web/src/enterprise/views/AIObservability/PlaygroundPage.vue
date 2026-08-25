<!-- Copyright 2026 OpenObserve Inc.

  The Playground bench.

  Ephemeral by design: no save button, no draft entity. The draft lives in this
  component, recent drafts live in localStorage, and the one exit that produces
  something durable is "+ Experiment".

  Two modes on one page. `draft.rows === null` is the editor bench — one input,
  variants side by side. Anything else is the compare table — rows down,
  variants across. Sampling switches modes; removing the last row switches back.
-->
<template>
  <OPageLayout bleed title-overflow="visible">
    <template #title>
      <span data-test="ai-playground-title">{{ t("aiObservability.playground.title") }}</span>
    </template>

    <template #actions>
      <ODropdown v-if="recentDrafts.length" align="end">
        <template #trigger>
          <OButton
            variant="outline"
            size="sm-action"
            icon-right="expand-more"
            data-test="ai-playground-recent-btn"
          >
            {{ t("aiObservability.playground.recentDrafts") }}
          </OButton>
        </template>
        <ODropdownItem disabled data-test="ai-playground-recent-section">
          {{ t("aiObservability.playground.recentDraftsSection") }}
        </ODropdownItem>
        <ODropdownItem
          v-for="entry in recentDrafts"
          :key="entry.id"
          :data-test="`ai-playground-recent-${entry.id}`"
          @select="restoreDraft(entry)"
        >
          {{ raw(entry.summary) }}
        </ODropdownItem>
      </ODropdown>

      <OButton
        v-if="running"
        variant="outline"
        size="sm-action"
        icon-left="close"
        data-test="ai-playground-stop-btn"
        @click="stopAll"
      >
        {{ t("aiObservability.playground.stop") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :icon-left="running ? undefined : 'play-arrow'"
        :loading="running"
        :disabled="runDisabled"
        :title="t('aiObservability.playground.runAllTooltip')"
        data-test="ai-playground-run-all-btn"
        @click="onRunAll()"
      >
        <template v-if="running">
          {{ t("aiObservability.playground.running", { done: completedCount, total: totalCells }) }}
        </template>
        <template v-else>{{ t("aiObservability.playground.runAll") }}</template>
      </OButton>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <OBanner
        v-if="!loadingProviders && !providers.length"
        variant="info"
        icon="warning"
        inline-actions
        class="mx-4 mt-3 shrink-0"
        data-test="ai-playground-no-provider"
      >
        <div class="flex flex-col gap-0.5">
          <span class="font-semibold">{{ t("aiObservability.playground.noProviderTitle") }}</span>
          <span class="text-xs">{{ t("aiObservability.playground.noProviderBody") }}</span>
        </div>
        <template #actions>
          <OButton
            variant="primary"
            size="sm-action"
            data-test="ai-playground-setup-provider-btn"
            @click="goToProviders"
          >
            {{ t("aiObservability.playground.noProviderAction") }}
          </OButton>
        </template>
      </OBanner>

      <OBanner
        v-else-if="usingMockRuns"
        variant="warning"
        dense
        icon="info"
        class="mx-4 mt-3 shrink-0"
        :content="t('aiObservability.playground.backendPending')"
        data-test="ai-playground-mock-banner"
      />

      <!-- editor bench -->
      <template v-if="!isTable">
        <PlaygroundVariableBar
          class="shrink-0"
          :var-names="varNames"
          :vars="draft.vars"
          :expected="draft.expectedSingle"
          :provenance="draft.provenance"
          @set-var="setVar"
          @set-expected="(value) => (draft.expectedSingle = value)"
          @sample="sampleOpen = true"
          @add-row="addRowOpen = true"
        />

        <div class="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto px-4 py-3">
          <PlaygroundVariantColumn
            v-for="(variant, index) in draft.variants"
            :key="variant.id"
            :variant="variant"
            :label="variantLabel(index)"
            :cell="cellFor(variant.id, SINGLE_ROW_KEY)"
            :providers="providers"
            :fields="null"
            :running="isVariantRunning(variant.id)"
            :run-disabled="runDisabled"
            :can-remove="draft.variants.length > 1"
            :can-duplicate="draft.variants.length < MAX_VARIANTS"
            @change="updateVariant"
            @run="runVariant(variant.id)"
            @duplicate="duplicate(variant.id)"
            @remove="removeVariant(variant.id)"
            @copy="copyOutput(variant.id, SINGLE_ROW_KEY)"
            @add-to-messages="addOutputToMessages(variant.id)"
            @create-experiment="createExperiment(variant.id)"
          />

          <OButton
            v-if="draft.variants.length < MAX_VARIANTS"
            variant="outline"
            class="rounded-surface h-auto w-40 shrink-0 border-dashed"
            :disabled="running"
            data-test="ai-playground-add-variant-btn"
            @click="addVariant"
          >
            <span class="flex flex-col items-center gap-1">
              <OIcon name="add" size="md" />
              <span>{{ t("aiObservability.playground.addVariant") }}</span>
              <span class="text-text-secondary text-2xs font-mono">
                {{
                  t("aiObservability.playground.variantCount", {
                    count: draft.variants.length,
                    max: MAX_VARIANTS,
                  })
                }}
              </span>
            </span>
          </OButton>
        </div>
      </template>

      <!-- compare table -->
      <template v-else>
        <div
          class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5"
        >
          <span class="text-text-secondary text-xs">
            {{ t("aiObservability.playground.rowsSampled", { count: draft.rows!.length }) }}
          </span>
          <OTag
            v-if="draft.provenance"
            variant="default"
            size="sm"
            :label="draft.provenance.label"
            data-test="ai-playground-provenance"
          />
          <div class="grow" />
          <OButton
            variant="outline"
            size="xs"
            data-test="ai-playground-sample-btn"
            @click="sampleOpen = true"
          >
            {{ t("aiObservability.playground.sampleFromDataset") }}
          </OButton>
          <OButton
            variant="outline"
            size="xs"
            icon-left="add"
            data-test="ai-playground-add-row-btn"
            @click="addRowOpen = true"
          >
            {{ t("aiObservability.playground.addRow") }}
          </OButton>
        </div>

        <PlaygroundCompareTable
          class="min-h-0 flex-1"
          :draft="draft"
          :results="results"
          :running="running"
          :run-disabled="runDisabled"
          :streaming-variants="streamingVariants"
          @open-config="(id) => (configVariantId = id)"
          @open-row="(index) => (drawerRowIndex = index)"
          @remove-row="removeRow"
          @add-variant="addVariant"
          @run-variant="runVariant"
          @duplicate-variant="duplicate"
          @remove-variant="removeVariant"
          @create-experiment="createExperiment"
          @insert-field="insertFieldEverywhere"
        />
      </template>
    </div>

    <PlaygroundSampleDialog
      v-model:open="sampleOpen"
      :datasets="datasets"
      :initial-dataset-id="initialDatasetId"
      :current-rows="draft.rows?.length ?? 0"
      :template-vars="varNames"
      @sample="applySample"
    />

    <PlaygroundAddRowDialog v-model:open="addRowOpen" @add="addRow" />

    <ODialog
      :open="!!configVariantId"
      size="lg"
      :title="t('aiObservability.playground.variantConfig')"
      :primary-button-label="t('common.close')"
      data-test="ai-playground-variant-config-dialog"
      @update:open="(value) => !value && (configVariantId = null)"
      @click:primary="configVariantId = null"
    >
      <div v-if="configVariant" class="flex flex-col gap-3">
        <p class="text-text-secondary m-0 text-xs">
          {{
            t("aiObservability.playground.variantConfigScope", {
              label: variantLabel(draft.variants.findIndex((v) => v.id === configVariant!.id)),
              count: draft.rows?.length ?? 0,
            })
          }}
        </p>
        <PlaygroundVariantConfig
          :variant="configVariant"
          :providers="providers"
          :fields="rowFields"
          @change="updateVariant"
        />
      </div>
    </ODialog>

    <PlaygroundRowDrawer
      :open="drawerRowIndex !== null"
      :draft="draft"
      :results="results"
      :row-index="drawerRowIndex ?? 0"
      @update:open="(value) => !value && (drawerRowIndex = null)"
      @navigate="navigateRow"
    />

    <!-- Not ConfirmDialog: here the SAFE choice must be the primary button.
         Going back and fixing the prompt is what the user almost always wants;
         "Run anyway" is the deliberate, secondary act. -->
    <ODialog
      :open="runGateOpen"
      size="sm"
      :title="t('aiObservability.playground.runGateTitle')"
      :primary-button-label="t('aiObservability.playground.runGateCancel')"
      :secondary-button-label="t('aiObservability.playground.runGateConfirm')"
      data-test="ai-playground-run-gate"
      @update:open="(value: boolean) => (runGateOpen = value)"
      @click:primary="runGateOpen = false"
      @click:secondary="confirmRunGate"
    >
      <p class="text-text-body m-0 text-sm leading-relaxed">
        {{
          t("aiObservability.playground.runGateMessage", {
            rows: draft.rows?.length ?? 0,
            calls: totalCells,
          })
        }}
      </p>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import PlaygroundAddRowDialog from "@/enterprise/components/AIObservability/PlaygroundAddRowDialog.vue";
import PlaygroundCompareTable from "@/enterprise/components/AIObservability/PlaygroundCompareTable.vue";
import PlaygroundRowDrawer from "@/enterprise/components/AIObservability/PlaygroundRowDrawer.vue";
import PlaygroundSampleDialog from "@/enterprise/components/AIObservability/PlaygroundSampleDialog.vue";
import PlaygroundVariableBar from "@/enterprise/components/AIObservability/PlaygroundVariableBar.vue";
import PlaygroundVariantColumn from "@/enterprise/components/AIObservability/PlaygroundVariantColumn.vue";
import PlaygroundVariantConfig from "@/enterprise/components/AIObservability/PlaygroundVariantConfig.vue";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import {
  PLAYGROUND_USE_MOCK,
  PlaygroundRunError,
  runPlayground,
} from "@/services/llm-playground.service";
import {
  MAX_ROWS,
  MAX_VARIANTS,
  SINGLE_ROW_KEY,
  cellAt,
  cloneVariant,
  emptyVariant,
  extractVars,
  hasZeroFieldReference,
  idleCell,
  playgroundId,
  renderedMessages,
  rowFieldsFor,
  rowKeysFor,
  starterDraft,
  variantLabel,
  varsForRow,
  withFieldInserted,
  type PlaygroundCell,
  type PlaygroundDraft,
  type PlaygroundResults,
  type PlaygroundRow,
  type PlaygroundVariant,
} from "./playgroundDraft";
import { aiExperimentCreateRoute } from "./experimentRoutes";

defineOptions({ name: "AIPlaygroundPage" });

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const usingMockRuns = PLAYGROUND_USE_MOCK;

// ── state ─────────────────────────────────────────────────────────

const draft = reactive<PlaygroundDraft>(starterDraft());
const results = reactive<PlaygroundResults>({});

const providers = ref<Provider[]>([]);
const loadingProviders = ref(true);
const datasets = ref<LlmDataset[]>([]);

const sampleOpen = ref(false);
const addRowOpen = ref(false);
const runGateOpen = ref(false);
const configVariantId = ref<string | null>(null);
const drawerRowIndex = ref<number | null>(null);

/** One controller per in-flight cell, so a re-run or unmount cancels precisely. */
const controllers = new Map<string, AbortController>();

const initialDatasetId = ref<string>(String(route.query.dataset ?? ""));

const isTable = computed(() => Array.isArray(draft.rows) && draft.rows.length > 0);
const varNames = computed(() => extractVars(draft.variants));
const rowFields = computed(() => (isTable.value ? rowFieldsFor(draft.rows) : null));
const rowKeys = computed(() => rowKeysFor(draft));
const totalCells = computed(() => draft.variants.length * rowKeys.value.length);

const configVariant = computed(
  () => draft.variants.find((variant) => variant.id === configVariantId.value) ?? null,
);

const streamingVariants = computed(() =>
  draft.variants
    .filter((variant) =>
      rowKeys.value.some((key) => cellAt(results, variant.id, key)?.status === "streaming"),
    )
    .map((variant) => variant.id),
);

const running = computed(() => streamingVariants.value.length > 0);

const completedCount = computed(() => {
  let done = 0;
  for (const variant of draft.variants) {
    for (const key of rowKeys.value) {
      const status = cellAt(results, variant.id, key)?.status;
      if (status === "done" || status === "error") done += 1;
    }
  }
  return done;
});

/** Nothing to run against, or nothing to run with. */
const runDisabled = computed(
  () => running.value || !providers.value.length || !draft.variants.length,
);

function isVariantRunning(variantId: string) {
  return streamingVariants.value.includes(variantId);
}

function cellFor(variantId: string, rowKey: string): PlaygroundCell | undefined {
  return cellAt(results, variantId, rowKey);
}

// ── loading ───────────────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([loadProviders(), loadDatasets()]);
  applyEntryParams();
  loadRecentDrafts();
  if (initialDatasetId.value) sampleOpen.value = true;
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  stopAll();
});

async function loadProviders() {
  loadingProviders.value = true;
  try {
    providers.value = await onlineEvalsService.providers.list(orgId.value);
    seedDefaultProvider();
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.providerLoadError") });
  } finally {
    loadingProviders.value = false;
  }
}

async function loadDatasets() {
  try {
    datasets.value = await llmDatasetsService.list(orgId.value);
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.datasetLoadError") });
  }
}

/** A first variant with no provider cannot run, and picking one for the user is
 *  never wrong when there is exactly one sensible answer. */
function seedDefaultProvider() {
  const preferred =
    providers.value.find((provider) => provider.isDefault ?? provider.is_default) ??
    providers.value[0];
  if (!preferred) return;
  for (const variant of draft.variants) {
    if (variant.providerId) continue;
    variant.providerId = preferred.id;
    variant.model = preferred.defaultModel ?? preferred.default_model ?? "";
  }
}

/** Entry params are read once. The URL is an entry address, not a save file. */
function applyEntryParams() {
  const experimentId = String(route.query.experiment ?? "");
  if (!experimentId) return;
  draft.provenance = {
    type: "experiment",
    label: t("aiObservability.playground.fromExperiment", { name: experimentId }),
  };
}

// ── run engine ────────────────────────────────────────────────────

function setCell(variantId: string, rowKey: string, changes: Partial<PlaygroundCell>) {
  const byRow = results[variantId] ?? (results[variantId] = {});
  byRow[rowKey] = { ...(byRow[rowKey] ?? idleCell()), ...changes };
}

function onRunAll(force = false) {
  if (runDisabled.value) return;
  // The gate lives on Run because that is where money is spent: a template that
  // references no row field bills rows × variants for one distinct answer.
  if (!force && isTable.value && hasZeroFieldReference(draft.variants, draft.rows)) {
    runGateOpen.value = true;
    return;
  }
  for (const variant of draft.variants) runVariant(variant.id, true);
}

function confirmRunGate() {
  runGateOpen.value = false;
  onRunAll(true);
}

function runVariant(variantId: string, skipGate = false) {
  if (!skipGate && runDisabled.value) return;
  const variant = draft.variants.find((candidate) => candidate.id === variantId);
  if (!variant) return;
  for (const rowKey of rowKeys.value) runCell(variant, rowKey);
}

async function runCell(variant: PlaygroundVariant, rowKey: string) {
  const key = `${variant.id}:${rowKey}`;
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);

  setCell(variant.id, rowKey, {
    status: "streaming",
    text: "",
    toolCall: null,
    usage: null,
    error: null,
  });

  const vars = varsForRow(draft, rowKey);
  const messages = renderedMessages(variant, vars)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
  // The provider's type decides how tools and the response schema are shaped
  // for the wire — the server forwards both to the provider untouched.
  const provider = providers.value.find((candidate) => candidate.id === variant.providerId);

  try {
    const result = await runPlayground(
      orgId.value,
      {
        providerId: variant.providerId,
        providerType: provider?.providerType ?? provider?.provider_type,
        model: variant.model,
        messages,
        params: { temperature: Number(variant.temperature) || 0 },
        tools: variant.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: safeParse(tool.parameters),
        })),
        responseSchema: variant.responseSchema ? safeParse(variant.responseSchema) : null,
      },
      {
        signal: controller.signal,
        onDelta: (text) => {
          const cell = cellAt(results, variant.id, rowKey);
          if (cell?.status === "streaming") setCell(variant.id, rowKey, { text: cell.text + text });
        },
      },
    );

    setCell(variant.id, rowKey, {
      status: "done",
      text: result.text,
      toolCall: result.toolCall,
      usage: result.usage,
    });
    // Clears staleness only if this is still the live variant object. Editing
    // the config mid-run replaces it, and that replacement stays stale — which
    // is right: the answer just produced describes the OLD config.
    variant.stale = false;
  } catch (error) {
    // An abort is a user action, not a failure — leave the cell as it was.
    if (error instanceof DOMException && error.name === "AbortError") return;
    setCell(variant.id, rowKey, {
      status: "error",
      error: {
        message:
          error instanceof PlaygroundRunError
            ? error.message
            : t("aiObservability.playground.runFailed"),
        retryable: error instanceof PlaygroundRunError ? error.retryable : true,
      },
    });
  } finally {
    controllers.delete(key);
  }
}

function stopAll() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  for (const variant of draft.variants) {
    for (const rowKey of rowKeys.value) {
      if (cellAt(results, variant.id, rowKey)?.status === "streaming") {
        setCell(variant.id, rowKey, { status: "idle" });
      }
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    onRunAll();
  }
}

// ── draft mutations ───────────────────────────────────────────────

function setVar(name: string, value: string) {
  draft.vars[name] = value;
}

function updateVariant(next: PlaygroundVariant) {
  const index = draft.variants.findIndex((variant) => variant.id === next.id);
  if (index !== -1) draft.variants[index] = next;
}

function addVariant() {
  if (draft.variants.length >= MAX_VARIANTS) return;
  const source = draft.variants[draft.variants.length - 1];
  draft.variants.push(source ? cloneVariant(source) : emptyVariant());
}

function duplicate(variantId: string) {
  if (draft.variants.length >= MAX_VARIANTS) return;
  const index = draft.variants.findIndex((variant) => variant.id === variantId);
  if (index === -1) return;
  draft.variants.splice(index + 1, 0, cloneVariant(draft.variants[index]));
}

function removeVariant(variantId: string) {
  if (draft.variants.length <= 1) return;
  draft.variants = draft.variants.filter((variant) => variant.id !== variantId);
  delete results[variantId];
  if (configVariantId.value === variantId) configVariantId.value = null;
}

function addRow(input: string, expectedOutput: string | null) {
  const rows = draft.rows ?? [];
  if (rows.length >= MAX_ROWS) return;
  draft.rows = [...rows, { id: playgroundId("row"), input, expectedOutput, source: null }];
}

function removeRow(rowId: string) {
  if (!draft.rows) return;
  const remaining = draft.rows.filter((row) => row.id !== rowId);
  draft.rows = remaining.length ? remaining : null;
  if (drawerRowIndex.value !== null && drawerRowIndex.value >= remaining.length) {
    drawerRowIndex.value = remaining.length ? remaining.length - 1 : null;
  }
}

function applySample(rows: PlaygroundRow[], mode: "replace" | "add") {
  if (mode === "add" && draft.rows) {
    draft.rows = [...draft.rows, ...rows].slice(0, MAX_ROWS);
  } else {
    draft.rows = rows.slice(0, MAX_ROWS);
    // Replacing the inputs invalidates every output, so drop them rather than
    // leaving answers to questions that are no longer being asked.
    for (const key of Object.keys(results)) delete results[key];
  }
}

/** Fix the zero-reference case across every variant at once — that is the whole
 *  point of the warning bar; fixing one variant would still leave the others. */
function insertFieldEverywhere(field: string) {
  draft.variants = draft.variants.map((variant) => withFieldInserted(variant, field));
  toast({
    variant: "info",
    message: t("aiObservability.playground.zeroRefInserted", { token: `{{${field}}}` }),
  });
}

function navigateRow(delta: number) {
  if (drawerRowIndex.value === null || !draft.rows) return;
  const next = drawerRowIndex.value + delta;
  if (next < 0 || next >= draft.rows.length) return;
  drawerRowIndex.value = next;
}

async function copyOutput(variantId: string, rowKey: string) {
  const cell = cellAt(results, variantId, rowKey);
  if (!cell?.text) return;
  await navigator.clipboard.writeText(cell.text);
  toast({ variant: "success", message: t("aiObservability.playground.copied") });
}

/** Continue the conversation: the answer becomes context, and an empty user
 *  turn is added so there is somewhere to type the follow-up. */
function addOutputToMessages(variantId: string) {
  const cell = cellAt(results, variantId, SINGLE_ROW_KEY);
  if (!cell || cell.status !== "done" || !cell.text) return;
  const variant = draft.variants.find((candidate) => candidate.id === variantId);
  if (!variant) return;

  variant.messages = [
    ...variant.messages,
    { id: playgroundId("msg"), role: "assistant", content: cell.text },
    { id: playgroundId("msg"), role: "user", content: "" },
  ];
  setCell(variantId, SINGLE_ROW_KEY, { status: "idle", text: "", usage: null });
  toast({ variant: "info", message: t("aiObservability.playground.addedToMessages") });
}

// ── exits ─────────────────────────────────────────────────────────

function goToProviders() {
  router.push({ name: "llmProviders" });
}

/** The one durable exit. Everything the experiment form needs travels in the
 *  query, so the handoff survives a full page load. */
function createExperiment(variantId: string) {
  const variant = draft.variants.find((candidate) => candidate.id === variantId);
  if (!variant) return;
  const datasetRow = draft.rows?.find((row) => row.source);

  const target = aiExperimentCreateRoute(orgId.value, {
    datasetId: datasetRow?.source?.datasetId,
    query: {
      provider: variant.providerId,
      model: variant.model,
      temperature: variant.temperature,
      systemPrompt: variant.messages.find((message) => message.role === "system")?.content ?? "",
      userPrompt:
        [...variant.messages].reverse().find((message) => message.role === "user")?.content ?? "",
    },
  });
  router.push(target);
}

// ── recent drafts (this browser only) ─────────────────────────────

interface RecentDraftEntry {
  id: string;
  summary: string;
  savedAt: number;
  draft: PlaygroundDraft;
}

const recentDrafts = ref<RecentDraftEntry[]>([]);

const storageKey = computed(() => `o2-playground-drafts:${orgId.value}`);

function loadRecentDrafts() {
  try {
    const stored = localStorage.getItem(storageKey.value);
    recentDrafts.value = stored ? (JSON.parse(stored) as RecentDraftEntry[]) : [];
  } catch {
    recentDrafts.value = [];
  }
}

function draftSummary(current: PlaygroundDraft): string {
  const first = current.variants[0];
  const message = first?.messages.find((entry) => entry.content.trim().length > 0);
  const text = message ? message.content.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return text || first?.model || "";
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => JSON.stringify(draft),
  () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistDraft, 1500);
  },
);

function persistDraft() {
  const summary = draftSummary(draft);
  if (!summary) return;
  const entry: RecentDraftEntry = {
    id: playgroundId("draft"),
    summary,
    savedAt: Date.now(),
    draft: JSON.parse(JSON.stringify(draft)) as PlaygroundDraft,
  };
  // Same opening line ⇒ the same working draft, so replace rather than pile up.
  const others = recentDrafts.value.filter((candidate) => candidate.summary !== summary);
  recentDrafts.value = [entry, ...others].slice(0, 10);
  try {
    localStorage.setItem(storageKey.value, JSON.stringify(recentDrafts.value));
  } catch {
    // A full or disabled localStorage costs the convenience, never the session.
  }
}

function restoreDraft(entry: RecentDraftEntry) {
  stopAll();
  Object.assign(draft, JSON.parse(JSON.stringify(entry.draft)) as PlaygroundDraft);
  for (const key of Object.keys(results)) delete results[key];
  toast({ variant: "info", message: t("aiObservability.playground.draftRestored") });
}
</script>
