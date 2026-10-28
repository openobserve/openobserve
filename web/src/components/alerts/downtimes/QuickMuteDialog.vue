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
    :primary-button-disabled="primaryDisabled"
    :secondary-button-label="
      confirming24h
        ? t('alerts.downtimes.mute.confirm24h.useUntilClear')
        : t('alerts.downtimes.form.cancel')
    "
    :neutral-button-label="confirming24h ? t('alerts.downtimes.form.cancel') : undefined"
    neutral-button-variant="outline"
    data-test="quick-mute-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="onSecondary"
    @click:neutral="emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <p class="text-text-secondary text-sm wrap-break-word" data-test="quick-mute-help">
        {{ alert ? t("alerts.downtimes.mute.subtitleOne") : t("alerts.downtimes.mute.subtitle") }}
      </p>
      <OFormToggleGroup
        name="preset"
        :label="t('alerts.downtimes.mute.muteFor')"
        label-position="top"
        data-test="quick-mute-preset"
      >
        <OToggleGroupItem
          v-if="alert"
          value="untilClear"
          size="sm"
          data-test="quick-mute-preset-untilClear"
        >
          {{ t("alerts.downtimes.mute.untilClear") }}
        </OToggleGroupItem>
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
      <p
        v-if="preset === 'untilClear'"
        class="text-text-secondary text-xs"
        data-test="quick-mute-until-clear-hint"
      >
        {{ t("alerts.downtimes.mute.untilClearHint") }}
      </p>
      <p v-else-if="endsIn" class="text-text-secondary text-xs" data-test="quick-mute-ends-in">
        {{ endsIn }}
      </p>

      <OBanner
        v-if="confirming24h"
        variant="warning"
        icon="warning"
        dense
        data-test="quick-mute-confirm-24h"
      >
        <span class="font-semibold">{{ t("alerts.downtimes.mute.confirm24h.title") }}</span>
        {{ t("alerts.downtimes.mute.confirm24h.message") }}
      </OBanner>

      <div v-if="hasGroups" class="flex flex-col gap-2" data-test="quick-mute-groups">
        <OFormToggleGroup
          name="group_scope"
          :label="t('alerts.downtimes.mute.groups')"
          label-position="top"
          data-test="quick-mute-group-scope"
        >
          <OToggleGroupItem value="this" size="sm" data-test="quick-mute-groups-this">
            {{ t("alerts.downtimes.mute.groupsThis") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="all" size="sm" data-test="quick-mute-groups-all">
            {{ t("alerts.downtimes.mute.groupsAll") }}
          </OToggleGroupItem>
        </OFormToggleGroup>
        <OFormSelect
          v-if="values.group_scope === 'this'"
          name="groups"
          multiple
          searchable
          :options="groupOptions"
          :placeholder="t('alerts.downtimes.mute.addGroup')"
          :help-text="t('alerts.downtimes.mute.groupsHint')"
          data-test="quick-mute-group-select"
        />
      </div>

      <template v-if="!(alert && noFolder)">
        <OBanner
          v-if="noFolder"
          variant="warning"
          dense
          :content="t('alerts.downtimes.noFolder')"
          data-test="quick-mute-no-folder"
        />
        <div v-else class="flex flex-wrap items-center gap-1 text-sm" data-test="quick-mute-folder">
          <span class="text-text-secondary">{{ t("alerts.downtimes.mute.fileIn") }}</span>
          <InlineSelectFolderDropdown
            variant="inline"
            type="downtimes"
            :model-value="values.folder_id"
            data-test="quick-mute-folder-select"
            @update:model-value="(v: string) => form.setFieldValue('folder_id', v)"
          />
        </div>
      </template>

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
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { TargetModule } from "@/services/downtimes";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useQuickMute } from "@/composables/downtimes/useQuickMute";
import { useAlertActions, type AlertMuteScope } from "@/composables/alerts/useAlertActions";
import {
  QUICK_MUTE_PRESETS,
  groupOptionLabel,
  presetSeconds,
  selectionCount,
  tomorrowEndTime,
  type AlertMuteEnd,
  type QuickMuteAlertContext,
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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import InlineSelectFolderDropdown from "@/components/common/sidebar/InlineSelectFolderDropdown.vue";

const FORM_ID = "quick-mute-form";

const TITLE_KEYS: Record<TargetModule, I18nKey> = {
  alerts: "alerts.downtimes.mute.title.alerts",
  anomaly_detections: "alerts.downtimes.mute.title.anomaly_detections",
  synthetics: "alerts.downtimes.mute.title.synthetics",
  slos: "alerts.downtimes.mute.title.slos",
};

const props = withDefaults(
  defineProps<{
    open: boolean;
    selection: QuickMuteSelection[];
    /** Set when one alert is in scope: Until it clears, the Groups field and the alert route. */
    alert?: QuickMuteAlertContext | null;
  }>(),
  { alert: null },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  muted: [downtimeId: string];
}>();

const { t } = useI18nTyped();
const { mute, timezone, defaultFolderId } = useQuickMute();
const alertActions = useAlertActions();

const nowMicros = () => Date.now() * 1000;

// The permitted folder list answered empty, so there is nowhere to file the mute.
const noFolder = computed(() => defaultFolderId.value === null);

const hasGroups = computed(() => !!props.alert?.groups?.length);

// The 24 h preset asks once inside the dialog, since Until it clears usually ends sooner.
const confirming24h = ref(false);

const defaults = (): QuickMuteForm => {
  const base = quickMuteDefaults(
    Date.now(),
    timezone.value,
    defaultFolderId.value ?? "",
    props.alert ? "untilClear" : "1h",
  );
  if (!hasGroups.value) return base;
  const from = props.alert?.groupKey;
  return { ...base, group_scope: from ? "this" : "all", groups: from ? [from] : [] };
};

const alertMuteEnd = (values: QuickMuteForm): AlertMuteEnd | null => {
  if (values.preset === "untilClear") return { untilClear: true };
  if (values.preset !== "custom") return { minutes: presetSeconds(values.preset) / 60 };
  const endsAt = quickMuteEndsAt(values, nowMicros(), timezone.value);
  return endsAt === null ? null : { endsAt };
};

const groupScope = (values: QuickMuteForm): AlertMuteScope => {
  if (!hasGroups.value) return {};
  if (values.group_scope === "all") return { allGroups: true };
  const keys = values.groups ?? [];
  const only = keys.length === 1 ? props.alert?.groups?.find((g) => g.key === keys[0]) : undefined;
  return { groups: keys, firingStartedAt: only?.firingStartedAt };
};

const submitAlertMute = async (values: QuickMuteForm, alert: QuickMuteAlertContext) => {
  if (values.preset === "24h" && !confirming24h.value) {
    confirming24h.value = true;
    return;
  }
  const end = alertMuteEnd(values);
  if (end === null) return;
  const result = await alertActions.createMute(
    { alertId: alert.alertId, name: alert.name, folderId: alert.folderId },
    end,
    { ...groupScope(values), reason: values.reason, folderId: values.folder_id || undefined },
  );
  if (!result) return;
  emit("muted", result.downtime_id);
  emit("update:open", false);
};

const form = useOForm<QuickMuteForm>({
  defaultValues: defaults(),
  schema: makeQuickMuteSchema(t, () => timezone.value, nowMicros, {
    folderOptional: () => !!props.alert,
  }),
  onSubmit: async (values) => {
    if (props.alert) {
      await submitAlertMute(values, props.alert);
      return;
    }
    const endsAt = quickMuteEndsAt(values, nowMicros(), timezone.value);
    if (endsAt === null) return;
    const id = await mute(props.selection, endsAt, values.reason, values.folder_id);
    if (!id) return;
    emit("muted", id);
    emit("update:open", false);
  },
});

const title = computed(() => {
  if (props.alert) return t("alerts.downtimes.mute.titleOne", { name: raw(props.alert.name) });
  const count = selectionCount(props.selection);
  const only = props.selection.length === 1 ? props.selection[0].module : null;
  return only
    ? t(TITLE_KEYS[only], { count }, count)
    : t("alerts.downtimes.mute.title.items", { count }, count);
});

const values = form.useStore((s) => s.values);
const preset = computed(() => values.value.preset);

const groupOptions = computed(() =>
  (props.alert?.groups ?? []).map((g) => ({ label: raw(groupOptionLabel(g)), value: g.key })),
);

const primaryDisabled = computed(() => {
  if (!props.alert) return noFolder.value;
  return hasGroups.value && values.value.group_scope === "this" && !values.value.groups?.length;
});

const endsAt = computed(() => quickMuteEndsAt(values.value, nowMicros(), timezone.value));

const primaryLabel = computed(() => {
  if (confirming24h.value) return t("alerts.downtimes.mute.confirm24h.ok");
  if (preset.value === "untilClear") return t("alerts.downtimes.mute.confirmUntilClear");
  if (endsAt.value === null) return t("alerts.downtimes.mute.confirm");
  const until = utcMicrosToLocal(endsAt.value, timezone.value).time;
  return t("alerts.downtimes.mute.confirmUntil", { time: until });
});

const endsIn = computed(() => {
  if (endsAt.value === null) return null;
  const secs = Math.round((endsAt.value - nowMicros()) / 1_000_000);
  if (secs <= 0) return null;
  const tomorrow = tomorrowEndTime(endsAt.value, nowMicros(), timezone.value);
  if (tomorrow) return t("alerts.downtimes.mute.untilTomorrow", { time: tomorrow });
  return t("alerts.downtimes.mute.endsIn", { duration: formatDuration(secs, t) });
});

const onSecondary = async () => {
  if (!confirming24h.value) {
    emit("update:open", false);
    return;
  }
  form.setFieldValue("preset", "untilClear");
  confirming24h.value = false;
  await form.handleSubmit();
};

// A preset fills the end, so switching to Custom starts from it.
watch(preset, (value) => {
  confirming24h.value = value === "24h" && !!props.alert;
  if (value === "custom" || value === "untilClear") return;
  const end = utcMicrosToLocal(nowMicros() + presetSeconds(value) * 1_000_000, timezone.value);
  form.setFieldValue("end_date", end.date);
  form.setFieldValue("end_time", end.time);
});

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    confirming24h.value = false;
    form.reset(defaults());
  },
);

// The folder list can answer after the dialog opened; follow it until the user picks one.
watch(defaultFolderId, (next, prev) => {
  if (values.value.folder_id === (prev ?? "")) form.setFieldValue("folder_id", next ?? "");
});
</script>
