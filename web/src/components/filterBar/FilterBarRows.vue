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
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FilterBarChip from "./FilterBarChip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  conditionValueLabel,
  type FilterCondition,
  type FilterGroup,
  type FilterRawNode,
} from "@/utils/query/filterBar";
import { containsNode, groupSummary } from "./useFilterBarFolds";
import {
  FILTER_BAR_CHIP_CONTEXT,
  type FilterBarCaretSlotProps,
  type FilterBarRowsEmits,
  type FilterBarRowsProps,
} from "./QueryFilterBar.types";

defineOptions({ name: "FilterBarRows" });

const props = withDefaults(defineProps<FilterBarRowsProps>(), {
  path: "",
  level: 1,
  editingId: null,
  editPart: null,
  armedId: null,
  caretGroupId: null,
  caretIndex: null,
  invalidIds: undefined,
  dialect: "sql",
  disabled: false,
  limitReason: undefined,
  nextConnector: "AND",
  canUngroup: undefined,
  foldedIds: undefined,
});
const emit = defineEmits<FilterBarRowsEmits>();
defineSlots<{ caret?(_props: FilterBarCaretSlotProps): unknown }>();

const { t } = useI18nTyped();
const bar = inject(FILTER_BAR_CHIP_CONTEXT, null);

const pathOf = (index: number) => (props.path ? `${props.path}-${index}` : String(index));
const suffix = (path: string) => (path ? `-${path}` : "");
const canAdd = computed(() => !props.disabled && !props.limitReason);
// Revealed with its own line on hover or keyboard focus; touch screens have no hover, so it always shows there.
const REVEAL_LINE =
  "opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100 max-md:opacity-100";
const REVEAL_GROUP =
  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100";
const caretAt = (index: number) =>
  props.groupId === props.caretGroupId &&
  props.caretIndex !== null &&
  Math.min(props.caretIndex, props.items.length) === index;

const isFolded = (id: string) => Boolean(props.foldedIds?.has(id));
const describe = (node: FilterCondition | FilterRawNode) => {
  if (node.kind === "raw") return node.label;
  const field = node.field ? (bar?.fieldLabel(node.field) ?? node.field) : t("filterBar.textField");
  const operator = bar?.operatorName(node.operator) ?? node.operator;
  return [field, operator, conditionValueLabel(node)].filter(Boolean).join(" ");
};
const summaryOf = (group: FilterGroup) =>
  raw(
    groupSummary(group, {
      describe,
      more: (count) => t("filterBar.moreInGroup", { count }),
      connectorMode: props.connectorMode,
    }),
  );
const hasIssue = (group: FilterGroup) =>
  Array.from(props.invalidIds ?? []).some((id) => containsNode(group, id));
</script>

