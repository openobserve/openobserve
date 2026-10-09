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
    :form-id="FORM_ID"
    :primary-button-label="primaryLabel"
    :secondary-button-label="t('alerts.downtimes.form.cancel')"
    data-test="extend-downtime-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <p
        v-if="downtime && isRecurring(downtime)"
        class="text-text-body text-sm"
        data-test="extend-downtime-follow-up"
      >
        {{ t("alerts.downtimes.extend.followUp", { name: followUpName(downtime.name) }) }}
      </p>
      <div class="flex flex-wrap items-start gap-3 max-md:flex-col">
        <OFormDate
          name="end_date"
          :label="t('alerts.downtimes.extend.newEnd')"
          required
          data-test="extend-downtime-end-date"
        />
        <OFormTime
          name="end_time"
          :label="t('alerts.downtimes.scheduleForm.endTime')"
          required
          data-test="extend-downtime-end-time"
        />
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { DowntimeListItem, ExtendDowntimeResponse } from "@/services/downtimes";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useExtendDowntime } from "@/composables/downtimes/useExtendDowntime";
import { extensionStart, followUpName, isRecurring } from "@/utils/downtimes/extend";
import { utcMicrosToLocal } from "@/utils/downtimes/schedule";
import {
  extendDefaults,
  extendUntil,
  makeExtendSchema,
  type ExtendBounds,
  type ExtendForm,
} from "./ExtendDowntimeDialog.schema";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";

const FORM_ID = "extend-downtime-form";

const props = defineProps<{
  open: boolean;
  downtime: DowntimeListItem | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  extended: [result: ExtendDowntimeResponse];
}>();

const { t } = useI18nTyped();
const { extend, timezone } = useExtendDowntime();

const bounds = (): ExtendBounds | null => {
  const d = props.downtime;
  const start = d ? extensionStart(d) : null;
  if (!d?.current_window || start === null) return null;
  return { currentEnd: d.current_window.end, start };
};

const form = useOForm<ExtendForm>({
  defaultValues: extendDefaults(Date.now() * 1000, timezone),
  schema: makeExtendSchema(t, timezone, bounds),
  onSubmit: async (values) => {
    const d = props.downtime;
    const until = extendUntil(values, timezone);
    if (!d || until === null) return;
    const result = await extend(d, { until });
    if (!result) return;
    emit("extended", result);
    emit("update:open", false);
  },
});

const values = form.useStore((s) => s.values);

const title = computed(() =>
  t("alerts.downtimes.extend.dialogTitle", { name: props.downtime?.name ?? "" }),
);

const primaryLabel = computed(() => {
  const until = extendUntil(values.value, timezone);
  if (until === null) return t("alerts.downtimes.actions.extend");
  return t("alerts.downtimes.extend.confirmUntil", {
    time: utcMicrosToLocal(until, timezone).time,
  });
});

watch(
  () => props.open,
  (isOpen) => {
    const end = props.downtime?.current_window?.end;
    if (isOpen && end) form.reset(extendDefaults(end, timezone));
  },
);
</script>
