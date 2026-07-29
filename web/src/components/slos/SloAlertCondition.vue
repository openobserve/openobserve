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

  The suggested-configuration cards are the point of this component. Datadog's
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
      v-model="model.slo_id"
      :label="t('slos.alert.sloLabel')"
      :options="sloOptions"
      required
      data-test="slos-sloalertcondition-slo"
    />
    <p v-if="selectedSlo" class="text-compact text-text-secondary -mt-2">
      {{ sloSummary }}
    </p>

    <OToggleGroup
      v-model="model.kind"
      :options="kindOptions"
      size="sm"
      data-test="slos-sloalertcondition-kind"
    />

    <template v-if="model.kind === 'burn_rate'">
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium">{{ t("slos.alert.suggested") }}</span>
          <span class="text-compact text-text-secondary">
            {{ t("slos.alert.suggestedFor", { window: windowLabel }) }}
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            v-for="p in presets"
            :key="p.key"
            type="button"
            class="text-left rounded-md border p-3 hover:border-primary transition-colors"
            :class="isActivePreset(p) ? 'border-primary bg-primary/5' : 'border-border'"
            :data-test="`slos-sloalertcondition-preset-${p.key}`"
            @click="applyPreset(p)"
          >
            <div class="text-compact text-text-secondary">{{ p.label }}</div>
            <div class="text-lg font-semibold tabular-nums">×{{ p.threshold }}</div>
            <div class="text-compact text-text-secondary">
              {{ t("slos.alert.presetDetail", { long: p.longLabel, short: p.shortLabel, budget: p.budgetPct }) }}
            </div>
          </button>
        </div>
        <p class="text-compact text-text-secondary mt-2">
          {{ t("slos.alert.shortIsLongOverTwelve") }}
        </p>
      </div>

      <div class="grid grid-cols-[7rem_1fr] items-center gap-3">
        <span class="text-negative font-medium">{{ t("slos.alert.criticalIf") }}</span>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("slos.alert.burnRate") }}</span>
          <OSelect v-model="model.operator" :options="operatorOptions" class="w-20" />
          <OInput v-model.number="model.critical" type="number" step="0.1" class="w-28" />
          <span>{{ t("slos.alert.inBothWindows") }}</span>
          <OInput
            v-model.number="longHours"
            type="number"
            class="w-24"
            suffix="h"
            :label="t('slos.alert.long')"
            label-inline
          />
          <OInput
            v-model.number="shortMinutes"
            type="number"
            class="w-24"
            suffix="min"
            :label="t('slos.alert.short')"
            label-inline
          />
        </div>

        <span class="text-warning font-medium">{{ t("slos.alert.warningIf") }}</span>
        <div class="flex items-center gap-2">
          <span>{{ t("slos.alert.burnRate") }}</span>
          <!-- Shares the operator with critical (T-2): two operators would
               allow a warning band that is not a subset of critical. -->
          <span class="font-mono">{{ model.operator }}</span>
          <OInput
            v-model.number="model.warning"
            type="number"
            step="0.1"
            class="w-28"
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
        <div class="flex items-center gap-2">
          <span>{{ t("slos.alert.budgetConsumed") }}</span>
          <OSelect v-model="model.operator" :options="operatorOptions" class="w-20" />
          <OInput v-model.number="model.critical" type="number" step="1" class="w-28" suffix="%" />
        </div>
        <span class="text-warning font-medium">{{ t("slos.alert.warningIf") }}</span>
        <div class="flex items-center gap-2">
          <span>{{ t("slos.alert.budgetConsumed") }}</span>
          <span class="font-mono">{{ model.operator }}</span>
          <OInput
            v-model.number="model.warning"
            type="number"
            step="1"
            class="w-28"
            suffix="%"
            :placeholder="t('slos.alert.none')"
          />
        </div>
      </div>
    </template>

    <OCheckbox
      v-if="selectedSlo && (selectedSlo.group_by?.length ?? 0) > 0"
      v-model="model.multi_alert"
      :label="t('slos.alert.multiAlert')"
      :hint="t('slos.alert.multiAlertHint')"
      data-test="slos-sloalertcondition-multi"
    />

    <!-- Stated, not omitted: someone will look for the count row that every
         other alert family has, and its absence needs a reason. -->
    <OBanner variant="info" icon="block" :title="t('slos.alert.noCountGate')">
      {{ t("slos.alert.noCountGateBody") }}
    </OBanner>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import sloService from "@/services/slos";
