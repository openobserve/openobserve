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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserStep, SettleResponse, StepAssertion, StepLocator } from "@/types/synthetics";
import {
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
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";

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
const effectiveLocator = computed<StepLocator>(() => props.step.locator ?? { candidates: [] });

const showValue = computed(() => VALUE_ACTIONS.includes(props.step.action));
const valueLabel = computed(
  () => VALUE_LABELS[props.step.action] || t("synthetics.journey.valueFallback"),
);
const valueTooltip = computed(() => VALUE_TOOLTIP_MAP[props.step.action]);

/**
 * Did changing the action just discard a recorded wire step? (SE-11 / D9)
 *
 * Discarding is correct — the wire's payload belongs to the OLD action, so a renamed
 * `type` step would drag its typed value into a `click`, and `click` -> `navigate`
 * would leave a navigate with no url. What was wrong is that it happened in silence.
 */
const actionChangedFromRecorded = ref(false);

const actionComputed = computed({
  get: () => props.step.action,
  set: (v: BrowserStep["action"]) => {
    if (v !== props.step.action && props.step.wire) actionChangedFromRecorded.value = true;
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
    !!settleNavigationLine.value || settleResponses.value.length > 0 || !!settleObservedLine.value,
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

// The settle budget's counterpart to `timeoutHelp`. Both fields are numbers in
// milliseconds with a blank-means-default placeholder, sitting one phase apart,
// and only one of them said so. It also names which clock this is: P3.3.1 draws
// the line between the action timeout and the settle budget precisely because
// the two are otherwise indistinguishable to an author.
const settleBudgetHelp = computed(() =>
  t("synthetics.journey.settleBudgetHelp", { seconds: seconds(DEFAULT_SETTLE_BUDGET_MS) }),
);

// Advisory, like the timeout warning: the server enforces the range, so a value
// outside it must be visible here rather than surfacing as a save failure.
const settleBudgetOutOfRange = computed(() => {
  const budget = props.step.settle?.budget_ms;
  if (budget === undefined) return false;
  return budget < MIN_SETTLE_BUDGET_MS || budget > MAX_SETTLE_BUDGET_MS;
});

// ── Field layout (spec SE-5) ────────────────────────────────────────────────
// Two tiers, not three groups. What the step does is the step — action, name,
// target, value, assertion — so it is plain always-visible markup with no
// disclosure of its own. Everything a recording or a runner default already
// answers correctly — page settling, the timeout, failure behaviour — sits behind
// one `Advanced` collapsible.
//
// The earlier shape had three peer collapsibles. That charged the same price for
// the step's identity as for its tuning: an author editing a step had to open a
// group to reach the fields the step cannot function without, while a `default-open`
// collapsible around always-visible content is a control that does nothing but
// take a click away.
//
// One collapsible is also the only separation device here. No cards, no rules, no
// sub-sections: each field carries its own label, so a second grouping vocabulary
// on top of them would say the same thing twice.
//
// Every field that can currently carry a validation error — action, name, target,
// value, assertion expected — is outside the collapsible, so an error can never be
// collapsed out of view. When SE-2/SE-19 introduce settle-budget or timeout errors,
// `Advanced` must become controlled so an error force-opens it.

const seconds = (ms: number) => Number((ms / 1000).toFixed(1));

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

/**
 * Does `Advanced` hold anything that is not a default?
 *
 * Drives whether the section opens itself, so that nothing an author set — or a
 * recording observed — is hidden behind a collapsed trigger.
 */
const hasAdvancedChanges = computed(
  () =>
    hasRecordedSettle.value ||
    props.step.settle?.budget_ms !== undefined ||
    props.step.timeout !== undefined ||
    !!props.step.optional ||
    !!props.step.alwaysRun,
);
</script>

<template>
  <div class="flex w-full flex-col gap-2" data-test="synthetics-journey-step-editor">
    <!-- What this step does — no disclosure of its own. These are the fields the
         step cannot function without, and every field that can carry a validation
         error is here, so an error can never be collapsed out of view. -->
    <div
      class="flex w-full max-w-200 flex-col gap-3"
      data-test="synthetics-journey-step-group-does"
    >
      <div class="flex w-full gap-2">
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

      <!-- The discard is right; doing it silently was not (D9). -->
      <p
        v-if="actionChangedFromRecorded"
        class="text-text-secondary m-0 flex items-start gap-1 text-xs"
        data-test="synthetics-journey-step-action-changed-notice"
      >
        <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{{ t("synthetics.journey.actionChangedNotice") }}</span>
      </p>
      <!-- Value (action-specific label) -->
      <OInput
        v-if="showValue"
        v-model="valueComputed"
        :label="valueLabel"
        :placeholder="valueLabel"
        class="w-full"
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

    <!-- Target — the locator bundle is the only way a step names its element.
           `stepNeedsTarget` is the same rule the save-time validator uses, so the
           block appears exactly when a target is required. -->
    <BrowserJourneyLocator
      v-if="showTarget"
      :locator="effectiveLocator"
      class="mt-2 w-full max-w-200"
      @update:locator="updateLocator"
    />

    <!-- Advanced — settling, timeout and failure behaviour, all of which a
         recording or a runner default already answers. Rendered unconditionally:
         the budget input is the only way to create a budget, so gating on "has
         settle data" made it unreachable on a hand-added step (SE-16). Only the
         recorded evidence lines are conditional.

         Opens itself when the step carries a non-default, so nothing an author set
         is hidden from them. -->
    <OCollapsible
      :default-open="hasAdvancedChanges"
      variant="sidebar"
      class="rounded-default bg-surface-panel mt-2 w-full max-w-200 border"
      data-test="synthetics-journey-step-group-advanced"
      trigger-class="border-b"
    >
      <!-- Label and caption on one line. The `caption` prop stacks them, which
           made `Advanced` twice as tall as the row it sits in and read as a
           heading with a subtitle rather than as one trigger. -->
      <template #trigger>
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <span class="text-text-heading text-sm font-medium">
            {{ t("synthetics.journey.groupAdvancedLabel") }}
          </span>
          <span class="text-text-secondary truncate text-xs">
            {{ t("synthetics.journey.groupAdvancedCaption") }}
          </span>
        </span>
      </template>

      <!-- Three phases of one step, not three unrelated groups of settings: what
           happens while it acts, after it acts, and if it fails. The numbered
           rail carries that sequence; the rules that used to separate these
           blocks said only "these are different" and are gone.

           The rail's order is the RUNNER's order, and settling is the second
           phase, not the first: the probe arms its watchers before the action,
           but the wait this panel configures happens strictly after the action
           completes (spec P3.3). The rail previously read settle-then-timeout
           under the heading "Before it acts", which described the invisible
           arming rather than the budget the author is setting — and inverted the
           one relationship P3.3.1 exists to draw, that `timeout_ms` bounds the
           action while `budget_ms` bounds the wait that follows it.

           `expanded` is OStepper's checklist mode — every panel rendered at once
           rather than only the active one. `model-value="0"` is the documented
           "no step is active" value: these are phases of one step that always all
           apply, not a wizard the author walks through, so none of them is
           current and all three indicators read alike. -->
      <div class="w-full px-2 py-3">
        <OStepper :model-value="0" orientation="vertical" expanded :animated="false">
          <OStep
            :name="1"
            :title="t('synthetics.journey.advancedTimeoutHeading')"
            data-test="synthetics-journey-step-advanced-timeout"
          >
            <OInput
              v-model="timeoutComputed"
              :label="t('synthetics.journey.timeoutLabel')"
              :placeholder="String(timeoutDefault)"
              :helpText="timeoutHelp"
              type="number"
              class="w-75!"
              data-test="synthetics-journey-step-timeout-input"
            />
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
          </OStep>

          <OStep
            :name="2"
            :title="t('synthetics.journey.advancedSettleHeading')"
            data-test="synthetics-journey-step-advanced-settle"
          >
            <div class="flex w-full flex-col gap-2" data-test="synthetics-journey-step-settle">
              <!-- What the recording observed is evidence, so it is boxed and reads
                 as read-only — except the one checkbox on it, which is a judgement
                 about the application that only the author can make. -->
              <div
                v-if="hasRecordedSettle"
                class="border-border-default rounded-default bg-surface-base flex w-full flex-col gap-1 border p-2"
                data-test="synthetics-journey-step-settle-recorded"
              >
                <span class="text-text-secondary text-xs">{{
                  t("synthetics.journey.settleLabel")
                }}</span>

                <p v-if="settleNavigationLine" class="text-text-body m-0 font-mono text-xs">
                  {{ settleNavigationLine }}
                </p>

                <!-- `Required` is the highest-stakes control in this panel: it
                     converts an advisory signal, whose absence the run tolerates
                     and carries forward one step, into one that fails this step
                     outright. Both flags in the failure phase carry a tooltip
                     for semantics their labels cannot hold; this one had none,
                     and it is the toggle whose two states differ most. -->
                <div
                  v-for="(response, i) in settleResponses"
                  :key="`${response.url_pattern}-${i}`"
                  class="flex w-full items-center gap-2"
                >
                  <OCheckbox
                    :model-value="!!response.required"
                    size="xs"
                    :label="t('synthetics.journey.settleRequiredLabel')"
                    :data-test="`synthetics-journey-step-settle-required-${i}`"
                    @update:model-value="setResponseRequired(i, $event)"
                  />
                  <OTooltip :content="t('synthetics.journey.settleRequiredHelp')">
                    <OIcon
                      name="info-outline"
                      size="xs"
                      class="text-text-secondary shrink-0"
                      :data-test="`synthetics-journey-step-settle-required-help-${i}`"
                      aria-hidden="true"
                    />
                  </OTooltip>
                  <span class="text-text-body min-w-0 truncate font-mono text-xs">
                    {{ settleResponseLabel(response) }}
                  </span>
                </div>

                <p
                  v-if="settleObservedLine"
                  class="text-text-secondary m-0 text-xs"
                  data-test="synthetics-journey-step-settle-observed"
                >
                  {{ settleObservedLine }}
                </p>
              </div>

              <!-- Same argument as the timeout's help line (SE-9 / D8): a bare
                   placeholder reads as "empty" to the author it was meant to
                   inform. It also says which clock this is — P3.3.1's whole
                   point is that the two answer different questions, and the
                   fields are peers with nothing else to tell them apart. -->
              <OInput
                v-model="settleBudgetComputed"
                :label="t('synthetics.journey.settleBudgetLabel')"
                :placeholder="String(DEFAULT_SETTLE_BUDGET_MS)"
                :helpText="settleBudgetHelp"
                type="number"
                class="w-75!"
                data-test="synthetics-journey-step-settle-budget-input"
              />
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
          </OStep>

          <!-- Both flags are fully implemented in the probe with semantics the labels
             omit — the `skipped` result status, the cleanup pass, the neutral
             verdict, and that `always_run` only reaches steps AFTER the failure.
             Both-set is legitimate (a best-effort logout), so this explains rather
             than prevents (D11).

             Side by side because they are alternatives an author weighs against
             each other, and each carries the sentence that says which to pick.
             The full semantics stay on the tooltip: a card can hold two lines,
             not the paragraph the probe's behaviour actually needs. -->
          <OStep
            :name="3"
            :title="t('synthetics.journey.advancedFailureHeading')"
            data-test="synthetics-journey-step-advanced-failure"
          >
            <div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="border-border-default rounded-default flex flex-col gap-1 border p-3">
                <div class="flex items-center gap-1">
                  <OCheckbox
                    v-model="optionalComputed"
                    :label="t('synthetics.journey.optionalShortLabel')"
                    data-test="synthetics-journey-step-optional-checkbox"
                  />
                  <OTooltip :content="t('synthetics.journey.optionalHelp')">
                    <OIcon
                      name="info-outline"
                      size="xs"
                      class="text-text-secondary"
                      data-test="synthetics-journey-step-optional-help"
                      aria-hidden="true"
                    />
                  </OTooltip>
                </div>
                <p class="text-text-secondary m-0 text-xs">
                  {{ t("synthetics.journey.optionalDescription") }}
                </p>
              </div>

              <div class="border-border-default rounded-default flex flex-col gap-1 border p-3">
                <div class="flex items-center gap-1">
                  <OCheckbox
                    v-model="alwaysRunComputed"
                    :label="t('synthetics.journey.alwaysRunShortLabel')"
                    data-test="synthetics-journey-step-always-run-checkbox"
                  />
                  <OTooltip :content="t('synthetics.journey.alwaysRunHelp')">
                    <OIcon
                      name="info-outline"
                      size="xs"
                      class="text-text-secondary"
                      data-test="synthetics-journey-step-always-run-help"
                      aria-hidden="true"
                    />
                  </OTooltip>
                </div>
                <p class="text-text-secondary m-0 text-xs">
                  {{ t("synthetics.journey.alwaysRunDescription") }}
                </p>
              </div>
            </div>
          </OStep>
        </OStepper>
      </div>
    </OCollapsible>
  </div>
</template>
