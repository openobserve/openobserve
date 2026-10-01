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
    <OFormToggleGroup name="schedule.repeat" data-test="downtime-schedule-repeat">
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
        />
        <OFormTime
          name="schedule.start_time"
          :label="t('alerts.downtimes.scheduleForm.startTime')"
          required
          data-test="downtime-schedule-start-time"
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
import { buildSchedule, type DowntimeFormValues } from "@/utils/downtimes/downtimeForm";
import { ISO_WEEKDAYS, currentOrNextWindow, formatWindow } from "@/utils/downtimes/schedule";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";

const { t } = useI18nTyped();
const form = inject(FORM_CONTEXT_KEY, null);
const { timezoneOptions } = useTimezoneOptions();

const schedule = form.useStore((s: { values: DowntimeFormValues }) => s.values.schedule);
const repeat = computed(() => schedule.value?.repeat);

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
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
  const inZone = formatWindow(window, built.timezone, t);
  const inUtc = formatWindow(window, "UTC", t);
  return built.timezone === "UTC"
    ? t("alerts.downtimes.scheduleForm.nextWindow", { window: inZone })
    : t("alerts.downtimes.scheduleForm.nextWindowWithUtc", { window: inZone, utc: inUtc });
});
</script>
