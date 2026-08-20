<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  The SLO condition block of the alert form (alerts_2.md §6b.6).

  The suggested-configuration cards are the point of this component. The
  published rows are the reason burn-rate alerting is usable at all: a raw
  "burn rate > ?" field with no guidance produces thresholds that either page
  constantly or never fire. Each card states what fraction of the budget the
  threshold corresponds to, so the choice is legible rather than magic.

  There is deliberately NO count gate here. Unlike aggregation and PromQL
  alerts this family has no count axis, and a non-default value on the legacy
  threshold fields is rejected rather than silently ignored (SA-4).
-->
<template>
  <div class="flex flex-col gap-4">
    <OSelect
      v-if="!slo"
      v-model="model.slo_id"
      :label="t('slos.alert.sloLabel')"
      :options="sloOptions"
      required
      data-test="slos-sloalertcondition-slo"
    />
    <p v-if="selectedSlo" class="text-compact text-text-secondary -mt-2">
      {{ sloSummary }}
    </p>

    <OToggleGroup v-model="model.kind" data-test="slos-sloalertcondition-kind">
      <OToggleGroupItem
        v-for="opt in kindOptions"
        :key="opt.value"
        :value="opt.value"
        size="sm"
        :data-test="`slos-sloalertcondition-kind-${opt.value}`"
      >
        <template v-if="opt.icon" #icon-left>
          <OIcon :name="opt.icon" size="sm" />
        </template>
        {{ opt.label }}
      </OToggleGroupItem>
    </OToggleGroup>

    <template v-if="model.kind === 'burn_rate'">
      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="font-medium">{{ t("slos.alert.suggested") }}</span>
          <span class="text-compact text-text-secondary">
            {{ t("slos.alert.suggestedFor", { window: windowLabel }) }}
          </span>
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <!-- Selection styling copied from PredefinedThemes: same shape (a grid
               of button-cards where one is applied), so the "this is the one in
               effect" cue reads identically in both places. -->
          <button
            v-for="p in presets"
            :key="p.key"
            type="button"
            class="rounded-default focus-visible:ring-accent/40 cursor-pointer border p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            :class="
              isActivePreset(p)
                ? 'border-accent ring-accent bg-card-glass-tint-soft ring-1 ring-inset'
                : 'border-border-default hover:border-accent hover:bg-card-glass-tint-subtle'
            "
            :aria-pressed="isActivePreset(p)"
            :data-test="`slos-sloalertcondition-preset-${p.key}`"
            @click="applyPreset(p)"
          >
            <div class="text-compact text-text-secondary">{{ p.label }}</div>
            <div class="text-lg font-semibold tabular-nums">×{{ p.threshold }}</div>
            <div class="text-compact text-text-secondary">
              {{
                t("slos.alert.presetDetail", {
                  long: p.longLabel,
                  short: p.shortLabel,
                  budget: p.budgetPct,
                })
              }}
            </div>
          </button>
        </div>
        <p class="text-compact text-text-secondary mt-2">
          {{ t("slos.alert.shortIsLongOverTwelve") }}
        </p>
      </div>

      <div class="grid grid-cols-[7rem_1fr] items-center gap-3">
        <span class="text-negative font-medium">{{ t("slos.alert.criticalIf") }}</span>
        <!-- `width="xs"`, not `class="w-*"`: a width class on the root loses to
             the component's own `w-full` default, stretching every control to a
             full row. Same for the inside labels — `labelPosition` is the API. -->
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("slos.alert.burnRate") }}</span>
          <OSelect
            v-model="model.operator"
            :options="operatorOptions"
            width="xs"
            data-test="slos-sloalertcondition-operator"
          />
          <OInput
            v-model.number="model.critical"
            type="number"
            step="0.1"
            width="xs"
            data-test="slos-sloalertcondition-critical"
          />
          <span>{{ t("slos.alert.inBothWindows") }}</span>
          <OInput
            v-model.number="longHours"
            type="number"
            width="xs"
            suffix="h"
            :label="t('slos.alert.long')"
            label-position="inside"
            data-test="slos-sloalertcondition-long"
          />
          <OInput
            v-model.number="shortMinutes"
            type="number"
            width="xs"
            suffix="min"
            :label="t('slos.alert.short')"
            label-position="inside"
            data-test="slos-sloalertcondition-short"
          />
        </div>

        <span class="text-warning font-medium">{{ t("slos.alert.warningIf") }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("slos.alert.burnRate") }}</span>
          <!-- Shares the operator with critical (T-2): two operators would
               allow a warning band that is not a subset of critical. -->
          <span class="font-mono">{{ model.operator }}</span>
          <OInput
            v-model.number="model.warning"
            type="number"
            step="0.1"
            width="xs"
            :placeholder="t('slos.alert.none')"
          />
          <span class="text-compact text-text-secondary">
            {{ t("slos.alert.warningShares") }}
          </span>
        </div>
      </div>

      <p v-if="selectedSlo" class="text-compact text-text-secondary">
        {{ t("slos.alert.maxBurnNote", { max: maxBurn, short: defaultShortLabel }) }}
        <template v-if="exhaustLabel">
          {{ t("slos.alert.exhaustNote", { time: exhaustLabel }) }}
        </template>
      </p>
    </template>

    <template v-else>
      <div class="grid grid-cols-[7rem_1fr] items-center gap-3">
        <span class="text-negative font-medium">{{ t("slos.alert.criticalIf") }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("slos.alert.budgetConsumed") }}</span>
          <OSelect v-model="model.operator" :options="operatorOptions" width="xs" />
          <OInput v-model.number="model.critical" type="number" step="1" width="xs" suffix="%" />
        </div>
        <span class="text-warning font-medium">{{ t("slos.alert.warningIf") }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("slos.alert.budgetConsumed") }}</span>
          <span class="font-mono">{{ model.operator }}</span>
          <OInput
            v-model.number="model.warning"
            type="number"
            step="1"
            width="xs"
            suffix="%"
            :placeholder="t('slos.alert.none')"
          />
        </div>
      </div>
    </template>

    <!-- No per-group fan-out control. It is rejected for EVERY SLO —
         `MultiAlertRequiresGroupedSlo` when ungrouped and
         `MultiAlertNotImplemented` when grouped — so offering it could only
         produce a permanent 400 on save. Restore it when fan-out ships. -->

    <!-- No count-gate row either, and deliberately no banner explaining the
         absence: the header comment carries the SA-4 rationale for developers,
         and the API error covers hand-crafted payloads. -->
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";

