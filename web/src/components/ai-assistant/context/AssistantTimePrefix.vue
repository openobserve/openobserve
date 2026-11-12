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
  <span
    v-if="loading"
    class="inline-flex shrink-0 items-center"
    aria-hidden="true"
    data-test="assistant-context-chip-time-skeleton"
  >
    <OSkeleton type="rect" class="h-6 w-24" />
  </span>
  <OPopover
    v-else
    :open="open"
    privacy="mask"
    side="top"
    :align="align"
    :aria-label="t('assistant.context.time.swap')"
    :content-class="`${composerPopoverClass(layout.tight)} flex flex-col gap-0.5 p-1`"
    @update:open="setOpen"
    @pointer-down-outside="keepOnChip"
  >
    <!-- An anchor, not a trigger: a set range carries a ✕, and focus must return to the label beside it -->
    <template #anchor>
      <OTooltip :content="t('assistant.context.time.hint')">
        <OTag
          ref="chip"
          type="assistantContext"
          :label="text"
          :icon="assistantGlyph.chipTime"
          clickable
          :disabled="disabled"
          :removable="removable"
          label-button
          :remove-label="t('assistant.context.remove', { label: text })"
          remove-data-test="assistant-context-chip-time-remove"
          :aria-label="name"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :class="['shrink-0 motion-safe:transition-colors', CHIP_HIT_AREA_CLASS]"
          data-test="assistant-context-chip-time"
          @click="setOpen(!open)"
          @remove="pick(null)"
        />
      </OTooltip>
    </template>
    <div class="flex flex-col gap-0.5" data-test="assistant-context-time-picker">
      <div
        ref="group"
        role="radiogroup"
        tabindex="-1"
        :aria-label="t('assistant.context.time.swap')"
        class="flex flex-col gap-0.5"
        @keydown="onGroupKeydown"
      >
        <AssistantMenuRow
          v-if="pageWindow"
          :label="t('assistant.composer.mention.pageTime')"
          :meta="textOf(pageWindow)"
          :selected="window.source === 'page'"
          :tabbable="tabbableId === 'page'"
          data-test="assistant-context-time-page"
          @click="pick(null)"
        />
        <AssistantMenuRow
          v-for="period in PERIODS"
          :key="period"
          :label="periodLabel(period)"
          :selected="isSelected(period)"
          :tabbable="tabbableId === period"
          :data-test="`assistant-context-time-${period}`"
          @click="pickPeriod(period)"
        />
      </div>
      <ODateTimeRange
        v-bind="pickerValue"
        :label="t('assistant.context.time.dateRange')"
        :timezone="timezone"
        show-timezone
        :auto-apply="false"
        tabindex="0"
        class="mt-1.5"
        data-test="assistant-context-time-range"
        @change="onPick"
      />
      <OText
        v-if="reversed"
        variant="meta"
        as="p"
        role="alert"
        class="text-status-error-text px-2 py-1"
        data-test="assistant-context-time-reversed"
      >
        {{ t("assistant.context.time.reversed") }}
      </OText>
    </div>
  </OPopover>
</template>

<script lang="ts">
import type { ComposerState, TimeWindow } from "@/composables/assistant";

export interface AssistantTimePrefixProps {
  window: TimeWindow;
  /** The page's own window, offered as "Page time"; null where the page has none. */
  pageWindow?: TimeWindow | null;
  timezone?: string;
  align?: "start" | "end";
  disabled?: boolean;
  /** The page range is still loading, so the chip would name a window that is about to change. */
  loading?: boolean;
  /** The chip has no ✕: the default window is always one pick away, so there is nothing to remove. */
  fixed?: boolean;
}

export interface AssistantTimePrefixEmits {
  /** `null` goes back to the page's time or the default. */
  (e: "change", range: ComposerState["timeOverride"]): void;
}

const PERIODS = ["15m", "1h", "24h", "7d"] as const;

const DEFAULT_PERIOD = "15m";

const UNIT_OF: Record<string, RelativeUnit> = {
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
  w: "weeks",
  M: "months",
};

const LETTER_OF: Record<RelativeUnit, string> = {
  seconds: "s",
  minutes: "m",
  hours: "h",
  days: "d",
  weeks: "w",
  months: "M",
};
</script>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  CHIP_HIT_AREA_CLASS,
  composerPopoverClass,
  useComposerLayout,
} from "@/components/ai-assistant/composer/composerUi";
import { periodMs, timeRangeShortText } from "@/composables/assistant";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type {
  DateTimeRangeValue,
  RelativeUnit,
} from "@/lib/forms/DateTimeRange/ODateTimeRange.types";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { convertDateToTimestamp, formatTimestampInTimezone } from "@/utils/date";

