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
    <div>
      <OForm
        ref="formRef"
        :schema="generalSettingsSchema"
        :default-values="generalSettingsDefaults()"
        @submit="onSubmit"
        v-slot="{ isSubmitting }"
      >
        <div class="flex flex-col gap-3 px-3 py-3">
          <OFormInput
            name="name"
            :label="t('dashboard.name')"
            required
            data-test="dashboard-general-setting-name"
          />
          <OFormInput
            name="description"
            :label="t('dashboard.typeDesc')"
            data-test="dashboard-general-setting-description"
          />
          <div v-if="dateTimeValue" data-test="dashboard-general-setting-datetime-picker">
            <label>{{ t("dashboard.defaultDuration") }}</label>
            <DateTimePickerDashboard
              v-show="store.state.printMode === false"
              ref="dateTimePicker"
              class="my-2 h-7.5"
              size="sm"
              :initialTimezone="initialTimezone"
              v-model="dateTimeValue"
              :auto-apply-dashboard="true"
              menu-align="start"
            />
          </div>
          <OFormSwitch
            name="showDynamicFilters"
            :label="t('dashboard.showDynamicFilters')"
            data-test="dashboard-general-setting-dynamic-filter"
            size="lg"
          />
          <div class="flex justify-center gap-2">
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
              >{{ t("dashboard.save") }}</OButton
            >
          </div>
        </div>
      </OForm>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref, nextTick, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getDashboard, updateDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import DashboardHeader from "./common/DashboardHeader.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import useNotifications from "@/composables/useNotifications";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import {
  makeGeneralSettingsSchema,
  generalSettingsDefaults,
  type GeneralSettingsForm,
} from "./GeneralSettings.schema";

export default defineComponent({
  name: "GeneralSettings",
  components: {
    DashboardHeader,
    DateTimePickerDashboard,
    OButton,
    OForm,
    OFormInput,
    OFormSwitch,
  },
  emits: ["save", "close"],
  setup(props, { emit }) {
    const store: any = useStore();
    const { t } = useI18n();
    const generalSettingsSchema = makeGeneralSettingsSchema(t);
    const route = useRoute();
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();

    const formRef = ref<any>(null);
    const closeBtn: Ref<any> = ref(null);
    // initial timezone, which will come from the route query
    const initialTimezone: any = ref(store.state.timezone ?? null);

    let dateTimeValue: any = ref(null);
    const getDashboardData = async () => {
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
      formRef.value?.form.reset({
        name: data.title,
        description: data.description ?? "",
        showDynamicFilters: data.variables?.showDynamicFilters ?? false,
      });

      dateTimeValue.value = {
        startTime: data?.defaultDatetimeDuration?.startTime,
        endTime: data?.defaultDatetimeDuration?.endTime,
        relativeTimePeriod: data?.defaultDatetimeDuration?.relativeTimePeriod,
        valueType: data?.defaultDatetimeDuration?.type,
      };
    };
    onMounted(async () => {
      await getDashboardData();
    });

    const saveDashboard = async (value: GeneralSettingsForm) => {
      try {
        // get the latest dashboard data and update the title and description
        const data = JSON.parse(
          JSON.stringify(
            await getDashboard(store, route.query.dashboard, route.query.folder ?? "default"),
          ),
        );

        // update the values — all three come from the validated form submit
        // payload (the form owns `name`, `description`, `showDynamicFilters`).
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

        emit("save");
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("dashboard.generalSettingsPage.updationFailed"),
          );
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
      generalSettingsSchema,
      generalSettingsDefaults,
      store,
      onSubmit,
      closeBtn,
      initialTimezone,
      dateTimeValue,
      formRef,
    };
  },
});
</script>