import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import sloService from "@/services/slos";
import type { Slo } from "@/ts/interfaces/slo";
import { formatTimeToExhaust, formatWindow } from "@/composables/useSloFormat";

const model = defineModel<any>({ required: true });

/** The SLO this alert belongs to.
 *
 *  On the SLO page the SLO is CONTEXT, not a choice: it comes from the page,
 *  the selector is not rendered, and the list is never fetched. */
const props = defineProps<{ slo?: Slo | null }>();

const { t } = useI18nTyped();
const store = useStore();
const slos = ref<Slo[]>([]);

const org = computed(() => store.state.selectedOrganization?.identifier);

const sloOptions = computed(() => slos.value.map((s) => ({ value: s.id, label: raw(s.name) })));

const selectedSlo = computed(
  () => props.slo ?? slos.value.find((s) => s.id === model.value.slo_id) ?? null,
);

const kindOptions = computed(() => [
  { value: "burn_rate", label: t("slos.alert.kind.burnRate"), icon: "local-fire-department" },
  { value: "error_budget", label: t("slos.alert.kind.errorBudget"), icon: "data_usage" },
]);

const operatorOptions = [
  // Ascending-orderable only (SA-5): `<` on a burn rate would mean "alert when
  // things are going WELL", which is never what anyone configures on purpose.
  { value: ">", label: raw(">") },
  { value: ">=", label: raw(">=") },
];

const windowLabel = computed(() =>
  selectedSlo.value ? formatWindow(selectedSlo.value.window_secs) : "30d",
);

/** The published suggested rows, per window (§6b.6a).
 *
 *  These are not arbitrary: each threshold is the burn rate that consumes the
 *  stated fraction of the budget over the long window, which is what makes
 *  "×14.4" mean something. */
const PRESETS: Record<number, Array<[string, number, number, number]>> = {
  // window days -> [key/label, threshold, longSecs, shortSecs]
  7: [
    ["fast", 16.8, 3600, 300],
    ["mid", 5.6, 21600, 1800],
    ["slow", 2.8, 86400, 7200],
  ],
  30: [
    ["fast", 14.4, 3600, 300],
    ["mid", 6, 21600, 1800],
    ["slow", 3, 86400, 7200],
  ],
  90: [
    ["fast", 21.6, 3600, 300],
    ["mid", 10.8, 21600, 1800],
    ["slow", 4.5, 86400, 7200],
  ],
};

const presets = computed(() => {
  const days = Math.round((selectedSlo.value?.window_secs ?? 30 * 86400) / 86400);
  const presetDays = PRESETS[days] ? days : 30;
  const rows = PRESETS[presetDays];
  const labels: Record<string, string> = {
    fast: t("slos.alert.preset.fast"),
    mid: t("slos.alert.preset.mid"),
    slow: t("slos.alert.preset.slow"),
  };
  return rows.map(([key, threshold, longSecs, rawShortSecs]) => {
    // The published rows assume a fine slice grid. Ours is the SLO's
    // own `slice_interval_secs`, and SA-8 requires every window to be a whole
    // multiple of it AND at least two slices — so on a 5-minute-slice SLO the
    // canonical 5m short window is ONE slice and the backend rejects it.
    // Snapping here is what keeps a suggested card from producing a config
    // that cannot be saved; it mirrors `default_short_window_secs`.
    const shortSecs = snapWindow(rawShortSecs as number);
    // The published thresholds assume a target tight enough to reach them.
    // SA-6 caps the burn rate at 100/(100 − target), so on a loose SLO (say
    // 90%, ceiling ×10) the canonical ×14.4 card is unsavable. Clamping keeps
    // every offered card savable rather than presenting a trap.
    // Floored to 2 decimals, not rounded: 100/(100−target) is usually a
    // repeating fraction (target 67% → 3.0303…), and rounding UP would put the
    // card a hair over the cap — unsavable, and 16 digits wide in the UI.
    const ceiling = maxBurnValue.value;
    const clamped =
      ceiling === null ? threshold : Math.min(threshold, Math.floor(ceiling * 100) / 100);
    const budgetPct = Math.round((clamped * longSecs * 100) / (presetDays * 86400));
    return {
      key: key as string,
      label: labels[key as string],
      threshold: clamped,
      longSecs,
      shortSecs,
      budgetPct,
      longLabel: longSecs >= 3600 ? `${longSecs / 3600}h` : `${longSecs / 60}m`,
      shortLabel: shortSecs >= 3600 ? `${shortSecs / 3600}h` : `${shortSecs / 60}m`,
    };
  });
});

