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
  <OPageLayout
    data-test="ai-playground-page"
    :title="t('aiObservability.nav.playground')"
    :subtitle="t('aiObservability.subtitle.playground')"
    icon="play-circle"
    title-data-test="ai-playground-title"
    bleed
  >
    <template #actions>
      <ODropdown v-if="recentDrafts.length" align="end" content-class="w-100">
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
          <!-- min-w-0 is what lets truncate win against the item's own w-full. -->
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate">{{ raw(entry.summary) }}</span>
            <span class="text-text-secondary text-2xs truncate">{{ raw(draftMeta(entry)) }}</span>
          </span>
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
        variant="outline"
        size="sm-action"
        :disabled="running"
        data-test="ai-playground-reset-btn"
        @click="resetPlayground"
      >
        {{ t("aiObservability.playground.reset") }}
      </OButton>
      <span class="text-text-secondary text-xs" data-test="ai-playground-window-count">
        {{
          t("aiObservability.playground.windowCount", {
            count: draft.variants.length,
            max: MAX_VARIANTS,
          })
        }}
      </span>
      <PlaygroundScorersMenu
        :scorers="scorers"
        :selected-ids="draft.scorerIds"
        :auto-score="draft.autoScore"
        :has-reference="hasReference"
        :can-score="scorableVariants.length > 0"
        :scoring="scoring"
        @update:selected-ids="(ids: string[]) => (draft.scorerIds = ids)"
        @update:auto-score="(value: boolean) => (draft.autoScore = value)"
        @focus-expected="focusExpected"
        @score="scoreAll"
      />
      <OButton
        variant="outline"
        size="sm-action"
        :loading="sharing"
        data-test="ai-playground-share-btn"
        @click="onShare"
      >
        {{ t("aiObservability.playground.share") }}
      </OButton>
      <OButton
        v-if="runningAll"
        variant="primary"
        size="sm-action"
        class="bg-cancel-query-bg! text-button-primary-foreground!"
        :title="t('common.cancel')"
        data-test="ai-playground-run-all-cancel-btn"
        @click="stopAll()"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        v-else
        variant="primary"
        size="sm-action"
        :disabled="runDisabled"
        :title="t('aiObservability.playground.runAllTooltip')"
        data-test="ai-playground-run-all-btn"
        @click="onRunAll()"
      >
        {{ t("aiObservability.playground.runAll") }}
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

      <!-- A snapshot is a copy someone sent you, so the page says so until you
           take it over. Editing is never blocked: the edits are local and the
           link they arrived on cannot change. -->
      <OBanner
        v-if="sharedSnapshot"
        variant="info"
        icon="visibility"
        inline-actions
        class="mx-4 mt-3 shrink-0"
        data-test="ai-playground-shared-banner"
      >
        <div class="flex flex-col gap-0.5">
          <span class="font-semibold">{{ t("aiObservability.playground.sharedTitle") }}</span>
          <span class="text-xs">
            {{
              sharedSnapshot.createdBy
                ? t("aiObservability.playground.sharedBodyBy", { user: sharedSnapshot.createdBy })
                : t("aiObservability.playground.sharedBody")
            }}
          </span>
        </div>
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="ai-playground-shared-continue-btn"
            @click="continueFromSnapshot"
          >
            {{ t("aiObservability.playground.sharedContinue") }}
          </OButton>
        </template>
      </OBanner>

      <PlaygroundVariableBar
        class="shrink-0"
        :var-names="varNames"
        :vars="draft.vars"
        :used-var-names="usedVarNames"
        :tools="draft.variants[0]?.tools ?? []"
        :provenance="draft.provenance"
        :sample="draft.sample"
        :stepping="sampleStepping"
        @set-tools="setTools"
        @set-var="setVar"
        @remove-var="removeVar"
        @sample="sampleOpen = true"
        @step-sample="stepSample"
        @clear-sample="clearSample"
      />

      <!-- The arrows float OVER the strip rather than reserving space beside
             it: at four variants every column is already tight, and a pair of
             gutters would come out of the outputs. -->
      <div class="relative flex min-h-0 flex-1">
        <!-- Positioning goes on the wrapper: OButton's root sets `relative`
               on itself, so an `absolute` handed to the button loses. -->
        <div v-if="canScrollLeft" class="absolute start-1.5 top-1/2 z-1 -translate-y-1/2">
          <OButton
            variant="outline"
            size="icon-circle"
            icon-left="chevron-left"
            class="bg-surface-panel! text-accent! border-border-strong! hover:bg-accent/12! hover:border-accent! shadow-lg"
            :aria-label="t('aiObservability.playground.scrollLeft')"
            data-test="ai-playground-scroll-left"
            @click="scrollByStep(-1)"
          />
        </div>
        <div v-if="canScrollRight" class="absolute end-1.5 top-1/2 z-1 -translate-y-1/2">
          <OButton
            variant="outline"
            size="icon-circle"
            icon-left="chevron-right"
            class="bg-surface-panel! text-accent! border-border-strong! hover:bg-accent/12! hover:border-accent! shadow-lg"
            :aria-label="t('aiObservability.playground.scrollRight')"
            data-test="ai-playground-scroll-right"
            @click="scrollByStep(1)"
          />
        </div>
        <div
          ref="benchStripRef"
          class="flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto px-4 py-3"
        >
          <PlaygroundVariantColumn
            v-for="(variant, index) in draft.variants"
            :key="variant.id"
            :variant="variant"
            :label="variantLabel(index)"
            :cell="cellFor(variant.id, SINGLE_ROW_KEY)"
            :providers="providers"
            :var-names="varNames"
            :vars="draft.vars"
            :solo="draft.variants.length === 1"
            :running="isVariantRunning(variant.id)"
            :run-disabled="variantRunDisabled(variant.id)"
            :can-remove="draft.variants.length > 1"
            :can-duplicate="draft.variants.length < MAX_VARIANTS"
            @change="updateVariant"
            @run="runVariant(variant.id)"
            @cancel="cancelVariant(variant.id)"
            @duplicate="duplicate(variant.id)"
            @reset="resetVariant(variant.id)"
            @remove="removeVariant(variant.id)"
            @copy="copyOutput(variant.id, SINGLE_ROW_KEY)"
            @add-to-messages="addOutputToMessages(variant.id)"
            @create-experiment="createExperiment(variant.id)"
          />
        </div>
      </div>

      <!-- Below the bench, not inside it: one golden answer serves every column,
           so it must not scroll away with them. Shown only once something reads
           it — a value, or a selected scorer that needs one. -->
      <PlaygroundExpectedBar
        v-if="draft.expectedSingle || expectedRequired"
        ref="expectedBarRef"
        :expected="draft.expectedSingle"
        :required="expectedRequired"
        @set-expected="(value) => (draft.expectedSingle = value)"
      />
    </div>

    <PlaygroundSampleDialog
      v-model:open="sampleOpen"
      :datasets="datasets"
      :initial-dataset-id="initialDatasetId"
      @sample="applySample"
    />

    <PlaygroundShareDialog
      v-model:open="shareOpen"
      :creating="sharing"
      @confirm="onShareConfirmed"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import PlaygroundExpectedBar from "@/enterprise/components/AIObservability/PlaygroundExpectedBar.vue";
