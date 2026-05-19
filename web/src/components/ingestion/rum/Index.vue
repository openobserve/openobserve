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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <q-splitter
    v-model="splitterModel"
    unit="px"
    style="min-height: calc(100vh - 130px)"
  >
    <template v-slot:before>
      <OTabs
        v-model="rumtabs"
        orientation="vertical"
      >
        <ORouteTab
          name="rumWebTab"
          :to="{
            name: 'frontendMonitoring',
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          }"
          icon="web"
          :label="t('common.browser')"
        />
      </OTabs>
    </template>

    <template v-slot:after>
      <router-view
        title="Web"
        :currOrgIdentifier="currOrgIdentifier"
        :currUserEmail="currentUserEmail"
        @copy-to-clipboard-fn="copyToClipboardFn"
      >
      </router-view>
    </template>
  </q-splitter>
</template>

<script lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
// @ts-ignore
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard, useQuasar } from "quasar";
// import { config } from "../constants/config";
import config from "../../../aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";

export default defineComponent({
  name: "IngestRum",
  components: {
    OTabs, OTab, ORouteTab,},
  data() {
    return {};
  },
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const routeToRumTab: Record<string, string> = {
      frontendMonitoring: "rumWebTab",
    };
    const rumtabs = ref(routeToRumTab[router.currentRoute.value.name as string] ?? "rumWebTab");

    onMounted(() => {
      const ingestRoutes = ["frontendMonitoring"];

      if (ingestRoutes.includes(router.currentRoute.value.name)) {
        router.push({
          name: router.currentRoute.value.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
      if (router.currentRoute.value.name === "rumMonitoring") {
        router.push({
          name: "frontendMonitoring",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const copyToClipboardFn = (content: any) => {
      copyToClipboard(content.innerText)
        .then(() => {
          q.notify({
            type: "positive",
            message: "Content Copied Successfully!",
            timeout: 5000,
          });
        })
        .catch(() => {
          q.notify({
            type: "negative",
            message: "Error while copy content.",
            timeout: 5000,
          });
        });

      segment.track("Button Click", {
        button: "Copy to Clipboard",
        ingestion: router.currentRoute.value.name,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "RUM Ingestion",
      });
    };

    const showUpdateDialogFn = () => {
      confirmUpdate.value = true;
    };

    return {
      t,
      store,
      router,
      config,
      rowData,
      splitterModel: ref(200),
      currentUserEmail: store.state.userInfo.email,
      copyToClipboardFn,
      showUpdateDialogFn,
      confirmUpdate,
      rumtabs,
      getImageURL,
      verifyOrganizationStatus,
    };
  },
});
</script>

<style scoped lang="scss">
.ingestionPage {
  padding: 1.5rem 0 0;
  .head {
    padding-bottom: 1rem;
  }
  .o-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 1rem;
      .o-tab {
        justify-content: flex-start;
        padding: 0 0.6rem 0 0.6rem;
        text-transform: capitalize;

        &__content.tab_content {
          .o-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          color: black;
          background-color: $accent;
        }
      }
    }
  }
}
</style>
