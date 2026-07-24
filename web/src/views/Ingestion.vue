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
  <OPageLayout
    class="ingestionPage"
    data-test="ingestion-page"
    :title="t('ingestion.header')"
    icon="data-plus-line"
    tabs-below
    bleed
  >
      <template #actions>
        <div class="w-50 flex-none">
          <OSearchInput
            v-model="globalSearchQuery"
            :placeholder="t('common.search')"
            clearable
            class="w-full indexlist-search-input"
            data-test="recommended-list-search-input"
          />
        </div>
        <OSelect
          v-if="!isRUMPage && tokenOptions.length > 0"
          v-model="selectedTokenName"
          :options="tokenOptions"
          label-key="label"
          value-key="value"
          class="max-w-xs"
          style="min-width: 220px"
          @update:model-value="onTokenSelected"
        />
        <OButton
          v-if="!isRUMPage"
          variant="primary"
          size="sm"
          icon-left="key"
          @click="navigateToIngestionTokens"
        >
          {{ t('ingestion.manageTokensBtnLabel') }}
        </OButton>
        <OButton
          v-if="
            rumRoutes.indexOf(router.currentRoute.value.name) > -1 &&
            store.state.organizationData.rumToken.rum_token != ''
          "
          variant="primary"
          size="sm"
          data-test="ingestion-reset-token-btn"
          @click="showRUMUpdateDialogFn"
        >
          {{ t(`ingestion.resetRUMTokenLabel`) }}
        </OButton>
        <OButton
          v-else-if="
            rumRoutes.indexOf(router.currentRoute.value.name) > -1 &&
            store.state.organizationData.rumToken.rum_token == ''
          "
          variant="primary"
          size="sm"
          data-test="ingestion-reset-token-btn"
          @click="generateRUMToken"
        >
          {{ t(`ingestion.generateRUMTokenLabel`) }}
        </OButton>
      </template>
      <template #header-tabs>
        <!-- Pull the strip left (cancel the header's px-4) so the first tab lines
             up with the vertical sub-nav (Kubernetes/…) in the section below. -->
        <div class="-ml-3 w-full">
        <OTabs v-model="ingestTabType" align="left">
          <ORouteTab
            name="recommended"
            :to="{ name: 'recommended', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.recommendedLabel')"
          />
          <ORouteTab
            name="custom"
            :to="{ name: 'custom', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.customLabel')"
          />
          <ORouteTab
            name="server"
            :to="{ name: 'servers', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.serverLabel')"
          />
          <ORouteTab
            name="database"
            :to="{ name: 'databases', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.databaseLabel')"
          />
          <ORouteTab
            name="security"
            :to="{ name: 'security', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.securityLabel')"
          />
          <ORouteTab
            name="devops"
            :to="{ name: 'devops', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.devopsLabel')"
          />
          <ORouteTab
            name="networking"
            :to="{ name: 'networking', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.networkingLabel')"
          />
          <ORouteTab
            name="message-queues"
            :to="{ name: 'message-queues', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.messageQueuesLabel')"
          />
          <ORouteTab
            name="languages"
            :to="{ name: 'languages', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.languagesLabel')"
          />
          <ORouteTab
            name="ai-integrations"
            :to="{ name: 'ai-integrations', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.aiLabel')"
          />
          <ORouteTab
            name="others"
            :to="{ name: 'others', query: { org_identifier: store.state.selectedOrganization.identifier } }"
            :label="t('ingestion.otherLabel')"
          />
        </OTabs>
        </div>
      </template>
    <ConfirmDialog
      :title="t('ingestion.resetRUMTokenLabel')"
      :message="t('ingestion.updateRUMTokenMessage')"
      @update:ok="updateRUMToken"
      @update:cancel="confirmRUMUpdate = false"
      v-model="confirmRUMUpdate"
    />
    <!-- Empty-data warning banner -->
    <div
      v-if="
        store.state.zoConfig.hasOwnProperty('restricted_routes_on_empty_data') &&
        store.state.zoConfig.restricted_routes_on_empty_data == true &&
        store.state.organizationData.isDataIngested == false
      "
      class="text-subtitle bg-warning p-2 font-bold mx-2.5 mt-1 rounded-default"
    >
      {{ t("ingestion.redirectionIngestionMsg") }}
    </div>
    <div class="flex-1 min-h-0">
      <router-view
        :title="ingestTabType"
        :currOrgIdentifier="currentOrgIdentifier"
        :currUserEmail="currentUserEmail"
        @copy-to-clipboard-fn="copyToClipboardFn"
      >
      </router-view>
    </div>
  </OPageLayout>
</template>

<script lang="ts">
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
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
import { useRouter, useRoute } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import organizationsService from "@/services/organizations";
import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL } from "@/utils/zincutils";
import apiKeysService from "@/services/api_keys";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import { searchIngestionItems } from "@/utils/ingestionSearchIndex";
import { awsIntegrations } from "@/utils/awsIntegrations";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageIngestion",
  components: { OPageLayout, ConfirmDialog, OTabs, ORouteTab, OButton, OSearchInput,
    OSelect,
},
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    const route = useRoute();
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const confirmRUMUpdate = ref<boolean>(false);
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );
    const ingestTabType = ref("recommended");
    const globalSearchQuery = ref("");

    // Token selector — pick which ingestion token the curl examples use
    const selectedTokenName = ref("");
    const tokenOptions = computed(() => {
      const tokens = store.state.organizationData.orgTokens || [];
      const enabled = tokens.filter((t: any) => t.enabled);
      if (enabled.length === 0) {
        return [];
      }
      return enabled.map((t: any) => ({
        label: t.name,
        value: t.name,
      }));
    });
    watch(
      tokenOptions,
      (opts) => {
        if (opts.length > 0 && !opts.find((o: { value: string }) => o.value === selectedTokenName.value)) {
          selectedTokenName.value = opts[0].value;
          const tokens = store.state.organizationData.orgTokens || [];
          const token = tokens.find((t: any) => t.name === opts[0].value);
          if (token?.token) {
            store.dispatch("setOrganizationPasscode", token.token);
          }
        }
      },
      { immediate: true },
    );
    const onTokenSelected = (name: SelectModelValue) => {
      const tokens = store.state.organizationData.orgTokens || [];
      const token = tokens.find((t: any) => t.name === name);
      if (token?.token) {
        store.dispatch("setOrganizationPasscode", token.token);
      }
    };

    const activeTab = ref("recommended");
    const metricRoutes = [
      "prometheus",
      "vmagent",
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
        fetchOrgTokens();
        if (!store.state.organizationData.rumToken.rum_token) {
          getRUMToken();
        }
      }
    });

    // Sync ingestTabType from the current route so page refresh on a child
    // route (e.g. ai-agno) selects the correct parent tab (ai-integrations).
    // Some ORouteTab name props differ from their route names, so map them.
    const routeToTabName: Record<string, string> = {
      servers: "server",
      databases: "database",
    };
    const syncTabFromRoute = () => {
      const matched = route.matched;
      if (matched.length > 2) {
        const parentRoute = matched[2].name as string;
        const parentTab = routeToTabName[parentRoute] ?? parentRoute;
        if (parentTab && parentTab !== ingestTabType.value) {
          ingestTabType.value = parentTab;
        }
      }
    };

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
      syncTabFromRoute();
    });

    watch(() => route.name, syncTabFromRoute);

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
            toast({
              variant: "error",
              message: "Passcode not found.",
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
            toast({
              variant: "error",
              message: "Passcode not found.",
              timeout: 5000,
            });
          } else {
            toast({
              variant: "success",
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
            toast({
              variant: "error",
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
      copyToClipboard(content.innerText, {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      }).then((success: boolean) => {
        if (success) {
          segment.track("Button Click", {
            button: "Copy to Clipboard",
            ingestion: router.currentRoute.value.name,
            user_org: store.state.selectedOrganization.identifier,
            user_id: store.state.userInfo.email,
            page: "Ingestion",
          });
        }
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
          toast({
            variant: "success",
            message: "RUM Token generated successfully.",
            timeout: 5000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
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
        .then(() => {
          getRUMToken();
          toast({
            variant: "success",
            message: "RUM Token updated successfully.",
            timeout: 5000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
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

    return {
      t,
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

