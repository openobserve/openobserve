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
  <div class="flex flex-col gap-5" data-test="downtime-schedule">
    <OFormToggleGroup
      name="schedule.repeat"
      data-test="downtime-schedule-repeat"
      @update:model-value="onRepeatChange"
    >
      <OToggleGroupItem value="none" size="sm" data-test="downtime-schedule-repeat-none">
        {{ t("alerts.downtimes.scheduleForm.once") }}
      </OToggleGroupItem>
      <OToggleGroupItem value="daily" size="sm" data-test="downtime-schedule-repeat-daily">
        {{ t("alerts.downtimes.scheduleForm.daily") }}
      </OToggleGroupItem>
      <OToggleGroupItem value="weekly" size="sm" data-test="downtime-schedule-repeat-weekly">
        {{ t("alerts.downtimes.scheduleForm.weekly") }}
      </OToggleGroupItem>
    </OFormToggleGroup>

    <template v-if="repeat === 'none'">
      <div class="flex flex-wrap items-start gap-3 max-md:flex-col">
        <OFormDate
          name="schedule.start_date"
          :label="t('alerts.downtimes.scheduleForm.startDate')"
          required
          data-test="downtime-schedule-start-date"
          @update:model-value="onStartChange('start_date', $event)"
        />
        <OFormTime
          name="schedule.start_time"
          :label="t('alerts.downtimes.scheduleForm.startTime')"
          required
          data-test="downtime-schedule-start-time"
          @update:model-value="onStartChange('start_time', $event)"
        />
      </div>
      <div class="flex flex-wrap items-start gap-3 max-md:flex-col">
        <OFormDate
          name="schedule.end_date"
          :label="t('alerts.downtimes.scheduleForm.endDate')"
          required
          data-test="downtime-schedule-end-date"
        />
        <OFormTime
          name="schedule.end_time"
          :label="t('alerts.downtimes.scheduleForm.endTime')"
          required
          data-test="downtime-schedule-end-time"
        />
      </div>
      <p
        v-if="pastSloOnly"
        class="text-text-secondary text-xs"
        data-test="downtime-schedule-past-slo-only"
      >
        {{ t("alerts.downtimes.validation.pastSloOnly") }}
      </p>
    </template>

    <template v-else>
      <OFormToggleGroup
        v-if="repeat === 'weekly'"
        name="schedule.weekdays"
        type="multiple"
        :label="t('alerts.downtimes.scheduleForm.days')"
        label-position="top"
        data-test="downtime-schedule-weekdays"
      >
        <OToggleGroupItem
          v-for="day in weekdays"
          :key="day.value"
          :value="day.value"
          size="sm"
          :data-test="`downtime-schedule-weekday-${day.value}`"
        >
          {{ day.label }}
        </OToggleGroupItem>
      </OFormToggleGroup>
      <OFormDate
        name="schedule.start_date"
        :label="t('alerts.downtimes.scheduleForm.startsOn')"
        required
        data-test="downtime-schedule-starts-on"
      />
      <div class="flex flex-wrap items-start gap-3 max-md:flex-col">
        <OFormTime
          name="schedule.start_time"
          :label="t('alerts.downtimes.scheduleForm.startsAt')"
          required
          data-test="downtime-schedule-start-time"
        />
        <OFormInput
          name="schedule.duration"
          :label="t('alerts.downtimes.scheduleForm.duration')"
          :placeholder="t('alerts.downtimes.scheduleForm.durationPlaceholder')"
          :help-text="t('alerts.downtimes.scheduleForm.durationHelp')"
          width="sm"
          required
          data-test="downtime-schedule-duration"
        />
      </div>
      <OFormDate
        name="schedule.until_date"
        :label="t('alerts.downtimes.scheduleForm.until')"
        :placeholder="t('alerts.downtimes.scheduleForm.untilPlaceholder')"
        clearable
        data-test="downtime-schedule-until"
      />
    </template>

    <OFormSelect
      name="schedule.timezone"
      :label="t('alerts.downtimes.scheduleForm.timezone')"
      :options="timezoneOptions"
      searchable
      required
      width="md"
      data-test="downtime-schedule-timezone"
    />

    <p class="text-text-secondary text-sm" data-test="downtime-schedule-next-window">
      {{ nextWindowText }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useTimezoneOptions } from "@/composables/useTimezoneOptions";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import {
  buildSchedule,
  scheduleForRepeat,
  type DowntimeFormValues,
} from "@/utils/downtimes/downtimeForm";
import type { Repeat } from "@/services/downtimes";
import {
  ISO_WEEKDAYS,
  currentOrNextWindow,
  formatWindow,
  localToUtcMicros,
  utcMicrosToLocal,
} from "@/utils/downtimes/schedule";
import { canonicalTimezone } from "@/utils/timezoneAliases";
import { getIntlLocale } from "@/locales";
import { serverNowMs } from "@/composables/useAnnouncementBanners";
import { endsInPast } from "./AddDowntime.schema";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";

