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
      <div class="w-50 flex-none max-md:w-auto max-md:min-w-36 max-md:flex-1">
        <OSearchInput
          v-model="globalSearchQuery"
          :placeholder="t('common.search')"
          clearable
          class="indexlist-search-input w-full"
          data-test="recommended-list-search-input"
        />
      </div>
      <OSelect
        v-if="!isMobile && !isRUMPage && tokenOptions.length > 0"
        v-model="selectedTokenName"
        :options="tokenOptions"
        label-key="label"
        value-key="value"
        class="max-w-xs max-md:order-last max-md:max-w-full max-md:min-w-0! max-md:basis-full"
        style="min-width: 13.75rem"
        @update:model-value="onTokenSelected"
      />
      <OButton
        v-if="!isRUMPage"
        variant="primary"
        size="sm"
        icon-left="key"
        :title="isMobile ? t('ingestion.manageTokensBtnLabel') : undefined"
        @click="navigateToIngestionTokens"
      >
        <span class="max-md:hidden">{{ t("ingestion.manageTokensBtnLabel") }}</span>
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
      <div class="-ms-3 w-full">
        <div v-if="isMobile && !isRUMPage && tokenOptions.length > 0" class="ms-3 pb-2">
          <OSelect
            v-model="selectedTokenName"
            :options="tokenOptions"
            label-key="label"
            value-key="value"
            @update:model-value="onTokenSelected"
          />
        </div>
        <OTabs v-model="ingestTabType" align="left">
          <ORouteTab
            name="recommended"
            :to="{
              name: 'recommended',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.recommendedLabel')"
          />
          <ORouteTab
            name="custom"
            :to="{
              name: 'custom',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.customLabel')"
          />
          <ORouteTab
            name="server"
            :to="{
              name: 'servers',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.serverLabel')"
          />
          <ORouteTab
            name="database"
            :to="{
              name: 'databases',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.databaseLabel')"
          />
          <ORouteTab
            name="security"
            :to="{
              name: 'security',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.securityLabel')"
          />
          <ORouteTab
            name="devops"
            :to="{
              name: 'devops',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.devopsLabel')"
          />
          <ORouteTab
            name="networking"
            :to="{
              name: 'networking',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.networkingLabel')"
          />
          <ORouteTab
            name="message-queues"
            :to="{
              name: 'message-queues',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.messageQueuesLabel')"
          />
          <ORouteTab
            name="languages"
            :to="{
              name: 'languages',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.languagesLabel')"
          />
          <ORouteTab
            name="ai-integrations"
            :to="{
              name: 'ai-integrations',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
            :label="t('ingestion.aiLabel')"
          />
          <ORouteTab
            name="others"
            :to="{
              name: 'others',
              query: { org_identifier: store.state.selectedOrganization.identifier },
            }"
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
    <OBanner
      v-if="
        store.state.zoConfig.hasOwnProperty('restricted_routes_on_empty_data') &&
        store.state.zoConfig.restricted_routes_on_empty_data == true &&
        store.state.organizationData.isDataIngested == false
      "
      variant="promo"
      dense
      class="mx-2.5 mt-1 font-bold"
      :content="t('ingestion.redirectionIngestionMsg')"
    />

    <div class="min-h-0 flex-1">
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
import { resetPasscodeMutation } from "@/services/organizations.queries";
import { createRumTokenMutation, updateRumTokenMutation } from "@/services/api_keys.queries";
import { useOrgId } from "@/composables/query/useOrgId";
import { useMutation } from "@tanstack/vue-query";
import { ingestionTokensQuery } from "@/services/organizations.queries";
import { orgPasscodeQuery } from "@/services/organizations.queries";
import { queryClient } from "@/composables/query/queryClient";
import { rumTokensQuery } from "@/services/api_keys.queries";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onMounted, onUpdated, watch, computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL } from "@/utils/zincutils";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import { searchIngestionItems } from "@/utils/ingestionSearchIndex";
import { awsIntegrations } from "@/utils/awsIntegrations";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageIngestion",
  components: {
    OPageLayout,
    ConfirmDialog,
    OTabs,
    ORouteTab,
    OButton,
    OSearchInput,
    OSelect,
    OBanner,
  },
  setup() {
    const { isMobile } = useBreakpoint();
    const { t } = useI18nTyped();
    const store = useStore();
    const router: any = useRouter();
    const route = useRoute();
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const confirmRUMUpdate = ref<boolean>(false);
    const currentOrgIdentifier: any = ref(store.state.selectedOrganization.identifier);
    const ingestTabType = ref("recommended");
    const globalSearchQuery = ref("");

    // Authoritative record of what GET /{org}/passcode answered for the org
    // currently in `currentOrgIdentifier`. Only that endpoint can write it:
    //
    //   - `true`  — a 403 was observed. The org ingestion token is not this
    //               role's to see, and nothing else on this page may contradict
    //               that. GET /{org}/ingestion-tokens is NOT a second opinion:
    //               both endpoints now share one server-side guard, so a token
    //               arriving from the selector cannot mean the passcode 403 was
    //               wrong — it can only mean that response was already in
    //               flight, or is stale.
    //   - `false` — a read or rotate succeeded, so the credential is this
    //               role's to see.
    //   - `null`  — not yet known (initial load, or the org just changed).
    //
    // Latching on the passcode answer is what makes the banner independent of
    // which request happens to resolve last: previously whichever of the two
    // concurrent onBeforeMount calls landed second won, so on enterprise the
    // tokens response routinely cleared a 403 that had already been observed.
    const passcodeReadForbidden = ref<boolean | null>(null);

    // True while the active passcode is one the token SELECTOR published (from
    // the /ingestion-tokens response) rather than one the passcode endpoint
    // returned. Tracked so a 403 that lands afterwards can withdraw
    // exactly that value and nothing else — a passcode obtained from a
    // successful read or rotate is never touched.
    const passcodeCameFromTokenSelector = ref(false);

    // Publish a token chosen in the selector as the active passcode. Refuses
    // once a 403 is latched: a 403 means the credential was never this role's
    // to see, so neither the watcher nor an explicit dropdown pick may reveal
    // it. Returns whether it published, so callers can keep their own state
    // consistent.
    const publishSelectedToken = (token: string) => {
      if (passcodeReadForbidden.value === true) return false;
      passcodeCameFromTokenSelector.value = true;
      store.dispatch("setOrganizationPasscodeForbidden", false);
      store.dispatch("setOrganizationPasscode", token);
      return true;
    };

    // Mirror the latch into the store, which is what the setup cards read.
    // Callers that merely *have* a token to show go through
    // `publishSelectedToken` instead of dispatching the flag themselves.
    const applyPasscodeForbidden = (forbidden: boolean) => {
      passcodeReadForbidden.value = forbidden;
      store.dispatch("setOrganizationPasscodeForbidden", forbidden);
      if (forbidden) {
        // The selector may already have published a token: /ingestion-tokens is
        // a separate request and can resolve before this 403 does. Withdraw it:
        // the banner must not sit above a working org-wide credential that this
        // role was just refused.
        if (passcodeCameFromTokenSelector.value) {
          store.dispatch("setOrganizationPasscode", "");
        }
      }
      passcodeCameFromTokenSelector.value = false;
    };

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
        if (
          opts.length > 0 &&
          !opts.find((o: { value: string }) => o.value === selectedTokenName.value)
        ) {
          selectedTokenName.value = opts[0].value;
          const tokens = store.state.organizationData.orgTokens || [];
          const token = tokens.find((t: any) => t.name === opts[0].value);
          // Keep the selector's own state in sync regardless, but only publish
          // the token (and clear the banner) when no 403 has been latched.
          if (token?.token) {
            publishSelectedToken(token.token);
          }
        }
      },
      { immediate: true },
    );
    const onTokenSelected = (name: SelectModelValue) => {
      const tokens = store.state.organizationData.orgTokens || [];
      const token = tokens.find((t: any) => t.name === name);
      // User-initiated rather than a race, but the rule is the same: a 403 says
      // the credential was never this role's to see, so choosing an entry from
      // the dropdown must not reveal it either.
      if (token?.token) {
        publishSelectedToken(token.token);
      }
    };

    const activeTab = ref("recommended");
    const metricRoutes = [
      "prometheus",
      "vmagent",
      "nightingale",
      "categraf",
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

    const isRUMPage = computed(() => rumRoutes.indexOf(router.currentRoute.value.name) > -1);

    onBeforeMount(() => {
      if (store.state.selectedOrganization.identifier != undefined) {
        fetchOrgTokens();
        // The passcode read is what actually establishes whether this role may
        // see an ingestion credential. GET /{org}/passcode is guarded
        // unconditionally for non-Admin/Root, whereas GET /{org}/ingestion-tokens
        // is guarded only on non-enterprise builds (and on enterprise the
        // browser session path bypasses the RBAC middleware entirely), so a
        // tokens 403 is NOT observable in the configuration that matters most.
        // Keying the banner off this call keeps it correct in both builds.
        getOrganizationPasscode();
        getRUMToken();
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

    // Switching orgs makes the latch stale: whether the new org's ingestion
    // token is readable is a fresh question, and MainLayout has already wiped
    // organizationData (which resets the store flag). Drop back to "unknown" so
    // the new org's passcode read — not the previous org's 403 — decides.
    watch(
      () => store.state.selectedOrganization.identifier,
      (identifier, previous) => {
        if (identifier === previous) return;
        passcodeReadForbidden.value = null;
        passcodeCameFromTokenSelector.value = false;
      },
    );

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
      // Returned so callers can await the load — it never was, which only
      // worked while the fetch resolved in a single microtask.
      return queryClient
        .fetchQuery(orgPasscodeQuery(store.state.selectedOrganization.identifier))
        .then((res: any) => {
          if (res.data.passcode == "") {
            toast({
              variant: "error",
              message: t("toastMessages.views.passcodeNotFound"),
              timeout: 5000,
            });
          } else {
            applyPasscodeForbidden(false);
            store.dispatch("setOrganizationPasscode", res.data.passcode);
            store.dispatch("setOrganizationPasscodeUser", res.data.user);
            currentOrgIdentifier.value = store.state.selectedOrganization.identifier;
          }
        })
        .catch((e: any) => {
          // 403 is not a failure to hide: the caller is below Admin/Root, so the
          // org ingestion token is simply not theirs to read. Record that
          // explicitly — an empty passcode would otherwise be substituted into
          // the setup snippets, producing a valid-looking but non-functional
          // credential. Every other error stays silent as before (the passcode
          // is not critical for page render).
          if (e?.response?.status === 403) {
            applyPasscodeForbidden(true);
          }
        });
    };

    // A read failure stays silent: the card falls back to its Generate action.
    const getRUMToken = () => {
      return queryClient
        .fetchQuery(rumTokensQuery(store.state.selectedOrganization.identifier))
        .then((res: any) => {
          store.dispatch("setRUMToken", res.data);
        })
        .catch(() => {});
    };

    const updatePasscode = () => {
      const request = resetPasscode
        .mutateAsync()
        .then((res: any) => {
          if (res.data.data.passcode == "") {
            toast({
              variant: "error",
              message: t("toastMessages.views.passcodeNotFound"),
              timeout: 5000,
            });
          } else {
            toast({
              variant: "success",
              message: t("toastMessages.views.tokenResetSuccessfully"),
              timeout: 5000,
            });
            applyPasscodeForbidden(false);
            store.dispatch("setOrganizationPasscode", res.data.data.passcode);
            store.dispatch("setOrganizationPasscodeUser", res.data.data.user);
            currentOrgIdentifier.value = store.state.selectedOrganization.identifier;
          }
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
              message: t("toastMessages.views.errorWhileUpdatingToken", { error: e.error }),
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

      // Returned so callers (and tests) can await the whole flow.
      return request;
    };

    const showResetDefaultDialogFn = () => {
      confirmUpdate.value = true;
    };

    const showRUMUpdateDialogFn = () => {
      confirmRUMUpdate.value = true;
    };

    const fetchOrgTokens = () => {
      return queryClient
        .fetchQuery(ingestionTokensQuery(store.state.selectedOrganization.identifier))
        .then((res: any) => {
          store.dispatch("setOrgTokens", res.data);
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
      copyToClipboard(content.innerText, t, {
        successMessage: t("common.contentCopiedSuccessfully"),
        errorMessage: t("ingestion.copyContentError"),
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

    const orgIdForWrites = useOrgId();
    const createRumToken = useMutation(() => createRumTokenMutation(orgIdForWrites.value));
    // `getRUMToken` below is a bare fetchQuery, so only the mutation's invalidation stops it re-serving the old token.
    const updateRumToken = useMutation(() => updateRumTokenMutation(orgIdForWrites.value));
    const resetPasscode = useMutation(() => resetPasscodeMutation(orgIdForWrites.value));

    const generateRUMToken = () => {
      // Held rather than returned inline: the `segment.track` call below must
      // still run synchronously, exactly as it did before.
      const request = createRumToken
        .mutateAsync()
        .then((res: any) => {
          store.dispatch("setRUMToken", {
            rum_token: res.data.data.new_key,
          });
          getRUMToken();
          toast({
            variant: "success",
            message: t("toastMessages.views.rumTokenGeneratedSuccessfully"),
            timeout: 5000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
              message: e.response?.data?.message || t("ingestion.errorWhileGeneratingRumToken"),
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

      // Returned so callers (and tests) can await the whole flow: `mutateAsync`
      // settles a tick later than a bare service promise did.
      return request;
    };

    // Returned so the dialog handler (and the spec) can await the write.
    const updateRUMToken = () => {
      const done = updateRumToken
        .mutateAsync(store.state.organizationData.rumToken.id)
        .then(async () => {
          toast({
            variant: "success",
            message: t("toastMessages.views.rumTokenUpdatedSuccessfully"),
            timeout: 5000,
          });
          getRUMToken();
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
              message: e.response?.data?.message || t("ingestion.errorWhileRefreshingRumToken"),
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

      return done;
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
      isMobile,
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
