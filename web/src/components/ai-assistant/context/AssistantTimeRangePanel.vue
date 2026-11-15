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
  <div class="flex flex-col" data-test="datetimerange-inline">
    <div class="border-datepicker-popup-border flex border-b" data-test="datetimerange-tabs">
      <button
        v-for="mode in MODES"
        :key="mode"
        type="button"
        :class="[TAB_CLASS, tab === mode ? TAB_ON_CLASS : TAB_OFF_CLASS]"
        :data-test="`datetimerange-tab-${mode}`"
        @click="tab = mode"
      >
        {{ t(`common.${mode}`) }}
      </button>
    </div>

    <div
      v-if="tab === 'relative'"
      class="flex flex-col gap-2 p-3"
      data-test="datetimerange-relative-panel"
    >
      <div v-for="unit in UNITS" :key="unit" class="flex items-center gap-2">
        <span class="text-datepicker-relative-label w-14 shrink-0 text-xs capitalize">{{
          t(UNIT_KEYS[unit])
        }}</span>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="amount in AMOUNTS[unit]"
            :key="amount"
            type="button"
            :class="[
              AMOUNT_CLASS,
              seed.unit === unit && seed.amount === amount ? AMOUNT_ON_CLASS : AMOUNT_OFF_CLASS,
            ]"
            @click="emit('period', `${amount}${unit}`)"
          >
            {{ amount }}
          </button>
        </div>
      </div>
      <div class="border-datepicker-popup-border mt-1 flex items-center gap-2 border-t pt-2">
        <span class="text-datepicker-relative-label w-14 shrink-0 text-xs">{{
          t("common.custom")
        }}</span>
        <input
          v-model="customAmount"
          type="number"
          min="1"
          :aria-label="t('common.timeAmount')"
          class="rounded-default border-datepicker-border bg-datepicker-bg text-datepicker-text focus:border-datepicker-focus-border h-7 w-16 border px-2 text-xs tabular-nums outline-none"
          data-test="datetimerange-custom-amount"
          @input="onAmountInput"
          @blur="onAmountBlur"
          @keydown.enter="applyCustom"
        />
        <select
          ref="unitSelect"
          v-model="customUnit"
          :aria-label="t('common.timeUnit')"
          class="rounded-default border-datepicker-border bg-datepicker-bg text-datepicker-text focus:border-datepicker-focus-border h-7 flex-1 border px-2 text-xs outline-none"
          data-test="datetimerange-custom-unit"
          @change="onUnitPick"
        >
          <option v-for="unit in UNITS" :key="unit" :value="unit">{{ t(UNIT_KEYS[unit]) }}</option>
        </select>
      </div>
    </div>

    <div v-else class="flex flex-col gap-3 p-3" data-test="datetimerange-absolute-panel">
      <ODateRangeCalendar
        :start-date="startDate"
        :end-date="endDate"
        @update:start-date="startDate = $event"
        @update:end-date="onDates"
        @update:pending-date="pending = $event"
      />
      <p
        v-if="rangeLabel"
        class="text-datepicker-weekday-text text-center text-xs"
        aria-live="polite"
      >
        {{ rangeLabel }}
      </p>
      <div class="flex gap-3 [--color-datepicker-border:var(--color-datepicker-inner-border)]">
        <OTime
          v-model="startTime"
          :label="t('common.startTime')"
          data-test="datetimerange-start-time"
          @change="onTime('start')"
          @keydown.enter="apply(true)"
        />
        <OTime
          v-model="endTime"
          :label="t('common.endTime')"
          data-test="datetimerange-end-time"
          @change="onTime('end')"
          @keydown.enter="apply(true)"
        />
      </div>
      <OText
        v-if="reversed"
        variant="meta"
        as="p"
        role="alert"
        class="text-status-error-text"
        data-test="assistant-context-time-reversed"
      >
        {{ t("assistant.context.time.reversed") }}
      </OText>
    </div>
  </div>
</template>

<script lang="ts">
import type { TimeWindow } from "@/composables/assistant";
import type { I18nKey } from "@/types/i18n";

export interface AssistantTimeRangePanelProps {
  /** The window the chip shows; the panel opens on it. */
  window: TimeWindow;
  /** The zone the absolute fields read and write in. */
  timezone: string;
}

export interface AssistantTimeRangePanelEmits {
  /** A relative pick such as "7h"; it ends the entry. */
  (e: "period", period: string): void;
  /** A valid absolute range in ms; `done` once the entry is finished (two dates, Enter), not on a time edit. */
  (e: "range", range: { from: number; to: number }, done: boolean): void;
}

const MODES = ["relative", "absolute"] as const;

const UNITS = ["s", "m", "h", "d", "w", "M"] as const;
type Unit = (typeof UNITS)[number];

const UNIT_KEYS: Record<Unit, I18nKey> = {
  s: "common.seconds",
  m: "common.minutes",
  h: "common.hours",
  d: "common.days",
  w: "common.weeks",
  M: "common.months",
};

