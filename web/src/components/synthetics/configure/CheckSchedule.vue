<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserCheck, BrowserCheckSchedule } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODate from "@/lib/forms/Date/ODate.vue";
import OTime from "@/lib/forms/Time/OTime.vue";

const props = defineProps<{ check: BrowserCheck }>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18n();

function updateSchedule(patch: Partial<BrowserCheckSchedule>) {
  emit("update:check", {
    ...props.check,
    schedule: { ...props.check.schedule, ...patch },
  });
}

// ─── frequency preset ─────────────────────────────────────────────────────────

type FrequencyPreset = "1min" | "5min" | "15min" | "30min" | "1hour" | "cron" | "custom";

const frequencyOptions: { label: string; value: FrequencyPreset }[] = [
  { label: t("synthetics.scheduleAlert.frequencyOptions.1min"), value: "1min" },
  { label: t("synthetics.scheduleAlert.frequencyOptions.5min"), value: "5min" },
  { label: t("synthetics.scheduleAlert.frequencyOptions.15min"), value: "15min" },
  { label: t("synthetics.scheduleAlert.frequencyOptions.30min"), value: "30min" },
  { label: t("synthetics.scheduleAlert.frequencyOptions.1hour"), value: "1hour" },
  { label: t("synthetics.scheduleAlert.frequencyOptions.cron"), value: "cron" },
  { label: t("synthetics.scheduleAlert.frequencyOptions.custom"), value: "custom" },
];

function scheduleToPreset(s: BrowserCheckSchedule): FrequencyPreset {
  if (s.type === "cron") return "cron";
  if (s.isCustomFrequency) return "custom";
  const mins = s.intervalUnit === "hours" ? (s.intervalValue ?? 1) * 60 : (s.intervalValue ?? 5);
  if (mins === 1) return "1min";
  if (mins === 5) return "5min";
  if (mins === 15) return "15min";
  if (mins === 30) return "30min";
  if (mins === 60) return "1hour";
  return "custom";
}

const frequencyPreset = computed<FrequencyPreset>({
  get: () => scheduleToPreset(props.check.schedule),
  set: (v: FrequencyPreset) => {
    if (v === "cron") {
      const patch: Partial<BrowserCheckSchedule> = { type: "cron", isCustomFrequency: false };
      if (!props.check.schedule.timezone) {
        try {
          patch.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          patch.timezone = "UTC";
        }
      }
      updateSchedule(patch);
    } else if (v === "custom") {
      const cur = props.check.schedule;
      updateSchedule({
        type: "interval",
        intervalValue: cur.intervalValue ?? 10,
        intervalUnit: cur.intervalUnit ?? "minutes",
        cron: "",
        isCustomFrequency: true,
      });
    } else {
      const map: Record<
        Exclude<FrequencyPreset, "custom">,
        { intervalValue: number; intervalUnit: "minutes" | "hours" }
      > = {
        "1min": { intervalValue: 1, intervalUnit: "minutes" },
        "5min": { intervalValue: 5, intervalUnit: "minutes" },
        "15min": { intervalValue: 15, intervalUnit: "minutes" },
        "30min": { intervalValue: 30, intervalUnit: "minutes" },
        "1hour": { intervalValue: 1, intervalUnit: "hours" },
        cron: { intervalValue: 5, intervalUnit: "minutes" },
      };
      updateSchedule({ type: "interval", ...map[v], isCustomFrequency: false });
    }
  },
});

// ─── cron + timezone ──────────────────────────────────────────────────────────

const cron = computed({
  get: () => props.check.schedule.cron ?? "",
  set: (v: string) => updateSchedule({ cron: v }),
});

function buildTimezoneOptions(): { label: string; value: string }[] {
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const options: { label: string; value: string }[] = [
      {
        label: t("synthetics.scheduleAlert.browserTime", { tz: browserTz }),
        value: t("synthetics.scheduleAlert.browserTime", { tz: browserTz }),
      },
      { label: "UTC", value: "UTC" },
    ];
    // @ts-ignore - supportedValuesOf not in all TS versions
    if (typeof Intl.supportedValuesOf === "function") {
      // @ts-ignore
      for (const tz of Intl.supportedValuesOf("timeZone") as string[]) {
        if (tz !== "UTC") options.push({ label: tz, value: tz });
      }
    }
    return options;
  } catch {
    /* fall through */
  }
  return [{ label: "UTC", value: "UTC" }];
}

const timezoneOptions = buildTimezoneOptions();

const timezone = computed({
  get: () => {
    if (props.check.schedule.timezone) return props.check.schedule.timezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  },
  set: (v: string | number | boolean | null | undefined) =>
    updateSchedule({ timezone: v != null ? String(v) : "UTC" }),
});

// ─── custom interval inputs ───────────────────────────────────────────────────

const customIntervalValue = computed({
  get: () => props.check.schedule.intervalValue ?? 10,
  set: (v: string | number) => updateSchedule({ intervalValue: Number(v) }),
});

const customIntervalUnit = computed({
  get: () => props.check.schedule.intervalUnit ?? "minutes",
  set: (v: string) => updateSchedule({ intervalUnit: v as BrowserCheckSchedule["intervalUnit"] }),
});

