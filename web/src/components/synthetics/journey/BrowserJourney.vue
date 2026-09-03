<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { BlockedReason, BrowserStep, ReplayPhase, StepReplayResult } from "@/types/synthetics";
import type { StepDotState } from "./JourneySteps.vue";
import useSyntheticsRecorder from "@/composables/useSyntheticsRecorder";
import { getUUIDv7 } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import JourneySteps from "./JourneySteps.vue";
import JourneySuggestions from "./JourneySuggestions.vue";
import {
  createSuggestedAssertionStep,
  deriveJourneySuggestions,
  type JourneySuggestionActionKind,
} from "@/utils/synthetics/journeySuggestions";
// Chrome UI element names stay in English in every locale — they name the
// actual Chrome interface the user is looking at.
import { CHROME_UI_LABELS, DEFAULT_TEST_ID_ATTR } from "@/constants/synthetics";
import BrowserJourneyStepEditor from "./BrowserJourneyStepEditor.vue";
import BrowserJourneyStepError from "./BrowserJourneyStepError.vue";
import ExtensionSetupDialog from "./ExtensionSetupDialog.vue";
import { stepIsMissingTarget } from "@/utils/synthetics/stepTarget";
import { journeyToWireSteps } from "@/utils/synthetics/mapRecordedStep";
import { classifyPreflightFailure } from "@/utils/synthetics/replayFailure";

const props = defineProps<{
  modelValue: BrowserStep[];
  readonly?: boolean;
  startUrl?: string; // URL shown in the recording banner
  /**
   * DOM attribute the recorder selects on, from the monitor's config.
   * Absent falls back to DEFAULT_TEST_ID_ATTR — see useSyntheticsRecorder.
   */
  testIdAttr?: string;
  extensionReady?: boolean; // when false, Record/Replay open the extension setup dialog
  /**
   * Whether the installed extension supports restore-then-record (`recordFrom`).
   *
   * A prop rather than a local probe because detection lives with the parent, which
   * owns the recorder instance that ran `detectExtension`. False means an extension
   * older than the capability: recording still works, it just cannot restore first,
   * so Record falls back to its previous behaviour instead of sending a command that
   * would be refused.
   */
  canRecordFrom?: boolean;
  /**
   * Whether the installed extension can record on the session a failed restore left
   * open (`recordFromFailure`).
   *
   * Separate from `canRecordFrom` because the two shipped in different extension
   * builds, and O2 always runs against a mix of them: without this, the recovery
   * button would be offered to an extension that answers it with a refusal.
   */
  canRecordFromFailure?: boolean;
  autoRecord?: boolean; // if true, start recording immediately on mount
  /** Owned by the parent (CreateBrowserTest). */
  replayPhase?: ReplayPhase;
  /** Per-step replay results, keyed by step id. Owned by the parent. */
  stepResults?: Map<string, StepReplayResult>;
  /** Id of the step currently being executed (set by stepReplayStarted). */
  activeStepId?: string | null;
  /** Why the last replay never reached step 1, or null when it did. */
  blockedReason?: BlockedReason | null;
  /** The extension's own error text, rendered verbatim for `preflight`. */
  blockedDetail?: string;
  /**
   * Save-time zod issues for this journey, owned by the parent.
   *
   * A prop rather than the method call this used to be. OStepper is a wizard, so
   * this component is unmounted whenever the Journey step is not the active one —
   * and in create mode the only Save button lives on the Configure step. The
   * parent's `journeyRef` is null there, so the imperative push was swallowed by
   * `?.` and the author got the toast and nothing else. Switching tabs first does
   * not fix it either: the ref is still null in that tick, and a component mounted
   * afterwards starts with an empty map. As a prop the issues simply wait, and the
   * row opens whenever the journey next renders.
   */
  fieldIssues?: readonly { path: PropertyKey[]; message: string }[];
  /**
   * Whether the parent's Variables panel is expanded. Undefined means the host
   * has no such panel, and the toolbar toggle is not rendered at all.
   */
  variablesPanelOpen?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: BrowserStep[]];
  "clear-results": [];
  replay: [];
  /**
   * Replay only the first `upTo` steps (1-based, inclusive).
   *
   * A single step is not independently runnable — journey state is cumulative and
   * the extension starts each replay from the target URL, so step 5 alone would run
   * against a fresh page with none of the preceding state. A PREFIX is runnable, and
   * `replay()` already accepts an arbitrary WireStep[], so this needs no extension
   * change. The old error-card button emitted a full `replay` while sitting inside a
   * per-step card, promising something it did not do (SE-4).
   */
  "replay-up-to": [upTo: number];
  "stop-replay": [];
  "auto-record-consumed": [];
  "selection-changed": [{ count: number; isRecording: boolean }];
  /**
   * The setup dialog's incognito ack was just given — the toggle reloads the
   * extension, so the owner of `extensionReady` must invalidate and re-probe.
   */
  "verify-extension": [];
  "toggle-variables-panel": [];
}>();

// ── Restore-then-record ─────────────────────────────────────────────────────
/**
 * The step new recordings land BEFORE, or null to land at the end.
 *
 * One piece of state drives both halves of the feature: everything before the anchor
 * is what gets replayed to restore the browser, and the anchor's index is where the
 * recorded steps are spliced in. "Record" and "Record before this step" are therefore
 * the same operation with a different anchor — see design §7.4.
 */
const anchorStepId = ref<string | null>(null);

/** How many prefix steps have reported a result, for the restore banner. */
const restoredCount = computed(() => recorder.stepResults.size);

/** How many steps the restore has to replay before recording can start. */
const restoreTotal = computed(() => {
  if (!anchorStepId.value) return props.modelValue.length;
  const idx = props.modelValue.findIndex((s) => s.id === anchorStepId.value);
  return idx < 0 ? props.modelValue.length : idx;
});

/** 1-based position of the step the restore stopped on, for the failure banner. */
const failedStepNumber = computed(() => {
  const id = prefixFailure.value?.stepId;
  if (!id) return 0;
  return props.modelValue.findIndex((s) => s.id === id) + 1;
});

// ── Filter / expand / select state ──────────────────────────────────────────
const filterQuery = ref("");
const expandedStepIds = ref<string[]>([]);
const selectedStepIds = ref<string[]>([]);

// ── "Where did my new step go?" ────────────────────────────────────────────
// Root element, so the row lookup in revealStep stays inside THIS journey's
// table rather than matching a same-indexed row in some other OTable.
const journeyRootRef = ref<HTMLElement | null>(null);
/** Step to highlight briefly after it is created; see revealStep. */
const flashStepId = ref<string | null>(null);
/** Long enough to catch the eye after a smooth scroll, short enough not to be
 * mistaken for a persistent status. Matches SessionDetails' turn flash. */
const FLASH_MS = 1400;
let flashTimer: number | undefined;

// Delete confirmation
const deleteConfirm = ref<{ show: boolean; step: BrowserStep | null }>({
  show: false,
  step: null,
});

const deleteConfirmMessage = computed(() => {
  const step = deleteConfirm.value.step;
  // raw("") is only the empty placeholder for "no step selected".
  if (!step) return raw("");
  const label = step.name || `#${props.modelValue.indexOf(step) + 1}`;
  return t("synthetics.journey.confirmDeleteMessage", { label });
});

// ── Drag-and-drop ──────────────────────────────────────────────────────────
// `isRestoring` as well as the parent's replay: a reorder mid-restore edits the very
// list the restore is anchored in, so the prefix being replayed and the index the
// capture splices at stop describing the same journey.
const dragReady = computed(
  () =>
    !isRecording.value &&
    !isReplayActive.value &&
    !isRestoring.value &&
    !props.readonly &&
    !filterQuery.value.trim(),
);
// Column stays visible during replay (handles invisible) to prevent layout shift
const showDragColumn = computed(
  () => !isRecording.value && !props.readonly && !filterQuery.value.trim(),
);

