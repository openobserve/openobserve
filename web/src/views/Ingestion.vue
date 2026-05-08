<!-- eslint-disable no-prototype-builtins -->
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
  <q-page class="ingestionPage">
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs">
      <div class="card-container">
        <div class="q-px-md q-pt-md full-width">
          <span class="text-h6 q-mr-auto"> {{ t("ingestion.header") }}</span>
          <!-- Org token management button (non-RUM pages) -->
          <q-btn
            v-if="!isRUMPage"
            class="o2-primary-button tw:h-[36px] q-ml-sm q-mb-xs text-bold no-border right float-right"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            flat
            no-caps
            icon="vpn_key"
            :label="t('ingestion.manageTokensBtnLabel')"
            @click="navigateToIngestionTokens"
          />
          <!-- RUM token buttons -->
          <q-btn
            v-if="
              isRUMPage &&
              store.state.organizationData.rumToken.rum_token != ''
            "
            class="o2-primary-button tw:h-[36px] q-ml-md q-mb-xs text-bold no-border right float-right"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            flat
            no-caps
            :label="t(`ingestion.resetRUMTokenLabel`)"
            @click="showRUMUpdateDialogFn"
          />
          <q-btn
            v-else-if="
              isRUMPage &&
              store.state.organizationData.rumToken.rum_token == ''
            "
            class="o2-primary-button tw:h-[36px] q-ml-md q-mb-xs text-bold no-border right float-right"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            flat
            no-caps
            :label="t(`ingestion.generateRUMTokenLabel`)"
            @click="generateRUMToken"
          />
          <q-select
            v-if="!isRUMPage"
            v-model="selectedTokenName"
            :options="tokenOptions"
            :dark="store.state.theme === 'dark'"
            outlined
            dense
            emit-value
            map-options
            class="tw:max-w-xs q-ml-md q-mb-xs right float-right"
            style="min-width: 220px"
            @update:model-value="onTokenSelected"
          >
            <template #prepend>
              <q-icon name="vpn_key" />
            </template>
          </q-select>
          <q-input
            v-model="globalSearchQuery"
            :placeholder="t('common.search')"
            dense
            borderless
            clearable
            class="tw:max-w-sm q-ml-md q-mb-xs right float-right indexlist-search-input"
            data-test="recommended-list-search-input"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
          <span
            class="text-subtitle bg-warning float-right q-pa-sm text-bold"
            v-if="
              store.state.zoConfig.hasOwnProperty(
                'restricted_routes_on_empty_data',
              ) &&
              store.state.zoConfig.restricted_routes_on_empty_data == true &&
              store.state.organizationData.isDataIngested == false
            "
          >
            {{ t("ingestion.redirectionIngestionMsg") }}
          </span>
          <div style="clear: both"></div>
          <ConfirmDialog
            title="Reset RUM Token"
            message="Are you sure you want to update rum token for this organization?"
            @update:ok="updateRUMToken"
            @update:cancel="confirmRUMUpdate = false"
            v-model="confirmRUMUpdate"
          />
        </div>
        <q-tabs v-model="ingestTabType" horizontal
align="left" class="q-ml-md">
          <q-route-tab
            default
            name="recommended"
            :to="{
              name: 'recommended',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.recommendedLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="custom"
            :to="{
              name: 'custom',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.customLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="server"
            :to="{
              name: 'servers',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.serverLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="database"
            :to="{
              name: 'databases',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.databaseLabel')"
            content-class="tab_content"
          />

          <q-route-tab
            name="security"
            :to="{
              name: 'security',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.securityLabel')"
            content-class="tab_content"
          />

          <q-route-tab
            name="devops"
            :to="{
              name: 'devops',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.devopsLabel')"
            content-class="tab_content"
          />

          <q-route-tab
            name="networking"
            :to="{
              name: 'networking',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.networkingLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="message-queues"
            :to="{
              name: 'message-queues',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.messageQueuesLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="languages"
            :to="{
              name: 'languages',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.languagesLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="ai-integrations"
            :to="{
              name: 'ai-integrations',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.aiLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            name="others"
            :to="{
              name: 'others',
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
              },
            }"
            :label="t('ingestion.otherLabel')"
            content-class="tab_content"
          />
        </q-tabs>
      </div>
    </div>
    <div
      class="tw:max-h-[calc(100vh - var(--navbar-height) - 100px)]"
    >
      <router-view
        :title="ingestTabType"
        :currOrgIdentifier="currentOrgIdentifier"
        :currUserEmail="currentUserEmail"
        @copy-to-clipboard-fn="copyToClipboardFn"
      >
      </router-view>
    </div>

  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import {
  defineComponent,
  ref,
  onBeforeMount,
  onMounted,
  onUpdated,
  watch,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, copyToClipboard } from "quasar";
