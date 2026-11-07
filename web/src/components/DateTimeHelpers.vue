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
  <section
    data-test="date-time-quick-ranges"
    class="bg-surface-panel border-border-default flex min-w-0 flex-col gap-2 border-e p-3 max-sm:border-e-0 max-sm:border-b"
    :aria-labelledby="headingId"
  >
    <h3 :id="headingId" class="text-text-heading text-compact flex h-7 items-center font-semibold">
      {{ t("common.rangeQuickRanges") }}
    </h3>
    <div
      ref="rootEl"
      data-test="date-time-helpers"
      class="flex flex-col gap-2 outline-none"
      tabindex="-1"
    >
      <div
        v-if="relative && relative.length > 0"
        data-test="date-time-helpers-relative"
        role="group"
        :aria-labelledby="relativeLabelId"
        class="flex flex-col gap-1"
      >
        <div :id="relativeLabelId" class="text-text-secondary text-2xs">
          {{ t("common.relative") }}
        </div>
        <div v-for="row in relative" :key="row.unit" class="flex items-start gap-2">
          <span class="text-text-secondary w-12 shrink-0 text-xs leading-7">{{ row.label }}</span>
          <div class="flex min-w-0 flex-1 flex-wrap gap-[0.3rem]">
            <OButton
              v-for="chip in row.chips"
              :key="chip.value"
              :data-test="`date-time-relative-${chip.value}-${row.unit}-btn`"
              :data-roving="`relative`"
              :data-roving-key="`rel-${chip.value}-${row.unit}`"
              :variant="chip.selected ? 'primary' : 'outline'"
              size="chip"
              class="h-7 min-w-10 justify-center px-2 tabular-nums"
              :aria-label="chip.ariaLabel"
              :aria-pressed="chip.selected"
              :disabled="chip.disabled"
              :tabindex="tabindexFor('relative', `rel-${chip.value}-${row.unit}`)"
              @mouseenter="onHover({ kind: 'relative', value: chip.value, unit: row.unit })"
              @focus="
                onFocusItem('relative', `rel-${chip.value}-${row.unit}`, {
                  kind: 'relative',
                  value: chip.value,
                  unit: row.unit,
                })
              "
              @keydown="onRovingKeydown($event, 'relative')"
              @click="emit('select', { kind: 'relative', value: chip.value, unit: row.unit })"
            >
              {{ raw(chip.value) }}
              <OTooltip
                v-if="chip.disabled && restrictionMsg"
                side="right"
                max-width="18.75rem"
                :content="restrictionMsg"
              />
            </OButton>
          </div>
        </div>
      </div>

      <div
        v-if="calendarRows.length > 0"
        data-test="date-time-helpers-calendar"
        role="group"
        :aria-labelledby="calendarLabelId"
        class="flex flex-col gap-1"
      >
        <div :id="calendarLabelId" class="text-text-secondary text-2xs">
          {{ t("common.timeRangeCalendar") }}
        </div>
        <div v-for="row in calendarRows" :key="row.label" class="flex items-start gap-2">
          <span class="text-text-secondary w-12 shrink-0 text-xs leading-7 max-sm:hidden">{{
            row.label
          }}</span>
          <div class="flex min-w-0 flex-1 flex-wrap gap-[0.3rem]">
            <OButton
              v-for="item in row.items"
              :key="item.id"
              :data-test="`date-time-rail-calendar-${item.id}`"
              data-date-time-rail-item
              data-date-time-rail-calendar
              data-roving="calendar"
              :data-roving-key="`cal-${item.id}`"
              :variant="item.selected ? 'primary' : 'outline'"
              size="chip"
              class="h-7 min-w-max flex-1 basis-0 justify-start! px-[0.45rem] font-medium"
              :aria-pressed="item.selected"
              :disabled="item.disabled"
              :tabindex="tabindexFor('calendar', `cal-${item.id}`)"
              @mouseenter="onHover({ kind: 'calendar', id: item.id })"
              @focus="onFocusItem('calendar', `cal-${item.id}`, { kind: 'calendar', id: item.id })"
              @keydown="onCalendarKeydown($event, item.id)"
              @click="emit('select', { kind: 'calendar', id: item.id })"
            >
              <span class="whitespace-nowrap">{{ item.label }}</span>
              <span
                v-if="item.hint"
                class="text-2xs font-normal whitespace-nowrap"
                :class="item.selected ? 'opacity-80' : 'text-text-secondary'"
                :data-test="`date-time-rail-calendar-${item.id}-hint`"
                ><span aria-hidden="true">{{ raw("· ") }}</span
                >{{ item.hint }}</span
              >
              <OTooltip
                v-if="item.disabled && restrictionMsg"
                side="right"
                max-width="18.75rem"
                :content="restrictionMsg"
              />
            </OButton>
          </div>
        </div>
      </div>

      <div
        v-if="showRecent"
        role="group"
        :aria-label="t('common.timeRangeRecent')"
        class="flex flex-col"
        data-test="date-time-rail-recent-group"
      >
        <div class="flex items-center justify-between">
          <div class="text-text-secondary text-2xs" data-test="date-time-rail-recent-header">
            {{ t("common.timeRangeRecent") }}
          </div>
          <OButton
            v-if="recent.length > collapsedCount"
            variant="ghost-primary"
            size="chip"
            data-date-time-rail-item
            data-test="date-time-rail-recent-toggle"
            data-roving="recent"
            data-roving-key="toggle"
            :tabindex="tabindexFor('recent', 'toggle')"
            :aria-expanded="expanded"
            @focus="onFocusItem('recent', 'toggle', null)"
            @keydown="onRovingKeydown($event, 'recent')"
            @keydown.enter.prevent="expanded = !expanded"
            @click="expanded = !expanded"
          >
            {{ expanded ? t("common.timeRangeShowLess") : t("common.timeRangeShowMore") }}
          </OButton>
        </div>
        <span :id="recentKeysHintId" class="sr-only">{{
          t("common.timeRangeRecentKeysHint")
        }}</span>
        <div
          v-if="recent.length === 0"
          class="text-text-secondary py-1 text-xs"
          data-test="date-time-rail-recent-empty"
        >
          {{ t("common.timeRangeRecentEmpty") }}
        </div>
        <div v-else role="list" data-test="date-time-rail-recent-list">
          <div v-for="item in visibleRecent" :key="item.id" role="listitem" class="group relative">
            <OTooltip
              side="right"
              align="center"
              :side-offset="8"
              max-width="18.75rem"
              content-class="whitespace-pre-line"
              :content="item.disabled ? restrictionMsg : item.tooltip"
            />
            <OButton
              variant="ghost"
              size="xs"
              data-date-time-rail-item
              data-date-time-rail-recent
              data-roving="recent"
              :data-roving-key="`recent-${item.id}`"
              :tabindex="tabindexFor('recent', `recent-${item.id}`)"
              :data-test="`date-time-rail-recent-${item.id}`"
              class="w-full justify-start! gap-2 pe-8! font-normal tabular-nums aria-disabled:opacity-35"
              :class="item.selected ? 'bg-button-primary! text-button-primary-foreground!' : ''"
              :disabled="item.disabled"
              focusable-unavailable
              :aria-pressed="item.selected"
              :aria-label="rowName(item)"
              :aria-describedby="recentKeysHintId"
              :description-id="recentKeysHintId"
              @mouseenter="onHover({ kind: 'recent', id: item.id })"
              @focus="onFocusItem('recent', `recent-${item.id}`, { kind: 'recent', id: item.id })"
              @click="emit('select', { kind: 'recent', id: item.id })"
              @keydown="onRecentKeydown($event, item.id)"
            >
              <template v-if="item.compact">
                <OTruncatedText :tooltip="false" class="min-w-0 flex-1 text-start">{{
                  item.compact.label
                }}</OTruncatedText>
                <span
                  v-if="item.zoneTag"
                  class="text-text-secondary text-2xs shrink-0"
                  :data-test="`date-time-rail-recent-${item.id}-zone`"
                  >{{ item.zoneTag }}</span
                >
                <span
                  class="text-2xs shrink-0 rounded-full px-2 font-normal"
                  :class="
                    item.selected
                      ? 'bg-button-primary-foreground/20'
                      : 'bg-text-heading/7 text-text-secondary'
                  "
                  :data-test="`date-time-rail-recent-${item.id}-duration`"
                  >{{ item.compact.duration }}</span
                >
              </template>
              <OTruncatedText v-else :tooltip="false" class="min-w-0">{{
                item.label
              }}</OTruncatedText>
            </OButton>
            <OButton
              variant="ghost"
              size="icon-chip"
              icon-left="close"
              :data-test="`date-time-rail-recent-${item.id}-remove`"
              tabindex="-1"
              :aria-label="t('common.timeRangeRemoveRecent', { range: rowName(item) })"
              class="absolute! end-1.5 top-1/2 -translate-y-1/2"
              :class="
                item.selected
                  ? 'text-button-primary-foreground/70! hover:text-button-primary-foreground! focus-visible:text-button-primary-foreground!'
                  : 'text-text-secondary! hover:text-text-heading! focus-visible:text-text-heading!'
              "
              @keydown.left.prevent="focusSibling($event, '[data-date-time-rail-recent]')"
              @click.stop="removeRecent(item.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { RelativeUnit, TimeRangeRailItem } from "@/utils/timeRangeRail";

