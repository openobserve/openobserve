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
  A budget's warn line as two linked fields, "80 % = $36.00": type either one and the
  other follows. The percent is the model, so a new budget keeps the same share.
-->
<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-xs font-semibold">{{ t("billing.usageV2.warnAt") }}</span>
    <!-- OInput sizes to its parent, so each field gets its own grid cell. -->
    <div class="grid grid-cols-[6.5rem_auto_minmax(0,1fr)] items-center gap-2">
      <div class="min-w-0">
        <OInput
          :model-value="hasBudget ? percentLabel : null"
          type="number"
          size="md"
          suffix="%"
          :disabled="!hasBudget"
          :aria-label="t('billing.usageV2.warnPercent')"
          :data-test="`${dataTest}-percent`"
          @update:model-value="setPercent"
        />
      </div>
      <span class="text-text-secondary text-sm" aria-hidden="true">=</span>
      <div class="min-w-0">
        <OInput
          :model-value="hasBudget ? amount : null"
          type="number"
          size="md"
          prefix="$"
          :disabled="!hasBudget"
          :aria-label="t('billing.usageV2.warnAmount')"
          :data-test="`${dataTest}-amount`"
          @update:model-value="setAmount"
        />
      </div>
    </div>
    <span v-if="hasBudget" class="text-text-secondary text-xs">
      {{ t("billing.usageV2.warnHelp", { amount: formatCost(amount) }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OInput from "@/lib/forms/Input/OInput.vue";
import { formatCost } from "./meteringModel";
import { clampPercent, warnAmountFor, warnPercentFor } from "./budgetModel";

const props = defineProps<{
  /** The budget the warn line is a share of. */
  budget: number;
  dataTest: string;
}>();

/** Percent of the budget, 0 to 100. */
const percent = defineModel<number>({ required: true });

const { t } = useI18nTyped();

const hasBudget = computed(() => props.budget > 0);
const amount = computed(() => warnAmountFor(percent.value, props.budget));
/** One decimal at most, so 80 reads "80" and a typed dollar amount still shows its share. */
const percentLabel = computed(() => Math.round(percent.value * 10) / 10);

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const setPercent = (value: unknown) => {
  percent.value = clampPercent(toNumber(value));
};
const setAmount = (value: unknown) => {
  percent.value = warnPercentFor(toNumber(value), props.budget);
};
</script>
