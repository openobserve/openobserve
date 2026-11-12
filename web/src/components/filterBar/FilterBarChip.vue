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

<script setup lang="ts">
import { computed, inject } from "vue";
import OFilterToken from "@/lib/core/Badge/OFilterToken.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { FilterTokenPart } from "@/lib/core/Badge/OFilterToken.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  conditionValueLabel,
  OPERATORS,
  type FilterCondition,
  type FilterDialect,
  type FilterRawNode,
} from "@/utils/query/filterBar";
import { operatorName } from "./useFilterBarEditor";
import { FILTER_BAR_CHIP_CONTEXT } from "./QueryFilterBar.types";

defineOptions({ name: "FilterBarChip" });

const props = withDefaults(
  defineProps<{
    node: FilterCondition | FilterRawNode;
    dialect?: FilterDialect;
    activePart?: FilterTokenPart | null;
    armed?: boolean;
    invalid?: boolean;
    disabled?: boolean;
    /** The bar's prefix; the chip is `-chip-<field>` (free text `-chip-text`, a locked part `-chip-locked`). */
    dataTest: string;
  }>(),
  { dialect: "sql", activePart: null, armed: false, invalid: false, disabled: false },
);

const emit = defineEmits<{
  (_e: "edit", _part: FilterTokenPart, _element: HTMLElement): void;
  (_e: "remove"): void;
}>();

const { t } = useI18nTyped();
const bar = inject(FILTER_BAR_CHIP_CONTEXT, null);

const condition = computed(() => (props.node.kind === "condition" ? props.node : null));

const testKey = computed(() => {
  if (!condition.value) return "locked";
  return condition.value.field || "text";
});

const fieldLabel = computed<I18nText>(() => {
  if (!condition.value) return raw((props.node as FilterRawNode).label);
  const { field } = condition.value;
  if (field) return raw(bar?.fieldLabel(field) ?? field);
  return condition.value.operator === "match_all"
    ? t("filterBar.textField")
    : t("filterBar.chooseField");
});

const operatorLabel = computed<I18nText | undefined>(() =>
  condition.value?.field
    ? (bar?.operatorName(condition.value.operator) ??
      operatorName(condition.value.operator, props.dialect, t))
    : undefined,
);

const valueLabel = computed<I18nText | undefined>(() => {
  const node = condition.value;
  if (!node || OPERATORS[node.operator].arity === "none") return undefined;
  return node.values.length ? raw(conditionValueLabel(node)) : t("filterBar.chooseValue");
});

const valueHint = computed<I18nText | undefined>(() => {
  const node = condition.value;
  return node?.field && node.values.length ? bar?.valueHint(node.field, node.values) : undefined;
});

const invalidMessage = computed(() =>
  props.invalid ? bar?.issueMessage(props.node.id) : undefined,
);
</script>

<template>
  <span v-if="!condition" class="inline-flex max-w-full min-w-0">
    <OFilterToken
      :field="fieldLabel"
      :editable="false"
      :armed="armed"
      :removable="!disabled"
      :remove-label="t('filterBar.removeFilter')"
      :data-test="`${dataTest}-chip-${testKey}`"
      @remove="emit('remove')"
    />
    <OTooltip :content="t('filterBar.lockedFilter')" />
  </span>
  <OFilterToken
    v-else
    :field="fieldLabel"
    :operator="operatorLabel"
    :value="valueLabel"
    :active-part="activePart"
    :armed="armed"
    :invalid="invalid"
    :invalid-message="invalidMessage"
    :value-hint="valueHint"
    :editable="!disabled"
    :removable="!disabled"
    :remove-label="t('filterBar.removeFilter')"
    :data-test="`${dataTest}-chip-${testKey}`"
    @select="(part, element) => emit('edit', part, element)"
    @remove="emit('remove')"
  />
</template>
