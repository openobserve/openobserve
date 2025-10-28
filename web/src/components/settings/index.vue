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
  <q-page class="">
    <!-- <div class="head q-table__title tw-mx-2 tw-mb-2 tw-px-2 q-py-sm o2-management-header">
      {{ t("settings.header") }}
    </div> -->
      <q-splitter
      class="logs-splitter-smooth tw-overflow-hidden"
      v-model="splitterModel"
      :limits="[0, 400]"
      unit="px"
    >
      <template v-slot:before>
        <div class="tw-w-full tw-h-full tw-pl-[0.625rem] tw-pb-[0.625rem]">
          <div class="card-container tw-mb-[0.625rem]">
            <div class="flex tw-h-[calc(100vh-50px)]">
              <div v-if="showManagementTabs">
                <q-tabs
                  class="management-tabs"
                  v-model="settingsTab"
                  indicator-color="transparent"
                  inline-label
                  vertical
                >
                <q-route-tab
                  default
                  name="queryManagement"
                  :to="`/settings/query_management?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  icon="query_stats"
                  :label="t('settings.queryManagement')"
                  content-class="tab_content"
                  v-if="isMetaOrg"
                />
                <q-route-tab
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
                  content-class="tab_content"
                />
                <q-route-tab
                  name="general"
                  :to="`/settings/general?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  content-class="tab_content"
                >
                  <template v-slot:default>
                    <div class="tw-flex tw-items-center tw-w-full">
                      <Bolt :size="24" class="o2-tab-icon" />
                      <span class="q-tab__label">{{ t('settings.generalLabel') }}</span>
                    </div>
                  </template>
                </q-route-tab>
                <q-route-tab
                  name="organization"
                  :to="`/settings/organization?org_identifier=${store.state.selectedOrganization?.identifier}`"
                  content-class="tab_content"
                >
                  <template v-slot:default>
                    <div class="tw-flex tw-items-center tw-w-full">
                      <Building :size="24" class="o2-tab-icon" />
                      <span class="q-tab__label">{{ t('settings.orgLabel') }}</span>
                    </div>
                  </template>
                </q-route-tab>
                <q-route-tab
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
                  content-class="tab_content"
                />
                <q-route-tab
                  data-test="alert-destinations-tab"
                  name="alert_destinations"
                  :to="{
                    name: 'alertDestinations',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                >
                  <template v-slot:default>
                    <div class="tw-flex tw-items-center tw-w-full">
                      <MapPin :size="24" class="o2-tab-icon" />
                      <span class="q-tab__label">{{ t('alert_destinations.header') }}</span>
                    </div>
                  </template>
                </q-route-tab>
                <q-route-tab
                  v-if="config.isEnterprise == 'true'"
                  data-test="pipeline-destinations-tab"
                  name="pipeline_destinations"
                  :to="{
                    name: 'pipelineDestinations',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                >
                  <template v-slot:default>
                    <div class="tw-flex tw-items-center tw-w-full">
                      <MapPinned :size="24" class="o2-tab-icon" />
                      <span class="q-tab__label">{{ t('pipeline_destinations.header') }}</span>
                    </div>
                  </template>
                </q-route-tab>
                <q-route-tab
                  data-test="alert-templates-tab"
                  name="templates"
                  :to="{
                    name: 'alertTemplates',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                >
                  <template v-slot:default>
                    <div class="tw-flex tw-items-center tw-w-full">
                      <FileText :size="24" class="o2-tab-icon" />
                      <span class="q-tab__label">{{ t('alert_templates.header') }}</span>
                    </div>
                  </template>
                </q-route-tab>
                <q-route-tab
                  v-if="config.isEnterprise == 'true'"
                  data-test="management-cipher-key-tab"
                  name="cipher-keys"
                  :to="{
                    name: 'cipherKeys',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                >
                  <template v-slot:default>
                    <div class="tw-flex tw-items-center tw-w-full">
                      <KeyRound :size="24" class="o2-tab-icon" />
                      <span class="q-tab__label">{{ t('settings.cipherKeys') }}</span>
                    </div>
                  </template>
                </q-route-tab>
                <q-route-tab
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
                  content-class="tab_content"
                />
                <q-route-tab
                  v-if="config.isEnterprise == 'true'"
                  data-test="regex-patterns-tab"
                  name="regex_patterns"
                  :to="{
                    name: 'regexPatterns',
                    query: {
                      org_identifier: store.state.selectedOrganization?.identifier,
                    },
                  }"
                  content-class="tab_content"
                >
                <div class="tw-flex tw-items-center tw-w-full">
                  <img :src="regexIcon" alt="regex" style="width: 24px; height: 24px;" />
                  <span class="tw-text-sm tw-font-medium tw-ml-2"
                  :class="store.state.theme === 'dark' && router.currentRoute.value.name !== 'regexPatterns'   ? 'tw-text-white' : 'tw-text-black'"
                  >{{ t('regex_patterns.title') }}</span>
                </div>
              </q-route-tab>
                </q-tabs>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #separator>
          <q-btn
            data-test="logs-search-field-list-collapse-btn-management"
            :icon="showManagementTabs ? 'chevron_left' : 'chevron_right'"
            :title="showManagementTabs ? 'Collapse Fields' : 'Open Fields'"
            :class="showManagementTabs ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
            color="primary"
            size="sm"
            dense
            round
            @click="controlManagementTabs"
          />
      </template>

      <template v-slot:after>
        <div class="tw-w-full tw-h-full tw-pr-[0.625rem] tw-pb-[0.625rem]">
            <div
              class="card-container tw-h-[calc(100vh-50px)]"
            >
             <router-view title=""> </router-view>
          </div>
          </div>
      </template>
    </q-splitter>

  </q-page>
</template>

<script lang="ts">
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
import { Bolt, Building, MapPin, MapPinned, FileText, KeyRound } from "lucide-vue-next";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { getImageURL } from "@/utils/zincutils";
export default defineComponent({
  name: "AppSettings",
  components: {
    Bolt,
    Building,
    MapPin,
    MapPinned,
    FileText,
    KeyRound,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const settingsTab = ref("general");
    const { isMetaOrg } = useIsMetaOrg();
    const splitterModel = ref(220);
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
      storePreviousStoreModel
    };
  },
});
</script>
<style lang="scss">
</style>
