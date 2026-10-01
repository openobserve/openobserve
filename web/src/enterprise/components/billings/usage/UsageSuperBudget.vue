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
  The Budget tab of a super org: one overall budget for the whole group's bill, saved
  under org_id "total", and a budget per org, the super org included, under its own id.
  Every edit is a draft until the save bar commits them all in one request.
-->
<template>
  <div
    class="@container/super-budget flex h-full min-h-0 flex-col gap-3 overflow-y-auto"
    data-test="billings-usagesuperbudget-root"
  >
    <!-- Wide: only the org table scrolls, so the save bar stays in view. Stacked: the tab scrolls. -->
    <KpiCardRow :columns="4" class="shrink-0" data-test="billings-usagesuperbudget-kpis">
      <UsageKpiCard
        v-for="card in kpiCards"
        :key="card.key"
        :label="card.label"
        :icon="card.icon"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :data-test="`billings-usagesuperbudget-kpi-${card.key}`"
      />
    </KpiCardRow>

    <div
      class="grid items-stretch gap-3 @min-[62rem]/super-budget:min-h-0 @min-[62rem]/super-budget:flex-1 @min-[62rem]/super-budget:grid-cols-[minmax(0,1.55fr)_minmax(18.75rem,0.85fr)]"
    >
      <!-- ── Organizations: reports each org's spend and edits its budget ── -->
      <section
        class="border-border-default rounded-default flex min-h-0 min-w-0 flex-col overflow-hidden border"
        data-test="billings-usagesuperbudget-orgs"
      >
        <UsagePaneHeader
          :title="t('billing.usageV2.organizationsTitle')"
          :subtitle="t('billing.usageV2.orgCountThisCycle', { count: billingOrgs.length })"
        />

        <div class="shrink-0 px-4 pt-3 pb-1.5">
          <div class="flex items-baseline gap-2.5">
            <span class="text-text-heading text-xl font-bold tabular-nums">
              {{ formatCost(spent) }}
            </span>
            <span v-if="totalDraft.budget > 0" class="text-text-secondary text-sm tabular-nums">
              {{
                t("billing.usageV2.ofBudget", {
                  budget: formatCost(totalDraft.budget),
                  percent: usedPercent.toFixed(1),
                })
              }}
            </span>
          </div>
          <template v-if="totalDraft.budget > 0">
            <div class="relative mt-2">
              <OProgressBar
                :value="Math.min(usedPercent / 100, 1)"
                :variant="progressVariant(totalStatus)"
                data-test="billings-usagesuperbudget-meter"
              />
              <span
                class="bg-text-secondary absolute -top-1 h-4 w-0.5"
                :style="{ left: `calc(${totalDraft.warnPercent}% - 0.0625rem)` }"
                :title="t('billing.usageV2.warnAt')"
              />
            </div>
            <div class="text-text-secondary mt-1.5 flex justify-between text-xs tabular-nums">
              <span>
                {{
                  spent >= totalDraft.budget
                    ? t("billing.usageV2.overBy", { amount: formatCost(spent - totalDraft.budget) })
                    : t("billing.usageV2.leftInBudget", {
                        amount: formatCost(totalDraft.budget - spent),
                      })
                }}
              </span>
              <span>{{
                t("billing.usageV2.warnAtPercent", { percent: percentLabel(totalDraft) })
              }}</span>
            </div>
          </template>
          <p v-else class="text-text-secondary mt-1 text-sm">
            {{ t("billing.usageV2.setBudgetFirst") }}
          </p>
        </div>

        <OTable
          :data="orgRows"
          :columns="columns"
          row-key="id"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          :default-columns="false"
          :loading="costsLoading"
          dense
          class="min-h-0 flex-1"
          data-test="billings-usagesuperbudget-table"
        >
          <template #cell-name="{ row }">
            <span class="truncate font-medium">{{ row.label }}</span>
          </template>
          <template #cell-spend="{ row }">
            <!-- Hovering the spend shows what makes it up, meter by meter. -->
            <OTooltip side="bottom" align="start" :delay="150" :disabled="!row.meters.length">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold tabular-nums">
                    {{ costsFailed ? EM_DASH : formatCost(row.spend) }}
                  </span>
                  <span
                    v-if="row.draft.budget > 0 && !costsFailed"
                    class="text-text-secondary text-xs tabular-nums"
                  >
                    {{ Math.round((row.spend / row.draft.budget) * 100) }}%
                  </span>
                  <OBadge
                    v-if="!costsFailed"
                    :variant="STATUS_BADGE[row.status]"
                    size="sm"
                    :data-test="`billings-usagesuperbudget-status-${row.id}`"
                  >
                    {{ t(STATUS_LABEL[row.status]) }}
                  </OBadge>
                </div>
                <OProgressBar
                  v-if="row.draft.budget > 0 && !costsFailed"
                  size="xs"
                  class="max-w-40"
                  :value="Math.min(row.spend / row.draft.budget, 1)"
                  :variant="progressVariant(row.status)"
                />
              </div>
              <template #content>
                <div
                  class="flex min-w-48 flex-col gap-1 text-xs"
                  :data-test="`billings-usagesuperbudget-spend-tip-${row.id}`"
                >
                  <div class="font-semibold">{{ row.label }}</div>
                  <div
                    v-for="meter in row.meters"
                    :key="meter.key"
                    class="flex justify-between gap-4"
                  >
                    <span class="flex items-center gap-1.5">
                      <span
                        class="rounded-default h-2 w-2 shrink-0"
                        :style="{ backgroundColor: meterColorFor(meter.key) }"
                      />
                      {{ meter.label }}
                    </span>
                    <span class="tabular-nums">{{ formatCost(meter.cost) }}</span>
                  </div>
                  <div class="flex justify-between gap-4 border-t pt-1 font-semibold">
                    <span>{{ t("billing.usageV2.colTotal") }}</span>
                    <span class="tabular-nums">{{ formatCost(row.spend) }}</span>
                  </div>
                </div>
              </template>
            </OTooltip>
          </template>
          <template #cell-budget="{ row }">
            <div class="w-28">
              <OInput
                :model-value="row.draft.budget || null"
                type="number"
                size="sm"
                prefix="$"
                placeholder="0.00"
                :aria-label="t('billing.usageV2.budgetFor', { org: row.label })"
                :data-test="`billings-usagesuperbudget-budget-${row.id}`"
                @update:model-value="setOrgBudget(row.id, $event)"
              />
            </div>
          </template>
          <template #cell-warn="{ row }">
            <div class="flex items-center gap-2">
              <div class="w-20">
                <OInput
                  :model-value="row.draft.budget > 0 ? percentLabel(row.draft) : null"
                  type="number"
                  size="sm"
                  suffix="%"
                  :disabled="row.draft.budget <= 0"
                  :aria-label="t('billing.usageV2.warnPercentFor', { org: row.label })"
                  :data-test="`billings-usagesuperbudget-warn-${row.id}`"
                  @update:model-value="setOrgWarn(row.id, $event)"
                />
              </div>
              <span
                v-if="row.draft.budget > 0"
                class="text-text-secondary text-xs whitespace-nowrap tabular-nums"
              >
                {{ formatCost(warnAmountFor(row.draft.warnPercent, row.draft.budget)) }}
              </span>
            </div>
          </template>
          <template #cell-alerts="{ row }">
            <OSwitch
              :model-value="row.draft.alertsOn"
              size="sm"
              :disabled="row.draft.budget <= 0"
              :aria-label="t('billing.usageV2.alertsFor', { org: row.label })"
              :data-test="`billings-usagesuperbudget-alerts-${row.id}`"
              @update:model-value="setOrgAlerts(row.id, $event)"
            />
          </template>
        </OTable>
      </section>

      <!-- ── Budget settings: the whole group's budget ── -->
      <section
        class="border-border-default rounded-default flex min-h-0 min-w-0 flex-col overflow-y-auto border"
        data-test="billings-usagesuperbudget-settings"
      >
        <UsagePaneHeader
          :title="t('billing.usageV2.budgetSettings')"
          :subtitle="t('billing.usageV2.appliesToGroup')"
        />
        <div class="flex flex-1 flex-col gap-4 p-4">
          <OInput
            :model-value="totalDraft.budget || null"
            type="number"
            size="md"
            prefix="$"
            :label="t('billing.usageV2.overallBudgetLabel')"
            :help-text="allocationNote"
            data-test="billings-usagesuperbudget-total"
            @update:model-value="totalDraft.budget = toNumber($event)"
          />

          <UsageWarnAt
            v-model="totalDraft.warnPercent"
            :budget="totalDraft.budget"
            data-test="billings-usagesuperbudget-total-warn"
          />

          <div class="border-border-default border-t" />

          <div
            class="border-border-default rounded-default flex items-center gap-3 border px-3 py-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold">{{ t("billing.usageV2.emailAlerts") }}</div>
              <div class="text-text-secondary text-xs">
                {{
                  totalDraft.alertsOn
                    ? t("billing.usageV2.groupAlertsOnHint")
                    : t("billing.usageV2.alertsPausedHint")
                }}
              </div>
            </div>
            <OSwitch
              v-model="totalDraft.alertsOn"
              size="sm"
              :disabled="totalDraft.budget <= 0"
              :aria-label="t('billing.usageV2.emailAlerts')"
              data-test="billings-usagesuperbudget-total-alerts"
            />
          </div>
        </div>
      </section>
    </div>

    <!-- One bar commits every pending edit; it stays put and only disables when clean. -->
    <div
      class="border-border-default rounded-default bg-surface-subtle flex shrink-0 items-center gap-3 border px-4 py-2.5"
      data-test="billings-usagesuperbudget-savebar"
    >
      <span class="text-text-secondary min-w-0 flex-1 truncate text-sm">{{ pendingText }}</span>
      <OButton
        variant="outline"
        :disabled="!pending.any || saving"
        data-test="billings-usagesuperbudget-discard"
        @click="resetDrafts"
      >
        {{ t("billing.usageV2.discard") }}
      </OButton>
      <OButton
        variant="primary"
        :disabled="!pending.any"
        :loading="saving"
        data-test="billings-usagesuperbudget-save"
        @click="save"
      >
        {{ t("billing.usageV2.saveChanges") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRef, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import organizations from "@/services/organizations";
import UsageKpiCard from "./UsageKpiCard.vue";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import UsageWarnAt from "./UsageWarnAt.vue";
import {
  cycleProgress,
  formatCost,
  METERS,
  projectCycleCost,
  type BillingOrg,
  type MeterKey,
  type MeteringDetails,
} from "./meteringModel";
import {
  budgetFor,
  budgetStatus,
  clampPercent,
  draftOf,
  sameBudget,
  superBudgetConfigs,
  TOTAL_BUDGET_ID,
  warnAmountFor,
  type BudgetConfig,
  type BudgetDraft,
  type BudgetStatus,
} from "./budgetModel";
import { useOrgCosts } from "./useOrgCosts";
import { meterColorFor } from "./usageCharts";

const props = defineProps<{
  details: MeteringDetails | null;
  /** The super org first, then its members. */
  billingOrgs: BillingOrg[];
}>();

const { t } = useI18nTyped();
const store = useStore();

const EM_DASH = raw("—");

const STATUS_LABEL: Record<BudgetStatus, I18nKey> = {
  none: "billing.usageV2.statusNone",
  ok: "billing.usageV2.statusOk",
  warn: "billing.usageV2.statusWarn",
  over: "billing.usageV2.statusOver",
};

const STATUS_BADGE: Record<BudgetStatus, BadgeVariant> = {
  none: "default-soft",
  ok: "success-soft",
  warn: "warning-soft",
  over: "error-soft",
};

const progressVariant = (status: BudgetStatus) =>
  status === "over" ? "danger" : status === "warn" ? "warning" : "default";

const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

// ── Spend ────────────────────────────────────────────────────────

const {
  costs,
  loading: costsLoading,
  failed: costsFailed,
} = useOrgCosts(toRef(props, "details"), toRef(props, "billingOrgs"), ref(0));

/** The whole group's bill, which the overall budget is measured against. */
const spent = computed(() => Number(props.details?.total_cost) || 0);
const progress = computed(() =>
  props.details ? cycleProgress(props.details) : { day: 1, totalDays: 1, elapsed: 0 },
);
const projected = computed(() => projectCycleCost(props.details));

// ── Saved and draft budgets ──────────────────────────────────────

const saved = ref<BudgetConfig[]>([]);
const totalDraft = reactive<BudgetDraft>(draftOf(null));
const orgDrafts = reactive<Record<string, BudgetDraft>>({});
const saving = ref(false);

const savedDraft = (id: string) => draftOf(budgetFor(saved.value, id));

const resetDrafts = () => {
  Object.assign(totalDraft, savedDraft(TOTAL_BUDGET_ID));
  for (const key of Object.keys(orgDrafts)) delete orgDrafts[key];
  for (const org of props.billingOrgs) orgDrafts[org.id] = savedDraft(org.id);
};

const load = async () => {
  try {
    const res = await organizations.get_organization_settings(orgId.value);
    saved.value = res?.data?.data?.budget_config ?? [];
  } catch {
    saved.value = [];
  }
  resetDrafts();
};

watch([orgId, () => props.billingOrgs.map((org) => org.id).join(",")], load, {
  immediate: true,
});

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const percentLabel = (draft: BudgetDraft) => Math.round(draft.warnPercent * 10) / 10;

const setOrgBudget = (id: string, value: unknown) => {
  if (orgDrafts[id]) orgDrafts[id].budget = toNumber(value);
};
const setOrgWarn = (id: string, value: unknown) => {
  if (orgDrafts[id]) orgDrafts[id].warnPercent = clampPercent(toNumber(value));
};
const setOrgAlerts = (id: string, value: unknown) => {
  if (orgDrafts[id]) orgDrafts[id].alertsOn = !!value;
};

// ── Rows ─────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  label: I18nText;
  spend: number;
  /** Spend per meter, priciest first, for the spend tooltip. */
  meters: { key: MeterKey; label: I18nText; cost: number }[];
  draft: BudgetDraft;
  status: BudgetStatus;
}

const orgRows = computed<OrgRow[]>(() =>
  props.billingOrgs.map((org) => {
    const draft = orgDrafts[org.id] ?? draftOf(null);
    const spend = costs.value[org.id]?.billed ?? 0;
    const byMeter = costs.value[org.id]?.byMeter ?? {};
    return {
      id: org.id,
      label: org.isSelf ? t("billing.usageV2.thisOrg", { org: org.name }) : raw(org.name),
      spend,
      meters: METERS.filter((def) => (byMeter[def.key] ?? 0) > 0)
        .map((def) => ({ key: def.key, label: t(def.labelKey), cost: byMeter[def.key] ?? 0 }))
        .sort((x, y) => y.cost - x.cost),
      draft,
      status: budgetStatus(spend, draft.budget, warnAmountFor(draft.warnPercent, draft.budget)),
    };
  }),
);

const columns = computed<OTableColumnDef<OrgRow>[]>(() => [
  {
    id: "name",
    header: t("billing.usageV2.colOrganization"),
    accessorKey: "label",
    meta: { isName: true, autoWidth: true },
    minSize: 160,
  },
  { id: "spend", header: t("billing.usageV2.colSpendThisCycle"), accessorKey: "spend", size: 220 },
  { id: "budget", header: t("billing.usageV2.colBudget"), accessorKey: "id", size: 132 },
  { id: "warn", header: t("billing.usageV2.warnAt"), accessorKey: "id", size: 170 },
  { id: "alerts", header: t("billing.usageV2.colAlerts"), accessorKey: "id", size: 76 },
]);

const totalWarnAt = computed(() => warnAmountFor(totalDraft.warnPercent, totalDraft.budget));
const totalStatus = computed(() => budgetStatus(spent.value, totalDraft.budget, totalWarnAt.value));
const usedPercent = computed(() =>
  totalDraft.budget > 0 ? (spent.value / totalDraft.budget) * 100 : 0,
);

/** Org budgets are separate limits, so their sum may exceed the overall budget; the page says so. */
const allocationNote = computed(() => {
  const allocated = Object.values(orgDrafts).reduce((sum, draft) => sum + draft.budget, 0);
  if (allocated <= 0) return undefined;
  return allocated > totalDraft.budget && totalDraft.budget > 0
    ? t("billing.usageV2.orgBudgetsOver", {
        amount: formatCost(allocated),
        over: formatCost(allocated - totalDraft.budget),
      })
    : t("billing.usageV2.orgBudgetsTotal", { amount: formatCost(allocated) });
});

// ── Save ─────────────────────────────────────────────────────────

const pending = computed(() => {
  const orgs = props.billingOrgs.filter(
    (org) => orgDrafts[org.id] && !sameBudget(orgDrafts[org.id], savedDraft(org.id)),
  ).length;
  const overall = !sameBudget(totalDraft, savedDraft(TOTAL_BUDGET_ID));
  return { orgs, overall, any: orgs > 0 || overall };
});

const pendingText = computed(() => {
  const p = pending.value;
  if (!p.any) return t("billing.usageV2.allChangesSaved");
  const parts: string[] = [];
  if (p.orgs) parts.push(String(t("billing.usageV2.unsavedOrgs", { count: p.orgs })));
  if (p.overall) parts.push(String(t("billing.usageV2.unsavedOverall")));
  return t("billing.usageV2.unsavedChanges", { parts: raw(parts.join(" · ")) });
});

/** Sends only `budget_config`: the whole array, since it replaces what is stored. */
const save = async () => {
  if (!pending.value.any) return;
  saving.value = true;
  const next = superBudgetConfigs(
    { ...totalDraft },
    Object.fromEntries(props.billingOrgs.map((org) => [org.id, { ...orgDrafts[org.id] }])),
  );
  try {
    await organizations.post_organization_settings(orgId.value, { budget_config: next });
    saved.value = next;
    resetDrafts();
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
  const total = totalDraft.budget;
  const tone = (status: BudgetStatus) =>
    status === "over" ? ("danger" as const) : status === "warn" ? ("warn" as const) : undefined;
  const proj = projected.value;
  const over = orgRows.value.filter((row) => row.status === "over").length;
  const near = orgRows.value.filter((row) => row.status === "warn").length;

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
      label: t("billing.usageV2.overallBudget"),
      icon: "attach-money",
      value: total > 0 ? formatCost(total) : t("billing.usageV2.budgetNotSet"),
      hint: t("billing.usageV2.budgetThisCycle"),
    },
    {
      key: "spent",
      label: t("billing.usageV2.costSoFar"),
      icon: "show-chart",
      value: formatCost(spent.value),
      hint:
        total > 0
          ? t("billing.usageV2.spentOfBudget", {
              percent: usedPercent.value.toFixed(1),
              day: progress.value.day,
              total: progress.value.totalDays,
            })
          : t("billing.usageV2.cycleDay", {
              day: progress.value.day,
              total: progress.value.totalDays,
            }),
      tone: tone(totalStatus.value),
    },
    {
      key: "projected",
      label: t("billing.usageV2.projectedTotal"),
      icon: "trending-up",
      value: proj === null ? EM_DASH : formatCost(proj),
      hint:
        proj === null
          ? t("billing.usageV2.tooEarlyToProject")
          : total <= 0
            ? raw("")
            : proj > total
              ? t("billing.usageV2.overBudgetBy", { amount: formatCost(proj - total) })
              : t("billing.usageV2.toSpare", { amount: formatCost(total - proj) }),
      tone: proj === null ? undefined : tone(budgetStatus(proj, total, totalWarnAt.value)),
    },
    {
      key: "attention",
      label: t("billing.usageV2.needsAttention"),
      icon: "warning",
      value: costsFailed.value ? EM_DASH : raw(String(over + near)),
      hint: t("billing.usageV2.attentionHint", { over, near }),
      tone: costsFailed.value ? undefined : over ? "danger" : near ? "warn" : undefined,
    },
  ];
  return cards;
});
</script>