// ── Replay helpers ──────────────────────────────────────────────────────────
const isReplayRunning = computed(() => props.replayPhase === "running");
/** Stop pressed, extension not yet confirmed — still live, but no longer advancing. */
const isReplayStopping = computed(() => props.replayPhase === "stopping");
const isReplayActive = computed(() => props.replayPhase && props.replayPhase !== "idle");
const isReplayTerminal = computed(
  () =>
    props.replayPhase === "passed" ||
    props.replayPhase === "failed" ||
    props.replayPhase === "stopped",
);
// Editing stays suppressed until the stop is confirmed — the journey can still be
// executing while `stopping`, so letting a step be edited would race the player.
const isReplayLocked = computed(() => isReplayRunning.value || isReplayStopping.value);

/** Index of the first failing step in journey order, or -1 when none failed. */
const firstFailedIndex = computed(() =>
  props.modelValue.findIndex((s) => {
    const r = props.stepResults?.get(s.id);
    return r && !r.passed;
  }),
);

/** Replay result for the first failing step (for the inline error card). */
const failedStepResult = computed<StepReplayResult | undefined>(() => {
  if (firstFailedIndex.value < 0) return undefined;
  const step = props.modelValue[firstFailedIndex.value];
  return props.stepResults?.get(step.id);
});

/**
 * The failed replay result for a given row, if any.
 *
 * Only while a replay is in a terminal/active state — a stale result from a previous
 * run must not keep a card on screen after the journey is edited.
 */
function failedResultFor(row: BrowserStep): StepReplayResult | undefined {
  if (!isReplayActive.value) return undefined;
  const r = props.stepResults?.get(row.id);
  return r && !r.passed ? r : undefined;
}

function stepNumberOf(row: BrowserStep): number {
  return props.modelValue.findIndex((s) => s.id === row.id) + 1;
}

/**
 * A failed step's evidence lives in the row's expansion, so open it automatically —
 * the same thing validateJourneySteps does for validation errors. Without this a
 * tester has to guess which row to expand to find out what happened.
 */
watch(
  () => (props.replayPhase === "failed" ? firstFailedIndex.value : -1),
  (idx) => {
    if (idx < 0) return;
    const step = props.modelValue[idx];
    if (step && !expandedStepIds.value.includes(step.id)) {
      expandedStepIds.value = [...expandedStepIds.value, step.id];
    }
  },
  { immediate: true },
);

/** Derive the status dot state for a step based on replay results. */
function stepDotState(stepId: string): StepDotState | undefined {
  if (!isReplayActive.value || !props.replayPhase) return undefined;
  const result = props.stepResults?.get(stepId);
  if (result) {
    return result.passed ? "pass" : "fail";
  }
  // Currently executing step. Gated on `running` deliberately: a stopped replay leaves
  // the step it was interrupted on with no result, and rendering that as "active" is what
  // left the journey showing a step spinning forever. Outside `running` it falls through
  // to "pending" — an empty circle, which is the truth: that step never completed.
  if (isReplayRunning.value && props.activeStepId === stepId) return "active";
  const stepIndex = props.modelValue.findIndex((s) => s.id === stepId);
  if (firstFailedIndex.value >= 0 && stepIndex > firstFailedIndex.value) return "skip";
  if (props.replayPhase === "running") return "pending";
  return "pending";
}

// ── Selection helpers ──────────────────────────────────────────────────────
const selectedCount = computed(() => selectedStepIds.value.length);

const allSelected = computed(
  () =>
    props.modelValue.length > 0 &&
    props.modelValue.every((s) => selectedStepIds.value.includes(s.id)),
);

function toggleSelectAll() {
  selectedStepIds.value = allSelected.value ? [] : props.modelValue.map((s) => s.id);
}

function deleteSelectedSteps() {
  const ids = new Set(selectedStepIds.value);
  emit(
    "update:modelValue",
    props.modelValue.filter((s) => !ids.has(s.id)),
  );
  selectedStepIds.value = [];
}

// Clear selection when the step list changes, filter changes, or replay starts.
// Also clear replay banner when all steps are deleted so stale pass/fail banners
// don't linger after the user removes every step.
watch(
  () => props.modelValue.length,
  (newLen) => {
    selectedStepIds.value = [];
    if (newLen === 0) emit("clear-results");
  },
);
watch(filterQuery, () => {
  selectedStepIds.value = [];
});
watch(
  () => props.replayPhase,
  (phase) => {
    if (phase === "running") {
      selectedStepIds.value = [];
      expandedStepIds.value = []; // collapse all on new replay
      return;
    }
    // Auto-expand the first failing step when replay fails
    if (phase === "failed" && firstFailedIndex.value >= 0) {
      const stepId = props.modelValue[firstFailedIndex.value]?.id;
      if (stepId) expandedStepIds.value = [stepId];
    }
  },
);

// Selection is the OTHER way to delete: ticking rows hands the parent a bulk Delete
// in its sticky footer. Recording and a running replay were excluded from the start;
// a restore has to be too, or the journey can be edited underneath the very run that
// is anchored in it — and the row's own Delete being disabled makes that path look
// deliberate rather than missed.
const multiSelectEnabled = computed(
  () => !isRecording.value && !props.readonly && !isReplayLocked.value && !isRestoring.value,
);

// ── Recording state ────────────────────────────────────────────────────────
// All Chrome-extension messaging lives in the composable; this component only
// reflects its reactive state and merges the result into the journey on stop.
const { t } = useI18nTyped();

const recorder = useSyntheticsRecorder(t);
const isRecording = recorder.isRecording;
/**
 * The restore's own phase and failure, from THIS component's recorder instance.
 *
 * Deliberately not `props.replayPhase`: that is the parent's replay, a different
 * session entirely. A restore is driven from here, so its state lives here — reading
 * the prop would leave the banner blank during the very thing it exists to narrate.
 */
const restorePhase = recorder.replayPhase;
const prefixFailure = recorder.prefixFailure;
const capturedSteps = recorder.liveSteps;
const currentUrl = recorder.currentUrl;
const recordingError = recorder.error;

// ── How a restore ended ────────────────────────────────────────────────────
//
// Two endings share one message from the extension, and nothing else about them
// is alike. The recorder window is the exit a restore offers, so closing it is a
// cancel — it simply reaches O2 as `runActions` rejecting, which the extension
// can only report through the channel a failing step uses.

/** The one restore ending with something to explain and somewhere to go. */
const restoreStepFailure = computed(() =>
  prefixFailure.value?.reason === "step-failed" ? prefixFailure.value : null,
);

// The same vocabulary the step error card speaks (issue 003), against the same
// `structuredError.name`. A restore IS a replay of the journey, so an author who
// has read "Timeout" on a failed step should read the same word here.
const restoreFailureIcon = computed(() => {
  switch (restoreStepFailure.value?.structuredError?.name) {
    case "TimeoutError":
      return "timer-off";
    case "TargetClosedError":
      return "visibility-off";
    default:
      return "error_outline";
  }
});

const restoreFailureLabel = computed(() => {
  switch (restoreStepFailure.value?.structuredError?.name) {
    case "TimeoutError":
      return t("synthetics.stepErrors.timeout");
    case "TargetClosedError":
      return t("synthetics.stepErrors.tabClosed");
    default:
      return t("synthetics.stepErrors.default");
  }
});

/** Is a restore still running? Distinct from the parent's replay — see `restorePhase`. */
const isRestoring = computed(() => restorePhase.value === "restoring");

/**
 * Put the editor back after a restore the author walked away from, and say so.
 *
 * A toast rather than a banner, for the reason the added-steps toast is one (see
 * `announceRecordedSteps`): the author spent that session in the extension's own
 * window, and there is nothing here to act on — a banner would sit on the table
 * demanding attention for a decision already taken. The marker goes with it,
 * because left up it promises a destination for a session that no longer exists
 * and the toolbar's Record would silently inherit it.
 *
 * Only the closed window is narrated. A cancel from the button below announces
 * itself by being pressed.
 */
watch(
  () => prefixFailure.value?.reason,
  (reason) => {
    if (reason !== "window-closed" && reason !== "cancelled") return;
    anchorStepId.value = null;
    if (reason === "window-closed")
      toast({ variant: "info", message: t("synthetics.journey.restoreCancelledWindowClosed") });
  },
);

