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
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FilterBarChip from "./FilterBarChip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type {
  FilterBarNodesEmits,
  FilterBarNodesProps,
  FilterBarCaretSlotProps,
} from "./QueryFilterBar.types";

defineOptions({ name: "FilterBarNodes" });

const props = withDefaults(defineProps<FilterBarNodesProps>(), {
  path: "",
  editingId: null,
  editPart: null,
  armedId: null,
  caretGroupId: null,
  caretIndex: null,
  invalidIds: undefined,
  dialect: "sql",
  disabled: false,
  canUngroup: undefined,
});
const emit = defineEmits<FilterBarNodesEmits>();
defineSlots<{ caret?(_props: FilterBarCaretSlotProps): unknown }>();

const { t } = useI18nTyped();

const pathOf = (index: number) => (props.path ? `${props.path}-${index}` : String(index));
const caretAt = (index: number) =>
  props.groupId === props.caretGroupId &&
  props.caretIndex !== null &&
  Math.min(props.caretIndex, props.items.length) === index;
</script>

<template>
  <template v-for="(item, index) in items" :key="item.id">
    <slot v-if="caretAt(index)" name="caret" :group-id="groupId" :index="index" />
    <OTag
      v-if="connectorMode !== 'and-only' && index > 0"
      clickable
      size="xs"
      shape="rounded"
      variant="default-soft"
      :disabled="disabled"
      :label="raw(item.connector)"
      :aria-label="t('filterBar.toggleConnector')"
      :data-test="`${dataTest}-connector-${pathOf(index)}`"
      @click.stop="emit('toggle-connector', item.id)"
    />
    <span
      v-if="item.kind === 'group'"
      class="rounded-default border-border-subtle bg-surface-subtle inline-flex max-w-full min-w-min flex-wrap items-center gap-1.5 border py-0.5 ps-1.5 pe-0.5"
      :data-filter-group="item.id"
      :data-filter-index="index"
      :data-test="`${dataTest}-group-${pathOf(index)}`"
    >
      <FilterBarNodes
        :items="item.items"
        :group-id="item.id"
        :path="pathOf(index)"
        :connector-mode="connectorMode"
        :dialect="dialect"
        :editing-id="editingId"
        :edit-part="editPart"
        :armed-id="armedId"
        :caret-group-id="caretGroupId"
        :caret-index="caretIndex"
        :invalid-ids="invalidIds"
        :disabled="disabled"
        :can-ungroup="canUngroup"
        :data-test="dataTest"
        @edit="(id, part, element) => emit('edit', id, part, element)"
        @remove="emit('remove', $event)"
        @toggle-connector="emit('toggle-connector', $event)"
        @ungroup="emit('ungroup', $event)"
      >
        <template #caret="slotProps">
          <slot name="caret" v-bind="slotProps" />
        </template>
      </FilterBarNodes>
      <span v-if="item.items.length && (canUngroup?.(item.id) ?? true)" class="inline-flex">
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="unfold-more"
          :disabled="disabled"
          :aria-label="t('filterBar.ungroup')"
          :data-test="`${dataTest}-ungroup-${pathOf(index)}`"
          @mousedown.prevent
          @click.stop="emit('ungroup', item.id)"
        />
        <OTooltip :content="t('filterBar.ungroup')" />
      </span>
    </span>
    <FilterBarChip
      v-else
      :node="item"
      :dialect="dialect"
      :active-part="item.id === editingId ? (editPart ?? 'value') : null"
      :armed="item.id === armedId"
      :invalid="Boolean(invalidIds?.has(item.id))"
      :disabled="disabled"
      :data-filter-index="index"
      :data-test="dataTest"
      @edit="(part, element) => emit('edit', item.id, part, element)"
      @remove="emit('remove', item.id)"
    />
  </template>
  <slot v-if="caretAt(items.length)" name="caret" :group-id="groupId" :index="items.length" />
</template>
