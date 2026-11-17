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

<template>
  <div
    class="flex h-104 flex-col gap-2 max-lg:h-auto lg:max-h-[calc(var(--reka-popper-available-height,26rem)-1.625rem)]"
    data-test="rum-analytics-funnel-field-picker"
  >
    <span
      v-if="note"
      class="text-text-secondary text-xs"
      data-test="rum-analytics-funnel-field-picker-note"
      >{{ note }}</span
    >
    <div v-if="hasFields" class="flex min-h-0 flex-1 flex-col max-lg:h-72">
      <GroupedFieldList
        keyboard
        :fields="rows"
        :search="search"
        search-class="px-0"
        row-key="rowId"
        @update:search="(v: string) => (search = v)"
        @row-click="onRowClick"
      >
        <template #field-row="{ row }">
          <OFieldRow :data-test="`rum-analytics-funnel-field-picker-${row.rowId}`">
            <span class="flex min-w-0 flex-1 items-center justify-between gap-2">
              <OTruncatedText
                as="span"
                class="min-w-0 font-mono"
                :class="row.reason ? 'text-text-muted' : 'text-text-body'"
                >{{ row.name }}</OTruncatedText
              >
              <OTruncatedText
                v-if="row.hint"
                as="span"
                class="text-text-secondary text-2xs max-w-[55%] min-w-0 shrink-0"
                >{{ row.hint }}</OTruncatedText
              >
            </span>
            <OTooltip v-if="row.reason" :content="row.reason" />
          </OFieldRow>
        </template>
        <template #empty>
          <span
            class="text-text-secondary py-2 text-xs"
            data-test="rum-analytics-funnel-field-picker-no-field"
            >{{ t("rum.analytics.funnel.filterNoField") }}</span
          >
        </template>
      </GroupedFieldList>
    </div>
    <span v-else-if="!note" class="text-text-secondary text-xs">{{
      t("rum.analytics.funnel.filterNoFields")
    }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import GroupedFieldList from "@/components/common/GroupedFieldList.vue";
import type { PickerGroup } from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineOptions({ name: "FunnelFieldPicker" });

const props = defineProps<{
  groups: readonly PickerGroup[];
  /** One line above the list, e.g. while a band is still loading. */
  note?: I18nText | null;
}>();
const emit = defineEmits<{
  pick: [string];
}>();
const { t } = useI18nTyped();

const search = ref("");

const hasFields = computed(() => props.groups.some((g) => g.fields.length));

// Ids are unique across bands, so a field listed in two bands keeps two rows.
const rows = computed(() =>
  props.groups
    .filter((g) => g.fields.length)
    .flatMap((g) => [
      { name: g.label, label: true, group: g.id, rowId: `band-${g.id}` },
      ...g.fields.map((f) => ({
        name: f.name,
        group: g.id,
        rowId: f.id,
        hint: f.hint,
        reason: f.reason,
        disabled: !!f.reason,
      })),
    ]),
);

const onRowClick = (row: { isGroup?: boolean; rowId?: string; reason?: unknown }) => {
  if (!row.isGroup && !row.reason && row.rowId) emit("pick", row.rowId);
};
</script>
