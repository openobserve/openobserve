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
  The AI SRE triage gate, per team (C11 — the l0_json block; I19-I24 — `off`).

  What each severity does is said in plain sentences beside the control,
  because the mode names alone ("gate", "only") read as jargon at the moment
  somebody is deciding whether a P2 will wait 90 seconds. All four rows are
  dropdowns now — P1 offers `parallel`/`off`, P2 and P3 offer
  `gate`/`parallel`/`off`, P4/P5 offer `only`/`off` — and the server 400s
  anything outside that row's set, so the options list is the validation.

  The "AI triage" switch above the rows is a convenience, not a fifth field:
  it writes `off` to all four rows (or the published defaults back) and stores
  nothing of its own — flipping it reads back as "on" the moment any row is
  not `off`.

  The budget is a list of durations rather than a free number: the server
  refuses anything outside 30-600s instead of clamping, and every value an
  operator can pick from a list is one the server will take. A stored value
  outside the range is still OFFERED — a select must never hold a value that is
  not one of its own options — and reported as invalid so the parent blocks Save.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-l0-editor">
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <OText variant="section" as="div">{{ t("oncall.l0BySeveritySection") }}</OText>
        <OSwitch
          :model-value="aiTriageOn"
          :label="t('oncall.l0AiTriageToggle')"
          size="sm"
          data-test="oncall-l0-ai-triage-toggle"
          @update:model-value="(v: unknown) => setAiTriage(!!v)"
        />
      </div>

      <div class="border-border-default rounded-surface flex flex-col border">
        <div
          v-for="row in SEVERITY_ROWS"
          :key="row.field"
          class="border-border-default flex flex-wrap items-center gap-2 border-t px-3 py-2 first:border-t-0"
          :data-test="`oncall-l0-${row.testKey}`"
        >
          <OTag :variant="row.variant" size="sm" class="w-14 shrink-0 justify-center">{{
            raw(row.label)
          }}</OTag>
          <span class="w-48">
            <OSelect
              :model-value="draft.mode[row.field]"
              :options="optionsFor(row.field)"
              size="sm"
              :data-test="`oncall-l0-mode-${row.testKey}`"
              @update:model-value="(v: unknown) => setMode(row.field, v)"
            />
          </span>
          <OText variant="meta">
            {{ modeSentenceLead(draft.mode[row.field]) }}
            <span v-if="draft.mode[row.field] === 'gate'" class="font-medium">{{
              t("oncall.l0GateSentenceBold")
            }}</span>
          </OText>
        </div>

        <!-- The hold applies only where a row reads `gate`; shown once, under every row. -->
        <div class="border-border-default flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <OText variant="label" class="w-24 shrink-0">{{ t("oncall.l0BudgetLabel") }}</OText>
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
      </div>
    </div>

    <!-- What a verdict is allowed to DO. Three separate permissions, because
         raising a severity, quieting one notification and cancelling a page
         are three different amounts of trust — each gets its own row and its
         own sentence, rather than one note shared across two toggles. -->
    <div class="flex flex-col gap-2">
      <OText variant="section" as="div">{{ t("oncall.l0VerdictPowers") }}</OText>

      <div class="border-border-default rounded-surface flex flex-col border">
        <div class="flex flex-col gap-1 px-3 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <OSwitch
              :model-value="draft.allow_promotion"
              :label="t('oncall.l0AllowPromotion')"
              size="sm"
              data-test="oncall-l0-allow-promotion"
              @update:model-value="(v: unknown) => update({ allow_promotion: !!v })"
            />
            <!-- The ratchet is not a setting — a verdict can only ever RAISE a
                 severity. This bounds how far one hop may climb, so it reads
                 as part of the permission rather than as a field of its own. -->
            <OSelect
              v-if="draft.allow_promotion"
              :model-value="draft.max_promotion_steps"
              :options="maxStepOptions"
              appearance="inline"
              size="sm"
              data-test="oncall-l0-max-steps"
              @update:model-value="(v: unknown) => setMaxSteps(v)"
            />
          </div>
          <OText variant="meta" class="ps-9">{{ t("oncall.l0AllowPromotionNote") }}</OText>
        </div>

        <div class="border-border-default flex flex-col gap-1 border-t px-3 py-2">
          <OSwitch
            :model-value="draft.allow_downgrade"
            :label="t('oncall.l0AllowDowngrade')"
            size="sm"
            data-test="oncall-l0-allow-downgrade"
            @update:model-value="(v: unknown) => update({ allow_downgrade: !!v })"
          />
          <!-- "Soften" is about one notification's channels, never the
               record's severity — the sentence most often mis-read. -->
          <OText variant="meta" class="ps-9">{{ t("oncall.l0DowngradeNote") }}</OText>
        </div>

        <div class="border-border-default flex flex-col gap-1 border-t px-3 py-2">
          <OSwitch
            :model-value="draft.allow_suppress"
            :label="t('oncall.l0AllowSuppress')"
            size="sm"
            data-test="oncall-l0-allow-suppress"
            @update:model-value="(v: unknown) => update({ allow_suppress: !!v })"
          />
          <!-- Opt-in: until this is on, a Suppress verdict is a
               recommendation, and the page still goes out. -->
          <OText variant="meta" class="ps-9">{{ t("oncall.l0SuppressNote") }}</OText>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
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