<template>
  <template v-for="(item, index) in items" :key="item.id">
    <slot v-if="caretAt(index)" name="caret" :group-id="groupId" :index="index" />
    <div
      class="group/row flex min-w-0 items-start gap-1.5"
      :data-test="`${dataTest}-row-${pathOf(index)}`"
    >
      <div class="flex w-10 shrink-0 flex-col items-start gap-1">
        <div class="flex h-6 items-center">
          <span v-if="index === 0 && level === 1" class="text-text-secondary text-xs">{{
            t("filterBar.where")
          }}</span>
          <span v-else-if="index === 0" class="inline-flex">
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              icon-left="expand-more"
              aria-expanded="true"
              :aria-label="t('filterBar.collapseGroup')"
              :data-fold-toggle="groupId"
              :data-test="`${dataTest}-collapse${suffix(path)}`"
              @mousedown.prevent
              @click.stop="emit('toggle-fold', groupId)"
            />
            <OTooltip :content="t('filterBar.collapseGroup')" />
          </span>
          <OTag
            v-else-if="connectorMode !== 'and-only'"
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
          <span v-else class="text-text-secondary text-xs">{{ raw("AND") }}</span>
        </div>
        <span v-if="item.kind === 'group' && canAdd && !isFolded(item.id)" class="inline-flex">
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            icon-left="add"
            :class="REVEAL_GROUP"
            :aria-label="t('filterBar.addBelow')"
            :data-test="`${dataTest}-add-after-${pathOf(index)}`"
            @mousedown.prevent
            @click.stop="emit('add-after', item.id)"
          />
          <OTooltip :content="t('filterBar.addBelow')" />
        </span>
      </div>
      <div
        v-if="item.kind === 'group' && isFolded(item.id)"
        :class="[
          'group/line rounded-default border-border-subtle flex min-w-80 flex-1 items-start gap-1.5 border p-1',
          level % 2 ? 'bg-surface-subtle' : 'bg-surface-base',
        ]"
        data-folded
        :data-test="`${dataTest}-group-${pathOf(index)}`"
      >
        <div class="flex h-6 w-10 shrink-0 items-center">
          <span class="inline-flex">
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              icon-left="chevron-right"
              aria-expanded="false"
              :aria-label="t('filterBar.expandGroup')"
              :data-fold-toggle="item.id"
              :data-test="`${dataTest}-expand-${pathOf(index)}`"
              @mousedown.prevent
              @click.stop="emit('toggle-fold', item.id)"
            />
            <OTooltip :content="t('filterBar.expandGroup')" />
          </span>
        </div>
        <span class="inline-flex min-w-0">
          <OButton
            variant="cell"
            class="min-w-0"
            aria-expanded="false"
            :data-fold-toggle="item.id"
            :data-test="`${dataTest}-summary-${pathOf(index)}`"
            @mousedown.prevent
            @click.stop="emit('toggle-fold', item.id)"
          >
            <span class="flex h-6 min-w-0 items-center gap-1">
              <template v-if="hasIssue(item)">
                <OIcon
                  name="error-outline"
                  size="xs"
                  class="text-input-error-text shrink-0"
                  :data-test="`${dataTest}-summary-issue-${pathOf(index)}`"
                />
                <span class="sr-only">{{ t("filterBar.groupHasIssues") }}</span>
              </template>
              <span class="text-text-secondary truncate font-mono text-xs">{{
                summaryOf(item)
              }}</span>
            </span>
          </OButton>
          <OTooltip :content="summaryOf(item)" />
        </span>
        <span v-if="canAdd" class="inline-flex">
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            icon-left="add"
            :class="REVEAL_LINE"
            :aria-label="t('filterBar.addBelow')"
            :data-test="`${dataTest}-add-after-${pathOf(index)}`"
            @mousedown.prevent
            @click.stop="emit('add-after', item.id)"
          />
          <OTooltip :content="t('filterBar.addBelow')" />
        </span>
      </div>
      <div
        v-else-if="item.kind === 'group'"
        :class="[
          'rounded-default border-border-subtle flex min-w-0 flex-1 flex-col gap-1.5 border p-1',
          level % 2 ? 'bg-surface-subtle' : 'bg-surface-base',
        ]"
        :data-test="`${dataTest}-group-${pathOf(index)}`"
      >
        <FilterBarRows
          :items="item.items"
          :group-id="item.id"
          :path="pathOf(index)"
          :level="level + 1"
          :connector-mode="connectorMode"
          :dialect="dialect"
          :editing-id="editingId"
          :edit-part="editPart"
          :armed-id="armedId"
          :caret-group-id="caretGroupId"
          :caret-index="caretIndex"
          :invalid-ids="invalidIds"
          :disabled="disabled"
          :can-group-in="canGroupIn"
          :can-ungroup="canUngroup"
          :limit-reason="limitReason"
          :next-connector="nextConnector"
          :folded-ids="foldedIds"
          :data-test="dataTest"
          @edit="(id, part, element) => emit('edit', id, part, element)"
          @remove="emit('remove', $event)"
          @toggle-connector="emit('toggle-connector', $event)"
          @ungroup="emit('ungroup', $event)"
          @add-condition="emit('add-condition', $event)"
          @add-group="emit('add-group', $event)"
          @add-after="emit('add-after', $event)"
          @toggle-fold="emit('toggle-fold', $event)"
        >
          <template #caret="slotProps">
            <slot name="caret" v-bind="slotProps" />
          </template>
        </FilterBarRows>
      </div>
      <!-- A nested line widens the scroll area to a readable width, never to its chip's full text; a top-level one fits the field as before. -->
      <div
        v-else
        :class="[
          'group/line flex flex-1 items-center gap-1 contain-inline-size',
          level > 1 ? 'min-w-80' : 'min-w-0',
        ]"
      >
        <FilterBarChip
          :node="item"
          :dialect="dialect"
          :active-part="item.id === editingId ? (editPart ?? 'value') : null"
          :armed="item.id === armedId"
          :invalid="Boolean(invalidIds?.has(item.id))"
          :disabled="disabled"
          :data-test="dataTest"
          @edit="(part, element) => emit('edit', item.id, part, element)"
          @remove="emit('remove', item.id)"
        />
        <span v-if="canAdd" class="inline-flex">
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            icon-left="add"
            :class="REVEAL_LINE"
            :aria-label="t('filterBar.addBelow')"
            :data-test="`${dataTest}-add-after-${pathOf(index)}`"
            @mousedown.prevent
            @click.stop="emit('add-after', item.id)"
          />
          <OTooltip :content="t('filterBar.addBelow')" />
        </span>
      </div>
    </div>
  </template>
  <slot v-if="caretAt(items.length)" name="caret" :group-id="groupId" :index="items.length" />
  <div v-if="path" class="flex min-w-0 items-start gap-1.5">
    <span class="w-10 shrink-0" aria-hidden="true" />
    <div class="flex items-center gap-1">
      <span class="inline-flex">
        <OButton
          variant="ghost"
          size="xs"
          icon-left="add"
          :disabled="disabled || Boolean(limitReason)"
          :data-test="`${dataTest}-add-condition${suffix(path)}`"
          @mousedown.prevent
          @click.stop="emit('add-condition', groupId)"
          >{{ t("filterBar.addCondition") }}</OButton
        >
        <OTooltip v-if="limitReason" :content="limitReason" />
      </span>
      <span v-if="canGroupIn(groupId)" class="inline-flex">
        <OButton
          variant="ghost"
          size="xs"
          icon-left="add"
          :disabled="disabled || Boolean(limitReason)"
          :data-test="`${dataTest}-add-group${suffix(path)}`"
          @mousedown.prevent
          @click.stop="emit('add-group', groupId)"
          >{{ t("filterBar.addGroup") }}</OButton
        >
        <OTooltip v-if="limitReason" :content="limitReason" />
      </span>
      <OButton
        v-if="items.length && (canUngroup?.(groupId) ?? true)"
        variant="ghost"
        size="xs"
        icon-left="unfold-more"
        :disabled="disabled"
        :data-test="`${dataTest}-ungroup${suffix(path)}`"
        @mousedown.prevent
        @click.stop="emit('ungroup', groupId)"
        >{{ t("filterBar.ungroup") }}</OButton
      >
    </div>
  </div>
</template>