/** One relative chip: the number it shows, and whether it is over the page's limit or in force. */
export interface RelativeChip {
  value: number;
  ariaLabel: I18nText;
  selected: boolean;
  disabled: boolean;
}

/** A row of relative chips under its unit label. */
export interface RelativeRow {
  unit: RelativeUnit;
  label: I18nText;
  chips: RelativeChip[];
}

/** A row of calendar chips under its period label. */
export interface CalendarRow {
  label: I18nText;
  items: TimeRangeRailItem[];
}

/** What a helper names: a rolling window, a calendar period, or a recent range. */
export type HelperItem =
  | { kind: "relative"; value: number; unit: RelativeUnit }
  | { kind: "calendar"; id: string }
  | { kind: "recent"; id: string };

type Group = "relative" | "calendar" | "recent";

const props = withDefaults(
  defineProps<{
    /** Null hides the relative rows, for a dates-only picker. */
    relative: RelativeRow[] | null;
    calendarRows?: CalendarRow[];
    recent: TimeRangeRailItem[];
    showRecent?: boolean;
    /** Shown instead of the range tooltip on items disabled by the query-range limit. */
    restrictionMsg?: I18nText;
  }>(),
  { calendarRows: () => [], showRecent: true, restrictionMsg: undefined },
);

const emit = defineEmits<{
  select: [item: HelperItem];
  /** Hover or focus on a helper; the panel previews it until another helper or the pointer leaving ends it. */
  preview: [item: HelperItem];
  /** Shift+Enter on a calendar chip: its dates, applied as fixed ones. */
  freeze: [id: string];
  "remove-recent": [id: string];
}>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const headingId = useId();
const relativeLabelId = useId();
const calendarLabelId = useId();
const recentKeysHintId = useId();
const rootEl = ref<HTMLElement | null>(null);

