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
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { conditionValueLabel, OPERATORS, type FilterCondition } from "@/utils/query/filterBar";
import type { FilterBarNodesEmits, FilterBarNodesProps } from "./QueryFilterBar.types";

defineOptions({ name: "FilterBarNodes" });

const props = withDefaults(defineProps<FilterBarNodesProps>(), {
  offset: 0,
  editingId: null,
  armedId: null,
  openGroupId: null,
});
const emit = defineEmits<FilterBarNodesEmits>();

const { t } = useI18nTyped();

const testKey = (condition: FilterCondition) => condition.field || "text";

const showConnector = (index: number) => props.advanced && index + props.offset > 0;
</script>

<template>
  <template v-for="(item, index) in items" :key="item.id">
    <OTag
      v-if="showConnector(index) && item.id !== editingId"
      clickable
      size="sm"
      variant="default-outline"
      :label="raw(item.connector)"
      :aria-label="t('filterBar.toggleConnector')"
      :data-test="`${dataTest}-connector-${index + offset}`"
      @click.stop="emit('toggle-connector', item.id)"
    />
    <template v-if="item.kind === 'condition'">
      <OTag
        v-if="item.id !== editingId"
        clickable
        removable
        size="sm"
        :variant="item.id === armedId ? 'primary' : 'primary-soft'"
        :remove-label="t('filterBar.removeFilter')"
        :data-test="`${dataTest}-chip-${testKey(item)}`"
        :data-filter-id="item.id"
        class="max-w-full"
        @click.stop="emit('edit', item.id)"
        @remove="emit('remove', item.id)"
      >
        <template v-if="item.field">
          <span class="font-medium">{{ raw(item.field) }}</span>
          <span class="opacity-75">{{ raw(OPERATORS[item.operator].symbol) }}</span>
          <OTruncatedText class="max-w-60">{{ raw(conditionValueLabel(item)) }}</OTruncatedText>
        </template>
        <OTruncatedText v-else class="max-w-60">{{
          t("filterBar.textChip", { text: item.values[0] ?? "" })
        }}</OTruncatedText>
      </OTag>
    </template>
    <template v-else>
      <span class="text-text-secondary font-mono text-sm" aria-hidden="true">{{ raw("(") }}</span>
      <FilterBarNodes
        :items="item.items"
        :advanced="advanced"
        :editing-id="editingId"
        :armed-id="armedId"
        :open-group-id="openGroupId"
        :data-test="dataTest"
        @edit="emit('edit', $event)"
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
