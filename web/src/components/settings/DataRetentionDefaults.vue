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
  <div data-test="settings-data-retention-defaults">
    <div class="pb-1 text-base font-bold">{{ t("settings.dataRetentionDefaults.title") }}</div>
    <div class="text-compact text-text-secondary pb-2">
      {{ t("settings.dataRetentionDefaults.about") }}
    </div>

    <OForm v-if="settings.data.value" :form="form" v-slot="{ isSubmitting }">
      <div class="o2-input w-100 max-md:w-full">
        <OFormInput
          data-test="settings-data-retention-default"
          name="default"
          :label="t('settings.dataRetentionDefaults.defaultDays')"
          type="number"
          min="0"
          class="showLabelOnTop py-3"
          :help-text="globalHelp('default')"
        />
      </div>

      <!-- :key is the index: fields bind by index-based name and do not re-bind on a mid-list delete. -->
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="flex w-100 items-start gap-2 pb-3 max-md:w-full"
        :data-test="`settings-data-retention-row-${index}`"
      >
        <div class="w-35 shrink-0">
          <OFormSelect
            :data-test="`settings-data-retention-type-${index}`"
            :name="`types[${index}].type`"
            :label="t('settings.dataRetentionDefaults.streamType')"
            :options="typeOptions(index)"
            label-key="label"
            value-key="value"
          />
        </div>
        <div class="min-w-0 flex-1">
          <OFormInput
            :data-test="`settings-data-retention-days-${index}`"
            :name="`types[${index}].days`"
            :label="t('settings.dataRetentionDefaults.days')"
            type="number"
            min="0"
            :help-text="globalHelp(row.type)"
          />
        </div>
        <div class="flex shrink-0 flex-col gap-1">
          <span aria-hidden="true" class="invisible text-sm leading-tight font-semibold select-none"
            >&nbsp;</span
          >
          <OButton
            :data-test="`settings-data-retention-remove-${index}`"
            variant="outline-destructive"
            size="icon-sm"
            icon-left="delete"
            :title="t('settings.dataRetentionDefaults.removeType')"
            @click="removeRow(index)"
          />
        </div>
      </div>

      <div class="mt-1 flex gap-2">
        <OButton
          v-if="freeTypes.length > 0"
          data-test="settings-data-retention-add"
          variant="outline"
          size="sm-action"
          icon-left="add"
          @click="addRow"
          >{{ t("settings.dataRetentionDefaults.addType") }}</OButton
        >
        <OButton
          data-test="settings-data-retention-save"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
          >{{ t("alerts.save") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { orgSettingsQuery, updateOrgSettingsMutation } from "@/services/organizations.queries";
import {
  RETENTION_STREAM_TYPES,
  type ResolvedDataRetention,
  type RetentionKey,
  type RetentionStreamType,
} from "@/utils/dataRetention";
import {
  makeDataRetentionDefaultsSchema,
  type DataRetentionDefaultsForm,
} from "./DataRetentionDefaults.schema";

type DefaultsPayload = Partial<Record<RetentionKey, number>>;

const { t } = useI18nTyped();
const store = useStore();
const orgId = useOrgId();
const queryClient = useQueryClient();

const settings = useQuery(() => orgSettingsQuery(orgId.value));
const updateOrgSettings = useMutation(() => updateOrgSettingsMutation(orgId.value));

const typeLabels = computed((): Record<RetentionStreamType, I18nText> => ({
  logs: t("logStream.labelLogs"),
  metrics: t("logStream.labelMetrics"),
  traces: t("logStream.labelTraces"),
  profiles: t("logStream.labelProfiles"),
}));

const toFormValues = (stored?: DefaultsPayload): DataRetentionDefaultsForm => ({
  default: stored?.default && stored.default > 0 ? stored.default : "",
  types: RETENTION_STREAM_TYPES.filter((type) => (stored?.[type] ?? 0) > 0).map((type) => ({
    type,
    days: stored?.[type],
  })),
});

const form = useOForm<DataRetentionDefaultsForm>({
  defaultValues: toFormValues(),
  schema: makeDataRetentionDefaultsSchema(t),
  onSubmit: (value) => onSubmit(value),
});

const rows = form.useStore((s: any) => s.values.types as DataRetentionDefaultsForm["types"]);

watch(
  () => settings.data.value?.data?.data_retention,
  (stored) => form.reset(toFormValues(stored)),
  { immediate: true },
);

const freeTypes = computed(() =>
  RETENTION_STREAM_TYPES.filter((type) => !rows.value.some((row) => row.type === type)),
);

const typeOptions = (index: number) =>
  RETENTION_STREAM_TYPES.filter(
    (type) => rows.value[index]?.type === type || freeTypes.value.includes(type),
  ).map((type) => ({ value: type, label: typeLabels.value[type] }));

const addRow = () => form.pushFieldValue("types", { type: freeTypes.value[0], days: "" });
const removeRow = (index: number) => form.removeFieldValue("types", index);

const globalDefaults = computed(
  (): ResolvedDataRetention | undefined => store.state?.zoConfig?.data_retention_defaults,
);

const globalHelp = (key: RetentionKey): I18nText => {
  const days = globalDefaults.value?.[key] ?? 0;
  const value =
    days > 0
      ? t("settings.dataRetentionDefaults.daysValue", { days })
      : t("settings.dataRetentionDefaults.forever");
  return key === "default"
    ? t("settings.dataRetentionDefaults.globalDefault", { value })
    : t("settings.dataRetentionDefaults.globalType", { type: typeLabels.value[key], value });
};

const onSubmit = async (value: DataRetentionDefaultsForm) => {
  const candidate: DefaultsPayload = { default: Number(value.default || 0) };
  for (const row of value.types) candidate[row.type] = Number(row.days);
  try {
    await updateOrgSettings.mutateAsync({ data_retention: candidate });
    const fresh = await queryClient.fetchQuery(orgSettingsQuery(orgId.value));
    store.dispatch("setOrganizationSettings", {
      ...store.state?.organizationData?.organizationSettings,
      data_retention: fresh?.data?.data_retention,
      resolved_data_retention: fresh?.resolved_data_retention,
    });
    toast({ variant: "success", message: t("settings.organizationSettings.settingsUpdated") });
  } catch (e: any) {
    toast({
      variant: "error",
      message:
        raw(e?.response?.data?.message) ||
        raw(e?.message) ||
        t("settings.organizationSettings.settingsSaveError"),
    });
  }
};

defineExpose({ onSubmit, addRow });
</script>
