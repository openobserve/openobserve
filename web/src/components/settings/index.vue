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
  <q-page class="page q-pa-md">
    <div class="head q-table__title q-pb-md">
      {{ t("settings.header") }}
    </div>
    <q-separator class="separator" />
    <q-splitter
      v-model="splitterModel"
      unit="px"
      style="min-height: calc(100vh - 136px)"
    >
      <template v-slot:before>
        <q-tabs
          v-model="settingsTab"
          indicator-color="transparent"
          inline-label
          vertical
        >
          <q-route-tab
            exact
            default
            name="general"
            :to="'/settings/general'"
            :icon="outlinedSettings"
            label="general"
            content-class="tab_content"
          />
          <q-route-tab
            v-if="config.isCloud == 'true'"
            exact
            default
            name="api_keys"
            :to="'/settings/apikeys'"
            icon="key"
            label="API Keys"
            content-class="tab_content"
          />
        </q-tabs>
      </template>

      <template v-slot:after>
        <router-view title=""> </router-view>
      </template>
    </q-splitter>
  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onActivated, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import { outlinedSettings } from "@quasar/extras/material-icons-outlined";

export default defineComponent({
  name: "PageIngestion",
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const settingsTab = ref("general");

    onBeforeMount(() => {
      if (router.currentRoute.value.name == "settings") {
        settingsTab.value = "general";
        router.push({ path: "/settings/general" });
      }
    });

    // render general settings component
    onActivated(() => {
      settingsTab.value = "general";
      router.push({ path: "/settings/general" });
    });

    onUpdated(() => {
      settingsTab.value = "general";
      if (router.currentRoute.value.name === "settings") {
        router.push({
          name: "general",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    return {
      t,
      store,
      router,
      config,
      settingsTab,
      splitterModel: ref(200),
      outlinedSettings
    };
  },
});
</script>
<style scoped lang="scss">
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
</style>
