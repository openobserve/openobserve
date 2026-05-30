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
  <PageLayout resizable :sidebar-width="220" :splitter-limits="[0, 320]">
    <template #header>
      <AppPageHeader icon="settings" :title="t('settings.header')" />
    </template>

    <template #sidebar>
      <SecondaryNav v-model="settingsTab" :items="settingsItems" />
    </template>

    <router-view title="" />
  </PageLayout>
</template>

<script lang="ts">
import PageLayout from '@/components/common/PageLayout.vue'
import AppPageHeader from '@/components/common/AppPageHeader.vue'
import SecondaryNav, {
  type SecondaryNavItem,
} from '@/components/common/SecondaryNav.vue'
// @ts-ignore
import {
  defineComponent,
  ref,
  onBeforeMount,
  onActivated,
  onUpdated,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { getImageURL } from "@/utils/zincutils";
export default defineComponent({
  name: "AppSettings",
  components: {
    PageLayout,
    AppPageHeader,
    SecondaryNav,
},
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    const routeToSettingsTab: Record<string, string> = {
      general:               "general",
      organization:          "organization",
      organizationSettings:  "organization",
      nodes:                 "nodes",
      queryManagement:       "queryManagement",
      query_management:      "queryManagement",
      domainManagement:      "domain_management",
      alertDestinations:     "alert_destinations",
      pipelineDestinations:  "pipeline_destinations",
      alertTemplates:        "templates",
      modelPricing:          "model_pricing",
      cipherKeys:            "cipher-keys",
      license:               "license",
      orgnizationManagement: "organization_management",
      regexPatterns:         "regex_patterns",
      correlationSettings:   "correlation_settings",
    };
    const settingsTab = ref(
      routeToSettingsTab[router.currentRoute.value.name as string] ?? "general"
    );
    const { isMetaOrg } = useIsMetaOrg();

    const handleSettingsRouting = () => {
      if (router.currentRoute.value.name === "settings") {
        if (isMetaOrg.value && config.isEnterprise === "true") {
          settingsTab.value = "queryManagement";
          router.push({
            path: "/settings/query_management",
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          });
        } 
        else {
          settingsTab.value = "general";
          router.push({
            path: "/settings/general",
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          });
        }
      }
      else if (router.currentRoute.value.name === "nodes") {
        if(store.state.zoConfig.meta_org && (!isMetaOrg.value || config.isEnterprise === "false")) {
          settingsTab.value = "general";
          router.push({
            path: "/settings/general",
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          });
        }

      }
      else if (router.currentRoute.value.name === "license") {
        if(store.state.zoConfig.meta_org && (!isMetaOrg.value || config.isEnterprise === "false")) {
          settingsTab.value = "general";
          router.push({
            path: "/settings/general",
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          });
        }

      }

    };

    onBeforeMount(() => {
      handleSettingsRouting();
    });

    onActivated(() => {
      handleSettingsRouting();
    });

    onUpdated(() => {
      handleSettingsRouting();
    });
    const regexIcon = computed(()=>{
      return getImageURL(store.state.theme === 'dark' ? 'images/regex_pattern/regex_icon_dark.svg' : 'images/regex_pattern/regex_icon_light.svg')
    })

    // Data-driven L2 vertical-rail sections (SecondaryNav). Feature-flag
    // visibility lives here declaratively instead of 15 per-tab v-ifs.
    const settingsItems = computed<SecondaryNavItem[]>(() => {
      const org = store.state.selectedOrganization?.identifier;
      const isEnt = config.isEnterprise == "true";
      const isCloud = config.isCloud == "true";
      const meta = isMetaOrg.value;
      const z = store.state.zoConfig;
      return [
        {
          key: "queryManagement",
          label: t("settings.queryManagement"),
          icon: "query-stats",
          to: `/settings/query_management?org_identifier=${org}`,
          visible: isEnt && meta,
          dataTest: "query-management-tab",
        },
        {
          key: "nodes",
          label: t("settings.nodes"),
          icon: "hub",
          to: { name: "nodes", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "nodes-tab",
        },
        {
          key: "general",
          label: t("settings.generalLabel"),
          icon: "settings",
          to: `/settings/general?org_identifier=${org}`,
          dataTest: "general-settings-tab",
        },
        {
          key: "organization",
          label: t("settings.orgLabel"),
          icon: "business",
          to: `/settings/organization?org_identifier=${org}`,
          dataTest: "organization-settings-tab",
        },
        {
          key: "domain_management",
          label: t("settings.ssoDomainRestrictions"),
          icon: "dns",
          to: { name: "domainManagement", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "domain-management-tab",
        },
        {
          key: "alert_destinations",
          label: t("alert_destinations.header"),
          icon: "location-on",
          to: { name: "alertDestinations", query: { org_identifier: org } },
          dataTest: "alert-destinations-tab",
        },
        {
          key: "pipeline_destinations",
          label: t("pipeline_destinations.header"),
          icon: "person-pin-circle",
          to: { name: "pipelineDestinations", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "pipeline-destinations-tab",
        },
        {
          key: "storageSettings",
          label: t("storage_settings.tabLabel"),
          icon: "cloud",
          to: { name: "storageSettings", query: { org_identifier: org } },
          visible:
            isEnt &&
            (!isCloud ||
              store.state.organizationData.organizationSettings
                .org_storage_enabled === true),
          dataTest: "storage-settings-tab",
        },
        {
          key: "templates",
          label: t("alert_templates.header"),
          icon: "description",
          to: { name: "alertTemplates", query: { org_identifier: org } },
          dataTest: "alert-templates-tab",
        },
        {
          key: "model_pricing",
          label: t("settings.llmModelPricing"),
          icon: "paid",
          to: { name: "modelPricing", query: { org_identifier: org } },
          visible: !!z.model_pricing_enabled,
          dataTest: "model-pricing-tab",
        },
        {
          key: "cipher-keys",
          label: t("settings.cipherKeys"),
          icon: "key",
          to: { name: "cipherKeys", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "management-cipher-key-tab",
        },
        {
          key: "license",
          label: t("settings.license"),
          icon: "card-membership",
          to: { name: "license", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "license-tab",
        },
        {
          key: "organization_management",
          label: t("settings.organizationManagement"),
          icon: "lan",
          to: { name: "orgnizationManagement", query: { org_identifier: org } },
          visible: isCloud && meta,
          dataTest: "organization-management-tab",
        },
        {
          key: "regex_patterns",
          label: t("regex_patterns.title"),
          icon: `img:${regexIcon.value}`,
          to: { name: "regexPatterns", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "regex-patterns-tab",
        },
        {
          key: "correlation_settings",
          label: t("settings.correlationSettings"),
          icon: "group-work",
          to: { name: "correlationSettings", query: { org_identifier: org } },
          visible: isEnt && z.service_streams_enabled !== false,
          dataTest: "correlation-settings-tab",
        },
      ];
    });

    return {
      settingsItems,
      t,
      store,
      router,
      config,
      settingsTab,
      isMetaOrg,
      regexIcon,
      handleSettingsRouting,
    };
  },
});
</script>
