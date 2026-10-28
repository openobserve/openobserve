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
  <div class="flex h-full flex-col">
    <DashboardHeader :title="t('dashboard.generalSettingsTitle')" />
    <OForm
      ref="formRef"
      :form="form"
      v-slot="{ isSubmitting }"
      class="flex min-h-0 flex-1 flex-col"
    >
      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-3 py-3">
        <OFormInput
          name="name"
          :label="t('dashboard.name')"
          required
          data-test="dashboard-general-setting-name"
        />
        <OFormTextarea
          name="description"
          :label="t('dashboard.typeDesc')"
          :rows="3"
          data-test="dashboard-general-setting-description"
        />

        <div
          v-if="dateTimeValue"
          class="flex flex-col items-start gap-1"
          data-test="dashboard-general-setting-datetime-picker"
        >
          <label class="text-compact text-input-label-text leading-tight font-medium">{{
            t("dashboard.defaultDuration")
          }}</label>
          <DateTimePickerDashboard
            v-show="store.state.printMode === false"
            ref="dateTimePicker"
            :key="dateTimePickerKey"
            class="h-7.5"
            size="sm"
            :initialTimezone="initialTimezone"
            v-model="dateTimeValue"
            :auto-apply-dashboard="true"
            calendar-presets
            menu-align="start"
          />
        </div>

        <div class="flex flex-col items-start gap-1">
          <label class="text-compact text-input-label-text leading-tight font-medium">{{
            t("dashboard.generalSettingsPage.defaultAutoRefresh")
          }}</label>
          <AutoRefreshInterval
            :model-value="selectedRefresh"
            :min-refresh-interval="minRefreshSeconds"
            class="h-7.5"
            data-test="dashboard-general-setting-default-refresh"
            @update:model-value="
              (value: number) => form.setFieldValue('defaultRefreshInterval', value)
            "
          />
          <span
            class="text-input-help-text text-xs leading-none"
            data-test="dashboard-general-setting-default-refresh-help"
          >
            {{ refreshHelpText }}
          </span>
          <p
            v-if="showAbsoluteRangeHint"
            class="text-text-secondary text-xs"
            data-test="dashboard-general-setting-default-refresh-absolute-hint"
          >
            {{ t("dashboard.generalSettingsPage.defaultAutoRefreshAbsoluteHint") }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <OFormSwitch
            name="showDynamicFilters"
            :label="t('dashboard.showDynamicFilters')"
            data-test="dashboard-general-setting-dynamic-filter"
            size="lg"
          />
          <p class="text-text-secondary text-xs">
            {{ t("dashboard.generalSettingsPage.dynamicFiltersHelp") }}
          </p>
        </div>
      </div>

      <!-- Footer pinned to the drawer bottom: a plain-language reminder that
           settings are shared, plus the primary/secondary actions. -->
      <div
        class="border-border-default flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2.5"
      >
        <span class="text-text-secondary text-xs">
          {{ t("dashboard.generalSettingsPage.appliesToEveryone") }}
        </span>
        <div class="flex gap-2">
          <OButton
            @click="$emit('close')"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            data-test="dashboard-general-setting-cancel-btn"
            >{{ t("dashboard.cancel") }}</OButton
          >
          <OButton
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
            data-test="dashboard-general-setting-save-btn"
            >{{ t("dashboard.generalSettingsPage.saveChanges") }}</OButton
          >
        </div>
      </div>
    </OForm>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  nextTick,
  watch,
  type Ref,
} from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { getDashboard, updateDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import DashboardHeader from "./common/DashboardHeader.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import useNotifications from "@/composables/useNotifications";
import { useDashboardSaveConflict } from "@/composables/dashboard/useDashboardSaveConflict";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  autoRefreshLabel,
  effectiveDefaultRefresh,
  minAutoRefreshSeconds,
} from "@/utils/dashboard/autoRefresh";
import {
  makeGeneralSettingsSchema,
  generalSettingsDefaults,
  type GeneralSettingsForm,
} from "./GeneralSettings.schema";
import {
  comparableDateTime,
  useDashboardSettingsDraft,
  type GeneralSettingsDraft,
} from "./dashboardSettingsDraft";
import { stableStringify } from "@/utils/drafts/editorDraftStore";

