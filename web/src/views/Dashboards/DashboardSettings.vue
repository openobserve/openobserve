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

<template>
    <div class="q-pa-none" :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'" style="min-height: inherit">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-body1 q-mx-md text-bold">
            {{ t('dashboard.setting') }}
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup
            round
            flat
            :icon="'img:' + getImageURL('images/common/close_icon.svg')"
          />
        </div>
      </div>
      <q-splitter
        v-model="splitterModel"
        unit="px"
        style="min-height: calc(100vh - 57px)"
      >
        <template v-slot:before>
          <div class="functions-tabs" style="width: 100%;">
            <q-tabs
              v-model="activeTab"
              indicator-color="transparent"
              inline-label
              vertical
            >
                <q-tab name="generalSettings" icon="settings" :label="t('dashboard.generalSettings')" />
                <q-tab name="variableSettings" icon="alarm" :label="t('dashboard.variableSettings')" />
            </q-tabs>
          </div>
        </template>
        <template v-slot:after>
          <div class="q-mx-md q-my-sm" style="width: 50vw;">
            <q-tab-panels
                v-model="activeTab"
                animated
                swipeable
                vertical
                transition-prev="jump-up"
                transition-next="jump-up"
                >
                <q-tab-panel name="generalSettings">
                   <GeneralSettings />
                </q-tab-panel>

                <q-tab-panel name="variableSettings">
                    <VariableSettings />
                </q-tab-panel>
            </q-tab-panels>
            <!-- :templates="templates"
              :functionAssociatedStreams="functionAssociatedStreams"
              @get:functionAssociatedStreams="getFunctionAssociatedStreams"
              @get:templates="getTemplates" -->
          </div>
        </template>
      </q-splitter>
    </div>
</template>
  
  <script lang="ts">
  import { defineComponent, ref, onActivated, onBeforeMount } from "vue";
  import { useStore } from "vuex";
  import { useRouter } from "vue-router";
  import { useI18n } from "vue-i18n";
  import GeneralSettings from "../../components/dashboards/settings/GeneralSettings.vue"
  import VariableSettings from "../../components/dashboards/settings/VariableSettings.vue"
  import { getImageURL } from "../../utils/zincutils";
  
  export default defineComponent({
    name: "AppSettings",
    components: {
        VariableSettings,
        GeneralSettings
    },
    setup() {
      const store = useStore();
      const { t } = useI18n();
      const router = useRouter();
      const activeTab: any = ref("generalSettings");
      const templates = ref([]);
      const splitterModel = ref(220);
    
  
      return {
        t,
        store,
        router,
        splitterModel,
        activeTab,
        templates,
        getImageURL
      };
    },
  });
  </script>
  
  <style scoped lang="scss">
  .dark-mode {
    background-color: $dark-page;
  }
  .q-table {
    &__top {
      border-bottom: 1px solid $border-color;
      justify-content: flex-end;
    }
  }
  .functions-tabs {
    .q-tabs {
      &--vertical {
        margin: 20px 16px 0 16px;
        .q-tab {
          justify-content: flex-start;
          padding: 0 1rem 0 1.25rem;
          border-radius: 0.5rem;
          margin-bottom: 0.5rem;
          // color: $dark;
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
            background-color: $accent;
            color: $dark;
          }
        }
      }
    }
  }
  </style>
  