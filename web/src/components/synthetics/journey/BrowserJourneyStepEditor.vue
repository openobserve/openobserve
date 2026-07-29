<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  BrowserStep,
  SettleResponse,
  StepAssertion,
  StepLocator,
} from "@/types/synthetics";
import {
  ACTION_LABELS,
  DEFAULT_SETTLE_BUDGET_MS,
  MAX_SETTLE_BUDGET_MS,
  MAX_STEP_TIMEOUT_MS,
  MIN_SETTLE_BUDGET_MS,
  VALUE_ACTIONS,
  VALUE_LABELS,
  VALUE_TOOLTIP_MAP,
  actionOptions,
} from "@/constants/synthetics";
import { applyValueToWire, defaultTimeoutFor } from "@/utils/synthetics/mapRecordedStep";
import { stepNeedsTarget } from "@/utils/synthetics/stepTarget";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import BrowserJourneyLocator from "./BrowserJourneyLocator.vue";
import BrowserJourneyAssertion from "./BrowserJourneyAssertion.vue";

/**
 * The expanded editor for one journey step — every author-editable field a step
 * has, in one place.
 *
 * It exists as its own component because there used to be two of these: the one
 * inside BrowserJourneyStep (used by the live recording panel) and a second,
 * thinner copy inlined in BrowserJourney's `#expansion` slot (used when editing
 * a saved check). The copies had drifted — the edit view rendered no locator
 * bundle, no settle block, no assertion editor and no optional/always-run
 * checkboxes, and synced fewer fields back into the wire step — so which fields
 * an author could see depended on how they had arrived at the step. One
 * component is the only way that stays fixed.
 */
const props = defineProps<{
  step: BrowserStep;
  /** Validation from the host view; absent in contexts that do not validate. */
  actionErrorMessage?: string;
  nameErrorMessage?: string;
  selectorErrorMessage?: string;
  valueErrorMessage?: string;
  expectedErrorMessage?: string;
}>();

const emit = defineEmits<{
  "update:step": [value: BrowserStep];
  /** Host views clear their own validation state on edit. */
  "action-edited": [];
  "selector-edited": [];
}>();

const { t } = useI18n();

/**
 * Apply an edit and keep the recorded wire step in sync.
 *
 * `journeyToWireSteps` prefers `wire` over the UI fields, so an edit that does
 * not land in `wire` is discarded at replay time. The wire spreads the editor's
 * single `value` across url/key/text/files/options by action, which is why the
 * write goes through `applyValueToWire` rather than assigning `wire.value`.
 */
function update(patch: Partial<BrowserStep>) {
  let wire = props.step.wire ? { ...props.step.wire } : undefined;
  if (wire) {
    if (patch.name !== undefined) wire.name = patch.name;
    // No `selector` / `selectorType` sync: the editor has no control that can
    // produce either patch since the v1 authoring path was deleted. A version-2
    // step names its element through `locator`, handled below.
    if (patch.value !== undefined) wire = applyValueToWire(wire, props.step.action, patch.value);
    if (patch.timeout !== undefined) wire.timeout_ms = patch.timeout;
    // The preview needs these to report what it cannot simulate, so they travel
    // with the replayed step rather than being dropped on edit.
    if (patch.locator !== undefined) wire.locator = patch.locator;
    if (patch.settle !== undefined) wire.settle = patch.settle;
    if (patch.assertion !== undefined) wire.assertion = patch.assertion;
    if (patch.optional !== undefined) wire.optional = patch.optional;
    if (patch.alwaysRun !== undefined) wire.always_run = patch.alwaysRun;
    if (patch.action !== undefined) wire = undefined; // action changed — wire metadata is no longer accurate
  }
  emit("update:step", { ...props.step, wire, ...patch });
}

// ── Field bindings ──────────────────────────────────────────────────────────

/**
 * Does this step name an element?
 *
 * One rule, shared with the save-time validator (`stepIsMissingTarget`), so the
 * form cannot ask for a target the validator ignores — nor omit one it requires.
 * Page-level assertions (`url_matches`, `page_title`) describe the page and need
 * no element at all, which is why this is not simply `SELECTOR_ACTIONS.includes`.
 *
 * It also governs requiredness: the block renders only when a target is needed,
 * so whenever it is visible a target is mandatory. There is no separate
 * conditional-`required` binding to keep in step.
 */