export default defineComponent({
  name: "GeneralSettings",
  components: {
    DashboardHeader,
    DateTimePickerDashboard,
    OButton,
    OForm,
    OFormInput,
    OFormTextarea,
    OFormSwitch,
    AutoRefreshInterval,
  },
  emits: ["save", "close"],
  setup(props, { emit }) {
    const store: any = useStore();
    const { t } = useI18nTyped();
    const generalSettingsSchema = makeGeneralSettingsSchema(t);
    const route = useRoute();
    const { showPositiveNotification, showErrorNotification } = useNotifications();
    const saveConflict = useDashboardSaveConflict();

    const formRef = ref<any>(null);
    const dateTimeValue: any = ref(null);
    const form = useOForm<GeneralSettingsForm>({
      defaultValues: generalSettingsDefaults(),
      schema: generalSettingsSchema,
      onSubmit: (value) => onSubmit(value),
    });

    const minRefreshSeconds = computed(() =>
      minAutoRefreshSeconds(store.state?.zoConfig?.min_auto_refresh_interval),
    );
    // What the dashboard has stored, kept apart from the form so a below-minimum value can be explained.
    const savedRefresh = ref(0);
    const effectiveRefresh = computed(() =>
      effectiveDefaultRefresh(savedRefresh.value, minRefreshSeconds.value),
    );
    const selectedRefresh = form.useStore((s: any) => s.values.defaultRefreshInterval as number);
    const refreshHelpText = computed(() =>
      savedRefresh.value > 0 && savedRefresh.value < minRefreshSeconds.value
        ? t("dashboard.generalSettingsPage.defaultAutoRefreshRaised", {
            saved: autoRefreshLabel(savedRefresh.value, t),
            effective: autoRefreshLabel(effectiveRefresh.value, t),
          })
        : t("dashboard.generalSettingsPage.defaultAutoRefreshHelp"),
    );
    const showAbsoluteRangeHint = computed(
      () => selectedRefresh.value > 0 && dateTimeValue.value?.valueType === "absolute",
    );
    const closeBtn: Ref<any> = ref(null);
    // initial timezone, which will come from the route query
    const initialTimezone: any = ref(store.state.timezone ?? null);

    const draftContext = useDashboardSettingsDraft();
    // The picker reads its v-model only on mount, so a restored range remounts it.
    const dateTimePickerKey = ref(0);
    // What the server holds, taken once the picker settled its own copy of the range; null until loaded.
    const loadedKey = ref<string | null>(null);
    // Off from a load until its pending edits are back, so the picker's mount emit cannot clear them first.
    let draftSyncOn = false;
    let lastSaveSucceeded = false;
    let unregisterDraftSection: (() => void) | null = null;

    const formValues = form.useStore((s) => s.values);
    const generalSnapshot = (): GeneralSettingsDraft =>
      JSON.parse(
        JSON.stringify({ values: formValues.value, dateTime: dateTimeValue.value ?? null }),
      );
    const sectionKey = (draft: GeneralSettingsDraft) =>
      stableStringify({ values: draft.values, dateTime: comparableDateTime(draft.dateTime) });

    const syncDraftSection = () => {
      if (!draftContext || !draftSyncOn || loadedKey.value === null) return;
      const current = generalSnapshot();
      draftContext.pending.general = sectionKey(current) === loadedKey.value ? null : current;
    };

    const applyPendingDraft = async () => {
      const pending = draftContext?.pending.general;
      if (!pending) return;
      form.reset(pending.values);
      dateTimeValue.value = pending.dateTime;
      dateTimePickerKey.value++;
      await nextTick();
    };

    const saveForDraft = async (): Promise<boolean> => {
      lastSaveSucceeded = false;
      await form.handleSubmit();
      return lastSaveSucceeded;
    };

    const markLoaded = async () => {
      // Two ticks: the picker emits its range on mount, then once more for an absolute range.
      await nextTick();
      await nextTick();
      loadedKey.value = sectionKey(generalSnapshot());
    };

    const getDashboardData = async () => {
      draftSyncOn = false;
      loadedKey.value = null;
      const data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default",
      );

      // Data arrives AFTER mount → re-baseline the form (flash-free) with the
      // loaded values. `reset()` rebuilds default state, unlike a per-field
      // `setFieldValue` (which marks the field edited → post-submit re-validate).
      // The form owns `name`, `description`, and `showDynamicFilters`; there is
      // no local mirror of any of them.
      await nextTick();
      savedRefresh.value = Number(data?.defaultRefreshInterval) || 0;
      form.reset({
        name: data.title,
        description: data.description ?? "",
        showDynamicFilters: data.variables?.showDynamicFilters ?? false,
        defaultRefreshInterval: effectiveRefresh.value,
      });

      dateTimeValue.value = {
        startTime: data?.defaultDatetimeDuration?.startTime,
        endTime: data?.defaultDatetimeDuration?.endTime,
        relativeTimePeriod: data?.defaultDatetimeDuration?.relativeTimePeriod,
        valueType: data?.defaultDatetimeDuration?.type,
      };
      if (draftContext) await markLoaded();
    };
    const reloadAfterConflict = async () => {
      await getDashboardData();
      draftSyncOn = true;
      syncDraftSection();
    };

    onMounted(async () => {
      await getDashboardData();
      if (!draftContext) return;
      await applyPendingDraft();
      draftSyncOn = true;
      syncDraftSection();
      unregisterDraftSection = draftContext.register("general", saveForDraft);
    });

    watch([formValues, dateTimeValue], syncDraftSection, { deep: true });
    watch(
      () => draftContext?.restoreRevision,
      async () => {
        if (!draftSyncOn) return;
        draftSyncOn = false;
        await applyPendingDraft();
        draftSyncOn = true;
        syncDraftSection();
      },
    );
    onBeforeUnmount(() => unregisterDraftSection?.());

    const saveDashboard = async (value: GeneralSettingsForm) => {
      let data: any;
      try {
        // get the latest dashboard data and update the title and description
        data = JSON.parse(
          JSON.stringify(
            await getDashboard(store, route.query.dashboard, route.query.folder ?? "default"),
          ),
        );

        // update the values — all come from the validated form submit payload
        // (the form owns `name`, `description`, `showDynamicFilters`).
        data.title = value.name;
        data.description = value.description;

        if (!data.variables) {
          data.variables = {
            list: [],
            showDynamicFilters: value.showDynamicFilters,
          };
        } else {
          data.variables.showDynamicFilters = value.showDynamicFilters;
        }

        if (value.defaultRefreshInterval > 0) {
          data.defaultRefreshInterval = value.defaultRefreshInterval;
        } else {
          delete data.defaultRefreshInterval;
        }

        data.defaultDatetimeDuration = {
          startTime: dateTimeValue?.value?.startTime,
          endTime: dateTimeValue?.value?.endTime,
          relativeTimePeriod: dateTimeValue?.value?.relativeTimePeriod,
          type: dateTimeValue?.value?.valueType,
        };

        // now lets save it
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          route.query.dashboard,
          data,
          route?.query?.folder ?? "default",
        );

        showPositiveNotification(t("dashboard.generalSettingsPage.updatedSuccessfully"));

        lastSaveSucceeded = true;
        if (loadedKey.value !== null) {
          loadedKey.value = sectionKey(generalSnapshot());
          syncDraftSection();
        }
        emit("save");
      } catch (error: any) {
        if (saveConflict.isConflict(error)) {
          void saveConflict.openConflict({
            dashboardId: route.query.dashboard as string,
            folderId: (route?.query?.folder as string) ?? "default",
            mine: data,
            change: t("dashboard.saveConflict.change.changedSettings"),
            onResolved: reloadAfterConflict,
          });
        } else {
          showErrorNotification(
            error?.message ?? t("dashboard.generalSettingsPage.updationFailed"),
            {
              timeout: 2000,
            },
          );
        }
      }
    };

    // OForm @submit handler — receives the validated form values. The form owns
    // `name`, `description`, and `showDynamicFilters`; we forward the whole
    // payload into the save (only the datetime duration is non-form state).
    // OForm awaits this, so the Save button's `isSubmitting` (slot) spans the save.
    const onSubmit = async (value: GeneralSettingsForm) => {
      await saveDashboard(value);
    };

    return {
      t,
      form,
      selectedRefresh,
      minRefreshSeconds,
      refreshHelpText,
      showAbsoluteRangeHint,
      store,
      onSubmit,
      closeBtn,
      initialTimezone,
      dateTimeValue,
      dateTimePickerKey,
      formRef,
    };
  },
});
</script>