// Emit selection state changes for the parent's sticky footer
watch([selectedCount, isRecording], ([count, recording]) => {
  emit("selection-changed", { count, isRecording: recording });
});

// ── Step validation (Continue button + save) ──────────────────────────────
const selectorErrors = ref<Set<string>>(new Set());
const firstStepError = ref(false);

/**
 * Field errors for the expanded editor, keyed by step id then field name.
 *
 * Populated from the zod issue paths so one enforcement path produces both the
 * save block and the inline messages. Keying by step **id** rather than index
 * means a reorder or a delete cannot leave an error pointing at the wrong row.
 */
const stepFieldErrors = ref<Map<string, Record<string, string>>>(new Map());

/**
 * Steps carrying at least one schema-level field error.
 *
 * `validateJourneySteps` enforces two rules of its own, but they are not the only
 * ones that block a save: `stepNameRequired`, `retiredAction`, the navigate URL,
 * `typeTextRequired` and `expectedRequired` all live in the zod schema and reach
 * this component through `setStepFieldErrors` alone. Row highlighting and
 * auto-expand read this so those rules behave like the two local ones instead of
 * being announced by a toast and then shown nowhere.
 *
 * `clearFieldError` can leave a step with an empty record, so emptiness is
 * checked rather than mere presence of the key.
 */
const fieldErrorStepIds = computed(
  () =>
    new Set(
      [...stepFieldErrors.value.entries()]
        .filter(([, fields]) => Object.keys(fields).length > 0)
        .map(([id]) => id),
    ),
);

/**
 * Open every errored row and bring the first of them into view.
 *
 * Journey order, not issue order: "the first error" has to mean the first one the
 * author would reach scrolling down, or the scroll lands on an arbitrary row. A
 * filter is cleared for the same reason `revealStep` clears it — a row the filter
 * excludes is not rendered at all, so expanding it puts nothing on screen.
 */
function revealErroredSteps(stepIds: Iterable<string>) {
  const wanted = new Set(stepIds);
  if (wanted.size === 0) return;
  const ordered = props.modelValue.filter((s) => wanted.has(s.id)).map((s) => s.id);
  if (ordered.length === 0) return;
  if (filterQuery.value.trim()) {
    filterQuery.value = "";
    toast({ variant: "info", message: t("synthetics.journey.filterClearedForErrors") });
  }
  expandedStepIds.value = [...new Set([...expandedStepIds.value, ...ordered])];
  scrollToStep(ordered[0]);
}