const showTarget = computed(() => stepNeedsTarget(props.step));

/**
 * Never hand `BrowserJourneyLocator` a fresh object literal from the template —
 * a new identity on every render defeats its prop watchers. A step that somehow
 * carries no bundle falls back to an empty one, computed once.
 */
const effectiveLocator = computed<StepLocator>(
  () => props.step.locator ?? { candidates: [], user_override: null },
);

const showValue = computed(() => VALUE_ACTIONS.includes(props.step.action));
const valueLabel = computed(
  () => VALUE_LABELS[props.step.action] || t("synthetics.journey.valueFallback"),
);
const valueTooltip = computed(() => VALUE_TOOLTIP_MAP[props.step.action]);

const actionComputed = computed({
  get: () => props.step.action,
  set: (v: BrowserStep["action"]) => {
    update({ action: v });
    emit("action-edited");
  },
});

const nameComputed = computed({
  get: () => props.step.name ?? "",
  set: (v: string) => update({ name: v }),
});

const valueComputed = computed({
  get: () => props.step.value ?? "",
  set: (v: string) => update({ value: v }),
});

const timeoutComputed = computed({
  get: () => String(props.step.timeout ?? ""),
  set: (v: string) => update({ timeout: v ? Number(v) : undefined }),
});

// ── Timeout guard rails (spec P1.1.4, P1.1.5) ───────────────────────────────
// The recorder no longer stamps a timeout, so this field renders empty — which
// reads as "no timeout" and invites authors to fill it in needlessly. Show the
// default the runner will actually apply, so an author can see what they would
// be overriding before they override it.
const timeoutDefault = computed(() => defaultTimeoutFor(props.step.action));

// Lowering below the category default is permitted — it is the author's call —
// but a step timeout shorter than the application's real response time is
// precisely the condition that produced the observed production failures.
// Advisory only: it must never block saving.
const timeoutBelowDefault = computed(() => {
  const explicit = props.step.timeout;
  return explicit !== undefined && explicit < timeoutDefault.value;
});

// ── Version-2 blocks ────────────────────────────────────────────────────────
// There is one targeting UI. The v1 Selector-type + Selector pair used to render
// when a step carried no bundle, which meant a hand-added step and a recorded one
// presented two unrelated editors (SE-7) — and a hand-added step that named its
// element the v1 way flipped the whole journey to steps_version 1, because
// isV2Journey reads `locator`, not `selector` (SE-18). No v1 journeys exist, so
// the fork served no case and is gone. See `showTarget` for the render condition.

function updateLocator(locator: StepLocator) {
  update({ locator });
}

function updateAssertion(assertion: StepAssertion) {
  update({ assertion });
}

const optionalComputed = computed({
  get: () => !!props.step.optional,
  set: (v: boolean) => update({ optional: v }),
});

const alwaysRunComputed = computed({
  get: () => !!props.step.alwaysRun,
  set: (v: boolean) => update({ alwaysRun: v }),
});

// ── Settle block (spec P3.3, P4) ────────────────────────────────────────────
// What the recording observed is evidence and stays read-only. Two fields on it
// are author decisions, though, and had no control at all: marking a response
// required (P4.1.5 — the recorder always emits `false`, because deciding a run
// is meaningless without a given call is a judgement about the application) and
// the settle budget (P3.4.3 — the wait-lift writes one and the author could
// neither see nor change the number it picked).

const settleNavigationLine = computed(() => {
  const nav = props.step.settle?.navigation;
  return nav ? t("synthetics.journey.settleNavigation", { pattern: nav.url_pattern }) : "";
});

const settleResponses = computed(() => props.step.settle?.responses ?? []);

const settleObservedLine = computed(() => {
  const ms = props.step.settle?.observed_duration_ms;
  return ms === undefined
    ? ""
    : t("synthetics.journey.settleObserved", { seconds: (ms / 1000).toFixed(1) });
});

