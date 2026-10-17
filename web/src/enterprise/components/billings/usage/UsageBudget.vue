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
  The Budget tab: how this cycle's spend tracks against a budget, and the budget itself.
  Every figure previews the draft settings, so the effect of a new budget shows before it is saved.
-->
<template>
  <div class="@container/budget flex flex-col gap-3 pb-3" data-test="billings-usagebudget-root">
    <KpiCardRow :columns="4" class="shrink-0" data-test="billings-usagebudget-kpis">
      <UsageKpiCard
        v-for="card in kpiCards"
        :key="card.key"
        :label="card.label"
        :icon="card.icon"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :data-test="`billings-usagebudget-kpi-${card.key}`"
      />
    </KpiCardRow>

    <div
      class="grid items-stretch gap-3 @min-[62rem]/budget:grid-cols-[minmax(0,1.55fr)_minmax(18.75rem,0.85fr)]"
    >
      <!-- ── Spend against budget ─────────────────────────── -->
      <section
        class="border-border-default rounded-default @container/budget-rows flex min-w-0 flex-col overflow-hidden border"
        data-test="billings-usagebudget-spend"
      >
        <UsagePaneHeader :title="t('billing.usageV2.spendAgainstBudget')" :subtitle="cycleHint" />

        <div class="px-4 pt-3 pb-1.5">
          <div class="flex items-baseline gap-2.5">
            <span class="text-text-heading text-xl font-bold tabular-nums">
              {{ formatCost(spent) }}
            </span>
            <span v-if="hasBudget" class="text-text-secondary text-sm tabular-nums">
              {{
                t("billing.usageV2.ofBudget", {
                  budget: formatCost(draftTotal),
                  percent: usedPercent.toFixed(1),
                })
              }}
            </span>
          </div>
          <template v-if="hasBudget">
            <div class="relative mt-2">
              <OProgressBar
                :value="Math.min(usedPercent / 100, 1)"
                :variant="
                  spendTone === 'over' ? 'danger' : spendTone === 'warn' ? 'warning' : 'default'
                "
                data-test="billings-usagebudget-meter"
              />
              <span
                class="bg-text-secondary absolute -top-1 h-4 w-0.5"
                :style="{ left: `calc(${warnPercent}% - 0.0625rem)` }"
                :title="t('billing.usageV2.warnAt')"
                data-test="billings-usagebudget-warn-mark"
              />
            </div>
            <div class="text-text-secondary mt-1.5 flex justify-between text-xs tabular-nums">
              <span>
                {{
                  spent >= draftTotal
                    ? t("billing.usageV2.overBy", { amount: formatCost(spent - draftTotal) })
                    : t("billing.usageV2.leftInBudget", { amount: formatCost(draftTotal - spent) })
                }}
              </span>
              <span>{{ t("billing.usageV2.warnAtPercent", { percent: warnPercentLabel }) }}</span>
            </div>
          </template>
          <p v-else class="text-text-secondary mt-1 text-sm" data-test="billings-usagebudget-unset">
            {{ t("billing.usageV2.setBudgetFirst") }}
          </p>
        </div>

        <!-- Each meter's share of the budget, so an overrun can be traced to what drove it. -->
        <div
          class="grid gap-x-4.5 gap-y-0.5 px-4 pt-1.5 pb-3.5 @min-[25rem]/budget-rows:grid-cols-2"
          data-test="billings-usagebudget-meters"
        >
          <div
            v-for="row in meterRows"
            :key="row.key"
            class="grid min-w-0 grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 py-2"
            :data-test="`billings-usagebudget-meter-${row.key}`"
          >
            <span
              class="rounded-default h-2.5 w-2.5"
              :style="{ backgroundColor: meterColorFor(row.key) }"
            />
            <span class="truncate font-medium">{{ row.label }}</span>
            <span class="text-right font-semibold tabular-nums">{{ formatCost(row.cost) }}</span>
            <OProgressBar
              class="col-span-2 col-start-2"
              size="xs"
              :value="hasBudget ? Math.min(row.cost / draftTotal, 1) : 0"
              :color="meterColorFor(row.key)"
            />
            <span
              class="text-text-secondary col-span-2 col-start-2 flex justify-between gap-2 text-xs whitespace-nowrap tabular-nums"
            >
              <span>
                {{
                  hasBudget
                    ? t("billing.usageV2.shareOfBudget", {
                        percent: ((row.cost / draftTotal) * 100).toFixed(1),
                      })
                    : ""
                }}
              </span>
              <span>{{ t("billing.usageV2.perDay", { cost: formatCost(row.cost / day) }) }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- ── Budget settings ──────────────────────────────── -->
      <section
        class="border-border-default rounded-default flex min-w-0 flex-col overflow-hidden border"
        data-test="billings-usagebudget-settings"
      >
        <UsagePaneHeader :title="t('billing.usageV2.budgetSettings')" :subtitle="cycleLabel" />

        <div class="flex flex-1 flex-col gap-4 p-4">
          <OInput
            :model-value="draftTotal || null"
            type="number"
            size="md"
            prefix="$"
            :label="t('billing.usageV2.budgetAmount')"
            :placeholder="suggestedBudget"
            :help-text="
              projected !== null
                ? t('billing.usageV2.budgetAmountHelp', { amount: formatCost(projected) })
                : undefined
            "
            data-test="billings-usagebudget-total"
            @update:model-value="setTotal"
          />

          <UsageWarnAt
            v-model="warnPercent"
            :budget="draftTotal"
            data-test="billings-usagebudget-warn"
          />

          <div class="border-border-default border-t" />

          <div
            class="border-border-default rounded-default flex items-center gap-3 border px-3 py-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold">{{ t("billing.usageV2.emailAlerts") }}</div>
              <div class="text-text-secondary text-xs">
                {{
                  alertsOn
                    ? t("billing.usageV2.alertsOnHint")
                    : t("billing.usageV2.alertsPausedHint")
                }}
              </div>
            </div>
            <OSwitch
              v-model="alertsOn"
              size="sm"
              :aria-label="t('billing.usageV2.emailAlerts')"
              data-test="billings-usagebudget-alerts"
            />
          </div>

          <OButton
            variant="primary"
            class="mt-auto"
            :disabled="!canSave"
            :loading="saving"
            data-test="billings-usagebudget-save"
            @click="save"
          >
            {{ t("billing.usageV2.saveBudget") }}
          </OButton>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import organizations from "@/services/organizations";
import UsageKpiCard from "./UsageKpiCard.vue";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import UsageWarnAt from "./UsageWarnAt.vue";
import {
  buildMeterRows,
  cycleProgress,
  formatCost,
  formatCycle,
  projectCycleCost,
  splitByUse,
  type MeteringDetails,
} from "./meteringModel";
import { meterColorFor } from "./usageCharts";
import {
  budgetFor,
  budgetReachedDay,
  budgetTone,
  DEFAULT_WARN_PERCENT,
  warnAmountFor,
  warnPercentFor,
  withBudget,
  type BudgetConfig,
} from "./budgetModel";

const props = defineProps<{ details: MeteringDetails | null }>();

const { t } = useI18nTyped();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

// ── Cycle ────────────────────────────────────────────────────────

const spent = computed(() => Number(props.details?.total_cost) || 0);
const progress = computed(() =>
  props.details ? cycleProgress(props.details) : { day: 1, totalDays: 1, elapsed: 0 },
);
const day = computed(() => progress.value.day);
const projected = computed(() => projectCycleCost(props.details));

const cycleLabel = computed(() => (props.details ? formatCycle(props.details, t) : raw("")));
const cycleHint = computed(() =>
  raw(
    `${cycleLabel.value} · ${t("billing.usageV2.cycleDay", {
      day: progress.value.day,
      total: progress.value.totalDays,
    })}`,
  ),
);

const meterRows = computed(() => splitByUse(buildMeterRows(props.details, t)).used);

// ── Saved and draft budget ───────────────────────────────────────

const savedConfigs = ref<BudgetConfig[]>([]);
const saved = computed(() => budgetFor(savedConfigs.value, orgId.value));

const draftTotal = ref(0);
/** The percent is the source of truth for the warn line, so a new budget keeps the same share. */
const warnPercent = ref(DEFAULT_WARN_PERCENT);
const alertsOn = ref(true);
const saving = ref(false);

const resetDraft = () => {
  const config = saved.value;
  draftTotal.value = config?.total_budget_amount ?? 0;
  warnPercent.value = config
    ? warnPercentFor(config.warn_at_amount, config.total_budget_amount)
    : DEFAULT_WARN_PERCENT;
  alertsOn.value = config ? !config.paused : true;
};

const loadSettings = async () => {
  try {
    const res = await organizations.get_organization_settings(orgId.value);
    savedConfigs.value = res?.data?.data?.budget_config ?? [];
  } catch {
    savedConfigs.value = [];
  }
  resetDraft();
};

onMounted(loadSettings);
watch(orgId, loadSettings);

const hasBudget = computed(() => draftTotal.value > 0);
const warnAmount = computed(() => warnAmountFor(warnPercent.value, draftTotal.value));
/** One decimal at most, so 80 reads "80" and a typed dollar amount still shows its share. */
const warnPercentLabel = computed(() => Math.round(warnPercent.value * 10) / 10);
const usedPercent = computed(() => (hasBudget.value ? (spent.value / draftTotal.value) * 100 : 0));
const spendTone = computed(() => budgetTone(spent.value, draftTotal.value, warnAmount.value));

/** An empty budget field suggests the projected cost, rounded up to a round number. */
const suggestedBudget = computed(() => {
  const base = projected.value ?? spent.value;
  return base > 0 ? String(Math.ceil(base / 10) * 10) : "";
});

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const setTotal = (value: unknown) => {
  draftTotal.value = toNumber(value);
};

const draftEntry = computed<BudgetConfig>(() => ({
  org_id: orgId.value,
  total_budget_amount: draftTotal.value,
  warn_at_amount: warnAmount.value,
  paused: !alertsOn.value,
}));

const dirty = computed(() => {
  const config = saved.value;
  const draft = draftEntry.value;
  if (!config) return draft.total_budget_amount > 0;
  return (
    config.total_budget_amount !== draft.total_budget_amount ||
    Math.abs(config.warn_at_amount - draft.warn_at_amount) >= 0.01 ||
    config.paused !== draft.paused
  );
});

const canSave = computed(() => hasBudget.value && dirty.value && !saving.value);

/** Sends only `budget_config`; the backend leaves every setting it is not sent untouched. */
const save = async () => {
  if (!canSave.value) return;
  saving.value = true;
  const next = withBudget(savedConfigs.value, draftEntry.value);
  try {
    await organizations.post_organization_settings(orgId.value, { budget_config: next });
    savedConfigs.value = next;
    store.dispatch("setOrganizationSettings", {
      ...(store.state?.organizationData?.organizationSettings ?? {}),
      budget_config: next,
    });
    toast({ variant: "success", message: t("billing.usageV2.budgetSaved"), timeout: 4000 });
  } catch (e: any) {
    toast({
      variant: "error",
      message:
        raw(e?.response?.data?.message ?? e?.message) || t("billing.usageV2.budgetSaveFailed"),
      timeout: 5000,
    });
  } finally {
    saving.value = false;
  }
};

// ── KPIs ─────────────────────────────────────────────────────────

const kpiCards = computed(() => {
  const total = draftTotal.value;
  const dash = raw("—");
  const proj = projected.value;
  const projTone =
    proj === null || !hasBudget.value ? undefined : budgetTone(proj, total, warnAmount.value);
  const reached = budgetReachedDay(spent.value, day.value, total, progress.value.totalDays);
  const tone = (value: string | undefined) =>
    value === "over" ? ("danger" as const) : value === "warn" ? ("warn" as const) : undefined;

  const cards: {
    key: string;
    label: I18nText;
    icon: IconName;
    value: I18nText;
    hint: I18nText;
    tone?: "warn" | "danger";
  }[] = [
    {
      key: "budget",
      label: t("billing.usageV2.budgetKpi"),
      icon: "attach-money",
      value: hasBudget.value ? formatCost(total) : t("billing.usageV2.budgetNotSet"),
      hint: t("billing.usageV2.budgetThisCycle"),
    },
    {
      key: "spent",
      label: t("billing.usageV2.costSoFar"),
      icon: "show-chart",
      value: formatCost(spent.value),
      hint: hasBudget.value
        ? t("billing.usageV2.spentOfBudget", {
            percent: usedPercent.value.toFixed(1),
            day: progress.value.day,
            total: progress.value.totalDays,
          })
        : t("billing.usageV2.cycleDay", {
            day: progress.value.day,
            total: progress.value.totalDays,
          }),
      tone: tone(spendTone.value),
    },
    {
      key: "projected",
      label: t("billing.usageV2.projectedTotal"),
      icon: "trending-up",
      value: proj === null ? dash : formatCost(proj),
      hint:
        proj === null
          ? t("billing.usageV2.tooEarlyToProject")
          : !hasBudget.value
            ? raw("")
            : proj > total
              ? t("billing.usageV2.overBudgetBy", { amount: formatCost(proj - total) })
              : t("billing.usageV2.toSpare", { amount: formatCost(total - proj) }),
      tone: tone(projTone),
    },
    {
      key: "reached",
      label: t("billing.usageV2.budgetReached"),
      icon: "bar-chart",
      value: !hasBudget.value
        ? dash
        : reached
          ? t("billing.usageV2.reachedOnDay", { day: reached })
          : t("billing.usageV2.notThisCycle"),
      hint:
        hasBudget.value && reached
          ? t("billing.usageV2.atPacePerDay", { cost: formatCost(spent.value / day.value) })
          : t("billing.usageV2.atCurrentPace"),
      tone: hasBudget.value && reached ? "warn" : undefined,
    },
  ];
  return cards;
});
</script>
