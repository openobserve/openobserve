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
  <div class="tw:rounded-md tw:h-full">
    <!-- <div class="head q-table__title tw:mx-2 tw:mb-2 tw:px-2 q-py-sm o2-management-header">
      {{ t("settings.header") }}
    </div> -->
      <q-splitter
      class="logs-splitter-smooth tw:overflow-hidden"
      v-model="splitterModel"
      :limits="[0, 400]"
      unit="px"
    >
      <template v-slot:before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem] q-pt-xs tw:overflow-hidden">
          <div class="card-container tw:mb-[0.625rem]" style="height: calc(100vh - var(--navbar-height) - 15px)">
            <div class="flex tw:h-[calc(100vh-50px)]">
              <div class="full-width" v-if="showManagementTabs">
                <OTabs
                  class="management-tabs"
                  v-model="settingsTab"
                  orientation="vertical"
                >
                <ORouteTab
                  name="queryManagement"
                  :to="`/settings/query_management?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  icon="query_stats"
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
                  name="general"
                  :to="`/settings/general?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  icon="settings"
                  :label="t('settings.generalLabel')"
                >
                </ORouteTab>
                <ORouteTab
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
                  icon="domain"
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
                  icon="location_on"
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
                   icon="person_pin_circle"
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
                  icon="smart_toy"
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
                    icon="card_membership"
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
                >
                <div class="tw:flex tw:items-center tw:w-full">
                  <img :src="regexIcon" alt="regex" style="width: 24px; height: 24px;" />
                  <span class="tw:text-sm tw:font-medium tw:ml-2"
                  :class="store.state.theme === 'dark' && router.currentRoute.value.name !== 'regexPatterns'   ? 'tw:text-white' : 'tw:text-black'"
                  >{{ t('regex_patterns.title') }}</span>
                </div>
              </ORouteTab>
                <ORouteTab
                  v-if="config.isEnterprise == 'true' && store.state.zoConfig.service_streams_enabled !== false"
                  data-test="correlation-settings-tab"
                  name="correlation_settings"
                  :to="{
                    name: 'correlationSettings',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  icon="group_work"
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
              <q-icon :name="showManagementTabs ? 'chevron_left' : 'chevron_right'" />
            </template>
          </OButton>
      </template>

      <template v-slot:after>
        <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem] q-pt-xs">
            <div
              class="card-container tw:h-[calc(100vh-var(--navbar-height)-15px)] tw:overflow-auto"
            >
             <router-view title=""> </router-view>
          </div>
          </div>
      </template>
    </q-splitter>

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
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { getImageURL } from "@/utils/zincutils";
import { outlinedSettings } from "@quasar/extras/material-icons-outlined";
export default defineComponent({
  name: "AppSettings",
  components: {
    OTabs,
    ORouteTab,
    OButton,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const routeToSettingsTab: Record<string, string> = {
      general:               "general",
      organization:          "organization",
      nodes:                 "nodes",
      queryManagement:       "queryManagement",
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
        if(!isMetaOrg.value || config.isEnterprise === "false") {
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
        if(!isMetaOrg.value || config.isEnterprise === "false") {
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
      return getImageURL(store.state.theme === 'dark' && router.currentRoute.value.name !== 'regexPatterns' ? 'images/regex_pattern/regex_icon_dark.svg' : 'images/regex_pattern/regex_icon_light.svg')
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
      outlinedSettings,
    };
  },
});
</script>
<style lang="scss">
</style>