import PlaygroundSampleDialog from "@/enterprise/components/AIObservability/PlaygroundSampleDialog.vue";
import PlaygroundScorersMenu from "@/enterprise/components/AIObservability/PlaygroundScorersMenu.vue";
import PlaygroundShareDialog from "@/enterprise/components/AIObservability/PlaygroundShareDialog.vue";
import PlaygroundVariableBar from "@/enterprise/components/AIObservability/PlaygroundVariableBar.vue";
import PlaygroundVariantColumn from "@/enterprise/components/AIObservability/PlaygroundVariantColumn.vue";
import onlineEvalsService, { type Provider, type Scorer } from "@/services/online-evals.service";
import { entityId } from "@/enterprise/components/onlineEvals/utils/evalEntity";
import llmDatasetsService, {
  type LlmDataset,
  type LlmDatasetItem,
} from "@/services/llm-datasets.service";
import {
  PlaygroundRunError,
  runPlayground,
  scorePlayground,
  type PlaygroundScoreRequest,
} from "@/services/llm-playground.service";
import llmPlaygroundSnapshotsService from "@/services/llm-playground-snapshots.service";
import {
  MAX_VARIANTS,
  SINGLE_ROW_KEY,
  type PlaygroundSample,
  adoptIds,
  cellAt,
  cloneVariant,
  draftFromSnapshot,
  emptyVariant,
  extractVars,
  hasReference as benchHasReference,
  idleCell,
  playgroundId,
  renderedMessages,
  renderTemplate,
  scorerEvidence,
  settledResults,
  snapshotPayload,
  starterDraft,
  variantLabel,
  type PlaygroundCell,
  type PlaygroundDraft,
  type PlaygroundResults,
  type PlaygroundTool,
  type PlaygroundVariant,
} from "./playgroundDraft";
import { takeHandoff } from "./playgroundHandoff";
import { aiExperimentCreateRoute } from "./experimentRoutes";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useHorizontalOverflow } from "@/composables/useHorizontalOverflow";

