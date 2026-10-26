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
  <div class="date-time-rail flex flex-col py-1" data-test="date-time-rail">
    <div
      role="group"
      :aria-labelledby="recentHeadingId"
      class="flex flex-col"
      data-test="date-time-rail-recent-group"
    >
      <div :id="recentHeadingId" class="text-text-secondary px-2 pt-1 pb-1 text-xs font-semibold">
        {{ t("common.timeRangeRecent") }}
      </div>
      <div
        v-if="recent.length === 0"
        class="text-text-muted px-2 pb-1 text-xs"
        data-test="date-time-rail-recent-empty"
      >
        {{ t("common.timeRangeRecentEmpty") }}
      </div>
      <div v-if="recent.length > 0" role="list" data-test="date-time-rail-recent-list">
        <div
          v-for="item in visibleRecent"
          :key="item.id"
          role="listitem"
          class="group relative px-1"
        >
          <OTooltip
            side="right"
            align="center"
            :side-offset="8"
            max-width="18.75rem"
            :content="item.disabled ? restrictionMsg : item.tooltip"
          />
          <OButton
            variant="ghost"
            size="xs"
            data-date-time-rail-item
            data-date-time-rail-recent
            :tabindex="tabindexFor(`recent-${item.id}`)"
            :data-test="`date-time-rail-recent-${item.id}`"
            class="w-full justify-start! pe-7! font-normal tabular-nums disabled:opacity-35"
            :class="item.selected ? 'bg-button-primary! text-button-primary-foreground!' : ''"
            :disabled="item.disabled"
            :aria-pressed="item.selected"
            :aria-keyshortcuts="raw('Delete ArrowRight')"
            @mouseenter="emit('hover')"
            @focus="onItemFocus(`recent-${item.id}`)"
            @click="emit('select-recent', item.id)"
            @keydown.delete.prevent="removeFocusedRecent(item.id, $event)"
            @keydown.right.prevent="focusSibling($event, '[data-test$=\'-remove\']')"
          >
            <OTruncatedText :tooltip="false" class="min-w-0">{{ item.label }}</OTruncatedText>
            <span
              v-if="item.suffix"
              class="text-2xs shrink-0"
              :class="item.selected ? '' : 'text-text-secondary'"
              >{{ item.suffix }}</span
            >
          </OButton>
          <OButton
            variant="ghost"
            size="icon-chip"
            icon-left="close"
            :data-test="`date-time-rail-recent-${item.id}-remove`"
            tabindex="-1"
            :aria-label="t('common.timeRangeRemoveRecent', { range: item.label })"
            @keydown.left.prevent="focusSibling($event, '[data-date-time-rail-recent]')"
            class="absolute! end-1.5 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
            @click.stop="removeFocusedRecent(item.id, $event)"
          />
        </div>
      </div>
      <OButton
        v-if="recent.length > COLLAPSED_COUNT"
        variant="ghost-primary"
        size="chip"
        class="ms-1 self-start"
        data-date-time-rail-item
        data-test="date-time-rail-recent-toggle"
        :tabindex="tabindexFor('toggle')"
        :aria-expanded="expanded"
        @focus="onItemFocus('toggle')"
        @keydown.enter.prevent="expanded = !expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? t("common.timeRangeShowLess") : t("common.timeRangeShowMore") }}
      </OButton>
    </div>

    <div
      v-if="calendar !== null && calendar.length > 0"
      role="group"
      :aria-labelledby="calendarHeadingId"
      class="flex flex-col"
      data-test="date-time-rail-calendar-group"
    >
      <div :id="calendarHeadingId" class="text-text-secondary px-2 pt-3 pb-1 text-xs font-semibold">
        {{ t("common.timeRangeCalendar") }}
      </div>
      <div
        role="list"
        class="max-sm:grid max-sm:grid-cols-2"
        data-test="date-time-rail-calendar-list"
      >
        <div v-for="item in calendar" :key="item.id" role="listitem" class="px-1">
          <OTooltip
            side="right"
            align="center"
            :side-offset="8"
            max-width="18.75rem"
            :content="item.disabled ? restrictionMsg : item.tooltip"
          />
          <OButton
            variant="ghost"
            size="xs"
            data-date-time-rail-item
            :tabindex="tabindexFor(`calendar-${item.id}`)"
            :data-test="`date-time-rail-calendar-${item.id}`"
            class="w-full justify-start! font-normal disabled:opacity-35"
            :class="item.selected ? 'bg-button-primary! text-button-primary-foreground!' : ''"
            :disabled="item.disabled"
            :aria-pressed="item.selected"
            @mouseenter="emit('hover')"
            @focus="onItemFocus(`calendar-${item.id}`)"
            @click="emit('select-calendar', item.id)"
          >
            <OTruncatedText :tooltip="false" class="min-w-0">{{ item.label }}</OTruncatedText>
            <span
              v-if="item.suffix"
              class="text-2xs ms-auto shrink-0"
              :class="item.selected ? '' : 'text-text-secondary'"
              >{{ item.suffix }}</span
            >
          </OButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { TimeRangeRailItem } from "@/utils/timeRangeRail";