import organizationsService from "@/services/organizations";
import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import apiKeysService from "@/services/api_keys";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { searchIngestionItems } from "@/utils/ingestionSearchIndex";

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
    const confirmRUMUpdate = ref<boolean>(false);
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );
    const ingestTabType = ref("recommended");
    const globalSearchQuery = ref("");

    // Token selector — pick which ingestion token the curl examples use
    const selectedTokenName = ref("default");
    const tokenOptions = computed(() => {
      const tokens = store.state.organizationData.orgTokens || [];
      const enabled = tokens.filter((t: any) => t.enabled);
      if (enabled.length === 0) {
        return [{ label: "default", value: "default" }];
      }
      return enabled.map((t: any) => ({
        label: t.name,
        value: t.name,
      }));
    });
    const onTokenSelected = (name: string) => {
      const tokens = store.state.organizationData.orgTokens || [];
      const token = tokens.find((t: any) => t.name === name);
      if (token?.token) {
        store.dispatch("setOrganizationPasscode", token.token);
      }
      // Fallback: if tokens haven't loaded yet, keep passcode from getOrganizationPasscode()
    };

    const activeTab = ref("recommended");
    const metricRoutes = [
      "prometheus",
      "otelCollector",
      "telegraf",
      "cloudwatchMetrics",
    ];
    const traceRoutes = ["tracesOTLP"];
    const rumRoutes = ["frontendMonitoring"];

    const tabs = [
      {
        label: t("ingestion.recommendedLabel"),
        value: "recommended",
      },
      {
        label: t("ingestion.customLabel"),
        value: "custom",
      },
      {
        label: t("ingestion.databaseLabel"),
        value: "database",
      },
    ];

    const isRUMPage = computed(() =>
      rumRoutes.indexOf(router.currentRoute.value.name) > -1,
    );

    onBeforeMount(() => {
      if (store.state.selectedOrganization.identifier != undefined) {
        getOrganizationPasscode();
        fetchOrgTokens();
        if (!store.state.organizationData.rumToken.rum_token) {
          getRUMToken();
        }
      }
    });

    onMounted(() => {
      if (router.currentRoute.value.name === "ingestion") {
        router.push({
          name: "recommended",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "ingestion") {
        router.push({
          name: "recommended",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const getOrganizationPasscode = () => {
      organizationsService
        .get_organization_passcode(store.state.selectedOrganization.identifier)
        .then((res) => {
          if (res.data.data.passcode == "") {
            q.notify({
              type: "negative",
              message: "API Key not found.",
              timeout: 5000,
            });
          } else {
            store.dispatch("setOrganizationPasscode", res.data.data.passcode);
            store.dispatch("setOrganizationPasscodeUser", res.data.data.user);
            currentOrgIdentifier.value =
              store.state.selectedOrganization.identifier;
          }
        })
        .catch(() => {
          // Silently fail — passcode is not critical for page render
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
          store.state.selectedOrganization.identifier,
        )
        .then((res) => {
          if (res.data.data.passcode == "") {
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
            store.dispatch("setOrganizationPasscodeUser", res.data.data.user);
            currentOrgIdentifier.value =
              store.state.selectedOrganization.identifier;
          }
        })
        .catch((e) => {
          if (e.response.status != 403) {
            q.notify({
              type: "negative",
              message: "Error while updating Token." + e.error,
              timeout: 5000,
            });
          }
        });

      segment.track("Button Click", {
        button: "Update Passcode",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    };

    const showResetDefaultDialogFn = () => {
      confirmUpdate.value = true;
    };

    const showRUMUpdateDialogFn = () => {
      confirmRUMUpdate.value = true;
    };

    const fetchOrgTokens = () => {
      organizationsService
        .list_org_ingestion_tokens(
          store.state.selectedOrganization.identifier,
        )
        .then((res) => {
          store.dispatch("setOrgTokens", res.data.data);
        })
        .catch(() => {
          // Silently fail — settings page will retry on load
        });
    };

    const navigateToIngestionTokens = () => {
      router.push({
        name: "ingestionTokens",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

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
        page: "Ingestion",
      });
    };

    const generateRUMToken = () => {
      apiKeysService
        .createRUMToken(store.state.selectedOrganization.identifier)
        .then((res) => {
          store.dispatch("setRUMToken", {
            rum_token: res.data.data.new_key,
          });
          getRUMToken();
          q.notify({
            type: "positive",
            message: "RUM Token generated successfully.",
            timeout: 5000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            q.notify({
              type: "negative",
              message:
                e.response?.data?.message ||
                "Error while generating RUM Token.",
              timeout: 5000,
            });
          }
        });

      segment.track("Button Click", {
        button: "Generate RUM Token",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    };

    const updateRUMToken = () => {
      apiKeysService
        .updateRUMToken(
          store.state.selectedOrganization.identifier,
          store.state.organizationData.rumToken.id,
        )
        .then((res) => {
          getRUMToken();
          q.notify({
            type: "positive",
            message: "RUM Token updated successfully.",
            timeout: 5000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            q.notify({
              type: "negative",
              message:
                e.response?.data?.message ||
                "Error while refreshing RUM Token.",
              timeout: 5000,
            });
          }
        });

      segment.track("Button Click", {
        button: "Update RUM Token",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    };

    // Global search functionality across all ingestion tabs
    const allIngestionTabs = [
      { name: "recommended", label: t("ingestion.recommendedLabel") },
      { name: "custom", label: t("ingestion.customLabel") },
      { name: "servers", label: t("ingestion.serverLabel") },
      { name: "databases", label: t("ingestion.databaseLabel") },
      { name: "security", label: t("ingestion.securityLabel") },
      { name: "devops", label: t("ingestion.devopsLabel") },
      { name: "networking", label: t("ingestion.networkingLabel") },
      { name: "message-queues", label: t("ingestion.messageQueuesLabel") },
      { name: "languages", label: t("ingestion.languagesLabel") },
      { name: "ai-integrations", label: t("ingestion.aiLabel") },
      { name: "others", label: t("ingestion.otherLabel") },
    ];

    // Recommended sub-tabs
    const recommendedSubTabs = [
      {
        name: "ingestFromKubernetes",
        label: t("ingestion.kubernetes"),
        parentTab: "recommended",
      },
      {
        name: "ingestFromWindows",
        label: t("ingestion.windows"),
        parentTab: "recommended",
      },
      {
        name: "ingestFromLinux",
        label: t("ingestion.linux"),
        parentTab: "recommended",
      },
      {
        name: "AWSConfig",
        label: t("ingestion.awsconfig"),
        parentTab: "recommended",
      },
      {
        name: "GCPConfig",
        label: t("ingestion.gcpconfig"),
        parentTab: "recommended",
      },
      {
        name: "AzureConfig",
        label: t("ingestion.azure"),
        parentTab: "recommended",
      },
      {
        name: "ingestFromTraces",
        label: t("ingestion.tracesotlp"),
        parentTab: "recommended",
      },
      {
        name: "frontendMonitoring",
        label: t("ingestion.rum"),
        parentTab: "recommended",
      },
    ];

    // Watch for search changes and navigate
    watch(globalSearchQuery, (newSearch) => {
      if (!newSearch) {
        return;
      }

      const searchQuery = newSearch.toLowerCase();

      // First, check main tabs
      const matchingMainTab = allIngestionTabs.find((tab) =>
        tab.label.toLowerCase().includes(searchQuery),
      );

      if (matchingMainTab) {
        router.replace({
          name: matchingMainTab.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }

      // Second, search within all ingestion items (servers, databases, etc.)
      const searchResults = searchIngestionItems(newSearch);
      if (searchResults.length > 0) {
        // Navigate to the first matching item
        const firstMatch = searchResults[0];
        router.replace({
          name: firstMatch.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }

      // Third, check AWS services
      import("@/utils/awsIntegrations").then((module) => {
        const awsIntegrations = module.awsIntegrations;

        const matchesAWSService = awsIntegrations.some(
          (integration: any) =>
            integration.displayName.toLowerCase().includes(searchQuery) ||
            integration.name.toLowerCase().includes(searchQuery) ||
            integration.description.toLowerCase().includes(searchQuery),
        );

        if (matchesAWSService) {
          router.replace({
            name: "AWSConfig",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
              search: newSearch,
            },
          });
        }
      });
    });

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
      currentUserEmail: store.state.userInfo.email,
      updatePasscode,
      showResetDefaultDialogFn,
      showRUMUpdateDialogFn,
      fetchOrgTokens,
      navigateToIngestionTokens,
      isRUMPage,
      confirmUpdate,
      confirmRUMUpdate,
      getImageURL,
      ingestTabType,
      getRUMToken,
      tabs,
      activeTab,
      copyToClipboardFn,
      rumRoutes,
      metricRoutes,
      traceRoutes,
      generateRUMToken,
      updateRUMToken,
      globalSearchQuery,
      selectedTokenName,
      tokenOptions,
      onTokenSelected,
    };
  },
});
</script>

<style scoped lang="scss">
.ingestionPage {
  .head {
    padding-bottom: 1rem;
  }
}
</style>