import type { Slo } from "@/ts/interfaces/slo";
import { formatTimeToExhaust, formatWindow } from "@/composables/useSloFormat";

const model = defineModel<any>({ required: true });

const { t } = useI18n();
const store = useStore();
const slos = ref<Slo[]>([]);

const org = computed(() => store.state.selectedOrganization?.identifier);

const sloOptions = computed(() =>
  slos.value.map((s) => ({ value: s.id, label: s.name })),
);

const selectedSlo = computed(() => slos.value.find((s) => s.id === model.value.slo_id) || null);

const kindOptions = computed(() => [
  { value: "burn_rate", label: t("slos.alert.kind.burnRate"), icon: "local_fire_department" },
  { value: "error_budget", label: t("slos.alert.kind.errorBudget"), icon: "data_usage" },
]);

const operatorOptions = [
  // Ascending-orderable only (SA-5): `<` on a burn rate would mean "alert when
  // things are going WELL", which is never what anyone configures on purpose.
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
];

const windowLabel = computed(() =>
  selectedSlo.value ? formatWindow(selectedSlo.value.window_secs) : "30d",
);

/** Datadog's published suggested rows, per window (§6b.6a).
 *
 *  These are not arbitrary: each threshold is the burn rate that consumes the
 *  stated fraction of the budget over the long window, which is what makes
 *  "×14.4" mean something. */
const PRESETS: Record<number, Array<[string, number, number, number, number]>> = {
  // window days -> [key/label, threshold, longSecs, shortSecs, budget %]
  7: [
    ["fast", 16.8, 3600, 300, 2],
    ["mid", 5.6, 21600, 1800, 5],
    ["slow", 2.8, 86400, 7200, 10],
  ],
  30: [
    ["fast", 14.4, 3600, 300, 2],
    ["mid", 6, 21600, 1800, 5],
    ["slow", 3, 86400, 7200, 10],
  ],
  90: [
    ["fast", 21.6, 3600, 300, 2],
    ["mid", 10.8, 21600, 1800, 5],
    ["slow", 4.5, 86400, 7200, 10],
  ],
};

const presets = computed(() => {
  const days = Math.round((selectedSlo.value?.window_secs ?? 30 * 86400) / 86400);
  const rows = PRESETS[days] ?? PRESETS[30];
  const labels: Record<string, string> = {
    fast: t("slos.alert.preset.fast"),
    mid: t("slos.alert.preset.mid"),
    slow: t("slos.alert.preset.slow"),
  };
  return rows.map(([key, threshold, longSecs, shortSecs, budgetPct]) => ({
    key: key as string,
    label: labels[key as string],
    threshold,
    longSecs,
    shortSecs,
    budgetPct,
    longLabel: longSecs >= 3600 ? `${longSecs / 3600}h` : `${longSecs / 60}m`,
    shortLabel: shortSecs >= 3600 ? `${shortSecs / 3600}h` : `${shortSecs / 60}m`,
  }));
});

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
  get: () => (model.value.long_window_secs ?? 3600) / 3600,
  set: (v: number) => {
    model.value.long_window_secs = Math.round((Number(v) || 1) * 3600);
  },
});

const shortMinutes = computed({
  get: () => (model.value.short_window_secs ?? 300) / 60,
  set: (v: number) => {
    model.value.short_window_secs = Math.round((Number(v) || 5) * 60);
  },
});

/** The SA-6 cap: an SLI of 0% cannot burn faster than 1/(1−target). A
 *  threshold above this can never fire, which is worth saying out loud. */
const maxBurn = computed(() => {
  const target = selectedSlo.value?.target;
  if (!target || target <= 0 || target >= 100) return "—";
  return Math.round(1 / (1 - target / 100));
});

const defaultShortLabel = computed(() => {
  const long = model.value.long_window_secs ?? 3600;
  return `${Math.round(long / 12 / 60)} min`;
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
watch(
  () => model.value.kind,
  (kind) => {
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
  if (!org.value) return;
  const res = await sloService.list(org.value);
  slos.value = res.data?.list ?? [];
});
</script>