const COLLAPSED_COUNT = 3;

const props = defineProps<{
  recent: TimeRangeRailItem[];
  /** Null hides the calendar section, for pages whose backend only takes rolling periods. */
  calendar: TimeRangeRailItem[] | null;
  /** Shown instead of the range tooltip on items disabled by the query-range limit. */
  restrictionMsg?: I18nText;
}>();

const emit = defineEmits<{
  "select-recent": [id: string];
  "remove-recent": [id: string];
  "select-calendar": [id: string];
  /** Fires on pointer enter and on focus, so the parent can refresh the clock "so far" tooltips end at. */
  hover: [];
}>();

const { t } = useI18nTyped();
const recentHeadingId = useId();
const calendarHeadingId = useId();

// Starts collapsed on every open because the popover unmounts this rail when it closes.
const expanded = ref(false);

const visibleRecent = computed(() =>
  expanded.value ? props.recent : props.recent.slice(0, COLLAPSED_COUNT),
);

// The rail is one Tab stop: only its active item is tabbable and arrow keys move within it.
const activeKey = ref<string | null>(null);

const focusOrder = computed(() => [
  ...visibleRecent.value.filter((item) => !item.disabled).map((item) => `recent-${item.id}`),
  ...(props.recent.length > COLLAPSED_COUNT ? ["toggle"] : []),
  ...(props.calendar ?? []).filter((item) => !item.disabled).map((item) => `calendar-${item.id}`),
]);

const tabStop = computed(() =>
  activeKey.value !== null && focusOrder.value.includes(activeKey.value)
    ? activeKey.value
    : focusOrder.value[0],
);

const tabindexFor = (key: string) => (key === tabStop.value ? 0 : -1);

const onItemFocus = (key: string) => {
  activeKey.value = key;
  emit("hover");
};

// The × stays out of the Tab order; ArrowRight from its row reaches it and ArrowLeft returns.
const focusSibling = (event: KeyboardEvent, selector: string) => {
  const row = (event.currentTarget as HTMLElement).parentElement;
  row?.querySelector<HTMLElement>(selector)?.focus();
};

// The × is out of the Tab order, so Delete on the focused row removes it and focus stays in the list.
const removeFocusedRecent = async (id: string, event: Event) => {
  const list = (event.currentTarget as HTMLElement).closest("[data-test='date-time-rail']");
  const index = visibleRecent.value.findIndex((item) => item.id === id);
  emit("remove-recent", id);
  await nextTick();
  const rows = list?.querySelectorAll<HTMLElement>("[data-date-time-rail-recent]");
  if (rows && rows.length > 0) rows[Math.min(index, rows.length - 1)].focus();
};
</script>
