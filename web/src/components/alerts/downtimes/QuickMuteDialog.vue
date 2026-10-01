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
  <ODialog
    :open="open"
    size="sm"
    persistent
    :title="title"
    :sub-title="t('alerts.downtimes.mute.subtitle')"
    :form-id="FORM_ID"
    :primary-button-label="primaryLabel"
    :secondary-button-label="t('alerts.downtimes.form.cancel')"
    data-test="quick-mute-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormToggleGroup
        name="preset"
        :label="t('alerts.downtimes.mute.muteFor')"
        label-position="top"
        data-test="quick-mute-preset"
      >
        <OToggleGroupItem
          v-for="preset in QUICK_MUTE_PRESETS"
          :key="preset.key"
          :value="preset.key"
          size="sm"
          :data-test="`quick-mute-preset-${preset.key}`"
        >
          {{ t(preset.labelKey) }}
        </OToggleGroupItem>
        <OToggleGroupItem value="custom" size="sm" data-test="quick-mute-preset-custom">
          {{ t("alerts.downtimes.mute.presets.custom") }}
        </OToggleGroupItem>
      </OFormToggleGroup>

      <div v-if="preset === 'custom'" class="flex flex-wrap items-start gap-3 max-md:flex-col">
        <OFormDate
          name="end_date"
          :label="t('alerts.downtimes.mute.endsAt')"
          required
          data-test="quick-mute-end-date"
        />
        <OFormTime
          name="end_time"
          :label="t('alerts.downtimes.scheduleForm.endTime')"
          required
          data-test="quick-mute-end-time"
        />
      </div>
      <p v-if="endsIn" class="text-text-secondary text-xs" data-test="quick-mute-ends-in">
        {{ endsIn }}
      </p>

      <OFormTextarea
        name="reason"
        :label="t('alerts.downtimes.form.reason')"
        :rows="2"
        autogrow
        data-test="quick-mute-reason"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import type { TargetModule } from "@/services/downtimes";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useQuickMute } from "@/composables/downtimes/useQuickMute";
import {
  QUICK_MUTE_PRESETS,
  presetSeconds,
  selectionCount,
  type QuickMuteSelection,
} from "@/utils/downtimes/quickMute";
import { formatDuration, utcMicrosToLocal } from "@/utils/downtimes/schedule";
import {
  makeQuickMuteSchema,
  quickMuteDefaults,
  quickMuteEndsAt,
  type QuickMuteForm,
} from "./QuickMuteDialog.schema";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";

const FORM_ID = "quick-mute-form";

const TITLE_KEYS: Record<TargetModule, I18nKey> = {
  alerts: "alerts.downtimes.mute.title.alerts",
  anomaly_detections: "alerts.downtimes.mute.title.anomaly_detections",
  synthetics: "alerts.downtimes.mute.title.synthetics",
  slos: "alerts.downtimes.mute.title.slos",
};

const props = defineProps<{
  open: boolean;
  selection: QuickMuteSelection[];
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  muted: [downtimeId: string];
}>();

const { t } = useI18nTyped();
const { mute, timezone } = useQuickMute();

const nowMicros = () => Date.now() * 1000;

const form = useOForm<QuickMuteForm>({
  defaultValues: quickMuteDefaults(Date.now(), timezone),
  schema: makeQuickMuteSchema(t, timezone, nowMicros),
  onSubmit: async (values) => {
    const endsAt = quickMuteEndsAt(values, nowMicros(), timezone);
    if (endsAt === null) return;
    const id = await mute(props.selection, endsAt, values.reason);
    if (!id) return;
    emit("muted", id);
    emit("update:open", false);
  },
});

const title = computed(() => {
  const count = selectionCount(props.selection);
  const only = props.selection.length === 1 ? props.selection[0].module : null;
  return only
    ? t(TITLE_KEYS[only], { count }, count)
    : t("alerts.downtimes.mute.title.items", { count }, count);
});

const values = form.useStore((s) => s.values);
const preset = computed(() => values.value.preset);

const endsAt = computed(() => quickMuteEndsAt(values.value, nowMicros(), timezone));

const primaryLabel = computed(() => {
  if (endsAt.value === null) return t("alerts.downtimes.mute.confirm");
  const until = utcMicrosToLocal(endsAt.value, timezone).time;
  return t("alerts.downtimes.mute.confirmUntil", { time: until });
});

const endsIn = computed(() => {
  if (endsAt.value === null) return null;
  const secs = Math.round((endsAt.value - nowMicros()) / 1_000_000);
  if (secs <= 0) return null;
  return t("alerts.downtimes.mute.endsIn", { duration: formatDuration(secs, t) });
});

// A preset fills the end, so switching to Custom starts from it.
watch(preset, (value) => {
  if (value === "custom") return;
  const end = utcMicrosToLocal(nowMicros() + presetSeconds(value) * 1_000_000, timezone);
  form.setFieldValue("end_date", end.date);
  form.setFieldValue("end_time", end.time);
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) form.reset(quickMuteDefaults(Date.now(), timezone));
  },
);
</script>
