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
import OTag from "@/lib/core/Badge/OTag.vue";
import OFilterToken from "@/lib/core/Badge/OFilterToken.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { conditionValueLabel, OPERATORS, type FilterCondition } from "@/utils/query/filterBar";
import type { FilterBarNodesEmits, FilterBarNodesProps } from "./QueryFilterBar.types";

defineOptions({ name: "FilterBarNodes" });

withDefaults(defineProps<FilterBarNodesProps>(), {
  editingId: null,
  editPart: null,
  armedId: null,
  openGroupId: null,
});
const emit = defineEmits<FilterBarNodesEmits>();

const { t } = useI18nTyped();

const testKey = (condition: FilterCondition) => condition.field || "text";

const fieldLabel = (condition: FilterCondition): I18nText =>
  condition.field ? raw(condition.field) : t("filterBar.textField");

// Symbols read the same in every language; word operators show their translated label.
const operatorLabel = (condition: FilterCondition): I18nText | undefined => {
  if (!condition.field) return undefined;
  const op = OPERATORS[condition.operator];
  return /^[a-z ]+$/.test(op.symbol) ? t(op.labelKey) : raw(op.symbol);
};

const valueLabel = (condition: FilterCondition): I18nText | undefined =>
  OPERATORS[condition.operator].arity === "none" ? undefined : raw(conditionValueLabel(condition));
</script>

<template>
  <template v-for="(item, index) in items" :key="item.id">
    <OTag
      v-if="connectors && index > 0"
      clickable
      size="sm"
      variant="default-outline"
      :label="raw(item.connector)"
      :aria-label="t('filterBar.toggleConnector')"
      :data-test="`${dataTest}-connector-${index}`"
      @click.stop="emit('toggle-connector', item.id)"
    />
    <OFilterToken
      v-if="item.kind === 'condition'"
      :field="fieldLabel(item)"
      :operator="operatorLabel(item)"
      :value="valueLabel(item)"
      :active-part="item.id === editingId ? (editPart ?? 'value') : null"
      :armed="item.id === armedId"
      removable
      :remove-label="t('filterBar.removeFilter')"
      :data-test="`${dataTest}-chip-${testKey(item)}`"
      @select="(part, element) => emit('edit', item.id, part, element)"
      @remove="emit('remove', item.id)"
    />
    <template v-else>
      <span class="text-text-secondary font-mono text-sm" aria-hidden="true">{{ raw("(") }}</span>
      <FilterBarNodes
        :items="item.items"
        :connectors="connectors"
        :editing-id="editingId"
        :edit-part="editPart"
        :armed-id="armedId"
        :open-group-id="openGroupId"
        :data-test="dataTest"
        @edit="(id, part, element) => emit('edit', id, part, element)"
        @remove="emit('remove', $event)"
        @toggle-connector="emit('toggle-connector', $event)"
      />
      <span
        v-if="item.id !== openGroupId"
        class="text-text-secondary font-mono text-sm"
        aria-hidden="true"
        >{{ raw(")") }}</span
      >
    </template>
  </template>
</template>
