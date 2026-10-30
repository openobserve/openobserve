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

<!-- "Until…" of Extend: a new end for an alert's live quick mute. -->
<template>
  <ODialog
    :open="open"
    size="sm"
    persistent
    :title="title"
    :form-id="FORM_ID"
    :primary-button-label="primaryLabel"
    :secondary-button-label="t('alerts.downtimes.form.cancel')"
    data-test="alerts-alertmuteuntildialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <div class="flex flex-wrap items-start gap-3 max-md:flex-col">
        <OFormDate
          name="end_date"
          :label="t('alerts.downtimes.extend.newEnd')"
          required
          data-test="alerts-alertmuteuntildialog-end-date"
        />
        <OFormTime
          name="end_time"
          :label="t('alerts.downtimes.scheduleForm.endTime')"
          required
          data-test="alerts-alertmuteuntildialog-end-time"
        />
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import {
  useAlertActions,
  type AlertActionTarget,
  type AlertMuteRef,
} from "@/composables/alerts/useAlertActions";
import { utcMicrosToLocal } from "@/utils/downtimes/schedule";
import {
  extendDefaults,
  extendUntil,
  makeExtendSchema,
  type ExtendBounds,
  type ExtendForm,
} from "./downtimes/ExtendDowntimeDialog.schema";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";

const FORM_ID = "alert-mute-until-form";

const props = withDefaults(
  defineProps<{
    open: boolean;
    target: AlertActionTarget | null;
    downtime?: AlertMuteRef | null;
  }>(),
  { downtime: null },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  done: [];
}>();

const { t } = useI18nTyped();
const actions = useAlertActions();
const timezone = useViewerTimezone().value;

const currentEnd = () => props.downtime?.ends_at ?? Date.now() * 1000;

const bounds = (): ExtendBounds => ({ currentEnd: currentEnd(), start: Date.now() * 1000 });

const form = useOForm<ExtendForm>({
  defaultValues: extendDefaults(currentEnd(), timezone),
  schema: makeExtendSchema(t, timezone, bounds),
  onSubmit: async (values) => {
    const until = extendUntil(values, timezone);
    const target = props.target;
    if (!target || !props.downtime || until === null) return;
    if (!(await actions.extend(target, props.downtime, { endsAt: until }))) return;
    emit("done");
    emit("update:open", false);
  },
});

const values = form.useStore((s) => s.values);

const title = computed(() =>
  t("alerts.downtimes.extend.dialogTitle", { name: raw(props.target?.name ?? "") }),
);

const primaryLabel = computed(() => {
  const until = extendUntil(values.value, timezone);
  if (until === null) return t("alerts.downtimes.actions.extend");
  const time = utcMicrosToLocal(until, timezone).time;
  return t("alerts.downtimes.extend.confirmUntil", { time });
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) form.reset(extendDefaults(currentEnd(), timezone));
  },
);
</script>
