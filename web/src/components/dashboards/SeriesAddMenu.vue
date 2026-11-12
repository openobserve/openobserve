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
  <ODropdown v-model:open="open" align="start" content-class="min-w-(--reka-popper-anchor-width)!">
    <template #trigger>
      <!-- Native button: no OButton variant matches the column dialog's dashed Add field trigger. -->
      <button
        v-if="variant === 'dashed'"
        type="button"
        :data-test="`${dataTest}-trigger`"
        class="rounded-default text-accent hover:border-accent border-accent/50 hover:bg-accent/5 flex w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 border border-dashed bg-transparent p-2.25 text-sm font-medium transition-colors"
      >
        <OIcon name="add" size="sm" />
        {{ t("dashboard.seriesFormattingAddSeries") }}
      </button>
      <OButton v-else variant="primary" icon-left="add" :data-test="`${dataTest}-trigger`">
        {{ t("dashboard.seriesFormattingAddSeries") }}
      </OButton>
    </template>
    <div class="flex w-64 max-w-[calc(100vw-1.5rem)] flex-col" :data-test="`${dataTest}-menu`">
      <div class="p-1.5">
        <OSearchInput
          ref="searchRef"
          v-model="search"
          :placeholder="t('dashboard.seriesFormattingSearchSeries')"
          :data-test="`${dataTest}-search`"
        />
      </div>
      <ODropdownItem icon-left="code" :data-test="`${dataTest}-regex`" @select="emit('add-regex')">
        {{ t("dashboard.seriesFormattingMatchByRegex") }}
      </ODropdownItem>
      <ODropdownSeparator />
      <ODropdownGroup :label="t('dashboard.seriesFormattingLegendSeries')">
        <div class="max-h-70 overflow-y-auto">
          <ODropdownItem
            v-for="name in visibleNames"
            :key="name"
            :text-value="name"
            :data-test="`${dataTest}-name`"
            :data-series-name="name"
            @select="emit('add-name', name)"
          >
            <OTruncatedText class="min-w-0 flex-1">{{ name }}</OTruncatedText>
          </ODropdownItem>
          <div
            v-if="!visibleNames.length"
            class="text-text-secondary px-3 py-2 text-xs"
            :data-test="`${dataTest}-empty`"
          >
            {{ emptyText }}
          </div>
        </div>
      </ODropdownGroup>
    </div>
  </ODropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

const props = withDefaults(
  defineProps<{
    names?: string[];
    usedNames?: string[];
    variant?: "dashed" | "primary";
    dataTest?: string;
  }>(),
  {
    names: () => [],
    usedNames: () => [],
    variant: "dashed",
    dataTest: "dashboard-series-format-add",
  },
);

const emit = defineEmits<{ "add-name": [name: string]; "add-regex": [] }>();

const { t } = useI18nTyped();
const open = ref(false);
const search = ref("");
const searchRef = ref<{ $el?: HTMLElement } | null>(null);

const availableNames = computed(() => {
  const used = new Set(props.usedNames);
  return props.names.filter((name) => !used.has(name));
});

const visibleNames = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query
    ? availableNames.value.filter((name) => name.toLowerCase().includes(query))
    : availableNames.value;
});

const emptyText = computed(() => {
  if (!props.names.length) return t("dashboard.seriesFormattingNoSeries");
  if (!availableNames.value.length) return t("dashboard.seriesFormattingAllAdded");
  return t("dashboard.seriesFormattingNoMatchingSeries");
});

watch(open, async (isOpen) => {
  if (!isOpen) {
    search.value = "";
    return;
  }
  await nextTick();
  searchRef.value?.$el?.querySelector?.("input")?.focus();
});
</script>
