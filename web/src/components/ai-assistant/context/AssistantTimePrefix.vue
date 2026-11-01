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
  <OPopover
    :open="open"
    privacy="mask"
    side="top"
    :align="align"
    :aria-label="t('assistant.context.time.swap')"
    :content-class="`${composerPopoverClass(layout.tight)} flex flex-col gap-0.5 p-1`"
    @update:open="setOpen"
  >
    <template #trigger>
      <OButton
        variant="ghost"
        size="chip"
        :disabled="disabled"
        :aria-label="name"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :class="['text-text-secondary shrink-0', TOUCH_TARGET_CLASS]"
        data-test="assistant-context-chip-time"
      >
        <OIcon :name="assistantGlyph.chipTime" size="xs" />
        <span class="whitespace-nowrap">{{ text }}</span>
      </OButton>
    </template>
    <div role="menu" class="flex flex-col gap-0.5" data-test="assistant-context-time-picker">
      <AssistantMenuRow
        v-if="pageWindow"
        :label="t('assistant.composer.mention.pageTime')"
        :meta="textOf(pageWindow)"
        :selected="window.source === 'page'"
        data-test="assistant-context-time-page"
        @click="pick(null)"
      />
      <AssistantMenuRow
        v-for="period in PERIODS"
        :key="period"
        :label="periodLabel(period)"
        :meta="
          period === DEFAULT_PERIOD && !pageWindow
            ? t('assistant.context.time.source.default')
            : undefined
        "
        :selected="isSelected(period)"
        :data-test="`assistant-context-time-${period}`"
        @click="pickPeriod(period)"
      />
      <ODateTimeRange
        v-bind="pickerValue"
        :timezone="timezone"
        show-timezone
        :auto-apply="false"
        tabindex="0"
        class="mt-0.5"
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
import { computed, ref } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  composerPopoverClass,
  useComposerLayout,
} from "@/components/ai-assistant/composer/composerUi";
import { periodMs, timeRangeShortText } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type {
  DateTimeRangeValue,
  RelativeUnit,
} from "@/lib/forms/DateTimeRange/ODateTimeRange.types";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { convertDateToTimestamp, formatTimestampInTimezone } from "@/utils/date";

import AssistantMenuRow from "./AssistantMenuRow.vue";

const props = withDefaults(defineProps<AssistantTimePrefixProps>(), {
  pageWindow: null,
  timezone: "UTC",
  align: "start",
  disabled: false,
});

const emit = defineEmits<AssistantTimePrefixEmits>();

const { t } = useI18nTyped();
const layout = useComposerLayout();
const open = ref(false);
const reversed = ref(false);

const text = computed(() => textOf(props.window));
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
</script>