// Starts collapsed on every open because the popover unmounts the helpers when it closes.
const expanded = ref(false);
const collapsedCount = computed(() => (isMobile.value ? 2 : 3));
const visibleRecent = computed(() =>
  expanded.value ? props.recent : props.recent.slice(0, collapsedCount.value),
);

// Each group is one Tab stop; arrows, Home and End move inside it.
const activeKeys = ref<Record<Group, string | null>>({
  relative: null,
  calendar: null,
  recent: null,
});

const groupKeys = (group: Group): string[] => {
  if (group === "relative") {
    return (props.relative ?? []).flatMap((row) =>
      row.chips.filter((chip) => !chip.disabled).map((chip) => `rel-${chip.value}-${row.unit}`),
    );
  }
  if (group === "calendar") {
    return props.calendarRows.flatMap((row) =>
      row.items.filter((item) => !item.disabled).map((item) => `cal-${item.id}`),
    );
  }
  // A recent row over the query-range limit stays focusable, so it can still be removed by keyboard.
  return [
    ...(props.recent.length > collapsedCount.value ? ["toggle"] : []),
    ...visibleRecent.value.map((item) => `recent-${item.id}`),
  ];
};

const selectedKey = (group: Group): string | undefined => {
  if (group === "relative") {
    for (const row of props.relative ?? []) {
      const chip = row.chips.find((item) => item.selected && !item.disabled);
      if (chip) return `rel-${chip.value}-${row.unit}`;
    }
  }
  if (group === "calendar") {
    const item = props.calendarRows.flatMap((row) => row.items).find((entry) => entry.selected);
    if (item && !item.disabled) return `cal-${item.id}`;
  }
  return undefined;
};

