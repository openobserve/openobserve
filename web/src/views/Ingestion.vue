<!-- eslint-disable no-prototype-builtins -->
<!-- Copyright 2023 Zinc Labs Inc.

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
    <div class="q-px-md flex justify-between items-center full-width">
      <span class="text-h6"> {{ t("ingestion.header") }}</span>

      <q-btn
        v-if="
          rumRoutes.indexOf(router.currentRoute.value.name) > -1 &&
          store.state.organizationData.rumToken.rum_token != ''
        "
        class="q-ml-md q-mb-xs text-bold no-border right float-right"
        padding="sm lg"
        color="secondary"
        no-caps
        icon="lock_reset"
        :label="t(`ingestion.resetRUMTokenLabel`)"
        @click="showRUMUpdateDialogFn"
      />
      <q-btn
        v-else-if="
          rumRoutes.indexOf(router.currentRoute.value.name) > -1 &&
          store.state.organizationData.rumToken.rum_token == ''
        "
        class="q-ml-md q-mb-xs text-bold no-border right float-right"
        padding="sm lg"
        color="secondary"
        no-caps
        icon="lock_reset"
        :label="t(`ingestion.generateRUMTokenLabel`)"
        @click="generateRUMToken"
      />
      <q-btn
        v-else
        class="q-ml-md q-mb-xs text-bold no-border right float-right"
        padding="sm lg"
        color="secondary"
        no-caps
        icon="lock_reset"
        :label="t(`ingestion.resetTokenBtnLabel`)"
        @click="showUpdateDialogFn"
      />
      <ConfirmDialog
        title="Reset Token"
        message="Are you sure you want to update token for this organization?"
        @update:ok="updatePasscode"
        @update:cancel="confirmUpdate = false"
        v-model="confirmUpdate"
      />
      <ConfirmDialog
        title="Reset RUM Token"
        message="Are you sure you want to update rum token for this organization?"
        @update:ok="updateRUMToken"
        @update:cancel="confirmRUMUpdate = false"
        v-model="confirmRUMUpdate"
      />
    </div>
    <q-separator class="separator" />
    <app-tabs :tabs="tabs" v-model:active-tab="activeTab" />
    <template v-if="activeTab === 'custom'">
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
    </template>
    <template v-if="activeTab === 'recommended'">
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
              name="ingestFromKubernetes"
              :to="{
                name: 'ingestFromKubernetes',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Kubernetes"
              content-class="tab_content"
            />
            <q-route-tab
              default
              name="ingestFromWindows"
              :to="{
                name: 'ingestFromWindows',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Windows"
              content-class="tab_content"
            />
            <q-route-tab
              name="ingestFromLinux"
              :to="{
                name: 'ingestFromLinux',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Linux"
              content-class="tab_content"
            />
            <q-route-tab
              name="ingestFromOtel"
              :to="{
                name: 'ingestFromOtel',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="OTEL"
              content-class="tab_content"
            />
            <q-route-tab
              name="frontendMonitoring"
              :to="{
                name: 'frontendMonitoring',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Frontend Monitoring"
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
            <q-tab-panel name="ingestFromKubernetes">
              <router-view :currOrgIdentifier="currentOrgIdentifier">
              </router-view>
            </q-tab-panel>
            <q-tab-panel name="ingestFromWindows">
              <router-view :currOrgIdentifier="currentOrgIdentifier">
              </router-view>
            </q-tab-panel>

            <q-tab-panel name="ingestFromLinux">
              <router-view :currOrgIdentifier="currentOrgIdentifier">
              </router-view>
            </q-tab-panel>
            <q-tab-panel name="ingestFromOtel">
              <router-view :currOrgIdentifier="currentOrgIdentifier">
              </router-view>
            </q-tab-panel>
            <q-tab-panel name="frontendMonitoring">
              <router-view
                :currOrgIdentifier="currentOrgIdentifier"
                :currUserEmail="store.state.userInfo.email"
              >
              </router-view>
            </q-tab-panel>
          </q-tab-panels>
        </template>
      </q-splitter>
    </template>
  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onMounted } from "vue";
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
import apiKeysService from "@/services/api_keys";
import AppTabs from "@/components/common/AppTabs.vue";