/// One row per field of `L0Modes` (C11 §4a), in the order the ladder pages.
/// `field` is the only thing the template needs to read and write; the rest
/// is display, kept here rather than computed so a translator's key change
/// cannot desync it from the row it labels.
const SEVERITY_ROWS: readonly {
  field: keyof L0Policy["mode"];
  testKey: string;
  label: string;
  variant: BadgeVariant;
}[] = [
  { field: "P1", testKey: "p1", label: "P1", variant: "error-soft" },
  { field: "P2", testKey: "p2", label: "P2", variant: "warning-soft" },
  { field: "P3", testKey: "p3", label: "P3", variant: "warning-soft" },
  { field: "P4", testKey: "p4", label: "P4 · P5", variant: "default-soft" },
];

/// §4a's matrix, spelled out per row — the same set [`L0Policy::validate`]
/// enforces server-side, so an option offered here can never be refused.
const MODES_FOR_FIELD: Record<keyof L0Policy["mode"], readonly L0Mode[]> = {
  P1: ["parallel", "off"],
  P2: ["gate", "parallel", "off"],
  P3: ["gate", "parallel", "off"],
  P4: ["only", "off"],
};

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

function modeLabel(mode: L0Mode): I18nText {
  switch (mode) {
    case "gate":
      return t("oncall.l0ModeGate");
    case "parallel":
      return t("oncall.l0ModeParallel");
    case "only":
      return t("oncall.l0ModeOnly");
    case "off":
      return t("oncall.l0ModeOff");
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

/// Restricted to the row's own legal set (§4a) — never the full `L0Mode`
/// union — so a select can never offer a value the server would 400. Called
/// straight from the template rather than memoised, so a locale switch is
/// picked up like every other `t()` call here.
function optionsFor(field: keyof L0Policy["mode"]) {
  return MODES_FOR_FIELD[field].map((mode) => ({ label: modeLabel(mode), value: mode }));
}

/// L13: this editor knows the L0 config, not the team's ladder, so the `only`
/// sentence must not claim nobody is paged — a team with levels at P4/P5 is.
/// The ladder preview says which, because the server resolved it there.
function modeSentenceLead(mode: L0Mode): I18nText {
  switch (mode) {
    case "gate":
      return t("oncall.l0GateSentenceLead");
    case "parallel":
      return t("oncall.l0ParallelSentence");
    case "only":
      return t("oncall.l0OnlySentence");
    case "off":
      return t("oncall.l0OffSentence");
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

/// Reads back "on" the moment any row is not `off` — the switch stores
/// nothing of its own, so this is the only place its state lives.
const aiTriageOn = computed(() =>
  (Object.keys(MODES_FOR_FIELD) as (keyof L0Policy["mode"])[]).some(
    (field) => draft.mode[field] !== "off",
  ),
);

function setAiTriage(on: boolean) {
  const source: L0Policy["mode"] = on
    ? l0Defaults().mode
    : { P1: "off", P2: "off", P3: "off", P4: "off" };
  Object.assign(draft.mode, source);
  announce();
}

function announce() {
  emit("update:l0", copy(draft));
  emit("update:valid", budgetValid.value);
}

function update(patch: Partial<L0Policy>) {
  Object.assign(draft, patch);
  announce();
}

function setMode(field: keyof L0Policy["mode"], value: unknown) {
  draft.mode[field] = String(value) as L0Mode;
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
