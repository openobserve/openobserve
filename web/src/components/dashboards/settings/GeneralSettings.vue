<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
    <div class="column full-height">
      <DashboardHeader :title="t('dashboard.generalSettingsTitle')" />
      <div>
        <q-form ref="addDashboardForm" @submit="onSubmit">
          <q-input
            v-model="dashboardData.title"
            :label="t('dashboard.name') + ' *'"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[(val) => !!val || t('dashboard.nameRequired')]"
          />
          <span>&nbsp;</span>
          <q-input
            v-model="dashboardData.description"
            :label="t('dashboard.typeDesc')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
          />
          <div class="flex justify-center q-mt-lg">
            <q-btn
              ref="closeBtn"
              v-close-popup
              class="q-mb-md text-bold"
              :label="t('dashboard.cancel')"
              text-color="light-text"
              padding="sm md"
              no-caps
            />
            <q-btn
              :disable="dashboardData.title === ''"
              :label="t('dashboard.save')"
              class="q-mb-md text-bold no-border q-ml-md"
              color="secondary"
              padding="sm xl"
              type="submit"
              no-caps
              :loading="saveDashboardApi.isLoading.value"
            />
          </div>
        </q-form>
      </div>
    </div>
</template>
  
<script lang="ts">
import { defineComponent, onMounted, ref, type Ref } from "vue";
import dashboardService from "../../../services/dashboards";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { isProxy, toRaw, reactive } from "vue";
import { getDashboard, updateDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import DashboardHeader from "./common/DashboardHeader.vue";
import { useLoading } from "@/composables/useLoading";
import { useQuasar } from "quasar";

  export default defineComponent({
    name: "GeneralSettings",
    components: {
      DashboardHeader,
    },
    emits: ["update:modelValue", "updated", "finish"],
    setup() {
      const store: any = useStore();
      const { t } = useI18n();
      const $q = useQuasar();
      const route = useRoute();
      
      const addDashboardForm: Ref<any> = ref(null);
      const closeBtn :Ref<any>= ref(null);

      const dashboardData = reactive({
        title: "",
        description: "",
      });
      
      const getDashboardData = async () => {
        const data = await getDashboard(store, route.query.dashboard);
        dashboardData.title = data.title;
        dashboardData.description = data.description;
      };
      // console.log("dashboardDataget", getDashboardData());
      onMounted(async () => {
        await getDashboardData();
      })

      const saveDashboardApi = useLoading(async () => {
        // get the latest dashboard data and update the title and description
        const data = JSON.parse(JSON.stringify(await getDashboard(store, route.query.dashboard)));

        // update the values
        data.title = dashboardData.title;
        data.description = dashboardData.description;

        // now lets save it
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          route.query.dashboard,
          data
        )

        $q.notify({
          type: "positive",
          message: "Dashboard updated successfully."
        });
      })

      const onSubmit = () => {
        addDashboardForm.value.validate().then((valid: any) => {
          if (!valid) {
            return false;
          }

          saveDashboardApi.execute()
            .catch((err: any) => {
              $q.notify({
                type: "negative",
                message: JSON.stringify(
                  err.response.data["error"] || "Dashboard creation failed."
                ),
              });
            });
        });
      }

      return {
        t,
        dashboardData,
        addDashboardForm,
        store,
        saveDashboardApi,
        onSubmit,
        closeBtn
      };
    },
  });
  </script>
  