export default defineComponent({
  name: "PageIngestion",
  components: { ConfirmDialog, AppTabs },
  methods: {
    generateRUMToken() {
      apiKeysService
        .createRUMToken(this.store.state.selectedOrganization.identifier)
        .then((res) => {
          this.store.dispatch("setRUMToken", res.data.data.keys);
          this.getRUMToken();
          this.q.notify({
            type: "positive",
            message: "RUM Token generated successfully.",
            timeout: 5000,
          });
        })
        .catch((e) => {
          this.q.notify({
            type: "negative",
            message: "Error while generating RUM Token." + e.error,
            timeout: 5000,
          });
        });

      segment.track("Button Click", {
        button: "Generate RUM Token",
        user_org: this.store.state.selectedOrganization.identifier,
        user_id: this.store.state.userInfo.email,
        page: "Ingestion",
      });
    },
    updateRUMToken() {
      apiKeysService
        .updateRUMToken(
          this.store.state.selectedOrganization.identifier,
          this.store.state.organizationData.rumToken.id
        )
        .then((res) => {
          this.getRUMToken();
          this.q.notify({
            type: "positive",
            message: "RUM Token updated successfully.",
            timeout: 5000,
          });
        })
        .catch((e) => {
          this.q.notify({
            type: "negative",
            message: "Error while refreshing RUM Token." + e.error,
            timeout: 5000,
          });
        });

      segment.track("Button Click", {
        button: "Update RUM Token",
        user_org: this.store.state.selectedOrganization.identifier,
        user_id: this.store.state.userInfo.email,
        page: "Ingestion",
      });
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const confirmRUMUpdate = ref<boolean>(false);
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier
    );
    const ingestTabType = ref("curl");
    const metricRoutes = ["prometheus", "otelCollector", "telegraf"];
    const traceRoutes = ["tracesOTLP"];
    const rumRoutes = ["rumWeb"];
    const activeTab = ref("recommended");

    const tabs = [
      {
        label: "Recommended",
        value: "recommended",
      },
      {
        label: "Custom",
        value: "custom",
      },
    ];

    onBeforeMount(() => {
      const ingestRoutes = [
        "ingestLogs",
        "ingestTraces",
        "ingestMetrics",
        "rumMonitoring",
      ];
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

      if (logRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "ingestLogs";
      } else if (metricRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "ingestMetrics";
      } else if (traceRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "ingestTraces";
      } else if (ingestRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = router.currentRoute.value.name;
      } else if (rumRoutes.includes(router.currentRoute.value.name)) {
        ingestTabType.value = "rumMonitoring";
      } else if (router.currentRoute.value.name === "ingestion") {
        ingestTabType.value = "ingestLogs";
        router.push({
          name: "curl",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
      if (
        !store.state.organizationData.organizationPasscode &&
        router.currentRoute.value.name != "ingestion"
      ) {
        getOrganizationPasscode();
        getRUMToken();
      }
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

    const getRUMToken = () => {
      apiKeysService
        .listRUMTokens(store.state.selectedOrganization.identifier)
        .then((res) => {
          store.dispatch("setRUMToken", res.data.data);
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

    const showRUMUpdateDialogFn = () => {
      confirmRUMUpdate.value = true;
    };

    return {
      t,
      q,
      store,
      router,
      config,
      rowData,
      splitterModel: ref(200),
      getOrganizationPasscode,
      currentOrgIdentifier,
      updatePasscode,
      showUpdateDialogFn,
      showRUMUpdateDialogFn,
      confirmUpdate,
      confirmRUMUpdate,
      getImageURL,
      ingestTabType,
      rumRoutes,
      getRUMToken,
      tabs,
      activeTab,
    };
  },
});
</script>

<style scoped lang="scss">
.ingestionPage {
  padding: 0.25rem 0 1.5rem 0;
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
          color: black;
          background-color: $accent;
        }
      }
    }
  }
}
</style>