defineOptions({ name: "AIPlaygroundPage" });

const { t, locale } = useI18nTyped();
const { confirm } = useConfirmDialog();
const route = useRoute();
const router = useRouter();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

// ── state ─────────────────────────────────────────────────────────

const draft = reactive<PlaygroundDraft>(starterDraft());
const results = reactive<PlaygroundResults>({});

const providers = ref<Provider[]>([]);
const loadingProviders = ref(true);
const scorers = ref<Scorer[]>([]);
const scoring = ref(false);
const datasets = ref<LlmDataset[]>([]);

const sampleOpen = ref(false);
const sampleStepping = ref(false);
const shareOpen = ref(false);
const sharing = ref(false);

/** The snapshot this bench descends from — the link it was opened on, or the
 *  last one shared from it. Sent as the parent so lineage forms a chain. */
const parentSnapshotId = ref<string | null>(null);

/** Set only while a shared link is being viewed; cleared by Continue From This. */
const sharedSnapshot = ref<{ id: string; createdBy: string } | null>(null);

/** One controller per in-flight cell, so a re-run or unmount cancels precisely. */
const controllers = new Map<string, AbortController>();

const initialDatasetId = ref<string>(String(route.query.dataset ?? ""));

/** Declared OR referenced. `draft.vars` is the declaration: a variable can be
 *  defined before any message uses it, which is why adding one does not have to
 *  write into a prompt. */
const varNames = computed(() => {
  const names = extractVars(draft.variants);
  for (const name of Object.keys(draft.vars)) if (!names.includes(name)) names.push(name);
  return names;
});

/** Referenced by a message somewhere; the rest are declared and never read. */
const usedVarNames = computed(() => extractVars(draft.variants));

const streamingVariants = computed(() =>
  draft.variants
    .filter((variant) => cellAt(results, variant.id, SINGLE_ROW_KEY)?.status === "streaming")
    .map((variant) => variant.id),
);

const running = computed(() => streamingVariants.value.length > 0);
/** True only while an actual Run All is in flight — a single bench's own Run
 *  streaming must not make the Run All button look like it started the work. */
const runningAll = ref(false);

/** Nothing to run against, or nothing to run with. */
const runDisabled = computed(
  () => running.value || !providers.value.length || !draft.variants.length,
);

/**
 * A single bench's own Run button. Unlike Run All, one variant streaming must
 * not block the others — runCell() already keys state per variant id, so
 * running two at once is safe; only this variant's own in-flight run (or no
 * providers/variants at all) should disable it.
 */
function variantRunDisabled(variantId: string) {
  return !providers.value.length || !draft.variants.length || isVariantRunning(variantId);
}

/**
 * Back to an empty bench. Confirmed because the draft is the only copy of the
 * work — it is deliberately never saved, so there is nothing to recover it
 * from except the recent-drafts list, which only holds what was already run.
 */
const benchStripRef = ref<HTMLElement | null>(null);
const { canScrollLeft, canScrollRight, scrollByStep } = useHorizontalOverflow(benchStripRef);