import AssistantMenuRow from "./AssistantMenuRow.vue";

const props = withDefaults(defineProps<AssistantTimePrefixProps>(), {
  pageWindow: null,
  timezone: "UTC",
  align: "start",
  disabled: false,
  loading: false,
  fixed: false,
});

const emit = defineEmits<AssistantTimePrefixEmits>();

/** The picker; a + menu opens it from outside. */
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const layout = useComposerLayout();
const reversed = ref(false);
const group = ref<HTMLElement | null>(null);
const chip = ref<ComponentPublicInstance | null>(null);

const text = computed(() => textOf(props.window));
// Only a range the user picked can be dropped; its ✕ goes back to the page's time or the default.
const removable = computed(
  () => props.window.source === "custom" && !props.disabled && !props.fixed,
);
const name = computed(() =>
  t("assistant.context.time.name", {
    range: text.value,
    source: t(`assistant.context.time.source.${props.window.source}`),
  }),
);

// The picker opens on the window the prefix shows: relative stays relative, a range shows its ends in the org zone.
const pickerValue = computed(() => {
  const match = props.window.period ? /^(\d+)([smhdwM])$/.exec(props.window.period) : null;
  if (match)
    return {
      mode: "relative" as const,
      relativeAmount: Number(match[1]),
      relativeUnit: UNIT_OF[match[2]],
    };
  const at = (ms: number, format: string) =>
    formatTimestampInTimezone(ms * 1000, format, props.timezone);
  return {
    mode: "absolute" as const,
    startDate: at(props.window.from, "YYYY-MM-DD"),
    startTime: at(props.window.from, "HH:mm"),
    endDate: at(props.window.to, "YYYY-MM-DD"),
    endTime: at(props.window.to, "HH:mm"),
  };
});

// Roving tabindex: Tab reaches the checked row, or the first row when a custom range is set.
const tabbableId = computed(() => {
  if (props.pageWindow && props.window.source === "page") return "page";
  const checked = PERIODS.find((period) => isSelected(period));
  if (checked) return checked;
  return props.pageWindow ? "page" : PERIODS[0];
});

function textOf(window: TimeWindow): I18nText {
  const short = timeRangeShortText(window);
  return window.period ? t("assistant.context.time.last", { period: short }) : short;
}

function periodLabel(period: string): I18nText {
  return textOf({ from: 0, to: 0, period, source: "custom" });
}

function isSelected(period: string): boolean {
  if (props.window.source === "page") return false;
  return props.window.period === period;
}

function setOpen(value: boolean): void {
  open.value = value;
  reversed.value = false;
}

// A press on the chip toggles the picker itself, so it must not also count as a press outside.
function keepOnChip(event: Event): void {
  const el: unknown = chip.value?.$el;
  if (el instanceof Element && event.target instanceof Node && el.contains(event.target))
    event.preventDefault();
}

function pick(range: ComposerState["timeOverride"]): void {
  emit("change", range);
  setOpen(false);
}

function pickPeriod(period: string): void {
  if (period === DEFAULT_PERIOD && !props.pageWindow) return pick(null);
  const to = Date.now();
  pick({ from: to - periodMs(period), to, period });
}

function onPick(value: DateTimeRangeValue): void {
  if (value.type === "relative") return pickPeriod(`${value.amount}${LETTER_OF[value.unit]}`);
  const ms = (date: string, time: string) => {
    const [year, month, day] = date.split("-");
    return (
      convertDateToTimestamp(
        `${day}-${month}-${year}`,
        time || "00:00",
        value.timezone || props.timezone,
      ).timestamp / 1000
    );
  };
  const from = ms(value.startDate, value.startTime);
  const to = ms(value.endDate, value.endTime);
  reversed.value = !(from > 0 && to > from);
  if (!reversed.value) pick({ from, to });
}

// Arrows move focus only; picking a row applies it and closes the picker, so selection cannot follow focus.
function onGroupKeydown(event: KeyboardEvent): void {
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
  const isEdge = event.key === "Home" || event.key === "End";
  if (!step && !isEdge) return;
  const rows = Array.from(group.value?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
  if (!rows.length) return;
  event.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : (Math.max(at, 0) + (step ?? 0) + rows.length) % rows.length;
  rows[next].focus();
}
</script>
