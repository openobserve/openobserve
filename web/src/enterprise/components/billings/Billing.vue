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
  <q-page class="page" >
    <div class="tw-flex tw-justify-between tw-items-center q-pb-md">
    <div class="head q-table__title ">
      {{ headerBasedOnRoute() }}
    </div>
    <div v-if="isUsageRoute" class="tw-flex tw-gap-2 tw-items-center tw-h-[32px]">
      <div class="custom-usage-date-select">
          <q-select
            dense
            outlined
            v-model="usageDate"
            :options="options"
            emit-value
            map-options
            icon="schedule"
            @update:model-value="(value: any) => selectUsageDate()"
            class="q-pa-none q-ma-none  "
            :class="store.state.theme === 'dark' ? 'tw-bg-[#35353C]' : 'tw-bg-[#D5D6EF]'"
          >
          <template v-slot:prepend>
            <q-icon name="schedule" size="xs" class="tw-mr-2" @click.stop.prevent />
          </template>
          </q-select>
        </div>
        <div class="usage-data-type-tabs">
          <AppTabs  :tabs="tabs" :activeTab="usageDataType" @update:activeTab="(value: any) => updateActiveTab(value)" />
        </div>
    </div>
      </div>
    <q-separator class="separator" />
    <q-splitter
      v-model="splitterModel"
      unit="px"
      style="min-height: calc(100vh - 130px)"
    >
      <template v-slot:before>
        <q-tabs
          v-model="billingtab"
          indicator-color="transparent"
          inline-label
          vertical
        >
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
      </template>

      <template v-slot:after>
          <router-view title=""> </router-view>
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

    onMounted(() => {
      if (router.currentRoute.value.name == "billings" || router.currentRoute.value.name == "usage") {
        billingtab.value = "usage";
        router.push({ path: "/billings/usage", query: { org_identifier: store.state.selectedOrganization.identifier, usage_date: usageDate.value, data_type: usageDataType.value } });
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
      splitterModel: ref(200),
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
    };
  },
});
</script>

<style scoped lang="scss">
.page {
  padding: 1.5rem 1.5rem 0;
  .q-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 0;
      .q-tab {
        justify-content: flex-start;
        // padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        // color: $dark;

        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          background-color: $accent;
          color: black;
        }
      }
    }
  }
}

.usage-data-type-tabs {
    height: 32px !important;

    :deep(.rum-tabs) {
      border: 1px solid #464646;
      height: 32px !important;

    }

    :deep(.rum-tab) {
      &:hover {
        background: #464646;
      }

      &.active {
        background: #5960b2;
        color: #ffffff !important;
      }
    }
  }

.usage-data-type-tabs {
  height: 32px !important;
  

  :deep(.rum-tabs) {
    border: 1px solid #dcdcdc;
    height: fit-content;
    border-radius: 4px;
    overflow: hidden;
  }

  :deep(.rum-tab) {
    width: fit-content !important;
    padding: 4px 12px !important;
    border: none !important;
    &:hover {
      background: #eaeaea;
      color: #000000 !important;
    }

    &.active {
      background: #5960b2;
      color: #ffffff !important;
    }
  }
}
.custom-usage-date-select{
  ::v-deep(.q-field--auto-height.q-field--dense .q-field__control) {
  min-height: 32px !important;
  height: 32px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  align-items: center !important;
}

::v-deep(.q-field--auto-height.q-field--dense .q-field__native) {
  min-height: 32px !important;
  height: 32px !important;
}
}
</style>
