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

<!-- Budget fields are the parent form's (`dailyBudgetUsd`, `budgetAction`), bound by name. -->
<template>
  <section
    class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
    data-test="job-form-cost-section"
  >
    <div class="border-border-default flex items-center gap-2 border-b px-3 py-2.5">
      <div class="rounded-default bg-theme-accent h-4 w-0.75 shrink-0" />
      <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">{{
        t("evalSpend.cost.title")
      }}</span>
      <span class="text-2xs text-text-secondary">{{ t("evalSpend.cost.basis") }}</span>
    </div>
    <div class="flex flex-col gap-3 px-4 py-3.5">
      <div class="grid grid-cols-3 gap-2.5 max-[68.75rem]:grid-cols-1">
        <div
          v-for="tile in tiles"
          :key="tile.id"
          class="rounded-default border-border-default bg-surface-base flex flex-col gap-1 border px-3.5 py-2.5"
          :data-test="`job-form-cost-${tile.id}`"
        >
          <span class="text-2xs text-text-secondary font-semibold">{{ tile.label }}</span>
          <span class="text-text-heading text-lg leading-none font-bold tabular-nums">{{
            tile.value
          }}</span>
          <span v-if="tile.id === 'perDay' && unpricedJudge" class="text-2xs">
            <router-link
              :to="pricingRoute"
              class="text-accent font-semibold no-underline hover:underline"
              data-test="job-form-cost-pricing-link"
            >
              {{ t("evalSpend.cost.setPrice") }}
            </router-link>
          </span>
          <span v-else-if="tile.note" class="text-2xs text-text-secondary">{{ tile.note }}</span>
        </div>
      </div>

      <OFormSwitch
        name="budgetEnabled"
        :label="t('evalSpend.budget.enabled')"
        size="sm"
        data-test="job-form-budget-enabled"
      />
      <div v-if="budgetEnabled" class="grid grid-cols-2 gap-3.5 max-[68.75rem]:grid-cols-1">
        <OFormInput
          name="dailyBudgetUsd"
          :label="t('evalSpend.budget.label')"
          type="number"
          min="0.01"
          step="0.01"
          size="sm"
          required
          :help-text="t('evalSpend.budget.help', { amount: formatUsd(DEFAULT_DAILY_BUDGET_USD) })"
          data-test="job-form-daily-budget-input"
        />
        <OFormRadioGroup
          name="budgetAction"
          :label="t('evalSpend.budget.onReach')"
          data-test="job-form-budget-action"
        >
          <ORadio
            v-for="action in ACTIONS"
            :key="action"
            :value="action"
            size="sm"
            :data-test="`job-form-budget-action-${action}`"
          >
            <template #label>
              <span class="flex flex-col gap-0.5">
                <span>{{ t(`evalSpend.budget.actions.${action}.label`) }}</span>
                <span class="text-2xs text-text-secondary">{{
                  t(`evalSpend.budget.actions.${action}.help`)
                }}</span>
              </span>
            </template>
          </ORadio>
        </OFormRadioGroup>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import { formatTokens } from "@/utils/llmUtils";
import { pricingGapsRoute } from "@/plugins/traces/llmDataTrust.utils";
import type { EvalBudgetAction, EvalTargetScope } from "@/services/online-evals.service";
import { DEFAULT_DAILY_BUDGET_USD, formatUsd, type SpendEstimate } from "../../utils/evalSpend";

const props = defineProps<{
  estimate: SpendEstimate;
  loading: boolean;
  rate: number;
  scope: EvalTargetScope;
  /** Whether any selected scorer is an LLM judge; other scorers cost nothing. */
  hasJudges: boolean;
  orgId: string;
  /** Whether the job has a daily budget; without one the limit fields are hidden. */
  budgetEnabled: boolean;
}>();

const { t } = useI18nTyped();
const ACTIONS: EvalBudgetAction[] = ["pause", "keep_running"];

// A judge whose calls were all unpriced needs a price; one that never ran has nothing to go on yet.
const unpricedJudge = computed(
  () =>
    props.hasJudges &&
    props.estimate.perTargetUsd == null &&
    props.estimate.judgeGap === "unpriced",
);
const pricingRoute = computed(() => pricingGapsRoute("_evaluator", props.orgId));
const count = (n: number) => Math.round(n).toLocaleString();

const tiles = computed<{ id: string; label: I18nText; value: string; note?: I18nText }[]>(() => {
  const e = props.estimate;
  const pending = props.loading ? "…" : null;
  const scope = t(`evalSpend.cost.scopes.${props.scope}`);
  // Without an LLM judge the estimate is $0; with an unpriced one it is null.
  const cost = (usd: number | null) =>
    pending ?? (usd == null ? t("evalSpend.cost.cannot") : formatUsd(usd));
  return [
    {
      id: "scored",
      label: t("evalSpend.cost.scored"),
      value:
        pending ??
        (e.scoredPerDay == null ? t("evalSpend.cost.cannot") : `≈ ${count(e.scoredPerDay)}`),
      note:
        e.matchedPerDay == null
          ? undefined
          : t("evalSpend.cost.scoredNote", {
              percent: Math.round(props.rate * 1000) / 10,
              n: count(e.matchedPerDay),
              scope,
            }),
    },
    {
      id: "perDay",
      label: t("evalSpend.cost.perDay"),
      value: cost(e.perDayUsd),
      note: !props.hasJudges
        ? t("evalSpend.cost.noJudge")
        : e.busiestDayUsd != null
          ? t("evalSpend.cost.busiest", { amount: formatUsd(e.busiestDayUsd) })
          : e.perTargetUsd == null && e.judgeGap === "noCalls"
            ? t("evalSpend.cost.noCalls")
            : undefined,
    },
    {
      id: "perTarget",
      label: t("evalSpend.cost.perTarget", { scope: t(`evalSpend.cost.scope.${props.scope}`) }),
      value: cost(e.perTargetUsd),
      note:
        e.tokensPerTarget != null && e.model
          ? t("evalSpend.cost.tokens", {
              tokens: formatTokens(Math.round(e.tokensPerTarget)),
              model: e.model,
            })
          : undefined,
    },
  ];
});
</script>
