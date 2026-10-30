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
  <div class="flex h-full min-h-0 flex-col" :data-test="`fleet-flow-list-${listId}`">
    <div class="flex shrink-0 items-center gap-2 px-3 pt-3">
      <OText variant="panel-title" class="flex-1">{{ title }}</OText>
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`fleet-flow-list-${listId}-top3`"
        @click="showTop"
      >
        {{ t("fleet.flow.showTop", { count: 3 }) }}
      </OButton>
    </div>
    <div class="shrink-0 px-3 py-2">
      <OSearchInput
        v-model="filter"
        size="sm"
        clearable
        :placeholder="filterPlaceholder"
        :data-test="`fleet-flow-list-${listId}-filter`"
      />
    </div>
    <div class="border-border-default flex shrink-0 items-center gap-2 border-y px-3 py-1.5">
      <OCheckbox
        :model-value="allState"
        size="sm"
        :aria-label="t('fleet.flow.selectAll')"
        :data-test="`fleet-flow-list-${listId}-all`"
        @update:model-value="toggleAll"
      />
      <OButton
        variant="ghost"
        size="xs"
        :icon-right="sortAsc ? 'arrow-upward' : 'arrow-downward'"
        :data-test="`fleet-flow-list-${listId}-sort`"
        @click="sortAsc = !sortAsc"
      >
        {{ t("fleet.common.name") }}
      </OButton>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <div
        v-for="item in visible"
        :key="item.id"
        class="rounded-default mx-1 flex items-center gap-2 px-2 py-1.5"
        :class="isChecked(item.id) ? 'bg-surface-tint-accent text-accent' : 'text-text-body'"
      >
        <OCheckbox
          :model-value="isChecked(item.id)"
          size="sm"
          :aria-label="item.label"
          :data-test="`fleet-flow-list-${listId}-item-${item.id}`"
          @update:model-value="toggle(item.id)"
        />
        <span
          v-if="item.dot && item.dot !== 'healthy'"
          class="h-2 w-2 shrink-0 rounded-full"
          :class="SEVERITY_DOT[item.dot]"
          :data-test="`fleet-flow-list-${listId}-item-${item.id}-issue`"
        />
        <span class="min-w-0 flex-1 truncate text-sm">{{ item.label }}</span>
        <span
          class="text-2xs max-w-1/2 min-w-0 truncate tabular-nums opacity-80"
          :title="item.rate"
          :data-test="`fleet-flow-list-${listId}-item-${item.id}-rate`"
          >{{ item.rate }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { SEVERITY_DOT, type PathSeverity } from "./flowIssues";

export interface FlowListItem {
  id: string;
  label: I18nText;
  rate: I18nText;
  /** The sort key for "Show top"; -1 when there is no throughput data. */
  value: number;
  dot?: PathSeverity;
}

const props = defineProps<{
  listId: string;
  title: I18nText;
  filterPlaceholder: I18nText;
  items: FlowListItem[];
}>();
const checked = defineModel<string[]>({ required: true });

const { t } = useI18nTyped();

const filter = ref("");
const sortAsc = ref(true);

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const rows = props.items.filter((i) => !q || i.label.toLowerCase().includes(q));
  return [...rows].sort((a, b) => (sortAsc.value ? 1 : -1) * a.label.localeCompare(b.label));
});

const allState = computed(() => {
  if (!checked.value.length) return false;
  return checked.value.length === props.items.length ? true : "indeterminate";
});

const isChecked = (id: string) => checked.value.includes(id);

function toggle(id: string) {
  checked.value = isChecked(id) ? checked.value.filter((x) => x !== id) : [...checked.value, id];
}

// Any selection clears back to "no filter"; from nothing, tick everything.
function toggleAll() {
  checked.value = checked.value.length ? [] : props.items.map((i) => i.id);
}

function showTop() {
  checked.value = [...props.items]
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((i) => i.id);
}
</script>