/** Round a window onto the selected SLO's slice grid, floored at two slices
 *  (SA-8). Without an SLO selected there is no grid to snap to. */
function snapWindow(secs: number): number {
  const slice = selectedSlo.value?.slice_interval_secs ?? 0;
  if (slice <= 0) return secs;
  const onGrid = Math.round(secs / slice) * slice;
  return Math.max(onGrid, 2 * slice);
}

function isActivePreset(p: any): boolean {
  return (
    model.value.critical === p.threshold &&
    model.value.long_window_secs === p.longSecs &&
    model.value.short_window_secs === p.shortSecs
  );
}

function applyPreset(p: any) {
  model.value.critical = p.threshold;
  model.value.long_window_secs = p.longSecs;
  model.value.short_window_secs = p.shortSecs;
}

const longHours = computed({
  get: () => model.value.long_window_secs / 3600,
  set: (v: number) => {
    model.value.long_window_secs = Math.round((Number(v) || 1) * 3600);
  },
});

const shortMinutes = computed({
  get: () => model.value.short_window_secs / 60,
  set: (v: number) => {
    model.value.short_window_secs = Math.round((Number(v) || 5) * 60);
  },
});

/** The SA-6 cap: an SLI of 0% cannot burn faster than 1/(1−target). A
 *  threshold above this can never fire, which is worth saying out loud. */
/** SA-6's ceiling: a burn rate above 100/(100 − target) needs an error rate
 *  over 100% and can never fire, so the backend rejects it. */
const maxBurnValue = computed(() => {
  const target = selectedSlo.value?.target;
  if (!target || target <= 0 || target >= 100) return null;
  return 100 / (100 - target);
});

const maxBurn = computed(() => {
  const v = maxBurnValue.value;
  return v === null ? "-" : Math.round(v);
});

const defaultShortLabel = computed(() => {
  const long = model.value.long_window_secs ?? 3600;
  return t("slos.alert.minutesShort", { count: Math.round(long / 12 / 60) });
});

/** How long the budget lasts at the configured rate — the number that makes a
 *  threshold concrete. */
const exhaustLabel = computed(() => {
  const slo = selectedSlo.value;
  const burn = Number(model.value.critical);
  if (!slo || !Number.isFinite(burn) || burn <= 0) return "";
  return formatTimeToExhaust(Math.floor(slo.window_secs / burn));
});

const sloSummary = computed(() => {
  const s = selectedSlo.value;
  if (!s) return "";
  return t("slos.alert.sloSummary", {
    target: `${Number(s.target.toFixed(3))}%`,
    window: formatWindow(s.window_secs),
    slice: s.slice_interval_secs === 60 ? "1-min" : "5-min",
    max: maxBurn.value,
  });
});

// Switching kind changes what the threshold MEANS — a burn multiple and a
// budget percentage are different quantities, and carrying one over as the
// other would silently misconfigure the alert.
// `immediate` is deliberately OFF, and the guard below matters just as much:
// the reset is for a USER switching kind, never for the load of an existing
// alert. Firing on populate silently rewrites stored thresholds the moment the
// edit form opens.
watch(
  () => model.value.kind,
  (kind, previous) => {
    if (previous === undefined || kind === previous) return;
    if (kind === "burn_rate") {
      model.value.critical = presets.value[0]?.threshold ?? 14.4;
      model.value.long_window_secs = 3600;
      model.value.short_window_secs = 300;
    } else {
      model.value.critical = 75;
      model.value.long_window_secs = null;
      model.value.short_window_secs = null;
    }
    model.value.warning = null;
  },
);

onMounted(async () => {
  // The SLO given by the page is authoritative: adopt its id so the saved
  // condition points at it, and skip the list fetch entirely — the page
  // already knows which SLO this is, and refetching all of them per mount
  // would be a request for nothing.
  if (props.slo) {
    model.value.slo_id = props.slo.id;
    return;
  }
  if (!org.value) return;
  const res = await sloService.list(org.value);
  slos.value = res.data?.list ?? [];
});
</script>