const tabStops = computed<Record<Group, string | undefined>>(() => {
  const stop = (group: Group) => {
    const keys = groupKeys(group);
    const active = activeKeys.value[group];
    if (active !== null && keys.includes(active)) return active;
    return selectedKey(group) ?? keys[0];
  };
  return { relative: stop("relative"), calendar: stop("calendar"), recent: stop("recent") };
});

const tabindexFor = (group: Group, key: string) => (tabStops.value[group] === key ? 0 : -1);

const onFocusItem = (group: Group, key: string, item: HelperItem | null) => {
  activeKeys.value = { ...activeKeys.value, [group]: key };
  if (item) emit("preview", item);
};

const onHover = (item: HelperItem) => emit("preview", item);

const focusKey = (group: Group, key: string) => {
  rootEl.value
    ?.querySelector<HTMLElement>(`[data-roving="${group}"][data-roving-key="${key}"]`)
    ?.focus();
};

const isRtl = () => (rootEl.value ? getComputedStyle(rootEl.value).direction === "rtl" : false);

// Next and previous follow reading order, so Left and Right swap in RTL.
const stepFor = (key: string): number | "first" | "last" | 0 => {
  if (key === "Home") return "first";
  if (key === "End") return "last";
  const forward = isRtl() ? "ArrowLeft" : "ArrowRight";
  const backward = isRtl() ? "ArrowRight" : "ArrowLeft";
  if (key === forward || key === "ArrowDown") return 1;
  if (key === backward || key === "ArrowUp") return -1;
  return 0;
};

const onRovingKeydown = (event: KeyboardEvent, group: Group) => {
  const step = stepFor(event.key);
  if (step === 0) return;
  event.preventDefault();
  event.stopPropagation();
  const keys = groupKeys(group);
  if (keys.length === 0) return;
  const current = keys.indexOf(activeKeys.value[group] ?? "");
  let index: number;
  if (step === "first") index = 0;
  else if (step === "last") index = keys.length - 1;
  else index = Math.min(keys.length - 1, Math.max(0, (current === -1 ? 0 : current) + step));
  focusKey(group, keys[index]);
};

const onCalendarKeydown = (event: KeyboardEvent, id: string) => {
  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    emit("freeze", id);
    return;
  }
  onRovingKeydown(event, "calendar");
};

const onRecentKeydown = (event: KeyboardEvent, id: string) => {
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeRecent(id);
    return;
  }
  const toRemove = isRtl() ? "ArrowLeft" : "ArrowRight";
  if (event.key === toRemove) {
    event.preventDefault();
    focusSibling(event, "[data-test$='-remove']");
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
  onRovingKeydown(event, "recent");
};

// The accessible name must contain the visible compact label.
const rowName = (item: TimeRangeRailItem) =>
  item.compact ? `${item.compact.label} (${item.label})` : item.label;

// The × stays out of the Tab order; ArrowRight from its row reaches it and ArrowLeft returns.
const focusSibling = (event: KeyboardEvent, selector: string) => {
  const row = (event.currentTarget as HTMLElement).parentElement;
  row?.querySelector<HTMLElement>(selector)?.focus();
};

// The × is out of the Tab order, so Delete on the focused row removes it and focus stays in the list.
const removeRecent = async (id: string) => {
  const index = visibleRecent.value.findIndex((item) => item.id === id);
  emit("remove-recent", id);
  await nextTick();
  const rows = rootEl.value?.querySelectorAll<HTMLElement>("[data-date-time-rail-recent]");
  if (rows && rows.length > 0) rows[Math.min(index, rows.length - 1)].focus();
  else {
    const next = rootEl.value?.querySelector<HTMLElement>("[data-roving]:not([disabled])");
    (next ?? rootEl.value)?.focus();
  }
};

/** Focuses the first helper: a chip, or the first recent row on a picker with no chips. */
const focusFirst = () => {
  for (const group of ["relative", "calendar", "recent"] as const) {
    const key = tabStops.value[group];
    if (key) {
      focusKey(group, key);
      return true;
    }
  }
  return false;
};

defineExpose({ focusFirst });
</script>
