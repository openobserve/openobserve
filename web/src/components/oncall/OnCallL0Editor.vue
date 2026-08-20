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

<!--
  The AI SRE triage gate, per team (C11 — the l0_json block).

  What each severity does is said in plain sentences beside the control,
  because the mode names alone ("gate", "only") read as jargon at the moment
  somebody is deciding whether a P2 will wait 90 seconds. Two of the four are
  not settings at all: P1 is pinned parallel (holding a critical page behind a
  model is not a product offer) and P4/P5 are pinned agent-only (they page
  nobody, so there is no page to hold). The server 400s both; the editor
  renders them as facts rather than disabled controls pretending to be knobs.

  The budget is a list of durations rather than a free number: the server
  refuses anything outside 30-600s instead of clamping, and every value an
  operator can pick from a list is one the server will take. A stored value
  outside the range is still OFFERED — a select must never hold a value that is
  not one of its own options — and reported as invalid so the parent blocks Save.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-l0-editor">
    <!-- Per-severity: what happens between a firing and a page. -->
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2" data-test="oncall-l0-p1">
        <OTag variant="error-soft" size="sm" class="w-14 justify-center">{{ raw("P1") }}</OTag>
        <OText variant="body" as="span">{{ t("oncall.l0P1Fixed") }}</OText>
      </div>

      <div
        v-for="severity in EDITABLE_SEVERITIES"
        :key="severity"
        class="flex flex-wrap items-center gap-2"
        :data-test="`oncall-l0-${severity.toLowerCase()}`"
      >
        <OTag variant="warning-soft" size="sm" class="w-14 justify-center">{{ severity }}</OTag>
        <span class="w-48">
          <OSelect
            :model-value="draft.mode[severity]"
            :options="modeOptions"
            size="sm"
            :data-test="`oncall-l0-mode-${severity.toLowerCase()}`"
            @update:model-value="(v: unknown) => setMode(severity, v)"
          />
        </span>
        <OText variant="meta">{{ modeSentence(draft.mode[severity]) }}</OText>
      </div>

      <div class="flex flex-wrap items-center gap-2" data-test="oncall-l0-p4">
        <OTag variant="default-soft" size="sm" class="w-14 justify-center">{{
          raw("P4 · P5")
        }}</OTag>
        <OText variant="body" as="span">{{ t("oncall.l0P4Fixed") }}</OText>
      </div>
    </div>

    <!-- The hold, and the promise underneath it: fail-open, always. -->
    <div class="flex flex-wrap items-center gap-2">
      <OText variant="label" class="w-32 shrink-0">{{ t("oncall.l0BudgetLabel") }}</OText>
      <span class="w-40">
        <OSelect
          :model-value="draft.triage_budget_seconds"
          :options="budgetOptions"
          size="sm"
          :error="!budgetValid"
          :error-message="t('oncall.l0BudgetRange')"
          data-test="oncall-l0-budget"
          @update:model-value="(v: unknown) => setBudget(v)"
        />
      </span>
      <OText variant="meta">{{ t("oncall.l0FailOpen") }}</OText>
    </div>

    <!-- What a verdict is allowed to DO. Three separate permissions, because
         raising a severity, quieting one notification and cancelling a page
         are three different amounts of trust. -->
    <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
      <OText variant="label" class="w-32 shrink-0">{{ t("oncall.l0VerdictPowers") }}</OText>

      <span class="flex flex-wrap items-center gap-2">
        <OSwitch
          :model-value="draft.allow_promotion"
          :label="t('oncall.l0AllowPromotion')"
          size="sm"
          data-test="oncall-l0-allow-promotion"
          @update:model-value="(v: unknown) => update({ allow_promotion: !!v })"
        />
        <!-- The ratchet is not a setting — a verdict can only ever RAISE a
             severity. This bounds how far one hop may climb, so it reads as
             part of the permission rather than as a field of its own. -->
        <OSelect
          v-if="draft.allow_promotion"
          :model-value="draft.max_promotion_steps"
          :options="maxStepOptions"
          appearance="inline"
          size="sm"
          data-test="oncall-l0-max-steps"
          @update:model-value="(v: unknown) => setMaxSteps(v)"
        />
      </span>

      <OSwitch
        :model-value="draft.allow_downgrade"
        :label="t('oncall.l0AllowDowngrade')"
        size="sm"
        data-test="oncall-l0-allow-downgrade"
        @update:model-value="(v: unknown) => update({ allow_downgrade: !!v })"
      />

      <OSwitch
        :model-value="draft.allow_suppress"
        :label="t('oncall.l0AllowSuppress')"
        size="sm"
        data-test="oncall-l0-allow-suppress"
        @update:model-value="(v: unknown) => update({ allow_suppress: !!v })"
      />
    </div>

    <!-- The two toggles above whose meaning is routinely mis-read: "soften" is
         about one notification's channels, never the record's severity, and
         suppression is opt-in because until it is on a Suppress verdict is only
         a recommendation. -->
    <OText variant="meta" data-test="oncall-l0-verdict-notes">
      {{ t("oncall.l0DowngradeNote") }} {{ t("oncall.l0SuppressNote") }}
    </OText>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type { L0Mode, L0Policy } from "@/ts/interfaces/oncall";