const { t } = useI18nTyped();
const form = inject(FORM_CONTEXT_KEY, null);
const schedule = form.useStore((s: { values: DowntimeFormValues }) => s.values.schedule);
const values = form.useStore((s: { values: DowntimeFormValues }) => s.values);
// A past window with an SLO target is allowed: it only corrects SLO data (D7).
const pastSloOnly = computed(
  () => !!values.value?.modules.includes("slos") && endsInPast(values.value, serverNowMs()),
);
// The stored zone is an option under its own name, so a legacy `Asia/Calcutta` saves back unchanged.
const { timezoneOptions } = useTimezoneOptions({ current: () => schedule.value?.timezone });
const repeat = computed(() => schedule.value?.repeat);

const REPEATS: readonly Repeat[] = ["none", "daily", "weekly"];

// A start the user moves moves the end by the same amount, so the window keeps its length.
// It runs from the start controls, not a watcher, so a loaded row or a reset moves nothing.
// The control calls this before the form stores the new start, so `schedule` still holds the old one.
const onStartChange = (part: "start_date" | "start_time", value: unknown) => {
  const s = schedule.value;
  if (!s || s.repeat !== "none" || typeof value !== "string" || value === s[part]) return;
  const zone = s.timezone;
  const oldStart = localToUtcMicros(s.start_date, s.start_time, zone);
  const oldEnd = localToUtcMicros(s.end_date, s.end_time, zone);
  const newStart =
    part === "start_date"
      ? localToUtcMicros(value, s.start_time, zone)
      : localToUtcMicros(s.start_date, value, zone);
  if (oldStart === null || oldEnd === null || newStart === null || oldEnd <= oldStart) return;
  const end = utcMicrosToLocal(newStart + (oldEnd - oldStart), zone);
  form.setFieldValue("schedule.end_date", end.date);
  form.setFieldValue("schedule.end_time", end.time);
};

// Only a user pick resets the dates; a loaded row sets the repeat without passing through here.
const onRepeatChange = (next: unknown) => {
  const picked = REPEATS.find((r) => r === next);
  if (!picked || !schedule.value) return;
  form.setFieldValue("schedule", scheduleForRepeat(schedule.value, picked, Date.now()));
};

// The app's language, not the browser's, as every downtime label reads.
const locale = getIntlLocale();
const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
// 2024-01-01 is a Monday, so ISO day n is 2024-01-0n.
const weekdays = ISO_WEEKDAYS.map((d) => ({
  value: d,
  label: raw(weekdayFormat.format(new Date(Date.UTC(2024, 0, d)))),
}));

const nextWindowText = computed(() => {
  if (!schedule.value) return "";
  const built = buildSchedule(schedule.value);
  const window = currentOrNextWindow(built, Date.now() * 1000);
  if (!window) return t("alerts.downtimes.scheduleForm.noWindow");
  const inZone = formatWindow(window, built.timezone, t, locale);
  const inUtc = formatWindow(window, "UTC", t, locale);
  // Canonical only for display, so a stored `Etc/UTC` shows the window once.
  return canonicalTimezone(built.timezone) === "UTC"
    ? t("alerts.downtimes.scheduleForm.nextWindow", { window: inZone })
    : t("alerts.downtimes.scheduleForm.nextWindowWithUtc", { window: inZone, utc: inUtc });
});
</script>
