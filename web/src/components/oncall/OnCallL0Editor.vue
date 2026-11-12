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

<!-- The AI SRE triage gate per team: each row offers only the modes the server accepts, so the options list is the validation. -->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-l0-editor">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-3">
        <OText variant="section" as="div">{{ t("oncall.l0AiTriageToggle") }}</OText>
        <OSwitch
          :model-value="aiTriageOn"
          :aria-label="t('oncall.l0AiTriageToggle')"
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
          <span class="flex w-24 shrink-0 items-center gap-1">
            <OTag
              v-for="priority in row.priorities"
              :key="priority"
              type="alertPriority"
              :value="priority"
              size="sm"
            />
          </span>
          <span class="w-80 max-md:w-full">
            <OSelect
              :model-value="draft.mode[row.field]"
              :options="optionsFor(row.field)"
              size="sm"
              :data-test="`oncall-l0-mode-${row.testKey}`"
              @update:model-value="(v: unknown) => setMode(row.field, v)"
            >
              <!-- The closed select names the mode only; its sentence is read in the open list. -->
              <template #trigger="{ value }">{{ modeLabel(value as L0Mode) }}</template>
              <OSelectItem
                v-for="option in optionsFor(row.field)"
                :key="option.value"
                :value="option.value"
                :label="option.label"
              >
                <span class="flex min-w-0 flex-col py-0.5">
                  <span class="text-sm">{{ option.label }}</span>
                  <span class="text-text-secondary text-xs">{{ option.description }}</span>
                </span>
              </OSelectItem>
            </OSelect>
          </span>
        </div>

        <!-- The wait applies only where a row holds the page. -->
        <div class="border-border-default flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <span class="flex w-24 shrink-0 items-center gap-1">
            <OText variant="label">{{ t("oncall.l0WaitAtMost") }}</OText>
            <OIcon
              name="info-outline"
              size="sm"
              class="text-icon-color cursor-pointer"
              data-test="oncall-l0-budget-info"
            >
              <OTooltip side="bottom" :content="t('oncall.l0WaitAtMostInfo')" />
            </OIcon>
          </span>
          <span class="w-40">
            <OSelect
              :model-value="draft.triage_budget_seconds"
              :options="budgetOptions"
              size="sm"
              :error="!budgetValid"
              :error-message="t('oncall.l0BudgetRange')"
              :aria-label="t('oncall.l0WaitAtMost')"
              data-test="oncall-l0-budget"
              @update:model-value="(v: unknown) => setBudget(v)"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- Three separate permissions, because raising, quieting and cancelling a page are three amounts of trust. -->
    <div class="flex flex-col gap-2">
      <span class="flex items-center gap-1">
        <OText variant="section" as="div">{{ t("oncall.l0MayHeading") }}</OText>
        <OIcon
          name="info-outline"
          size="sm"
          class="text-icon-color cursor-pointer"
          data-test="oncall-l0-may-info"
        >
          <OTooltip side="bottom" :content="t('oncall.l0MayInfo')" />
        </OIcon>
      </span>

      <div class="border-border-default rounded-surface flex flex-col border">
        <div
          v-for="row in permissionRows"
          :key="row.key"
          class="border-border-default flex min-h-12 items-center gap-3 border-b px-3 py-2 last:border-b-0"
          :data-test="`oncall-l0-row-${row.key}`"
        >
          <span class="text-text-heading min-w-0 flex-1 text-sm font-medium">{{ row.label }}</span>
          <OSelect
            v-if="row.key === 'promotion' && draft.allow_promotion"
            :model-value="draft.max_promotion_steps"
            :options="maxStepOptions"
            size="sm"
            width="sm"
            :aria-label="t('oncall.l0RaisePriority')"
            data-test="oncall-l0-max-steps"
            @update:model-value="(v: unknown) => setMaxSteps(v)"
          />
          <OSwitch
            :model-value="draft[row.field]"
            :aria-label="row.label"
            size="sm"
            class="shrink-0"
            :data-test="`oncall-l0-${row.switchTest}`"
            @update:model-value="(v: unknown) => update({ [row.field]: !!v })"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { L0Mode, L0Policy } from "@/ts/interfaces/oncall";
import { L0_BUDGET_MAX_SECONDS, L0_BUDGET_MIN_SECONDS } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";
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
  /** `alertPriority` badge values, the same scale the Pages list uses. */
  priorities: string[];
}[] = [
  { field: "P1", testKey: "p1", priorities: ["p1"] },
  { field: "P2", testKey: "p2", priorities: ["p2"] },
  { field: "P3", testKey: "p3", priorities: ["p3"] },
  { field: "P4", testKey: "p4", priorities: ["p4", "p5"] },
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

/// The parent resets or restores a draft through the prop, and a kept-alive tab would otherwise show the old edit.
watch(
  () => props.l0,
  (value) => {
    Object.assign(draft, copy(value ?? l0Defaults()));
    emit("update:valid", budgetValid.value);
  },
);

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

const permissionRows = computed(
  (): {
    key: string;
    field: "allow_promotion" | "allow_downgrade" | "allow_suppress";
    switchTest: string;
    label: I18nText;
  }[] => [
    {
      key: "promotion",
      field: "allow_promotion",
      switchTest: "allow-promotion",
      label: t("oncall.l0RaisePriority"),
    },
    {
      key: "downgrade",
      field: "allow_downgrade",
      switchTest: "allow-downgrade",
      label: t("oncall.l0QuietOne"),
    },
    {
      key: "suppress",
      field: "allow_suppress",
      switchTest: "allow-suppress",
      label: t("oncall.l0AllowSuppress"),
    },
  ],
);

/// One to three. A verdict that can climb four steps turns a P5 into a P1,
/// which is the whole reason the ratchet is bounded.
const maxStepOptions = computed(() =>
  [1, 2, 3].map((n) => ({ label: t("oncall.l0MaxLevelsOption", { count: n }, n), value: n })),
);

function modeLabel(mode: L0Mode): I18nText {
  switch (mode) {
    case "gate":
      return t("oncall.l0OptionGate");
    case "parallel":
      return t("oncall.l0OptionParallel");
    case "only":
      return t("oncall.l0OptionOnly");
    case "off":
      return t("oncall.l0OptionOff");
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
  return MODES_FOR_FIELD[field].map((mode) => ({
    label: modeLabel(mode),
    value: mode,
    description: modeSentence(mode),
  }));
}

/// This editor knows the L0 config, not the team's ladder, so `only` must not claim nobody is paged.
function modeSentence(mode: L0Mode): I18nText {
  switch (mode) {
    case "gate":
      return t("oncall.l0OptionGateDesc");
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
