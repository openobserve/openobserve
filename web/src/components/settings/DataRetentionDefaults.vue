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
  <OFormSection
    variant="plain"
    :title="t('settings.dataRetentionDefaults.title')"
    :description="t('settings.dataRetentionDefaults.about')"
    data-test="settings-data-retention-defaults"
  >
    <template v-if="!loading" #actions>
      <ODropdown v-if="freeTypes.length > 0" align="end">
        <template #trigger>
          <OButton
            data-test="settings-data-retention-add"
            variant="outline"
            size="sm-action"
            icon-left="add"
            icon-right="keyboard-arrow-down"
            type="button"
            >{{ t("settings.dataRetentionDefaults.addType") }}</OButton
          >
        </template>
        <ODropdownItem
          v-for="type in freeTypes"
          :key="type"
          :data-test="`settings-data-retention-add-${type}`"
          @select="addRow(type)"
        >
          <span>{{ typeLabels[type] }}</span>
        </ODropdownItem>
      </ODropdown>
      <span v-else class="flex">
        <OButton
          data-test="settings-data-retention-add"
          variant="outline"
          size="sm-action"
          icon-left="add"
          type="button"
          disabled
          focusable-unavailable
        >
          {{ t("settings.dataRetentionDefaults.addType") }}
          <template #unavailable-reason>{{
            t("settings.dataRetentionDefaults.allTypesAdded")
          }}</template>
        </OButton>
        <OTooltip side="bottom" :content="t('settings.dataRetentionDefaults.allTypesAdded')" />
      </span>
    </template>

    <OSettingRow
      control-at="end"
      name="default"
      error-data-test="settings-data-retention-default-error"
      :label="t('settings.dataRetentionDefaults.defaultLabel')"
      :description="globalHelp('default')"
      :loading="loading"
      data-test="settings-data-retention-default-row"
    >
      <OFormInput
        data-test="settings-data-retention-default"
        name="default"
        type="number"
        min="0"
        :suffix="t('settings.dataRetentionDefaults.unitDays')"
        :aria-label="t('settings.dataRetentionDefaults.defaultDays')"
      />
    </OSettingRow>

    <!-- :key is the index: fields bind by index-based name and do not re-bind on a mid-list delete. -->
    <OSettingRow
      v-for="(row, index) in rows"
      :key="index"
      control-at="end"
      :name="`types[${index}].days`"
      :error-data-test="`settings-data-retention-days-${index}-error`"
      :label="typeLabels[row.type]"
      :description="globalHelp(row.type)"
      :loading="loading"
      :data-test="`settings-data-retention-row-${index}`"
    >
      <div class="flex w-full items-center gap-2">
        <div class="min-w-0 flex-1">
          <OFormInput
            :data-test="`settings-data-retention-days-${index}`"
            :name="`types[${index}].days`"
            type="number"
            min="0"
            :suffix="t('settings.dataRetentionDefaults.unitDays')"
            :aria-label="daysLabel(row.type)"
          />
        </div>
        <OButton
          :data-test="`settings-data-retention-remove-${index}`"
          variant="ghost-muted"
          size="icon-xs-sq"
          icon-left="close"
          type="button"
          :aria-label="removeLabel(row.type)"
          @click="removeRow(index)"
        >
          <OTooltip :content="removeLabel(row.type)" side="top" align="end" />
        </OButton>
      </div>
    </OSettingRow>
  </OFormSection>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import type { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  RETENTION_STREAM_TYPES,
  type ResolvedDataRetention,
  type RetentionKey,
  type RetentionStreamType,
} from "@/utils/dataRetention";
import type { DataRetentionDefaultsForm } from "./DataRetentionDefaults.schema";
import type { OrganizationSettingsForm } from "./OrganizationSettings.schema";

// The rows belong to the page's form: its save bar counts, validates and saves them.
const props = defineProps<{
  form: ReturnType<typeof useOForm<OrganizationSettingsForm>>;
  loading?: boolean;
}>();

const { t } = useI18nTyped();
const store = useStore();

const typeLabels = computed((): Record<RetentionStreamType, I18nText> => ({
  logs: t("logStream.labelLogs"),
  metrics: t("logStream.labelMetrics"),
  traces: t("logStream.labelTraces"),
  profiles: t("logStream.labelProfiles"),
}));

const rows = props.form.useStore(
  (s: any) => (s.values.types ?? []) as DataRetentionDefaultsForm["types"],
);

const freeTypes = computed(() =>
  RETENTION_STREAM_TYPES.filter((type) => !rows.value.some((row) => row.type === type)),
);

const addRow = (type: RetentionStreamType) =>
  props.form.pushFieldValue("types", { type, days: "" });
const removeRow = (index: number) => props.form.removeFieldValue("types", index);

const removeLabel = (type: RetentionStreamType): I18nText =>
  t("settings.dataRetentionDefaults.removeTypeNamed", { type: typeLabels.value[type] });
const daysLabel = (type: RetentionStreamType): I18nText =>
  t("settings.dataRetentionDefaults.daysFor", { type: typeLabels.value[type] });

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
</script>
