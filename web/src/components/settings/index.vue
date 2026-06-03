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
  <div class="tw:rounded-md tw:h-[calc(100vh-var(--navbar-height))] tw:overflow-hidden">
    <!-- <div class="head tw:text-xl tw:tracking-[0.005em] tw:mx-2 tw:mb-2 tw:px-2 tw:py-2 o2-management-header">
      {{ t("settings.header") }}
    </div> -->
      <OSplitter
      class="logs-splitter-smooth tw:overflow-hidden"
      :model-value="splitterModel"
      @update:model-value="(v: number) => splitterModel = v"
      :limits="[0, 400]"
      unit="px"
    >
      <template #before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem] tw:pt-1 tw:overflow-hidden">
          <div class="card-container tw:mb-[0.625rem]" style="height: calc(100vh - var(--navbar-height) - 15px)">
            <div class="tw:flex tw:h-[calc(100vh-50px)]">
              <div class="tw:w-full" v-if="showManagementTabs">
                <OTabs
                  class="management-tabs"
                  v-model="settingsTab"
                  orientation="vertical"
                >
                <ORouteTab
                  name="queryManagement"
                  :to="`/settings/query_management?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  icon="query-stats"
                  :label="t('settings.queryManagement')"
                  v-if="config.isEnterprise == 'true' && isMetaOrg"
                />
                <ORouteTab
                  v-if="config.isEnterprise == 'true' && isMetaOrg"
                  data-test="nodes-tab"
                  name="nodes"
                  :to="{
                    name: 'nodes',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="hub"
                  :label="t('settings.nodes')"
                />
                <ORouteTab
                  data-test="general-settings-tab"
                  name="general"
                  :to="`/settings/general?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  icon="settings"
                  :label="t('settings.generalLabel')"
                >
                </ORouteTab>
                <ORouteTab
                  data-test="organization-settings-tab"
                  name="organization"
                  :to="`/settings/organization?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  icon="business"
                  :label="t('settings.orgLabel')"
                >
                </ORouteTab>
                <ORouteTab
                  v-if="config.isEnterprise == 'true' && isMetaOrg"
                  data-test="domain-management-tab"
                  name="domain_management"
                  :to="{
                    name: 'domainManagement',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="dns"
                  :label="t('settings.ssoDomainRestrictions')"
                />
                <ORouteTab
                  data-test="alert-destinations-tab"
                  name="alert_destinations"
                  :to="{
                    name: 'alertDestinations',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="location-on"
                  :label="t('alert_destinations.header')"
                >
                </ORouteTab>
                <ORouteTab
                  v-if="config.isEnterprise == 'true'"
                  data-test="pipeline-destinations-tab"
                  name="pipeline_destinations"
                  :to="{
                    name: 'pipelineDestinations',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                   icon="person-pin-circle"
                   :label="t('pipeline_destinations.header')"
                >
                </ORouteTab>
                <ORouteTab
                  v-if="config.isEnterprise == 'true' && (config.isCloud != 'true' || store.state.organizationData.organizationSettings.org_storage_enabled === true)"
                  data-test="storage-settings-tab"
                  name="storageSettings"
                  :to="{
                    name: 'storageSettings',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                  icon="cloud"
                  :label="t('storage_settings.tabLabel')"
                >
                </ORouteTab>
                <ORouteTab
                  data-test="alert-templates-tab"
                  name="templates"
                  :to="{
                    name: 'alertTemplates',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="description"
                  :label="t('alert_templates.header')"
                >
                </ORouteTab>
                <ORouteTab
                  v-if="store.state.zoConfig.model_pricing_enabled"
                  data-test="model-pricing-tab"
                  name="model_pricing"
                  :to="{
                    name: 'modelPricing',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                  icon="paid"
                  :label="t('settings.llmModelPricing')"
                >
                </ORouteTab>
                <ORouteTab
                  v-if="config.isEnterprise == 'true'"
                  data-test="management-cipher-key-tab"
                  name="cipher-keys"
                  :to="{
                    name: 'cipherKeys',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="key"
                  :label="t('settings.cipherKeys')"
                >
                </ORouteTab>
                <!-- <ORouteTab
                  v-if="config.isEnterprise == 'true'"
                  data-test="ai-toolsets-tab"
                  name="ai_toolsets"
                  :to="{
                    name: 'aiToolsets',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="smart-toy"
                  :label="t('settings.aiToolsets')"
                >
                </ORouteTab> -->
                <ORouteTab
                    v-if="config.isEnterprise == 'true' && isMetaOrg"
                    data-test="license-tab"
                    name="license"
                    :to="{
                      name: 'license',
                      query: {
                        org_identifier: store.state.selectedOrganization?.identifier,
                      },
                    }"
                    icon="card-membership"
                    :label="t('settings.license')"
                  />
                <ORouteTab
                  v-if="config.isCloud == 'true' && isMetaOrg"
                  data-test="organization-management-tab"
                  name="organization_management"
                  :to="{
                    name: 'orgnizationManagement',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="lan"
                  :label="t('settings.organizationManagement')"
                />
                <ORouteTab
                  v-if="config.isEnterprise == 'true'"
                  data-test="regex-patterns-tab"
                  name="regex_patterns"
                  :to="{
                    name: 'regexPatterns',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  :icon="`img:${regexIcon}`"
                  :label="t('regex_patterns.title')"
                />
                <ORouteTab
                  v-if="config.isEnterprise == 'true'"
                  data-test="correlation-settings-tab"
                  name="correlation_settings"
                  :to="{
                    name: 'correlationSettings',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="group-work"
                  :label="t('settings.correlationSettings')"
                />
                </OTabs>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #separator>
          <OButton
            data-test="logs-search-field-list-collapse-btn-management"
            variant="sidebar-button"
            size="sidebar-button"
            :title="showManagementTabs ? 'Collapse Fields' : 'Open Fields'"
            :class="showManagementTabs ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
            @click="controlManagementTabs"
          >
            <template #icon-left>
              <OIcon :name="showManagementTabs ? 'chevron-left' : 'chevron-right'" size="sm" />
            </template>
          </OButton>
      </template>

      <template #after>
        <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pl-1 tw:pb-[0.625rem] tw:pt-1">
            <div
              class="card-container tw:h-[calc(100vh-var(--navbar-height)-15px)] tw:overflow-auto"
            >
             <router-view title=""> </router-view>
          </div>
          </div>
      </template>
    </OSplitter>

  </div>
