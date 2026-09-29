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

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  BrowserCheck,
  BrowserStep,
  SyntheticsFolder,
  SyntheticsLocation,
} from "@/types/synthetics";
import {
  extractedStartingUrl,
  seedChildName,
  type ExtractedChildSplit,
} from "@/utils/synthetics/buildExtractedChild";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import {
  DEFAULT_SCHEDULE_PRESET,
  makeExtractSubtestSchema,
  SCHEDULE_PRESETS,
  type ExtractForm,
  type ExtractSubtestForm,
  type SchedulePresetKey,
} from "./ExtractSubtestDialog.schema";

const FORM_ID = "synthetics-extract-form";

const props = defineProps<{
  open: boolean;
  range: BrowserStep[];
  anchor: number;
  authoredCount: number;
  executedCount?: number;
  parentName: string;
  parentStartingUrl: string;
  defaultFolder: string;
  folders: SyntheticsFolder[];
  needsSchedule: boolean;
  parentLocations: string[];
  parentSchedule: BrowserCheck["schedule"];
  locationOptions: SyntheticsLocation[];
  variables: ExtractedChildSplit;
  onSubmit: (_values: ExtractForm) => Promise<void>;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18nTyped();

const submitError = ref<I18nText | null>(null);

const count = computed(() => props.range.length);

const folderOptions = computed(() =>
  props.folders.map((f) => ({ label: raw(f.name), value: f.folderId })),
);
const locationSelectOptions = computed(() =>
  props.locationOptions.map((l) => ({ label: l.label, value: l.id })),
);
const scheduleOptions = (Object.keys(SCHEDULE_PRESETS) as SchedulePresetKey[]).map((key) => ({
  label: t(`synthetics.scheduleAlert.frequencyOptions.${key}`),
  value: key,
}));

function defaults(): ExtractSubtestForm {
  return {
    name: seedChildName(props.parentName, props.range[0]?.name ?? ""),
    folder: props.defaultFolder,
    locations: props.needsSchedule ? props.locationOptions.map((l) => l.id) : undefined,
    schedule: props.needsSchedule ? DEFAULT_SCHEDULE_PRESET : undefined,
  };
}

const form = useOForm<ExtractSubtestForm>({
  defaultValues: defaults(),
  schema: makeExtractSubtestSchema(t, props.needsSchedule),
  onSubmit: (values) => submit(values),
});
// The same TanStack state ODialog's footer mirrors, so no hand-kept flag can drift from it.
const isSubmitting = form.useStore((s) => s.isSubmitting);

// OForm swallows the handler's rejection, so the message has to be caught here to be shown.
async function submit(values: ExtractSubtestForm) {
  submitError.value = null;
  const payload: ExtractForm = { name: values.name, folder: values.folder };
  if (values.locations) payload.locations = values.locations;
  if (values.schedule) payload.schedule = { ...SCHEDULE_PRESETS[values.schedule] };
  try {
    await props.onSubmit(payload);
  } catch (err) {
    submitError.value = raw(err instanceof Error ? err.message : String(err));
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    submitError.value = null;
    form.reset(defaults());
  },
);

// The dialog persists across opens, so the setup-time schema goes stale when a locations edit flips the flag.
watch(
  () => props.needsSchedule,
  (needs) => {
    const schema = makeExtractSubtestSchema(t, needs);
    form.update({
      ...form.options,
      validators: { onDynamic: schema as any, onDynamicAsync: schema as any },
    });
  },
);

function onUpdateOpen(value: boolean) {
  if (!isSubmitting.value) emit("update:open", value);
}

const startPath = computed(() => {
  const value = extractedStartingUrl(props.range, props.parentStartingUrl);
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
});

const stepsLine = computed(() =>
  t(
    "synthetics.journey.extract.steps",
    { first: props.anchor + 1, last: props.anchor + count.value, path: startPath.value },
    count.value,
  ),
);

const thisTestLine = computed(() => {
  const authored = props.authoredCount - count.value + 1;
  if (props.executedCount === undefined) {
    return t("synthetics.journey.extract.thisTestAuthored", { authored });
  }
  return t("synthetics.journey.extract.thisTest", { authored, executed: props.executedCount });
});

// Only the interval shapes the locale can phrase; a cron or day-based parent shows no row rather than a wrong one.
const summarisableSchedule = computed(() => {
  const { type, intervalValue, intervalUnit } = props.parentSchedule;
  if (type !== "interval" || intervalValue === undefined) return null;
  if (intervalUnit !== "minutes" && intervalUnit !== "hours") return null;
  return { n: intervalValue, unit: intervalUnit };
});

const scheduleLine = computed(() => {
  if (!summarisableSchedule.value) return "";
  const { n, unit } = summarisableSchedule.value;
  const locations = props.parentLocations
    .map((id) => props.locationOptions.find((l) => l.id === id)?.label ?? id)
    .join(", ");
  const frequency = t("synthetics.journey.extract.every", {
    n,
    unit: t(`synthetics.journey.extract.unit.${unit}`, { n }, n),
  });
  return t("synthetics.journey.extract.schedule", { locations, frequency });
});
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('synthetics.journey.extract.title', { count }, count)"
    :sub-title="t('synthetics.journey.extract.subtitle')"
    :persistent="isSubmitting"
    :show-close="!isSubmitting"
    :primary-button-label="t('synthetics.journey.extract.confirm')"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="ghost"
    :form-id="FORM_ID"
    data-test="synthetics-extract-dialog"
    @update:open="onUpdateOpen"
    @click:secondary="onUpdateOpen(false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormInput
        name="name"
        :label="t('synthetics.journey.extract.nameLabel')"
        required
        data-test="synthetics-extract-name-input"
      />
      <OFormSelect
        name="folder"
        :label="t('synthetics.journey.extract.folderLabel')"
        :options="folderOptions"
        required
        data-test="synthetics-extract-folder-select"
      />
      <template v-if="needsSchedule">
        <OFormSelect
          name="locations"
          :label="t('synthetics.table.locations')"
          :options="locationSelectOptions"
          multiple
          required
          data-test="synthetics-extract-locations-select"
        />
        <OFormSelect
          name="schedule"
          :label="t('synthetics.scheduleAlert.frequency')"
          :options="scheduleOptions"
          required
          data-test="synthetics-extract-schedule-select"
        />
      </template>

      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-text-secondary">{{ t("synthetics.journey.steps") }}</dt>
        <dd class="text-text-body m-0">{{ stepsLine }}</dd>
        <dt class="text-text-secondary">{{ t("synthetics.journey.extract.labelThisTest") }}</dt>
        <dd class="text-text-body m-0">{{ thisTestLine }}</dd>
        <template v-if="!needsSchedule && summarisableSchedule">
          <dt class="text-text-secondary">{{ t("synthetics.scheduleAlert.schedule") }}</dt>
          <dd class="text-text-body m-0">{{ scheduleLine }}</dd>
        </template>
        <dt class="text-text-secondary">{{ t("common.status") }}</dt>
        <dd class="text-text-body m-0">{{ t("synthetics.journey.extract.status") }}</dd>
        <template v-if="variables.copied.length || variables.toDefine.length">
          <dt class="text-text-secondary">{{ t("synthetics.authNetwork.variables") }}</dt>
          <dd class="text-text-body m-0 flex flex-col gap-1">
            <span v-if="variables.copied.length">
              {{
                t("synthetics.journey.extract.variablesCopied", {
                  names: variables.copied.join(", "),
                })
              }}
            </span>
            <span v-if="variables.toDefine.length">
              {{
                t("synthetics.journey.extract.variablesToDefine", {
                  names: variables.toDefine.join(", "),
                })
              }}
            </span>
          </dd>
        </template>
      </dl>

      <OBanner variant="warning" dense :content="t('synthetics.journey.extract.historyNotice')" />

      <p
        v-if="submitError"
        class="text-status-error-text m-0 text-sm"
        data-test="synthetics-extract-error"
      >
        {{ submitError }}
      </p>
    </OForm>
  </ODialog>
</template>
