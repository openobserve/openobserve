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
  <q-page class="q-pa-none" style="min-height: inherit">
    <q-splitter
      v-model="splitterModel"
      unit="px"
      style="min-height: calc(100vh - 57px)"
    >
      <template v-slot:before>
        <div class="functions-tabs">
          <q-tabs
            v-model="activeTab"
            indicator-color="transparent"
            inline-label
            vertical
          >
            <q-route-tab
              name="functions"
              :to="{
                name: 'functionList',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :label="t('function.header')"
              content-class="tab_content"
            />
            <q-route-tab
              data-test="function-stream-tab"
              name="streamFunctions"
              :to="{
                name: 'streamFunctions',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :label="t('function.associatedWithStream')"
              content-class="tab_content"
            />
            <q-route-tab
              data-test="function-enrichment-table-tab"
              name="enrichmentTables"
              :to="{
                name: 'enrichmentTables',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :label="t('function.enrichmentTables')"
              content-class="tab_content"
            />
          </q-tabs>
        </div>
      </template>
      <template v-slot:after>
        <div class="q-mx-md q-my-sm">
          <!-- :templates="templates"
            :functionAssociatedStreams="functionAssociatedStreams"
            @get:functionAssociatedStreams="getFunctionAssociatedStreams"
            @get:templates="getTemplates" -->
          <RouterView />
        </div>
      </template>
    </q-splitter>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "AppFunctions",
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const activeTab: any = ref("functionAssociatedStreams");
    const templates = ref([]);
    const functionAssociatedStreams = ref([]);
    const splitterModel = ref(220);
    onActivated(() => {
      redirectRoute();
    });
    onBeforeMount(() => {
      redirectRoute();
    });
    const redirectRoute = () => {
      if (router.currentRoute.value.name === "functions") {
        router.push({
          name: "functionList",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };

    return {
      t,
      store,
      router,
      redirectRoute,
      splitterModel,
      functionAssociatedStreams,
      activeTab,
      templates,
    };
  },
});
</script>

<style scoped lang="scss">
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