/** Scroll to a step's expansion anchor, scoped to this journey's root. */
function scrollToStep(stepId: string) {
  nextTick(() => {
    journeyRootRef.value
      ?.querySelector(`[data-test="synthetics-journey-step-anchor-${stepId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

/** Record zod issues whose path points at a journey step field. */
function applyStepFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const next = new Map<string, Record<string, string>>();
  for (const issue of issues) {
    if (issue.path[0] !== "journey" || typeof issue.path[1] !== "number") continue;
    const step = props.modelValue[issue.path[1]];
    if (!step) continue;
    // `journey.3.assertion.expected` → "assertion.expected"; a bare
    // `journey.3` (a whole-step issue) is attributed to the action field.
    const field = issue.path.slice(2).join(".") || "action";
    next.set(step.id, { ...(next.get(step.id) ?? {}), [field]: issue.message });
  }
  stepFieldErrors.value = next;
  // This is the schema's only channel into the journey, so it owns the expansion
  // the way validateJourneySteps owns it for its own two rules. Without this the
  // save's toast named fields that sat inside a collapsed row.
  revealErroredSteps(next.keys());
}

// `immediate` is the whole point: this component is mounted long after the save
// that produced the issues, so applying them only on CHANGE would miss every
// create-mode failure. An empty list clears — a save that succeeds must not leave
// the previous failure's messages on screen.
watch(
  () => props.fieldIssues,
  (issues) => applyStepFieldErrors(issues ?? []),
  { immediate: true },
);

function fieldError(stepId: string, field: string): string {
  return stepFieldErrors.value.get(stepId)?.[field] ?? "";
}

function clearFieldError(stepId: string, field: string) {
  const current = stepFieldErrors.value.get(stepId);
  if (!current?.[field]) return;
  const { [field]: _dropped, ...rest } = current;
  const next = new Map(stepFieldErrors.value);
  next.set(stepId, rest);
  stepFieldErrors.value = next;
}

function validateJourneySteps(): boolean {
  // 1. First step must be "navigate"
  const first = props.modelValue[0];
  firstStepError.value = first ? first.action !== "navigate" : false;

  // 2. Element-acting steps must name their element — by a v1 `selector` or a
  //    v2 locator bundle. See stepIsMissingTarget.
  const selErrs = new Set<string>();
  for (const step of props.modelValue) {
    if (stepIsMissingTarget(step)) selErrs.add(step.id);
  }
  selectorErrors.value = selErrs;

  // Auto-expand errored steps so the inline error is visible
  const erroredIds = [...selErrs];
  if (firstStepError.value && first) erroredIds.push(first.id);
  revealErroredSteps(erroredIds);

  const valid = !firstStepError.value && selErrs.size === 0;
  if (!valid) {
    // Surface the first error as a toast so the user knows why
    // navigation was blocked, then expand the step to see inline details.
    const firstErrId = erroredIds[0];
    const stepIdx = props.modelValue.findIndex((s) => s.id === firstErrId);
    const stepLabel =
      props.modelValue[stepIdx]?.name ||
      t("synthetics.results.steps.step", { step: (stepIdx ?? 0) + 1 });
    if (firstStepError.value && (!first || first.id === firstErrId)) {
      toast({ variant: "error", message: t("synthetics.validation.firstStepMustNavigate") });
    } else {
      toast({
        variant: "error",
        message: t("synthetics.validation.selectorRequired", { step: stepLabel }),
      });
    }
  }

  return valid;
}

function clearSelectorError(stepId: string) {
  const next = new Set(selectorErrors.value);
  next.delete(stepId);
  selectorErrors.value = next;
}

function clearFirstStepError() {
  firstStepError.value = false;
}

// Expose selection state + validation for the parent's sticky footer
defineExpose({
  selectedCount,
  isRecording,
  deleteSelectedSteps,
  stopActiveRecording,
  stopActiveReplay,
  // Still imperative: both callers (Continue-to-Configure, the replay gate) run
  // while the Journey step IS the active one, so the ref is live. Save-time zod
  // issues cannot use this channel — see the `fieldIssues` prop.
  validateStepSelectors: validateJourneySteps,
});

/**
 * Start capturing, restoring the journey first when there is anything to restore.
 *
 * The anchor decides the prefix: null anchors at the end (everything replays), a step
 * anchors before it (everything up to it replays). An empty journey — or an extension
 * that cannot restore — takes the original path, because there is either nothing to
 * replay or no way to replay it.
 */
function startRecording() {
  const insertAt = currentInsertAt();
  const prefix = props.modelValue.slice(0, insertAt);

  if (prefix.length === 0 || !props.canRecordFrom) {
    // Nothing was restored, so the capture starts on a browser that knows nothing about
    // the prefix — steps from it cannot be filed at the anchor.
    anchorStepId.value = null;
    recorder.startRecording(props.startUrl ?? "", props.testIdAttr).catch((err) => {
      recorder.error.value = err instanceof Error ? err.message : String(err);
    });
    return;
  }

  recorder
    .startRecordingFrom(journeyToWireSteps(prefix), {
      targetUrl: props.startUrl,
      testIdAttr: props.testIdAttr,
    })
    .catch((err) => {
      recorder.error.value = err instanceof Error ? err.message : String(err);
    });
}

/**
 * Record from where the failing step stopped, on the session still open there.
 *
 * Re-anchors on that step, so what the author records lands immediately before the
 * step that could not run — which is where a missing precondition belongs. No
 * restore runs: the browser has not moved since it stopped, which is the whole
 * point of the extension leaving the session up (design §7.6).
 */
function onRecordFromFailure() {
  const failed = restoreStepFailure.value;
  if (!failed) return;
  anchorStepId.value = failed.stepId;
  recorder.recordFromHere().catch((err) => {
    recorder.error.value = err instanceof Error ? err.message : String(err);
  });
}

/**
 * Abandon a restore that is still replaying.
 *
 * The exit the recorder window used to be. Same ending as the failure dismissal —
 * the anchor goes with the session — which is why both go through the composable's
 * one cancel rather than each unwinding the state their own way.
 */
function onCancelRestore() {
  anchorStepId.value = null;
  recorder.cancelRestore();
}

/**
 * Give up on the restore and go back to editing.
 *
 * Drops the anchor as well as the banner: the session it pointed into is over, and
 * a marker left behind would send the toolbar's Record into the middle of the
 * journey with nothing on screen to explain why.
 */
function onDismissRestoreFailure() {
  anchorStepId.value = null;
  recorder.cancelRestore();
}

/** Where recorded steps land: the anchor's index, or the end when unanchored. */
function currentInsertAt(): number {
  if (!anchorStepId.value) return props.modelValue.length;
  const idx = props.modelValue.findIndex((s) => s.id === anchorStepId.value);
  return idx < 0 ? props.modelValue.length : idx;
}

/**
 * Whether the row action is offered at all.
 *
 * Not `canRecordFrom` itself: with no extension installed the click still has somewhere
 * useful to go — the setup dialog — so only "installed but too old" disables it.
 */
const canOfferRecordBefore = computed(() => !props.extensionReady || !!props.canRecordFrom);

/**
 * Anchor on `row` and start recording — "Record before this step".
 *
 * The anchor is not cleared on success: it is cleared when the steps are committed,
 * so the marker stays put for the whole session and the author can see where their
 * steps are going.
 */
function onRecordBefore(row: BrowserStep) {
  if (!props.extensionReady) {
    extensionSetup.value = { open: true, action: "record" };
    return;
  }
  anchorStepId.value = row.id;
  startRecording();
}

/**
 * Say what a finished recording added, and where.
 *
 * The one case that genuinely satisfies this file's toast convention (see
 * `revealStep`): the author spent the whole recording in the extension's incognito
 * window, so the steps land in a table they were not looking at — with no flash, no
 * scroll and no row marker to find them by. It fires once per SESSION, not once per
 * step, so it cannot stack the way a per-step message would.
 *
 * Numbers come from the splice rather than a lookup: a recording is inserted as one
 * contiguous block, so it occupies exactly `insertAt + 1 … insertAt + count`, 1-based
 * like the row numbering. The range is named instead of the anchor
 * (record-from-step-design.md §7.2's "inserted before step 5") because after the
 * splice the new steps ARE step 5 onwards, so the anchor's old number points at one
 * of them.
 */
function announceRecordedSteps(insertAt: number, count: number) {
  const first = insertAt + 1;
  toast({
    variant: "success",
    message: t(
      "synthetics.journey.recordedStepsAdded",
      { count, first, last: insertAt + count },
      count,
    ),
  });
}

/**
 * Splice `steps` in at the anchor and invalidate everything after them.
 *
 * The single commit path for every way a recording can end — the Stop button, the
 * route guard, and the extension window being closed — so the ordering rule and the
 * invalidation rule cannot drift apart between them. The toast lives here for that
 * same reason: hung off the Stop button it would have missed the other two.
 */
function commitRecordedSteps(steps: BrowserStep[]) {
  if (steps.length === 0) {
    anchorStepId.value = null;
    return;
  }
  const insertAt = currentInsertAt();
  const next = [...props.modelValue];
  next.splice(insertAt, 0, ...steps);
  emit("update:modelValue", next);
  anchorStepId.value = null;
  // After the reset: `currentInsertAt` reads the anchor, so the position has to be
  // captured while it still points at one.
  announceRecordedSteps(insertAt, steps.length);
}

async function stopRecording() {
  commitRecordedSteps(await recorder.stopRecording());
}

function cancelRecording() {
  recorder.cancelRecording();
}

// ── Extension setup dialog ─────────────────────────────────────────────────
// Record and Replay both run inside the extension, so either one clicked
// without it installed opens the setup dialog instead of failing silently
// (an ungated replay would sit in `running` until the bridge watchdog fired).
const extensionSetup = ref<{ open: boolean; action: "record" | "replay" }>({
  open: false,
  action: "record",
});

function onRecordButtonClick() {
  // This button has always meant "record at the end". The anchor is read by both
  // record affordances, so one left over from an anchored session that ended without
  // committing — a failed restore, a closed window — would silently turn this into a
  // mid-journey insert with nothing on screen saying so.
  anchorStepId.value = null;
  if (props.extensionReady) {
    startRecording();
  } else {
    extensionSetup.value = { open: true, action: "record" };
  }
}

function onReplayButtonClick() {
  if (props.extensionReady) {
    emit("replay");
  } else {
    extensionSetup.value = { open: true, action: "replay" };
  }
}

function onExtensionSetupContinue() {
  if (extensionSetup.value.action === "record") startRecording();
  else emit("replay");
}

const extensionSetupDialog = ref<InstanceType<typeof ExtensionSetupDialog> | null>(null);

// Recording-start refusals arrive as a raw extension message, not a
// BlockedReason — classify them the same way the replay preflight is.
const recordingBlockedIncognito = computed(
  () => !!recordingError.value && classifyPreflightFailure(recordingError.value) === "incognito",
);

// An incognito-classified failure — replay preflight or recording start —
// means "Allow in Incognito" is off: reopen the setup dialog on its incognito
// task, revoking the attestation the failure just disproved, instead of
// leaving the author with a wall of text.
watch([() => props.blockedReason, recordingBlockedIncognito], ([reason, recordBlocked]) => {
  if (reason === "incognito" || recordBlocked) {
    extensionSetupDialog.value?.revokeIncognitoAck();
    extensionSetup.value = { open: true, action: recordBlocked ? "record" : "replay" };
  }
});

function onIncognitoRetry() {
  if (recordingBlockedIncognito.value) startRecording();
  else emit("replay");
}

function onIncognitoDismiss() {
  if (recordingBlockedIncognito.value) recorder.error.value = "";
  else emit("clear-results");
}

/** Sync stop — called by parent's route guard before navigating away.
 *  Commits captured recording steps so they aren't lost. Returns true if
 *  anything was stopped. */
function stopActiveRecording(): boolean {
  if (!recorder.isRecording.value) return false;
  commitRecordedSteps(recorder.stopAndForget());
  return true;
}

/** Sync stop for replay — called by parent's route guard. */
function stopActiveReplay(): boolean {
  // A restore is a replay this component started, so it is one of the things the
  // guard is asking about. Left running it holds an incognito window open with
  // nothing listening to it, since the page that was listening is gone.
  if (isRestoring.value) {
    onCancelRestore();
    return true;
  }
  // `stopping` included: the extension has been asked to stop but has not confirmed, so
  // the replay is still live and leaving without the sync stop can orphan it.
  if (!isReplayLocked.value) return false;
  recorder.stopReplayAndForget();
  return true;
}

/** Sync fire-and-forget on tab close — prevents orphaned extension tabs. */
function handleBeforeUnload() {
  if (recorder.isRecording.value) recorder.stopAndForget();
  else if (isReplayLocked.value) recorder.stopReplayAndForget();
}

onMounted(() => {
  // Register the external-stop callback: the composable calls this synchronously
  // when recordingStopped arrives over the port, avoiding any async timing races.
  recorder.setOnExternalStop((steps: BrowserStep[]) => {
    commitRecordedSteps(steps);
  });
  window.addEventListener("beforeunload", handleBeforeUnload);
  if (props.autoRecord) {
    startRecording();
    emit("auto-record-consumed");
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  recorder.setOnExternalStop(null);
  recorder.cleanup();
  window.clearTimeout(flashTimer);
});

// ── Step list (single flat list — one journey, one start URL) ───────────────
const filteredSteps = computed<BrowserStep[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return props.modelValue;
  return props.modelValue.filter(
    (step) =>
      step.name?.toLowerCase().includes(q) ||
      step.action.toLowerCase().includes(q) ||
      step.selector?.toLowerCase().includes(q) ||
      step.value?.toLowerCase().includes(q),
  );
});

// ── Journey suggestions ────────────────────────────────────────────────────
// What the recording is worth telling its author, collapsed into one toolbar
// chip. Derived, never stored: a suggestion leaves when the author resolves the
// condition behind it, which is the only dismissal there is.
const suggestions = computed(() =>
  deriveJourneySuggestions(props.modelValue, props.testIdAttr ?? DEFAULT_TEST_ID_ATTR),
);

function onSuggestionAction(kind: JourneySuggestionActionKind) {
  if (kind !== "add-assertion") return;
  const step = createSuggestedAssertionStep(t("synthetics.journey.assertionSuggestedName"));
  emit("update:modelValue", [...props.modelValue, step]);
  // The suggested step is a stub — it names an assertion kind and no element, so the
  // author has to finish it. Revealed like `addStep`'s step for that reason; without
  // it, clicking the chip on a long journey appended a row below the fold and looked
  // like nothing had happened.
  revealStep(step.id);
}

// ── Expand / collapse ─────────────────────────────────────────────────────
function handleToggleExpand(row: BrowserStep) {
  if (expandedStepIds.value.includes(row.id)) {
    expandedStepIds.value = expandedStepIds.value.filter((id) => id !== row.id);
  } else {
    expandedStepIds.value = [...expandedStepIds.value, row.id];
  }
}

// ── Step CRUD — find by id and mutate ──────────────────────────────────────
function findIndex(row: BrowserStep): number {
  return props.modelValue.findIndex((s) => s.id === row.id);
}

function handleDelete(row: BrowserStep) {
  deleteConfirm.value = { show: true, step: row };
}

function confirmDelete() {
  if (!deleteConfirm.value.step) return;
  const idx = findIndex(deleteConfirm.value.step);
  deleteConfirm.value = { show: false, step: null };
  if (idx < 0) return;
  const next = [...props.modelValue];
  next.splice(idx, 1);
  emit("update:modelValue", next);
}

function cancelDelete() {
  deleteConfirm.value = { show: false, step: null };
}
function handleDuplicate(row: BrowserStep) {
  const idx = findIndex(row);
  if (idx < 0) return;
  const copy = { ...props.modelValue[idx], id: getUUIDv7(true) };
  const next = [...props.modelValue];
  next.splice(idx + 1, 0, copy);
  emit("update:modelValue", next);
  revealStep(copy.id);
}
function handleInsertBelow(row: BrowserStep) {
  const idx = findIndex(row);
  if (idx < 0) return;
  const step: BrowserStep = {
    id: getUUIDv7(true),
    action: "click",
    name: "",
    // A new step is a version-2 step: its identity is the locator bundle, never a
    // bare `selector`. Seeding it empty is what makes the editor render the
    // Locator block from the start, and what lets isV2Journey stay true once the
    // author supplies a locator instead of flipping the journey to v1 (SE-18).
    locator: { candidates: [] },
  };
  const next = [...props.modelValue];
  next.splice(idx + 1, 0, step);
  emit("update:modelValue", next);
  revealStep(step.id);
}
function handleRowReorder(reordered: BrowserStep[]) {
  emit("update:modelValue", reordered);
}
function handleUpdateSelected(ids: string[]) {
  selectedStepIds.value = ids;
}
function handleUpdateExpanded(ids: string[]) {
  expandedStepIds.value = ids;
}
function addStep() {
  const step: BrowserStep = {
    id: getUUIDv7(true),
    action: "click",
    name: "",
    // See handleInsertBelow — a new step is version 2.
    locator: { candidates: [] },
  };
  emit("update:modelValue", [...props.modelValue, step]);
  revealStep(step.id);
}

/**
 * Bring a just-created step to the author: expand it, scroll to it, flash it.
 *
 * "Add Step" appended a blank row to the end of the list and did nothing else.
 * On a 20-step journey the row was below the fold, collapsed, and — if a filter
 * was active — not rendered at all, so the button read as broken.
 *
 * Expanding is the same reflex this component already has for a step that needs
 * attention (a validation error, a failed replay): the evidence, or here the
 * empty fields, live in the expansion. A new step is by definition incomplete —
 * it has no locator and will fail `validateJourneySteps` — so it always needs
 * the author, and the expansion is what they came for.
 *
 * Deliberately NOT a success toast. The scroll + expansion is the confirmation,
 * and it persists; a toast would be redundant on top of it, would stack twenty
 * deep while building a journey, and would break this file's convention of
 * reserving toasts for things the user CANNOT see (blocked saves, errors).
 * The one toast here is for the filter reset, which is a change the author did
 * not ask for and would otherwise be baffling.
 */
function revealStep(stepId: string) {
  // A blank step matches no filter query, so it would land invisible. Clearing
  // is better than silently appending into a hidden part of the list — but say
  // so, because the author's filter disappearing on its own is confusing.
  if (filterQuery.value.trim()) {
    filterQuery.value = "";
    toast({ variant: "info", message: t("synthetics.journey.filterClearedForNewStep") });
  }
  if (!expandedStepIds.value.includes(stepId)) {
    expandedStepIds.value = [...expandedStepIds.value, stepId];
  }
  flashStepId.value = stepId;
  // The anchor lives inside the row's expansion, which the line above just
  // opened — so it exists by the time scrollToStep's nextTick runs, and it is
  // keyed by step id rather than by row position.
  scrollToStep(stepId);
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    if (flashStepId.value === stepId) flashStepId.value = null;
  }, FLASH_MS);
}
function duplicateCapturedStep(index: number, step: BrowserStep) {
  capturedSteps.value.splice(index + 1, 0, { ...step, id: getUUIDv7(true) });
}

// ── Dot state wrapper for JourneySteps ────────────────────────────────────
function dotStateForRow(row: BrowserStep): StepDotState | undefined {
  return stepDotState(row.id);
}

// ── Row status color: red left border for rows with validation errors ──────
function getRowStatusColor(row: BrowserStep): string | undefined {
  const first = props.modelValue[0];
  const hasFirstStepErr = firstStepError.value && first?.id === row.id;
  const hasSelectorErr = selectorErrors.value.has(row.id);
  // Schema-level errors count too, or "fix the highlighted fields" would name a
  // row that carries no highlight — every rule except these two local ones
  // reaches the journey only as a field error.
  const hasFieldErr = fieldErrorStepIds.value.has(row.id);
  if (hasFirstStepErr || hasSelectorErr || hasFieldErr) return "var(--color-status-error-text)";
  // Transient "this is the one you just added". It clears itself a moment later; the
  // list says nothing lasting about a row's age, only about whether it is broken.
  if (flashStepId.value === row.id) return "var(--color-status-info-text)";
  return undefined;
}

// ── Inline editor ──────────────────────────────────────────────────────────
// BrowserJourneyStepEditor owns the field rendering AND the wire sync, and
// emits a complete replacement step. Keeping a second copy of that logic here
// is what let the two editors drift apart in the first place.
function handleStepReplace(row: BrowserStep, next: BrowserStep) {
  const idx = findIndex(row);
  if (idx < 0) return;
  const prev = props.modelValue[idx];
  const steps = [...props.modelValue];
  steps[idx] = next;
  // A message that outlives the edit fixing it is worse than no message: the
  // field stays red while the author looks at correct input, and since a field
  // error now force-expands its row, a stale one keeps re-opening a row that is
  // already right. `action` and `selector` have their own edited events; the
  // editor emits none for name/value/expected, so the changed field is derived
  // from the replacement step it hands back.
  if (next.name !== prev.name) clearFieldError(row.id, "name");
  if (next.value !== prev.value) clearFieldError(row.id, "value");
  if (next.assertion?.expected !== prev.assertion?.expected) {
    clearFieldError(row.id, "assertion.expected");
  }
  emit("update:modelValue", steps);
}
</script>

<template>
  <div ref="journeyRootRef" class="flex min-h-0 w-full flex-col py-4">
    <!-- Toolbar — pl-4 mirrors the expand column (w-4) so the select-all checkbox
         aligns with the row checkboxes in the OTable below. -->
    <div class="mb-3 ml-6.5 flex items-center gap-4 px-3">
      <!-- Select-all — visibility:hidden during replay to preserve layout -->
      <OCheckbox
        :model-value="allSelected || undefined"
        size="sm"
        :class="{ invisible: isRecording || readonly }"
        data-test="synthetics-journey-select-all"
        @update:model-value="toggleSelectAll()"
      />
      <div class="flex">
        <h3 class="text-text-heading mr-0 text-base font-semibold">
          {{ t("synthetics.journey.steps") }}
        </h3>
        <OBadge variant="default" size="sm" class="ml-1">{{ modelValue.length }}</OBadge>
      </div>

      <!-- Advisory notices used to be two permanently-expanded cards below this
           toolbar. The filter is `flex-1` and the action area is a fixed width,
           so the chip's width comes out of the filter and the buttons stay put. -->
      <JourneySuggestions
        v-if="!readonly"
        :suggestions="suggestions"
        @action="onSuggestionAction"
      />

      <OInput
        v-model="filterQuery"
        :placeholder="t('synthetics.journey.filterSteps')"
        class="flex-1"
        data-test="synthetics-journey-filter-input"
      />
      <!-- Fixed-width action area — buttons right-aligned, widest set (Add Step + Record + Replay/Stop) fits in 320px -->
      <div class="flex w-110 items-center justify-end gap-2">
        <OButton
          v-if="!isRecording && !isReplayLocked"
          variant="outline"
          size="sm"
          :disabled="readonly || isRecording || isRestoring"
          data-test="synthetics-journey-add-step-btn"
          @click="addStep"
          icon-left="add"
        >
          {{ t("synthetics.journey.addStep") }}
        </OButton>

        <!-- Run replay / Stop / Re-run — positionally stable, same slot -->
        <template v-if="!isRecording">
          <OButton
            v-if="replayPhase === 'idle'"
            variant="outline"
            size="sm"
            :disabled="readonly || modelValue.length === 0 || isRestoring"
            data-test="synthetics-journey-replay-btn"
            @click="onReplayButtonClick"
            icon-left="replay"
          >
            {{ t("synthetics.journey.replay") }}
          </OButton>
          <OButton
            v-else-if="replayPhase === 'running'"
            variant="destructive"
            size="sm"
            data-test="synthetics-journey-stop-replay-btn"
            @click="emit('stop-replay')"
            icon-left="stop"
          >
            {{ t("synthetics.journey.stop") }}
          </OButton>
          <!-- Stop acknowledged, extension not yet confirmed. Same slot, so no layout
               shift; disabled so a second click cannot queue another stopReplay. -->
          <OButton
            v-else-if="isReplayStopping"
            variant="destructive"
            size="sm"
            loading
            disabled
            data-test="synthetics-journey-stopping-replay-btn"
            icon-left="stop"
          >
            {{ t("synthetics.journey.stopping") }}
          </OButton>
          <!-- Re-run, reached when a previous replay has finished. Carries the same
               restore guard as the idle branch: it is the same button in the same
               slot, and a restore holds the only session a replay could use. -->
          <OButton
            v-else-if="isReplayTerminal"
            variant="outline"
            size="sm"
            :disabled="isRestoring"
            data-test="synthetics-journey-replay-btn"
            @click="onReplayButtonClick"
            icon-left="replay"
          >
            {{ t("synthetics.journey.replay") }}
          </OButton>
        </template>

        <OButton
          v-if="isRecording"
          variant="outline"
          size="sm"
          data-test="synthetics-journey-cancel-btn"
          @click="cancelRecording"
        >
          {{ t("synthetics.journey.cancel") }}
        </OButton>

        <OButton
          v-if="isRecording"
          variant="destructive"
          size="sm"
          data-test="synthetics-journey-stop-btn"
          @click="stopRecording"
          icon-left="stop"
          class="w-24!"
        >
          {{ t("synthetics.journey.stop") }}
        </OButton>
        <OButton
          v-else
          variant="primary"
          size="sm"
          :disabled="readonly || isRecording || isReplayLocked || isRestoring"
          data-test="synthetics-journey-record-btn"
          @click="onRecordButtonClick"
          icon-left="smart-display"
          class="w-24!"
        >
          {{ t("synthetics.journey.record") }}
        </OButton>

        <!-- Variables panel toggle — only when the host provides that panel -->
        <OButton
          v-if="variablesPanelOpen !== undefined"
          variant="outline"
          size="sm"
          class="shrink-0"
          data-test="synthetics-journey-toggle-variables-btn"
          @click="emit('toggle-variables-panel')"
        >
          {{ t("synthetics.variablesPanel.title") }}
          <OIcon
            :name="
              variablesPanelOpen ? 'keyboard-double-arrow-right' : 'keyboard-double-arrow-left'
            "
            size="sm"
          />
          <OTooltip
            :content="
              variablesPanelOpen
                ? t('synthetics.variablesPanel.collapsePanel')
                : t('synthetics.variablesPanel.openPanel')
            "
            side="bottom"
          />
        </OButton>
      </div>
    </div>

    <!-- The journey is being re-run only to reach the point recording starts from.
         Named apart from a replay on purpose: a restore that passes is not a result,
         and calling it "replaying" invites the author to start clicking mid-restore. -->
    <div
      v-if="restorePhase === 'restoring'"
      class="rounded-default bg-badge-info-soft-bg border-badge-info-ol-border/50 mx-2! mb-3 flex items-center gap-3 border p-3"
      role="status"
      data-test="synthetics-journey-restoring-banner"
    >
      <OIcon name="history" size="sm" aria-hidden="true" />
      <span class="text-text-body text-sm">
        {{ t("synthetics.journey.restoringState", { done: restoredCount, total: restoreTotal }) }}
      </span>
      <span class="flex-1" />
      <!-- Without this, closing the recorder window was the only way to end a
           restore — and that arrives as an exception the extension can only report
           as a failing step. The exit has to be here, where the author is. -->
      <OButton
        variant="ghost"
        size="xs"
        data-test="synthetics-journey-restore-cancel-btn"
        @click="onCancelRestore"
      >
        {{ t("synthetics.journey.cancel") }}
      </OButton>
    </div>

    <!-- The restore could not reach the anchor. The session is still alive and the
         browser is sitting where this step stopped, so the recovery re-anchors there
         rather than replaying the whole prefix again (design §7.6). -->
    <div
      v-if="restoreStepFailure"
      class="rounded-default bg-badge-warning-soft-bg border-badge-warning-ol-border/50 mx-2! mb-3 flex flex-col gap-2 border p-3"
      role="alert"
      data-test="synthetics-journey-prefix-failed"
    >
      <div class="flex items-center gap-2">
        <OIcon
          :name="restoreFailureIcon"
          size="sm"
          class="text-badge-warning-ol-text"
          aria-hidden="true"
        />
        <span class="text-text-heading text-sm font-semibold">
          {{ t("synthetics.journey.restoreFailed", { step: failedStepNumber }) }}
        </span>
      </div>
      <!-- The error class in words, then the extension's own message. Naming the
           class alone hides what happened; the raw string alone is the Playwright
           internals the author was reading before this. -->
      <p class="text-text-secondary m-0 text-xs">
        {{ restoreFailureLabel }} — {{ t("synthetics.journey.restoreFailedHint") }}
      </p>
      <pre
        class="text-text-body bg-surface-subtle rounded-default m-0 overflow-x-auto px-2 py-1.5 font-mono text-xs whitespace-pre-wrap"
        data-test="synthetics-journey-prefix-failed-detail"
        >{{ restoreStepFailure.error }}</pre>
      <div class="flex items-center gap-2">
        <!-- Recording before step 1 would leave the journey starting with something
             that is not a navigate, which validateJourneySteps rejects — the same
             guardrail the row button carries. -->
        <OButton
          v-if="canRecordFromFailure && failedStepNumber > 1"
          variant="primary"
          size="sm"
          data-test="synthetics-journey-prefix-failed-record-btn"
          @click="onRecordFromFailure"
        >
          {{ t("synthetics.journey.recordBeforeFailedStep", { step: failedStepNumber }) }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          data-test="synthetics-journey-prefix-failed-cancel-btn"
          @click="onDismissRestoreFailure"
        >
          {{ t("synthetics.journey.cancel") }}
        </OButton>
      </div>
    </div>

    <!-- Incognito blocked warning card (replay pre-flight or recording start) -->
    <div
      v-if="blockedReason === 'incognito' || recordingBlockedIncognito"
      class="rounded-default bg-badge-warning-soft-bg border-badge-warning-ol-border/50 mx-2! mb-3 flex flex-col gap-3 border p-3"
      role="alert"
      data-test="synthetics-journey-incognito-warning"
    >
      <div class="flex items-center gap-2">
        <OIcon
          name="visibility-off"
          size="sm"
          class="text-badge-warning-ol-text"
          aria-hidden="true"
        />
        <span class="text-text-heading text-sm font-semibold">{{
          t("synthetics.journey.incognitoTitle")
        }}</span>
      </div>
      <p class="text-text-secondary m-0 text-xs">
        {{
          t("synthetics.journey.incognitoDescription", {
            product: CHROME_UI_LABELS.recorderName,
          })
        }}
      </p>
      <div class="flex items-center gap-2">
        <OButton
          variant="primary"
          size="sm"
          data-test="synthetics-journey-incognito-retry-btn"
          @click="onIncognitoRetry"
        >
          {{ t("synthetics.journey.retry") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          data-test="synthetics-journey-incognito-dismiss-btn"
          @click="onIncognitoDismiss"
        >
          {{ t("synthetics.journey.dismiss") }}
        </OButton>
        <span class="flex-1" />
        <!-- The setup dialog's incognito task IS the walkthrough — reopen it
             if the author dismissed the auto-opened one. -->
        <OButton
          variant="outline"
          size="sm"
          data-test="synthetics-journey-incognito-setup-btn"
          @click="
            extensionSetup = {
              open: true,
              action: recordingBlockedIncognito ? 'record' : 'replay',
            }
          "
        >
          {{ t("synthetics.journey.showSetupSteps") }}
        </OButton>
      </div>
    </div>

    <!--
      Every other pre-flight failure. The card above is for the ONE cause with a
      known fix; this one reports what the extension actually said rather than
      guessing, which is what sent authors to chrome://extensions for problems
      that had nothing to do with Chrome.
    -->
    <div
      v-else-if="blockedReason"
      class="rounded-default bg-badge-warning-soft-bg border-badge-warning-ol-border/50 mb-3 flex flex-col gap-3 border px-3 py-3"
      role="alert"
      data-test="synthetics-journey-preflight-warning"
    >
      <div class="flex items-center gap-2">
        <OIcon
          name="error_outline"
          size="sm"
          class="text-badge-warning-ol-text"
          aria-hidden="true"
        />
        <span class="text-text-heading text-sm font-semibold">
          {{
            blockedReason === "in-progress"
              ? t("synthetics.journey.replayInProgressTitle")
              : t("synthetics.journey.preflightTitle")
          }}
        </span>
      </div>
      <p class="text-text-secondary m-0 text-xs">
        {{
          blockedReason === "in-progress"
            ? t("synthetics.journey.replayInProgressDescription")
            : t("synthetics.journey.preflightDescription")
        }}
      </p>
      <pre
        v-if="blockedDetail"
        class="text-text-body bg-surface-subtle rounded-default m-0 overflow-x-auto px-2 py-1.5 font-mono text-xs whitespace-pre-wrap"
        data-test="synthetics-journey-preflight-detail"
        >{{ blockedDetail }}</pre>
      <div class="flex items-center gap-2">
        <OButton
          variant="primary"
          size="sm"
          data-test="synthetics-journey-preflight-retry-btn"
          @click="emit('replay')"
        >
          {{ t("synthetics.journey.retry") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          data-test="synthetics-journey-preflight-dismiss-btn"
          @click="emit('clear-results')"
        >
          {{ t("synthetics.journey.dismiss") }}
        </OButton>
      </div>
    </div>

    <!-- Replay running banner -->
    <div
      v-if="replayPhase === 'running'"
      class="rounded-default border-border-default bg-badge-primary-soft-bg mx-2 mb-3 flex items-center gap-2 border px-3 py-2"
      role="status"
      data-test="synthetics-journey-replay-banner"
    >
      <OIcon name="sync" size="sm" class="text-accent animate-spin" aria-hidden="true" />
      <span class="text-text-body text-sm" data-test="synthetics-journey-replay-banner-text">
        {{ t("synthetics.journey.replaying") }}
      </span>
      <span class="text-text-secondary text-sm">
        {{
          t("synthetics.journey.replayProgress", {
            current: stepResults?.size ?? 0,
            total: modelValue.length,
          })
        }}
      </span>
    </div>

    <!-- Replay stopping banner — the wait between Stop and the extension confirming -->
    <div
      v-else-if="replayPhase === 'stopping'"
      class="rounded-default border-border-default bg-surface-subtle mx-2 mb-3 flex items-center gap-2 border px-3 py-2"
      role="status"
      data-test="synthetics-journey-stopping-banner"
    >
      <OIcon name="sync" size="sm" class="text-text-secondary animate-spin" aria-hidden="true" />
      <span class="text-text-body text-sm" data-test="synthetics-journey-stopping-banner-text">
        {{ t("synthetics.journey.replayStopping") }}
      </span>
    </div>

    <!-- Replay passed banner -->
    <div
      v-else-if="replayPhase === 'passed'"
      class="rounded-default border-badge-success-ol-border/50 bg-badge-success-soft-bg mx-2 mb-3 flex items-center gap-2 border px-3 py-2"
      role="status"
      data-test="synthetics-journey-passed-banner"
    >
      <OIcon name="check-circle" size="sm" class="text-timeline-dot-success" aria-hidden="true" />
      <span class="text-badge-success-ol-text font-semi-bold text-sm">{{
        t("synthetics.journey.replayPassed", { count: modelValue.length })
      }}</span>
      <span class="flex-1" />
      <OButton
        variant="ghost"
        size="xs"
        data-test="synthetics-journey-clear-results-btn"
        @click="emit('clear-results')"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <!-- Replay failed banner -->
    <div
      v-else-if="replayPhase === 'failed'"
      class="rounded-default border-badge-error-ol-border/30 bg-badge-error-soft-bg mx-2 mb-3 flex items-start gap-2 border px-3 py-2"
      role="alert"
      data-test="synthetics-journey-failed-banner"
    >
      <OIcon name="error" size="sm" class="text-badge-error-ol-text mt-0.5" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-badge-error-ol-text text-sm font-semibold">{{
          t("synthetics.journey.replayFailed", {
            failed: firstFailedIndex + 1,
            total: modelValue.length,
          })
        }}</span>
        <span
          v-if="failedStepResult?.stepName"
          class="text-badge-error-ol-text truncate pt-1 text-xs"
          >{{ failedStepResult.stepName }}</span
        >
      </div>
      <OButton
        variant="ghost"
        size="xs"
        data-test="synthetics-journey-clear-results-btn"
        @click="emit('clear-results')"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <!-- Replay stopped banner -->
    <div
      v-else-if="replayPhase === 'stopped'"
      class="rounded-default bg-surface-subtle border-border-default mx-2 mb-3 flex items-center gap-2 border px-3 py-2"
      role="status"
      data-test="synthetics-journey-stopped-banner"
    >
      <OIcon name="stop" size="sm" class="text-text-secondary" aria-hidden="true" />
      <span class="text-text-body text-sm">{{
        t("synthetics.journey.replayStopped", {
          completed: stepResults?.size ?? 0,
          total: modelValue.length,
        })
      }}</span>
      <span class="flex-1" />
      <OButton
        variant="outline"
        size="xs"
        data-test="synthetics-journey-stopped-retry-btn"
        @click="emit('replay')"
      >
        {{ t("synthetics.journey.reRun") }}
      </OButton>
      <OButton
        variant="ghost"
        size="xs"
        data-test="synthetics-journey-clear-results-btn"
        @click="emit('clear-results')"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <!-- Recorder error (extension missing / failed to start). The incognito
         case is excluded — it renders as the warning card + setup dialog. -->
    <div
      v-if="recordingError && !isRecording && !recordingBlockedIncognito"
      class="rounded-default bg-status-error-bg text-status-error-text mx-2 mb-3 flex items-center gap-2 px-3 py-2 text-sm"
      role="alert"
      data-test="synthetics-journey-record-error"
    >
      <OIcon name="error" size="sm" aria-hidden="true" />
      <span>{{ recordingError }}</span>
    </div>

    <!-- Live capture area (shown while recording) -->
    <template v-if="isRecording">
      <!-- Recording banner with current URL + controls -->
      <div
        class="rounded-default bg-status-error-bg border-border-default mx-2 mb-3 flex items-center gap-3 border px-3 py-2"
      >
        <span class="flex items-center gap-1.5">
          <span
            class="relative inline-flex h-[0.7rem] w-[0.7rem] items-center justify-center"
            aria-hidden="true"
          >
            <span class="bg-status-error-text absolute z-1 h-[0.7rem] w-[0.7rem] rounded-full" />
            <span
              class="recording-pulse-ring bg-status-error-text absolute h-[0.7rem] w-[0.7rem] rounded-full opacity-0"
            />
          </span>
          <span class="text-status-error-text pl-1.5 text-sm font-semibold">{{
            t("synthetics.journey.recording")
          }}</span>
        </span>
        <span class="text-text-secondary flex min-w-0 flex-1 items-center gap-1 truncate text-xs">
          <span class="truncate">{{ currentUrl }}</span>
        </span>
        <span class="text-text-muted text-xs">{{
          t("synthetics.table.stepsCount", { count: capturedSteps.length })
        }}</span>
      </div>

      <JourneySteps
        v-if="capturedSteps.length > 0"
        :data="capturedSteps"
        mode="editor"
        action-key="action"
        name-key="name"
        detail-key="selector"
        :locked="true"
        :selection-enabled="false"
        @delete="
          (row: BrowserStep) =>
            capturedSteps.splice(
              capturedSteps.findIndex((s) => s.id === row.id),
              1,
            )
        "
        @duplicate="
          (row: BrowserStep) => {
            const idx = capturedSteps.findIndex((s) => s.id === row.id);
            duplicateCapturedStep(idx, row);
          }
        "
      />

      <!-- Waiting for first step -->
      <div v-else class="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <OIcon
          name="fiber-manual-record"
          size="xl"
          class="text-text-muted animate-pulse"
          aria-hidden="true"
        />
        <p class="text-text-secondary m-0 text-sm">
          {{ t("synthetics.journey.waitingForActions") }}
        </p>
      </div>
    </template>

    <!-- Normal step list (shown when not recording) -->
    <!-- Empty state -->
    <div
      v-else-if="modelValue.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <OIcon name="open-in-browser" size="xl" class="text-text-muted" aria-hidden="true" />
      <h3 class="text-text-heading m-0 text-base font-semibold">
        {{ t("synthetics.journey.noSteps") }}
      </h3>
      <div class="flex items-center gap-3">
        <OButton variant="primary" size="sm" @click="onRecordButtonClick">{{
          t("synthetics.journey.recordJourney")
        }}</OButton>
        <OButton variant="outline" size="sm" @click="addStep">{{
          t("synthetics.journey.addStepManually")
        }}</OButton>
      </div>
    </div>

    <!-- JourneySteps — draggable/selectable/expandable as mode permits -->
    <JourneySteps
      v-else
      :data="filterQuery ? filteredSteps : modelValue"
      mode="editor"
      action-key="action"
      name-key="name"
      detail-key="selector"
      :dot-state-fn="dotStateForRow"
      :locked="isReplayLocked || isRestoring"
      :readonly="readonly"
      :enable-reorder="showDragColumn"
      :disable-row-reorder="() => !dragReady"
      :filter-active="!!filterQuery.trim()"
      :selection-enabled="multiSelectEnabled"
      :selected-ids="selectedStepIds"
      :expanded-ids="expandedStepIds"
      :get-row-status-color="getRowStatusColor"
      @update:data="handleRowReorder"
      @update:selected-ids="handleUpdateSelected"
      @update:expanded-ids="handleUpdateExpanded"
      @expand="handleToggleExpand"
      @delete="handleDelete"
      @duplicate="handleDuplicate"
      :anchor-id="anchorStepId"
      :can-record-from="canOfferRecordBefore"
      @record-before="onRecordBefore"
      @insert-below="handleInsertBelow"
      @retry-replay="emit('replay')"
    >
      <!-- Inline editor (expanded content) — the same component the recording
           panel renders, so an author sees the same fields either way -->
      <template #expansion="{ row }">
        <!-- Scroll target for revealStep. Deliberately markup THIS component
             owns: OTable's own `o2-table-row-N` hook is index-based and
             internal to that component, so scrolling to it would couple this
             file to OTable's row numbering. -->
        <span
          class="sr-only"
          aria-hidden="true"
          :data-test="`synthetics-journey-step-anchor-${(row as BrowserStep).id}`"
        />
        <!-- What the runner saw, when this step is the one that failed. Above the
             editor because it is the reason the author opened the row. -->
        <BrowserJourneyStepError
          v-if="failedResultFor(row)"
          class="mx-8 mt-3"
          :result="failedResultFor(row)!"
          :step-number="stepNumberOf(row)"
          @retry-replay="emit('replay-up-to', stepNumberOf(row))"
        />
        <!-- `selector-error-message` is field-scoped, not step-scoped: it renders
             inside the step it describes, so naming that step again only crowds
             out the one sentence that says what to do. `selectorRequired` keeps
             the name — it is the toast, which fires with no step in view. -->
        <BrowserJourneyStepEditor
          class="px-8 pt-3 pb-3"
          :step="row"
          :action-error-message="
            (firstStepError && props.modelValue[0]?.id === row.id
              ? t('synthetics.validation.firstStepMustNavigate')
              : raw('')) || fieldError(row.id, 'action')
          "
          :name-error-message="fieldError(row.id, 'name')"
          :selector-error-message="
            (selectorErrors.has(row.id) ? t('synthetics.validation.locatorRequired') : raw('')) ||
            fieldError(row.id, 'selector')
          "
          :value-error-message="fieldError(row.id, 'value')"
          :expected-error-message="fieldError(row.id, 'assertion.expected')"
          @update:step="(next: BrowserStep) => handleStepReplace(row, next)"
          @action-edited="
            clearFirstStepError();
            clearFieldError(row.id, 'action');
          "
          @selector-edited="
            clearSelectorError(row.id);
            clearFieldError(row.id, 'selector');
          "
        />
      </template>
    </JourneySteps>

    <!-- Delete confirmation dialog -->
    <ConfirmDialog
      v-model:model-value="deleteConfirm.show"
      :title="t('synthetics.journey.deleteStep')"
      :message="deleteConfirmMessage"
      :ok-label="t('common.ok')"
      ok-color="danger"
      @update:ok="confirmDelete"
      @update:cancel="cancelDelete"
    />

    <!-- Extension install/setup dialog — opened by Record/Replay when the
         extension is not detected; `connected` flips live via the parent's probe. -->
    <ExtensionSetupDialog
      ref="extensionSetupDialog"
      v-model:open="extensionSetup.open"
      :connected="extensionReady"
      :action="extensionSetup.action"
      @continue="onExtensionSetupContinue"
      @verify="emit('verify-extension')"
    />
  </div>
</template>

<style scoped>
/* keep(keyframes): single-consumer pulse for the recording indicator. The
   animation lives here as a class (not a template `animate-[…]` utility)
   because scoped hashes the keyframe name and only rewrites references made
   inside this block. */
.recording-pulse-ring {
  animation: recording-pulse-expand 1.5s ease-out infinite;
}
@keyframes recording-pulse-expand {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
}
</style>