</template>

<script lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OButton from '@/lib/core/Button/OButton.vue'
// @ts-ignore
import {
  defineComponent,
  ref,
  onBeforeMount,
  onActivated,
  onUpdated,
  watch,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { getImageURL } from "@/utils/zincutils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
export default defineComponent({
  name: "AppSettings",
  components: {
    OTabs,
    ORouteTab,
    OButton,
    OIcon,
    OSplitter,
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
    const splitterModel = ref(250);
    const storePreviousStoreModel  = ref(250);

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
    const showManagementTabs = ref(true);
    const controlManagementTabs = () => {
      if(showManagementTabs.value){
        const prevVal = splitterModel.value;
        storePreviousStoreModel.value = prevVal;
        splitterModel.value = 0;
        showManagementTabs.value = false;
      }
      else{
        splitterModel.value = storePreviousStoreModel.value || 250;
        
        showManagementTabs.value = true;
      }
    }
    const regexIcon = computed(()=>{
      return getImageURL(store.state.theme === 'dark' ? 'images/regex_pattern/regex_icon_dark.svg' : 'images/regex_pattern/regex_icon_light.svg')
    })

    return {
      t,
      store,
      router,
      config,
      settingsTab,
      splitterModel,
      isMetaOrg,
      showManagementTabs,
      controlManagementTabs,
      regexIcon,
      // Expose methods for testing
      handleSettingsRouting,
      storePreviousStoreModel,
      "settings": "settings",
    };
  },
});
</script>
<style lang="scss">
</style>
