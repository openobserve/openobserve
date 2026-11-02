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
  <OInput
    v-model="text"
    size="sm"
    width="sm"
    :placeholder="placeholder"
    :aria-label="fieldLabel"
    :error="invalid"
    clearable
    :data-test="dataTest"
    @keydown.enter.prevent="commit"
    @blur="commit"
    @clear="emit('update:modelValue', undefined)"
  >
    <template #icon-right>
      <OPopover
        v-model:open="open"
        side="bottom"
        align="end"
        :aria-label="fieldLabel"
        content-class="p-1 shadow-lg!"
        @open-auto-focus="focusDay"
      >
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            icon-left="calendar-month"
            class="text-input-hint"
            :aria-label="t('components.date.openCalendar')"
            :data-test="`${dataTest}-trigger`"
          />
        </template>
        <div
          ref="calendarRef"
          class="flex justify-center px-3 py-2"
          :data-test="`${dataTest}-calendar`"
        >
          <ODateRangeCalendar
            :start-date="selectedDay"
            :end-date="selectedDay"
            :min-date="MIN_DAY"
            :max-date="today"
            @update:pending-date="pick"
          />
        </div>
      </OPopover>
    </template>
  </OInput>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { DateTime } from "luxon";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";

const MIN_DAY = "1999/01/01";

const props = defineProps<{
  /** The chosen day as YYYY-MM-DD, or undefined for any day. */
  modelValue?: string;
  /** Shown when no day is chosen, in the format the field displays. */
  placeholder: I18nText;
  fieldLabel: I18nText;
  dataTest: string;
  /** Timezone whose today is the last pickable day; the browser's when unset. */
  zone?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [day: string | undefined];
}>();

const { t } = useI18nTyped();
const open = ref(false);
const calendarRef = ref<HTMLElement | null>(null);

const todayText = () =>
  (props.zone ? DateTime.now().setZone(props.zone) : DateTime.local()).toFormat("yyyy/MM/dd");
const today = ref(todayText());
// Read on every open, so a drawer left open past midnight still offers the new day.
watch(open, (isOpen) => {
  if (isOpen) today.value = todayText();
});
// The calendar speaks the app's YYYY/MM/DD; the filter keeps YYYY-MM-DD.
const selectedDay = computed(() => props.modelValue?.replace(/-/g, "/"));
const shown = (day?: string) => (day ? DateTime.fromISO(day).toFormat("dd/MM/yyyy") : "");
const text = ref(shown(props.modelValue));
const invalid = ref(false);
watch(
  () => props.modelValue,
  (day) => {
    text.value = shown(day);
    invalid.value = false;
  },
);

// Typed days read day-first, the order the field shows; a day outside the calendar's range is refused.
const parseTyped = (value: string): string | null => {
  for (const format of ["d/M/yyyy", "d-M-yyyy", "d.M.yyyy"]) {
    const day = DateTime.fromFormat(value, format);
    if (!day.isValid) continue;
    const iso = day.toISODate();
    const last = todayText().replace(/\//g, "-");
    return iso && iso >= MIN_DAY.replace(/\//g, "-") && iso <= last ? iso : null;
  }
  return null;
};

const commit = () => {
  const value = String(text.value ?? "").trim();
  if (!value) {
    invalid.value = false;
    if (props.modelValue) emit("update:modelValue", undefined);
    return;
  }
  const day = parseTyped(value);
  invalid.value = !day;
  if (day && day !== props.modelValue) emit("update:modelValue", day);
};

// Arrow keys and Enter work only from a day cell, so open on the chosen day, else today.
const focusDay = (event: Event) => {
  const day =
    calendarRef.value?.querySelector<HTMLElement>("[data-selected]") ??
    calendarRef.value?.querySelector<HTMLElement>("[data-today]");
  if (!day) return;
  event.preventDefault();
  day.focus();
};

// A first click on the range calendar is one complete day for this filter.
const pick = (day: string | null) => {
  if (!day) return;
  emit("update:modelValue", day.replace(/\//g, "-"));
  open.value = false;
};
</script>
