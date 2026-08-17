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

  The budget is refused outside 30-600s, not clamped — an operator who typed
  900 has a belief about how long their page is held, and quietly saving 600
  would leave that belief intact and wrong. The same doctrine applies here:
  the field shows the error and the parent's Save is blocked until it is fixed.
-->
<template>
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-3 border px-4 py-3"
    data-test="oncall-l0-editor"
  >
    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <OText variant="panel-title">{{ t("oncall.l0Title") }}</OText>
      <OText variant="meta">{{ t("oncall.l0Hint") }}</OText>
    </span>

    <!-- Per-severity: what happens between a firing and a page. -->
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2" data-test="oncall-l0-p1">
        <OTag variant="error-soft" size="sm">{{ raw("P1") }}</OTag>
        <span class="text-text-body text-sm">{{ t("oncall.l0P1Fixed") }}</span>
      </div>

      <div
        v-for="severity in EDITABLE_SEVERITIES"
        :key="severity"
        class="flex flex-wrap items-center gap-2"
        :data-test="`oncall-l0-${severity.toLowerCase()}`"
      >
        <OTag variant="warning-soft" size="sm">{{ severity }}</OTag>
        <span class="w-40">
          <OSelect
            :model-value="draft.mode[severity]"
            :options="modeOptions"
            :data-test="`oncall-l0-mode-${severity.toLowerCase()}`"
            @update:model-value="(v: unknown) => setMode(severity, v)"
          />
        </span>
        <span class="text-text-secondary text-sm">{{ modeSentence(draft.mode[severity]) }}</span>
      </div>

      <div class="flex flex-wrap items-center gap-2" data-test="oncall-l0-p4">
        <OTag variant="default-soft" size="sm">{{ raw("P4 · P5") }}</OTag>
        <span class="text-text-body text-sm">{{ t("oncall.l0P4Fixed") }}</span>
      </div>
    </div>

    <!-- The hold, and the promise underneath it: fail-open, always. -->
    <div class="flex flex-wrap items-end gap-2">
      <span class="w-40">
        <OInput
          :model-value="String(draft.triage_budget_seconds)"
          type="number"
          :label="t('oncall.l0BudgetLabel')"
          :error="!budgetValid"
          :error-message="t('oncall.l0BudgetRange')"
          data-test="oncall-l0-budget"
          @update:model-value="(v: string | number) => setBudget(v)"
        />
      </span>
      <span class="text-text-secondary pb-1 text-sm">{{ t("oncall.l0FailOpen") }}</span>
    </div>

    <div class="flex flex-col gap-2">
      <span class="flex flex-wrap items-center gap-3">
        <OSwitch
          :model-value="draft.allow_promotion"
          :label="t('oncall.l0AllowPromotion')"
          data-test="oncall-l0-allow-promotion"
          @update:model-value="(v: unknown) => update({ allow_promotion: !!v })"
        />
        <span v-if="draft.allow_promotion" class="w-24">
          <OInput
            :model-value="String(draft.max_promotion_steps)"
            type="number"
            :label="t('oncall.l0MaxSteps')"
            data-test="oncall-l0-max-steps"
            @update:model-value="(v: string | number) => setMaxSteps(v)"
          />
        </span>
      </span>
      <!-- The ratchet is not a setting: a verdict can only ever RAISE a
           severity. This toggle governs how far one hop may climb. -->
      <span class="text-text-secondary text-xs">{{ t("oncall.l0PromotionNote") }}</span>

      <OSwitch
        :model-value="draft.allow_downgrade"
        :label="t('oncall.l0AllowDowngrade')"
        data-test="oncall-l0-allow-downgrade"
        @update:model-value="(v: unknown) => update({ allow_downgrade: !!v })"
      />
      <!-- "Downgrade" here is about ONE notification riding quieter channels —
           the record's severity is untouched. Saying so stops the toggle
           reading as a severity control. -->
      <span class="text-text-secondary text-xs">{{ t("oncall.l0DowngradeNote") }}</span>

      <OSwitch
        :model-value="draft.allow_suppress"
        :label="t('oncall.l0AllowSuppress')"
        data-test="oncall-l0-allow-suppress"
        @update:model-value="(v: unknown) => update({ allow_suppress: !!v })"
      />
      <span class="text-text-secondary text-xs">{{ t("oncall.l0SuppressNote") }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type { L0Mode, L0Policy } from "@/ts/interfaces/oncall";
import { L0_BUDGET_MAX_SECONDS, L0_BUDGET_MIN_SECONDS } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ l0: L0Policy | null }>();

const emit = defineEmits<{
  (e: "update:l0", value: L0Policy): void;
  /** False while the budget is outside the server's range — the parent must
   *  block Save rather than send a PUT the server will refuse. */
  (e: "update:valid", value: boolean): void;
}>();

const { t } = useI18nTyped();

const EDITABLE_SEVERITIES = ["P2", "P3"] as const;

/// The block every auto-created policy ships with — used only when the stored
/// policy predates L0 and carries none. Mirrors L0Policy::defaults().
function defaults(): L0Policy {
  return {
    mode: { P1: "parallel", P2: "gate", P3: "gate", P4: "only" },
    triage_budget_seconds: 90,
    allow_promotion: true,
    max_promotion_steps: 2,
    allow_downgrade: true,
    allow_suppress: false,
  };
}

/// Spread, not structuredClone: the prop and the draft are reactive proxies,
/// which structuredClone refuses to clone.
function copy(value: L0Policy): L0Policy {
  return { ...value, mode: { ...value.mode } };
}

const draft = reactive<L0Policy>(copy(props.l0 ?? defaults()));

const budgetValid = computed(
  () =>
    draft.triage_budget_seconds >= L0_BUDGET_MIN_SECONDS &&
    draft.triage_budget_seconds <= L0_BUDGET_MAX_SECONDS,
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

function setBudget(value: string | number) {
  draft.triage_budget_seconds = Number(value);
  announce();
}

function setMaxSteps(value: string | number) {
  // Bounded below at 1 — zero steps is allow_promotion off, not a step count.
  draft.max_promotion_steps = Math.max(1, Math.round(Number(value) || 1));
  announce();
}
</script>