const AMOUNTS: Record<Unit, number[]> = {
  s: [1, 5, 10, 15, 30, 45],
  m: [1, 5, 10, 15, 30, 45],
  h: [1, 2, 3, 6, 8, 12],
  d: [1, 2, 3, 4, 5, 6],
  w: [1, 2, 3, 4, 5, 6],
  M: [1, 2, 3, 4, 5, 6],
};

const FOCUS_CLASS =
  "ring-offset-surface-base focus-visible:ring-datepicker-focus-ring ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2";
const TAB_CLASS = `${FOCUS_CLASS} flex-1 border-b-2 py-2.5 text-sm`;
const TAB_ON_CLASS = "border-datepicker-day-selected-bg text-datepicker-accent-text font-medium";
const TAB_OFF_CLASS =
  "text-datepicker-weekday-text hover:text-datepicker-heading-text border-transparent";
const AMOUNT_CLASS = `${FOCUS_CLASS} rounded-default h-7 w-8 text-xs tabular-nums`;
const AMOUNT_ON_CLASS =
  "bg-datepicker-relative-btn-selected-bg text-datepicker-relative-btn-selected-text";
const AMOUNT_OFF_CLASS =
  "bg-datepicker-relative-btn-bg text-datepicker-relative-btn-text hover:bg-datepicker-relative-btn-hover-bg cursor-pointer";

/** `YYYY/MM/DD` of the day after `date`; calendar maths, so no zone or DST can shift it. */
function nextDay(date: string): string {
  const [year, month, day] = date.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10).replace(/-/g, "/");
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";

import OText from "@/lib/core/Typography/OText.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import { useI18nTyped } from "@/types/i18n";
import { convertDateToTimestamp, formatTimestampInTimezone } from "@/utils/date";

const props = defineProps<AssistantTimeRangePanelProps>();
const emit = defineEmits<AssistantTimeRangePanelEmits>();

const { t } = useI18nTyped();

// The panel mounts each time Custom Range… opens, so it reads the window once.
const match = props.window.period ? /^(\d+)([smhdwM])$/.exec(props.window.period) : null;
const seed = { amount: match ? Number(match[1]) : 0, unit: (match?.[2] ?? "m") as Unit };
const shown = (ms: number, format: string) =>
  match ? "" : formatTimestampInTimezone(ms * 1000, format, props.timezone);

const tab = ref<(typeof MODES)[number]>(match ? "relative" : "absolute");

// ── Relative: the custom row applies on Enter, a unit pick after a typed amount, or leaving the amount after a unit pick.
const customAmount = ref(String(Math.max(1, seed.amount)));
const customUnit = ref<Unit>(seed.unit);
const unitSelect = ref<HTMLSelectElement | null>(null);
let amountTyped = false;
let unitPicked = false;

function applyCustom(): void {
  const amount = parseInt(customAmount.value, 10);
  if (amount > 0) emit("period", `${amount}${customUnit.value}`);
}

function onAmountInput(): void {
  amountTyped = true;
}

function onUnitPick(): void {
  unitPicked = true;
  if (amountTyped) applyCustom();
}

function onAmountBlur(event: FocusEvent): void {
  if (unitPicked && event.relatedTarget !== unitSelect.value) applyCustom();
}

// ── Absolute: as the Logs picker, a time edit applies at once, a clock pick included.
const startDate = ref(shown(props.window.from, "YYYY/MM/DD"));
const endDate = ref(shown(props.window.to, "YYYY/MM/DD"));
const startTime = ref(shown(props.window.from, "HH:mm"));
const endTime = ref(shown(props.window.to, "HH:mm"));
/** The first date of a new range, waiting for its end. */
const pending = ref<string | null>(null);
const reversed = ref(false);
const touched = { start: false, end: false };

const rangeLabel = computed(() => {
  const label = pending.value ?? (startDate.value && `${startDate.value} — ${endDate.value}`);
  return label ? label.replace(/\//g, "-") : null;
});

function at(date: string, time: string): number {
  const [year, month, day] = date.split("/");
  return convertDateToTimestamp(`${day}-${month}-${year}`, time, props.timezone).timestamp / 1000;
}

function apply(done: boolean): void {
  if (pending.value || !startDate.value || !endDate.value) return;
  // An empty time is the day's edge: the start's 00:00, or 00:00 after the end day.
  const from = at(startDate.value, startTime.value || "00:00");
  const to = endTime.value ? at(endDate.value, endTime.value) : at(nextDay(endDate.value), "00:00");
  reversed.value = !(from > 0 && to > from);
  if (!reversed.value) emit("range", { from, to }, done);
}

function onTime(which: keyof typeof touched): void {
  touched[which] = true;
  apply(false);
}

// Two picked dates mean whole days; only a time the user set here survives them.
function onDates(end: string): void {
  endDate.value = end;
  pending.value = null;
  if (!touched.start) startTime.value = "";
  if (!touched.end) endTime.value = "";
  apply(true);
}
</script>