/**
 * Did the recording observe anything to wait for?
 *
 * Gates the read-only evidence lines only. It must NOT gate the settle group as a
 * whole: the budget input lives in there and is the only way to create a budget,
 * so gating on "has settle data" meant a hand-added step could never be given one
 * — the condition was self-fulfilling (SE-16).
 */
const hasRecordedSettle = computed(
  () =>
    !!settleNavigationLine.value ||
    settleResponses.value.length > 0 ||
    !!settleObservedLine.value,
);

function settleResponseLabel(response: SettleResponse): string {
  return t("synthetics.journey.settleResponse", {
    method: response.method ?? "",
    pattern: response.url_pattern,
  });
}

function setResponseRequired(index: number, next: CheckboxModelValue) {
  const settle = props.step.settle;
  if (!settle?.responses) return;
  // OCheckbox also models "indeterminate"; a settle signal is required or it is
  // not, so only an explicit `true` counts as required.
  const required = next === true;
  update({
    settle: {
      ...settle,
      responses: settle.responses.map((r, i) => (i === index ? { ...r, required } : r)),
    },
  });
}

const settleBudgetComputed = computed({
  get: () => String(props.step.settle?.budget_ms ?? ""),
  set: (v: string) => {
    const { budget_ms: _dropped, ...rest } = props.step.settle ?? {};
    update({ settle: v ? { ...rest, budget_ms: Number(v) } : rest });
  },
});

// Advisory, like the timeout warning: the server enforces the range, so a value
// outside it must be visible here rather than surfacing as a save failure.
const settleBudgetOutOfRange = computed(() => {
  const budget = props.step.settle?.budget_ms;
  if (budget === undefined) return false;
  return budget < MIN_SETTLE_BUDGET_MS || budget > MAX_SETTLE_BUDGET_MS;
});

// ── Field groups (spec SE-5) ────────────────────────────────────────────────
// Grouped on the runner's own sequence — act, then settle, then handle failure.
// That is the order the step executes in and the order a tester asks questions in.
//
// A collapsed group must advertise what it holds, or collapsing hides state. The
// caption names every non-default value; a group holding only defaults captions
// nothing and stays shut. `OCollapsible` has no trailing-content slot, so this
// uses its native `caption` prop rather than a header badge — which carries more
// than a count would anyway ("Optional · Timeout 10 s" beats "2 changed").
//
// Every field that can currently carry a validation error — action, name, target,
// value, assertion expected — lives in group 1, which is always open, so an error
// can never be collapsed out of view. When SE-2/SE-19 introduce settle-budget or
// timeout errors, groups 2 and 3 must become controlled so an error force-opens
// them.

const seconds = (ms: number) => Number((ms / 1000).toFixed(1));

// ── Plain-language summary (spec SE-6) ──────────────────────────────────────
// Every comparable tool leads a step editor with a sentence describing the step in
// the author's words rather than the tool's. Composed entirely from values already
// on screen, so it can never disagree with the fields below it.

/** What the run will actually target: the pin if there is one, else the primary. */
const effectiveTarget = computed(() => {
  const locator = props.step.locator;
  return locator?.user_override?.value ?? locator?.candidates?.[0]?.value ?? "";
});

const summary = computed(() => {
  const action = ACTION_LABELS[props.step.action] ?? props.step.action;
  const target = showTarget.value ? effectiveTarget.value : props.step.value ?? "";
  const sentence = target
    ? t("synthetics.journey.summaryWithTarget", { action, target })
    : action;
  const effectiveTimeout = props.step.timeout ?? timeoutDefault.value;
  return t("synthetics.journey.summaryWaitingUpTo", {
    sentence,
    seconds: seconds(effectiveTimeout),
  });
});

// ── Timeout helper (spec SE-9 / D8, SE-20) ──────────────────────────────────
// The placeholder stays — P1.1.5 mandates it, and T1-13 asserts it — but a
// placeholder alone reads as "empty" to the audience it was meant to inform. This
// line is additive: it says what blank means and what the bounds are.
//
// On navigate and assert the category default (60 s) EQUALS the server maximum, so
// the field can only ever shorten the timeout. Saying so up front is what stops the
// below-default warning reading as a malfunction (SE-20).
const timeoutIsCeiling = computed(() => timeoutDefault.value >= MAX_STEP_TIMEOUT_MS);

