<!-- Copyright 2023 OpenObserve Inc.

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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <q-page class="q-pa-none q-pt-xs" style="min-height: inherit;" >
    <div class="tw:flex tw:justify-between tw:items-center q-pb-md card-container tw:h-[62px] tw:mb-2 tw:ml-2 tw:mr-3 tw:px-3 tw:py-4">
    <div class="head q-table__title ">
      {{ headerBasedOnRoute() }}
    </div>
    <div v-if="isUsageRoute" class="tw:flex tw:gap-2 tw:items-center tw:h-[40px]">
      <div class="custom-usage-date-select">
          <q-select
            dense
            borderless
            v-model="usageDate"
            :options="options"
            emit-value
            map-options
            icon="schedule"
            @update:model-value="(value: any) => selectUsageDate()"
            class="q-pa-none q-mx-none tw:h-[40px] q-mt-xs"
          >
          <template v-slot:prepend>
            <q-icon name="schedule" size="xs" class="tw:mr-2 tw:mt-1" @click.stop.prevent />
          </template>
          </q-select>
        </div>
        <div class="tw:flex tw:items-center ">
          <div class="app-tabs-container tw:h-[36px] ">
              <AppTabs class=" tabs-selection-container"  :tabs="tabs" :activeTab="usageDataType" @update:activeTab="(value: any) => updateActiveTab(value)" />

          </div>
        </div>
    </div>
      </div>
    <q-splitter
      v-model="splitterModel"
      unit="px"
      class="logs-splitter-smooth tw:overflow-hidden"
    >
      <template v-slot:before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem] ">
          <div class="card-container tw:h-[calc(100vh-118px)]">
        <q-tabs
          v-model="billingtab"
          indicator-color="transparent"
          inline-label
          vertical
        >

          <q-route-tab
            exact
            name="plans"
            :to="
              '/billings/plans?org_identifier=' +
              store.state.selectedOrganization.identifier
            "
            :icon="'img:' + getImageURL('images/common/plan_icon.svg')"
            :label="t('billing.plansLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            exact
            default
            name="usage"
            :to="
              '/billings/usage?org_identifier=' +
              store.state.selectedOrganization.identifier +
              '&usage_date=' +
              usageDate + 
              '&data_type=' +
              usageDataType
            "
            :icon="'img:' + getImageURL('images/common/usage_icon.svg')"
            :label="t('billing.usageLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            exact
            name="invoice_history"
            :to="
              '/billings/invoice_history?org_identifier=' +
              store.state.selectedOrganization.identifier
            "
            :icon="'img:' + getImageURL('images/common/invoice_icon.svg')"
            :label="t('billing.invoiceHistoryLabel')"
            content-class="tab_content"
          />
        </q-tabs>
        <!-- <q-btn
              data-test="logs-search-field-list-collapse-btn"
              :icon="showSidebar ? 'chevron_left' : 'chevron_right'"
              :title="showSidebar ? 'Collapse Fields' : 'Open Fields'"
              :class="showSidebar ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
              color="primary"
              size="sm"
              dense
              round
              @click="collapseSidebar"
            /> -->
          </div>
        </div>

      </template>

      <template v-slot:after>
        <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
          <div class="card-container tw:h-[calc(100vh-118px)]">
            <router-view title=""> </router-view>
          </div>
        </div>
      </template>
    </q-splitter>
  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onBeforeMount, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import Usage from "./usage.vue";
import { getImageURL } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";

export default defineComponent({
  name: "PageIngestion",
  components: { ConfirmDialog, Usage, AppTabs },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const billingtab = ref("usage");
    const usageDataType = ref(router.currentRoute.value.query.data_type || "gb");
    const showSidebar = ref(true);
    const lastSplitterPosition = ref(200);
    const splitterModel = ref(220);
    const collapseSidebar = () => {
      showSidebar.value = !showSidebar.value;
      if (showSidebar.value) {
        splitterModel.value = lastSplitterPosition.value;
      } else {
        lastSplitterPosition.value = splitterModel.value;
        splitterModel.value = 0;
      }
    };

    onMounted(() => {
      if (router.currentRoute.value.name == "billings" || router.currentRoute.value.name == "plans") {
        billingtab.value = "plans";
        router.push({ path: "/billings/plans", query: { org_identifier: store.state.selectedOrganization.identifier } });
      }
      // else {
      //   billingtab.value = router.currentRoute.value.name;
      //   router.push({ path: "/billings/" + router.currentRoute.value.name });
      // }
    });

    const headerBasedOnRoute = () => {
      if (router.currentRoute.value.name == "usage") {
        return t("billing.usageLabel");
      } else if (router.currentRoute.value.name == "plans") {
        return t("billing.plansLabel");
      } else if (router.currentRoute.value.name == "invoice_history") {
        return t("billing.invoiceHistoryLabel");
      }
      return "";
    };
    const usageDate = ref(router.currentRoute.value.query.usage_date || "30days");

    const isUsageRoute = computed(() => {
      return router.currentRoute.value.name == "usage";
    })
    const selectUsageDate = () => {
      router.push({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: usageDate.value,
          data_type: usageDataType.value
        }
      })
      
    }
    const updateActiveTab = (value: any) => {
      usageDataType.value = value;
      selectUsageDate();
    }
    const tabs = [
    {
        label: 'Gb',
        value: "gb",
      },
      {
        label: 'Mb',
        value: "mb",
      }
    ]

    return {
      t,
      store,
      router,
      config,
      billingtab,
      getImageURL,
      splitterModel,
      headerBasedOnRoute,
      options: [
        {label: "30 Days", value: "30days"}, 
        {label: "60 Days", value: "60days"},
        {label: "3 Months", value: "3months"},
        {label: "6 Months", value: "6months"}],
      usageDate,
      selectUsageDate,
      isUsageRoute,
      tabs,
      usageDataType,
      updateActiveTab,
      collapseSidebar,
      showSidebar,
      lastSplitterPosition,
    };
  },
});
</script>

<style scoped lang="scss">


.custom-usage-date-select{
  ::v-deep(.q-field--auto-height.q-field--dense .q-field__control) {
  min-height: 32px !important;
  height: 40px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  align-items: center !important;
}

::v-deep(.q-field--auto-height.q-field--dense .q-field__native) {
  min-height: 42px !important;
  height: 42px !important;
}
}
</style>