const customIntervalUnitOptions = [
  { label: t("synthetics.scheduleAlert.customIntervalUnit.minutes"), value: "minutes" },
  { label: t("synthetics.scheduleAlert.customIntervalUnit.hours"), value: "hours" },
  { label: t("synthetics.scheduleAlert.customIntervalUnit.days"), value: "days" },
  { label: t("synthetics.scheduleAlert.customIntervalUnit.weeks"), value: "weeks" },
  { label: t("synthetics.scheduleAlert.customIntervalUnit.months"), value: "months" },
];

// ─── start type ───────────────────────────────────────────────────────────────

const startType = computed({
  get: () => props.check.schedule.startType ?? "now",
  set: (v: string) => {
    const patch: Partial<BrowserCheckSchedule> = { startType: v as "now" | "later" };
    if (v === "later" && !props.check.schedule.timezone) {
      try {
        patch.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        patch.timezone = "UTC";
      }
    }
    updateSchedule(patch);
  },
});

const startDate = computed({
  get: () => props.check.schedule.startDate ?? "",
  set: (v: string) => updateSchedule({ startDate: v }),
});

const startTime = computed({
  get: () => props.check.schedule.startTime ?? "",
  set: (v: string) => updateSchedule({ startTime: v }),
});
</script>

<template>
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-primary-600" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t("synthetics.scheduleAlert.schedule") }}
      </h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">
      <!-- ── Frequency + Schedule Now/Later (same row) ───────────────── -->
      <div class="flex items-end gap-8 flex-wrap">
        <!-- Frequency -->
        <div>
          <label class="text-sm font-medium text-text-body mb-1 block">
            {{ t("synthetics.scheduleAlert.frequency") }}
          </label>
          <OToggleGroup
            v-model="frequencyPreset"
            type="single"
            data-test="synthetics-check-schedule-frequency-toggle"
          >
            <OToggleGroupItem
              v-for="opt in frequencyOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              :data-test="`synthetics-check-schedule-frequency-${opt.value}-item`"
            >
              {{ opt.label }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>

        <!-- Schedule Now / Later -->
        <div v-if="check.schedule.type !== 'cron'" class="flex items-center gap-2">
          <OToggleGroup
            v-model="startType"
            type="single"
            data-test="synthetics-check-schedule-start-type-toggle"
          >
            <OToggleGroupItem
              value="now"
              size="sm"
              data-test="synthetics-check-schedule-start-now-item"
            >
              {{ t("synthetics.scheduleAlert.scheduleNow") }}
            </OToggleGroupItem>
            <OToggleGroupItem
              value="later"
              size="sm"
              data-test="synthetics-check-schedule-start-later-item"
            >
              {{ t("synthetics.scheduleAlert.scheduleLater") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OIcon name="info-outline" size="sm" class="cursor-pointer text-text-muted">
            <OTooltip side="right" align="center">
              <template #content>
                {{ t("synthetics.scheduleAlert.scheduleNowTooltip") }}<br />
                {{ t("synthetics.scheduleAlert.scheduleLaterTooltip") }}
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>

      <!-- Cron inputs -->
      <div v-if="check.schedule.type === 'cron'" class="flex items-start gap-3 flex-wrap">
        <OInput
          v-model="cron"
          :label="t('synthetics.scheduleAlert.cronExpression')"
          placeholder="*/5 * * * *"
          class="w-83!"
          data-test="synthetics-check-schedule-cron-input"
        />
        <OSelect
          v-model="timezone"
          :label="t('synthetics.scheduleAlert.timezone')"
          :options="timezoneOptions"
          class="w-64!"
          data-test="synthetics-check-schedule-timezone-select"
        />
      </div>

      <!-- Custom interval inputs -->
      <div v-if="frequencyPreset === 'custom'" class="flex items-start gap-3 flex-wrap">
        <OInput
          v-model="customIntervalValue"
          :label="t('synthetics.scheduleAlert.customIntervalValue')"
          type="number"
          min="1"
          class="w-40!"
          data-test="synthetics-check-schedule-custom-interval-value-input"
        />
        <OSelect
          v-model="customIntervalUnit"
          :label="t('synthetics.scheduleAlert.customIntervalUnit.label')"
          :options="customIntervalUnitOptions"
          class="w-40!"
          data-test="synthetics-check-schedule-custom-interval-unit-select"
        />
      </div>

      <!-- Schedule Later date/time pickers -->
      <div
        v-if="startType === 'later' && check.schedule.type !== 'cron'"
        class="flex items-start gap-3 flex-wrap"
      >
        <ODate
          v-model="startDate"
          :label="t('synthetics.scheduleAlert.startDate')"
          data-test="synthetics-check-schedule-start-date-input"
          class="w-40!"
        />
        <OTime
          v-model="startTime"
          :label="t('synthetics.scheduleAlert.startTime')"
          data-test="synthetics-check-schedule-start-time-input"
          class="w-40!"
        />
        <OSelect
          v-model="timezone"
          :label="t('synthetics.scheduleAlert.timezone')"
          :options="timezoneOptions"
          class="w-64!"
          data-test="synthetics-check-schedule-start-timezone-select"
        />
      </div>
    </div>
  </div>
</template>
