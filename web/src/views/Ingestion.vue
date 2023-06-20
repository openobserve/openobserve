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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <q-page class="ingestionPage">
    <div class="head q-table__title q-pb-md q-px-md">
      {{ t("ingestion.header") }}

      <q-btn
        class="q-ml-md q-mb-xs text-bold no-border right float-right"
        padding="sm lg"
        color="secondary"
        no-caps
        icon="lock_reset"
        :label="t(`ingestion.passwordLabel`)"
        @click="showUpdateDialogFn"
      />
      <ConfirmDialog
        title="Reset Token"
        message="Are you sure you want to update token for this organization?"
        @update:ok="updatePasscode"
        @update:cancel="confirmUpdate = false"
        v-model="confirmUpdate"
      />
    </div>
    <q-separator class="separator" />
    <q-splitter
      v-model="splitterModel"
      unit="px"
      style="min-height: calc(100vh - 130px)"
    >
      <template v-slot:before>
        <q-tabs
          v-model="ingestTabType"
          indicator-color="transparent"
          inline-label
          vertical
        >
          <q-route-tab
            default
            name="ingestLogs"
            :to="{
              name: 'ingestLogs',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            label="Logs"
            content-class="tab_content"
          />
          <q-route-tab
            default
            name="ingestMetrics"
            :to="{
              name: 'ingestMetrics',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            label="Metrics"
            content-class="tab_content"
          />
          <q-route-tab
            name="ingestTraces"
            :to="{
              name: 'ingestTraces',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            label="Traces"
            content-class="tab_content"
          />
        </q-tabs>
      </template>

      <template v-slot:after>
        <q-tab-panels
          v-model="ingestTabType"
          animated
          swipeable
          vertical
          transition-prev="jump-up"
          transition-next="jump-up"
        >
          <q-tab-panel name="ingestLogs">
            <router-view :currOrgIdentifier="currentOrgIdentifier">
            </router-view>
          </q-tab-panel>
          <q-tab-panel name="ingestMetrics">
            <router-view :currOrgIdentifier="currentOrgIdentifier">
            </router-view>
          </q-tab-panel>

          <q-tab-panel name="ingestTraces">
            <router-view :currOrgIdentifier="currentOrgIdentifier">
            </router-view>
          </q-tab-panel>
        </q-tab-panels>
      </template>
    </q-splitter>
  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import organizationsService from "../services/organizations";
// import { config } from "../constants/config";
import config from "../aws-exports";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import segment from "../services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "../utils/zincutils";

export default defineComponent({
  name: "PageIngestion",
  components: { ConfirmDialog },

  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier
    );
    const ingestTabType = ref("");

    onBeforeMount(() => {
      const ingestRoutes = ["ingestLogs", "ingestTraces", "ingestMetrics"];
      const logRoutes = [
        "curl",
        "fluentbit",
        "fluentd",
        "kinesisfirehose",
        "vector",
        "filebeat",
        "syslog",
        "gcpLogs",
      ];
      const metricRoutes = ["prometheus", "otelCollector", "telegraf"];
      const traceRoutes = ["tracesOTLP"];

      if (logRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "ingestLogs";
      } else if (metricRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "ingestMetrics";
      } else if (traceRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "ingestTraces";
      } else if (ingestRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = router.currentRoute.value.name;
      } else if (router.currentRoute.value.name === "ingestion") {
        ingestTabType.value = "ingestLogs";
        router.push({
          name: "ingestLogs",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }

      if (!store.state.organizationPasscode) getOrganizationPasscode();
    });

    const getOrganizationPasscode = () => {
      organizationsService
        .get_organization_passcode(store.state.selectedOrganization.identifier)
        .then((res) => {
          if (res.data.data.token == "") {
            q.notify({
              type: "negative",
              message: "API Key not found.",
              timeout: 5000,
            });
          } else {
            store.dispatch("setOrganizationPasscode", res.data.data.passcode);
            currentOrgIdentifier.value =
              store.state.selectedOrganization.identifier;
          }
        });
    };

    const updatePasscode = () => {
      organizationsService
        .update_organization_passcode(
          store.state.selectedOrganization.identifier
        )
        .then((res) => {
          if (res.data.data.token == "") {
            q.notify({
              type: "negative",
              message: "API Key not found.",
              timeout: 5000,
            });
          } else {
            q.notify({
              type: "positive",
              message: "Token reset successfully.",
              timeout: 5000,
            });
            store.dispatch("setOrganizationPasscode", res.data.data.passcode);
            currentOrgIdentifier.value =
              store.state.selectedOrganization.identifier;
          }
        })
        .catch((e) => {
          q.notify({
            type: "negative",
            message: "Error while updating Token." + e.error,
            timeout: 5000,
          });
        });

      segment.track("Button Click", {
        button: "Update Passcode",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
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
      getOrganizationPasscode,
      currentOrgIdentifier,
      updatePasscode,
      showUpdateDialogFn,
      confirmUpdate,
      getImageURL,
      ingestTabType,
    };
  },
  computed: {
    selectedOrg() {
      return this.store.state.selectedOrganization.identifier;
    },
  },
  watch: {
    selectedOrg(newVal: any, oldVal: any) {
      verifyOrganizationStatus(this.store.state.organizations, this.router);
      if (newVal != oldVal) {
        this.getOrganizationPasscode();
      }
    },
  },
});
</script>

<style scoped lang="scss">
.ingestionPage {
  padding: 1.5rem 0 0;
  .head {
    padding-bottom: 1rem;
  }
  .q-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 1rem;
      .q-tab {
        justify-content: flex-start;
        padding: 0 0.6rem 0 0.6rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        text-transform: capitalize;

        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          background-color: $primary;
        }
      }
    }
  }
}
</style>