import { L0_BUDGET_MAX_SECONDS, L0_BUDGET_MIN_SECONDS } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { l0Defaults } from "@/utils/oncall";

const props = defineProps<{ l0: L0Policy | null }>();

const emit = defineEmits<{
  (e: "update:l0", value: L0Policy): void;
  /** False while the budget is outside the server's range — the parent must
   *  block Save rather than send a PUT the server will refuse. */
  (e: "update:valid", value: boolean): void;
}>();

const { t } = useI18nTyped();

const EDITABLE_SEVERITIES = ["P2", "P3"] as const;

/// The durations offered. Every one is inside the range the server accepts, so
/// picking from this list can never produce a refused save.
const BUDGET_SECONDS = [30, 45, 60, 90, 120, 180, 300, 600];

/// Spread, not structuredClone: the prop and the draft are reactive proxies,
/// which structuredClone refuses to clone.
function copy(value: L0Policy): L0Policy {
  return { ...value, mode: { ...value.mode } };
}

const draft = reactive<L0Policy>(copy(props.l0 ?? l0Defaults()));

const budgetValid = computed(
  () =>
    draft.triage_budget_seconds >= L0_BUDGET_MIN_SECONDS &&
    draft.triage_budget_seconds <= L0_BUDGET_MAX_SECONDS,
);

/// A stored value that is not one of the presets is added to the list. A select
/// holding a value that is not one of its own options reads as chosen and
/// submits as nothing — and an out-of-range one still has to be visible, since
/// it is what the parent is being blocked from saving.
const budgetOptions = computed(() => {
  const stored = draft.triage_budget_seconds;
  const seconds = BUDGET_SECONDS.includes(stored)
    ? BUDGET_SECONDS
    : [...BUDGET_SECONDS, stored].sort((a, b) => a - b);
  return seconds.map((n) => ({ label: t("oncall.l0BudgetSeconds", { count: n }, n), value: n }));
});

/// One to three. A verdict that can climb four steps turns a P5 into a P1,
/// which is the whole reason the ratchet is bounded.
const maxStepOptions = computed(() =>
  [1, 2, 3].map((n) => ({ label: t("oncall.l0MaxStepsOption", { count: n }, n), value: n })),
);

const modeOptions = computed(() => [
  { label: t("oncall.l0ModeGate"), value: "gate" },
  { label: t("oncall.l0ModeParallel"), value: "parallel" },
  { label: t("oncall.l0ModeOnly"), value: "only" },
]);

function modeSentence(mode: L0Mode): I18nText {
  if (mode === "gate") return t("oncall.l0GateSentence");
  if (mode === "parallel") return t("oncall.l0ParallelSentence");
  return t("oncall.l0OnlySentence");
}

function announce() {
  emit("update:l0", copy(draft));
  emit("update:valid", budgetValid.value);
}

function update(patch: Partial<L0Policy>) {
  Object.assign(draft, patch);
  announce();
}

function setMode(severity: (typeof EDITABLE_SEVERITIES)[number], value: unknown) {
  draft.mode[severity] = String(value) as L0Mode;
  announce();
}

function setBudget(value: unknown) {
  draft.triage_budget_seconds = Number(value);
  announce();
}

function setMaxSteps(value: unknown) {
  // Bounded below at 1 — zero steps is allow_promotion off, not a step count.
  draft.max_promotion_steps = Math.max(1, Math.round(Number(value) || 1));
  announce();
}
</script>