async function resetPlayground() {
  const ok = await confirm({
    title: t("aiObservability.playground.resetTitle"),
    message: t("aiObservability.playground.resetMessage"),
    confirmLabel: t("aiObservability.playground.reset"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  stopAll();
  // Seeded exactly as a first load seeds it — the org default and ITS default
  // model. Taking the first provider and no model left the header select
  // holding a value no option matched, which renders as the raw key.
  Object.assign(draft, starterDraft());
  seedDefaultProvider();
  for (const key of Object.keys(results)) delete results[key];
  // A new working session: the old one stays in Recent Drafts, but Reset is the
  // one action that means "not this any more".
  draftSessionId.value = playgroundId("draft");
  parentSnapshotId.value = null;
  sharedSnapshot.value = null;
  clearSession();
}

function isVariantRunning(variantId: string) {
  return streamingVariants.value.includes(variantId);
}

function cellFor(variantId: string, rowKey: string): PlaygroundCell | undefined {
  return cellAt(results, variantId, rowKey);
}

// ── loading ───────────────────────────────────────────────────────

onMounted(async () => {
  // First, and synchronously: the bench is the work, and it must be on screen
  // before anything that can fail or take a round trip.
  restoreSession();
  applyHandoff();
  await Promise.all([loadProviders(), loadDatasets(), loadScorers()]);
  applyEntryParams();
  loadRecentDrafts();
  const snapshotId = String(route.query.snapshot ?? "");
  if (snapshotId) await openSharedSnapshot(snapshotId);
  if (initialDatasetId.value) sampleOpen.value = true;
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  // Flush before the abort: leaving the page mid-edit must not cost the edit,
  // and the debounce may not have fired yet.
  saveSession();
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

/** A failure here costs scoring, not the bench — the menu simply lists none. */
async function loadScorers() {
  try {
    scorers.value = await onlineEvalsService.scorers.list(orgId.value);
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.scorerLoadError") });
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

/**
 * Loads the conversation Trace Details stashed for us. Everything arrives as
 * ordinary editable content — the whole point of the entry is to change the
 * call and re-run it, so nothing is pinned readonly.
 */
function applyHandoff() {
  if (String(route.query.from ?? "") !== "span") return;
  const handoff = takeHandoff();
  if (!handoff) return;
  const variant = emptyVariant();
  variant.messages = handoff.messages;
  // Provider and model are left to seedDefaultProvider: the trace's model may
  // not exist on any provider configured here.
  variant.temperature = handoff.temperature;
  // A fresh draft, not a merge: the imported call is the subject of the bench,
  // and leaving a restored session's variants beside it would silently compare
  // the trace against whatever the user last had open.
  Object.assign(draft, starterDraft());
  draft.variants = [variant];
  draft.provenance = {
    type: "trace",
    label: t("aiObservability.playground.fromTrace", { id: handoff.sourceId }),
  };
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

async function onRunAll() {
  if (runDisabled.value) return;
  runningAll.value = true;
  try {
    await Promise.allSettled(
      draft.variants.map((variant) => runVariant(variant.id, true)),
    );
  } finally {
    runningAll.value = false;
  }
}

function runVariant(variantId: string, skipGate = false) {
  if (!skipGate && variantRunDisabled(variantId)) return Promise.resolve();
  const variant = draft.variants.find((candidate) => candidate.id === variantId);
  if (!variant) return Promise.resolve();
  return runCell(variant, SINGLE_ROW_KEY);
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
    // The verdicts belonged to the answer being replaced.
    scores: undefined,
    scoredKey: undefined,
  });

  const vars = { ...draft.vars };
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

    if (draft.autoScore) void scoreVariant(variant);
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
    if (cellAt(results, variant.id, SINGLE_ROW_KEY)?.status === "streaming") {
      setCell(variant.id, SINGLE_ROW_KEY, { status: "idle" });
    }
  }
}

/** One bench's own Cancel — mirrors stopAll() but only for that variant, so
 *  cancelling one run does not touch the others. */
function cancelVariant(variantId: string) {
  const key = `${variantId}:${SINGLE_ROW_KEY}`;
  controllers.get(key)?.abort();
  controllers.delete(key);
  if (cellAt(results, variantId, SINGLE_ROW_KEY)?.status === "streaming") {
    setCell(variantId, SINGLE_ROW_KEY, { status: "idle" });
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

// ── scoring ───────────────────────────────────────────────────────

const hasReference = computed(() => benchHasReference(draft.expectedSingle));

const expectedBarRef = ref<{ focus: () => void } | null>(null);

/** A selected scorer reads `{{expected_output}}` and the bench has none, so the
 *  field has to be on screen for the Score panel's notice to point at. */
const expectedRequired = computed<boolean>(() => {
  if (hasReference.value) return false;
  return scorers.value.some((scorer) => {
    if (!draft.scorerIds.includes(entityId(scorer))) return false;
    const evidence = scorerEvidence(scorer.template ?? "");
    // A trace-reading scorer is skipped for a reason no expected output fixes.
    if (evidence.trace) return false;
    return evidence.expectedOutput || Boolean(scorer.referenceBased ?? scorer.reference_based);
  });
});

function focusExpected() {
  expectedBarRef.value?.focus();
}

/** Outputs worth judging. A tool call is not text a scorer can read, and an
 *  empty answer would only ever be judged as one. */
const scorableVariants = computed(() =>
  draft.variants.filter((variant) => {
    const cell = cellAt(results, variant.id, SINGLE_ROW_KEY);
    return cell?.status === "done" && Boolean(cell.text.trim());
  }),
);

async function scoreAll() {
  if (scoring.value || !draft.scorerIds.length) return;
  scoring.value = true;
  try {
    await Promise.all(scorableVariants.value.map((variant) => scoreVariant(variant)));
  } finally {
    scoring.value = false;
  }
}

/**
 * Judge one output.
 *
 * An output that has not changed since it was last judged by this same set of
 * scorers is left alone: a judge call costs a model call, and re-running one
 * over identical text can only produce noise around the answer already shown.
 */
async function scoreVariant(variant: PlaygroundVariant) {
  const cell = cellAt(results, variant.id, SINGLE_ROW_KEY);
  if (!cell || cell.status !== "done" || !cell.text.trim()) return;
  if (!draft.scorerIds.length) return;

  const request = {
    scorerIds: [...draft.scorerIds].sort(),
    input: scoreInput(variant),
    output: cell.text,
    expectedOutput: draft.expectedSingle ?? undefined,
    metadata: {
      model: variant.model,
      providerId: variant.providerId,
      temperature: Number(variant.temperature) || 0,
    },
  };

  const key = scoreKey(request);
  if (cell.scoredKey === key) return;

  setCell(variant.id, SINGLE_ROW_KEY, { scoring: true });
  try {
    const scores = await scorePlayground(orgId.value, request);
    setCell(variant.id, SINGLE_ROW_KEY, { scores, scoredKey: key, scoring: false });
  } catch {
    setCell(variant.id, SINGLE_ROW_KEY, { scoring: false });
    toast({ variant: "error", message: t("aiObservability.playground.scoreFailed") });
  }
}

/** What the judge is told the model was asked — rendered, so `{{input}}` shows
 *  the question that was actually sent rather than the template. */
function scoreInput(variant: PlaygroundVariant): string {
  const asked = [...variant.messages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim());
  return asked ? renderTemplate(asked.content, draft.vars) : "";
}

/**
 * Identifies a verdict set by everything the judge was given.
 *
 * The whole request, not just the answer: adding an expected output changes
 * what a reference-based scorer can do — often from "skipped" to a real verdict
 * — while the output it judges stays byte-identical. Keying on the answer alone
 * made that edit invisible, so Score did nothing until a re-run happened to
 * change the text.
 */
function scoreKey(request: PlaygroundScoreRequest): string {
  return JSON.stringify(request);
}

// ── draft mutations ───────────────────────────────────────────────

function setVar(name: string, value: string) {
  draft.vars[name] = value;
}

/** Only forgets the binding. A name a message still references comes straight
 *  back on the next render, which is correct — the prompt is asking for it. */
function removeVar(name: string) {
  delete draft.vars[name];
}

function updateVariant(next: PlaygroundVariant) {
  const index = draft.variants.findIndex((variant) => variant.id === next.id);
  if (index === -1) return;
  draft.variants[index] = next;
}

// Tools are the harness every bench shares: a comparison only says something
// when the prompt or the model is the ONE thing that differs between columns.
function setTools(tools: PlaygroundTool[]) {
  for (const variant of draft.variants) {
    variant.tools = tools.map((tool) => ({ ...tool }));
  }
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
}

/** One bench back to blank — the scoped alternative to Reset, which wipes
 *  every bench and confirms first. Keeps the variant's id so it stays the
 *  same column (same label, same position) rather than reflowing the bench. */
async function resetVariant(variantId: string) {
  const index = draft.variants.findIndex((variant) => variant.id === variantId);
  if (index === -1) return;
  const ok = await confirm({
    title: t("aiObservability.playground.resetVariantTitle"),
    message: t("aiObservability.playground.resetVariantMessage"),
    confirmLabel: t("aiObservability.playground.reset"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  cancelVariant(variantId);
  const fresh = emptyVariant();
  fresh.id = variantId;
  draft.variants[index] = fresh;
  delete results[variantId];
  seedDefaultProvider();
}

function applySample(sample: PlaygroundSample, item: LlmDatasetItem) {
  draft.sample = sample;
  draft.vars = { ...draft.vars, input: item.inputPreview || item.input };
  draft.expectedSingle = item.expectedOutput;
  // New question ⇒ the answers on screen are answers to the old one.
  for (const key of Object.keys(results)) delete results[key];
}

/** Walk to a neighbouring dataset item without leaving the bench — this is what
 *  stands in for the row table: spot-check by cycling, not by fanning out. */
async function stepSample(delta: number) {
  const sample = draft.sample;
  if (!sample || sampleStepping.value) return;
  const index = sample.index + delta;
  if (index < 0 || index >= sample.total) return;
  sampleStepping.value = true;
  try {
    const page = await llmDatasetsService.listItems(orgId.value, sample.datasetId, {
      from: index,
      size: 1,
    });
    const item = page.items[0];
    if (!item) return;
    applySample({ ...sample, itemId: item.id, index, total: page.total }, item);
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.sampleLoadError") });
  } finally {
    sampleStepping.value = false;
  }
}

function clearSample() {
  draft.sample = null;
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

// ── sharing ───────────────────────────────────────────────────────

/** Per browser, not per organization: it records that this person has read what
 *  a snapshot is, which does not change with the org they are in. */
const SHARE_INTRO_KEY = "o2-playground-share-intro-read";

function shareIntroRead(): boolean {
  try {
    return localStorage.getItem(SHARE_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

/** The explanation is worth one reading. After that Share is a single click. */
function onShare() {
  if (shareIntroRead()) return void shareSnapshot();
  shareOpen.value = true;
}

function onShareConfirmed(skipIntro: boolean) {
  try {
    if (skipIntro) localStorage.setItem(SHARE_INTRO_KEY, "1");
  } catch {
    // A disabled localStorage costs the preference, never the share.
  }
  shareSnapshot();
}

/** Create the snapshot and put its link on the clipboard. Nothing is shown to
 *  copy by hand: the link is only ever wanted somewhere else. */
async function shareSnapshot() {
  if (sharing.value) return;
  sharing.value = true;
  try {
    const snapshot = await llmPlaygroundSnapshotsService.share(
      orgId.value,
      // Results included: a link with the prompts but not the answers loses the
      // reason it was sent.
      snapshotPayload(draft, results),
      parentSnapshotId.value,
    );
    parentSnapshotId.value = snapshot.id;
    shareOpen.value = false;
    await copyToClipboard(snapshotLink(snapshot.id), t, {
      successMessage: t("aiObservability.playground.shareCopied"),
      errorMessage: t("aiObservability.playground.shareCopyFailed"),
    });
  } catch (error) {
    toast({ variant: "error", message: shareError(error) });
  } finally {
    sharing.value = false;
  }
}

/** The server's reason when it has one — a bench over the workbench limits is
 *  something the author can act on, "failed" is not. */
function shareError(error: unknown): I18nText {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data
    ?.message;
  return typeof message === "string" && message.trim()
    ? raw(message)
    : t("aiObservability.playground.shareFailed");
}

function snapshotLink(snapshotId: string): string {
  const { href } = router.resolve({
    name: "aiPlayground",
    query: { org_identifier: orgId.value, snapshot: snapshotId },
  });
  return new URL(href, window.location.origin).toString();
}

/** Load a shared snapshot over the bench. It becomes the local draft — the
 *  stored one is immutable, so there is nothing here to write back to. */
async function openSharedSnapshot(snapshotId: string) {
  try {
    const snapshot = await llmPlaygroundSnapshotsService.get(orgId.value, snapshotId);
    const restored = draftFromSnapshot(snapshot.payload);
    if (!restored) throw new Error("snapshot carries no bench");
    stopAll();
    Object.assign(draft, restored.draft);
    adoptIds(draft);
    for (const key of Object.keys(results)) delete results[key];
    Object.assign(results, restored.results);
    // A new session id, so opening a link never overwrites the recent draft the
    // reader was working on before it.
    draftSessionId.value = playgroundId("draft");
    parentSnapshotId.value = snapshot.id;
    sharedSnapshot.value = { id: snapshot.id, createdBy: snapshot.createdBy };
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.sharedLoadError") });
  }
}

/** Take the snapshot over as your own work: the banner goes, the address stops
 *  claiming to be the shared link, and the lineage pointer stays so the next
 *  share records where this came from. */
function continueFromSnapshot() {
  sharedSnapshot.value = null;
  const query = { ...route.query };
  delete query.snapshot;
  router.replace({ name: "aiPlayground", query });
  toast({ variant: "info", message: t("aiObservability.playground.sharedContinued") });
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
  const target = aiExperimentCreateRoute(orgId.value, {
    datasetId: draft.sample?.datasetId,
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

/** Largest unit that still reads as a whole number, so "2m ago" beats "138s ago". */
const TIME_DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

function timeAgo(at: number): string {
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
  let duration = (at - Date.now()) / 1000;
  for (const division of TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "";
}

interface RecentDraftEntry {
  id: string;
  /** What the draft is about — the line the operator scans for. */
  summary: string;
  /** Which models it ran. Secondary: it narrows a match, it does not make one. */
  models?: string;
  savedAt: number;
  draft: PlaygroundDraft;
}

const recentDrafts = ref<RecentDraftEntry[]>([]);

/** Identifies the draft being worked on now; a new one starts on Reset. */
const draftSessionId = ref(playgroundId("draft"));

const storageKey = computed(() => `o2-playground-drafts:${orgId.value}`);

function loadRecentDrafts() {
  try {
    const stored = localStorage.getItem(storageKey.value);
    recentDrafts.value = stored ? (JSON.parse(stored) as RecentDraftEntry[]) : [];
  } catch {
    recentDrafts.value = [];
  }
}

/** What the draft is about. Empty until there is something to say: a bare model
 *  name is the page's own default, not a draft the operator authored. */
function draftSummary(current: PlaygroundDraft): string {
  return draftContext(current);
}

/** The dimmed second line: which models, and how long ago. */
function draftMeta(entry: RecentDraftEntry): string {
  return [entry.models, timeAgo(entry.savedAt)].filter(Boolean).join(" \u00b7 ");
}

function draftModels(current: PlaygroundDraft): string {
  const counts = new Map<string, number>();
  for (const variant of current.variants) {
    const name = variant.model.trim() || variant.providerId.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (!counts.size) return "";
  const names = [...counts].map(([name, count]) => (count > 1 ? `${name} \u00d7${count}` : name));
  // "vs" claims a head-to-head, which stops being true the moment a model
  // repeats — two gpt-4o columns are a mix, not a comparison.
  const joiner = [...counts.values()].every((count) => count === 1)
    ? ` ${t("aiObservability.playground.draftVersus")} `
    : " + ";
  return names.join(joiner);
}

/** What the run was about, in the order the operator would recognise it. */
function draftContext(current: PlaygroundDraft): string {
  if (current.sample) {
    return t("aiObservability.playground.draftDatasetSample", {
      dataset: current.sample.datasetName,
    });
  }
  if (current.provenance) return current.provenance.label;
  const messages = current.variants[0]?.messages ?? [];
  const prompt =
    messages.find((message) => message.role === "user" && message.content.trim()) ??
    messages.find((message) => message.content.trim());
  if (!prompt) return "";
  const text = prompt.content.replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 40)}\u2026` : text;
}

// ── the live session (this browser only) ──────────────────────────

/**
 * The bench survives leaving the page.
 *
 * The route is `keepAlive: false`, so navigating to Logs and back unmounts this
 * component and takes the draft with it. That is only correct for a page you
 * can re-derive from its address; the Playground is unsaved work, and Reset —
 * which asks first — is the one thing that is allowed to clear it.
 */
interface StoredSession {
  id: string;
  draft: PlaygroundDraft;
  results: PlaygroundResults;
}

const sessionKey = computed(() => `o2-playground-session:${orgId.value}`);

function restoreSession() {
  try {
    const stored = localStorage.getItem(sessionKey.value);
    if (!stored) return;
    const session = JSON.parse(stored) as StoredSession;
    if (!session?.draft?.variants?.length) return;
    Object.assign(draft, session.draft);
    adoptIds(draft);
    Object.assign(results, session.results ?? {});
    // Same id, so picking the session back up updates its Recent Drafts entry
    // in place rather than forking a near-duplicate beside it.
    if (session.id) draftSessionId.value = session.id;
  } catch {
    // Corrupt or unavailable storage costs the restore, never the page.
  }
}

function saveSession() {
  try {
    const session: StoredSession = {
      id: draftSessionId.value,
      draft: JSON.parse(JSON.stringify(draft)) as PlaygroundDraft,
      // Outcomes only: a cell caught mid-stream would come back as a run that
      // never finishes.
      results: settledResults(results),
    };
    localStorage.setItem(sessionKey.value, JSON.stringify(session));
  } catch {
    // A full or disabled localStorage costs the convenience, never the session.
  }
}

function clearSession() {
  try {
    localStorage.removeItem(sessionKey.value);
  } catch {
    // Nothing to do — the next save overwrites it anyway.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => JSON.stringify(draft),
  () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSession();
      persistDraft();
    }, 1500);
  },
);

/** Outputs are not part of the draft, so the debounce above never sees one
 *  arrive. Saving when the last run settles is what carries them across a
 *  navigation. */
watch(running, (isRunning, wasRunning) => {
  if (wasRunning && !isRunning) saveSession();
});

function persistDraft() {
  const summary = draftSummary(draft);
  if (!summary) return;
  const entry: RecentDraftEntry = {
    id: draftSessionId.value,
    summary,
    models: draftModels(draft),
    savedAt: Date.now(),
    draft: JSON.parse(JSON.stringify(draft)) as PlaygroundDraft,
  };
  // One entry per working session, not per keystroke. Keying on the text meant
  // every edit forked a near-duplicate and buried the drafts worth returning to.
  const others = recentDrafts.value.filter((candidate) => candidate.id !== entry.id);
  recentDrafts.value = [entry, ...others].slice(0, 10);
  try {
    localStorage.setItem(storageKey.value, JSON.stringify(recentDrafts.value));
  } catch {
    // A full or disabled localStorage costs the convenience, never the session.
  }
}

function restoreDraft(entry: RecentDraftEntry) {
  stopAll();
  // Carrying the id over means picking a draft back up updates it in place
  // rather than cloning it into a second entry.
  draftSessionId.value = entry.id;
  Object.assign(draft, JSON.parse(JSON.stringify(entry.draft)) as PlaygroundDraft);
  adoptIds(draft);
  for (const key of Object.keys(results)) delete results[key];
  toast({ variant: "info", message: t("aiObservability.playground.draftRestored") });
}
</script>