const timeoutHelp = computed(() =>
  timeoutIsCeiling.value
    ? t("synthetics.journey.timeoutHelpNavAssert", { seconds: seconds(timeoutDefault.value) })
    : t("synthetics.journey.timeoutHelpInteraction", {
        seconds: seconds(timeoutDefault.value),
        max: seconds(MAX_STEP_TIMEOUT_MS),
      }),
);

const waitsCaption = computed(() => {
  const parts: string[] = [];
  if (hasRecordedSettle.value) parts.push(t("synthetics.journey.captionRecorded"));
  const budget = props.step.settle?.budget_ms;
  if (budget !== undefined)
    parts.push(t("synthetics.journey.captionBudget", { seconds: seconds(budget) }));
  return parts.join(" · ");
});

const failureCaption = computed(() => {
  const parts: string[] = [];
  if (props.step.optional) parts.push(t("synthetics.journey.captionOptional"));
  if (props.step.alwaysRun) parts.push(t("synthetics.journey.captionAlwaysRun"));
  if (props.step.timeout !== undefined)
    parts.push(t("synthetics.journey.captionTimeout", { seconds: seconds(props.step.timeout) }));
  return parts.join(" · ");
});
</script>

<template>
  <div class="flex flex-col gap-2" data-test="synthetics-journey-step-editor">
    <!-- What this step will do, in the author's words rather than the tool's.
         Composed from the same values the fields below show, so the two cannot
         disagree. -->
    <p
      class="text-text-body m-0 text-sm"
      data-test="synthetics-journey-step-summary"
    >
      {{ summary }}
    </p>

    <!-- 1. What this step does — always open. Every field that can carry a
            validation error lives here, so an error is never collapsed away. -->
    <OCollapsible
      :label="t('synthetics.journey.groupDoesLabel')"
      :default-open="true"
      data-test="synthetics-journey-step-group-does"
    >
      <div class="flex flex-col gap-3 pt-2">
        <div class="flex gap-2">
          <OSelect
            v-model="actionComputed"
            :label="t('synthetics.journey.actionLabel')"
            :options="actionOptions"
            class="basis-1/3"
            :error="!!actionErrorMessage"
            :error-message="actionErrorMessage ?? ''"
            data-test="synthetics-journey-step-action-select"
          />
          <OInput
            v-model="nameComputed"
            :label="t('synthetics.journey.stepNameLabel')"
            :placeholder="t('synthetics.journey.stepNamePurposePlaceholder')"
            :required="true"
            :error="!!nameErrorMessage"
            :error-message="nameErrorMessage ?? ''"
            class="basis-2/3"
            data-test="synthetics-journey-step-name-input"
          />
        </div>

        <!-- Target — the locator bundle is the only way a step names its element.
             `stepNeedsTarget` is the same rule the save-time validator uses, so the
             block appears exactly when a target is required. -->
        <BrowserJourneyLocator
          v-if="showTarget"
          :locator="effectiveLocator"
          @update:locator="updateLocator"
        />

        <!-- Value (action-specific label) -->
        <OInput
          v-if="showValue"
          v-model="valueComputed"
          :label="valueLabel"
          :placeholder="valueLabel"
          :error="!!valueErrorMessage"
          :error-message="valueErrorMessage ?? ''"
          data-test="synthetics-journey-step-value-input"
        >
          <template v-if="valueTooltip" #tooltip>
            <OTooltip :content="valueTooltip" />
          </template>
        </OInput>

        <!-- Typed assertion — what this step actually verifies -->
        <BrowserJourneyAssertion
          v-if="step.action === 'assert'"
          :assertion="step.assertion"
          :expected-error-message="expectedErrorMessage"
          @update:assertion="updateAssertion"
        />
      </div>
    </OCollapsible>

    <!-- 2. What it waits for — rendered unconditionally. The budget input is the
            only way to create a budget, so gating the group on "has settle data"
            made it unreachable on a hand-added step (SE-16). Only the recorded
            evidence lines are conditional. -->
    <OCollapsible
      :label="t('synthetics.journey.groupWaitsLabel')"
      :caption="waitsCaption"
      :default-open="!!waitsCaption"
      data-test="synthetics-journey-step-group-waits"
    >
      <div class="flex flex-col gap-2 pt-2" data-test="synthetics-journey-step-settle">
        <template v-if="hasRecordedSettle">
          <span class="text-text-secondary text-xs">{{
            t("synthetics.journey.settleLabel")
          }}</span>

          <p v-if="settleNavigationLine" class="text-text-secondary m-0 font-mono text-xs">
            {{ settleNavigationLine }}
          </p>

          <div
            v-for="(response, i) in settleResponses"
            :key="`${response.url_pattern}-${i}`"
            class="flex items-center gap-2"
          >
            <OCheckbox
              :model-value="!!response.required"
              size="xs"
              :label="t('synthetics.journey.settleRequiredLabel')"
              :data-test="`synthetics-journey-step-settle-required-${i}`"
              @update:model-value="setResponseRequired(i, $event)"
            />
            <span class="text-text-secondary min-w-0 truncate font-mono text-xs">
              {{ settleResponseLabel(response) }}
            </span>
          </div>

          <p v-if="settleObservedLine" class="text-text-secondary m-0 font-mono text-xs">
            {{ settleObservedLine }}
          </p>
        </template>

        <div class="flex gap-2">
          <OInput
            v-model="settleBudgetComputed"
            :label="t('synthetics.journey.settleBudgetLabel')"
            :placeholder="String(DEFAULT_SETTLE_BUDGET_MS)"
            type="number"
            class="basis-1/3"
            data-test="synthetics-journey-step-settle-budget-input"
          />
        </div>
        <p
          v-if="settleBudgetOutOfRange"
          class="text-status-warning-text m-0 flex items-start gap-1 text-xs"
          data-test="synthetics-journey-step-settle-budget-warning"
        >
          <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{{
            t("synthetics.journey.settleBudgetRangeWarning", {
              min: MIN_SETTLE_BUDGET_MS,
              max: MAX_SETTLE_BUDGET_MS,
            })
          }}</span>
        </p>
      </div>
    </OCollapsible>

    <!-- 3. How it behaves on failure — flow control plus the timeout, with the
            below-default warning beside the field it describes rather than in a
            trailing block. -->
    <OCollapsible
      :label="t('synthetics.journey.groupFailureLabel')"
      :caption="failureCaption"
      :default-open="!!failureCaption"
      data-test="synthetics-journey-step-group-failure"
    >
      <div class="flex flex-col gap-2 pt-2">
        <OCheckbox
          v-model="optionalComputed"
          :label="t('synthetics.journey.optionalLabel')"
          data-test="synthetics-journey-step-optional-checkbox"
        />
        <OCheckbox
          v-model="alwaysRunComputed"
          :label="t('synthetics.journey.alwaysRunLabel')"
          data-test="synthetics-journey-step-always-run-checkbox"
        />

        <div class="flex gap-2">
          <OInput
            v-model="timeoutComputed"
            :label="t('synthetics.journey.timeoutLabel')"
            :placeholder="String(timeoutDefault)"
            type="number"
            class="basis-1/3"
            data-test="synthetics-journey-step-timeout-input"
          />
        </div>
        <!-- Additive to the placeholder, which P1.1.5 mandates: says what blank
             means, and on navigate/assert that the default is also the ceiling. -->
        <p
          class="text-text-secondary m-0 text-xs"
          data-test="synthetics-journey-step-timeout-help"
        >
          {{ timeoutHelp }}
        </p>
        <p
          v-if="timeoutBelowDefault"
          class="text-status-warning-text m-0 flex items-start gap-1 text-xs"
          data-test="synthetics-journey-step-timeout-warning"
        >
          <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{{
            t("synthetics.journey.timeoutBelowDefaultWarning", { default: timeoutDefault })
          }}</span>
        </p>
      </div>
    </OCollapsible>
  </div>
</template>
