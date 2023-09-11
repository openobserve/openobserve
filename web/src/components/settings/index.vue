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
      style="min-height: calc(100vh - 130px)"
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
import { defineComponent, ref, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "PageIngestion",
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const settingsTab = ref("usage");

    onBeforeMount(() => {
      if (router.currentRoute.value.name == "settings") {
        settingsTab.value = "api_keys";
        router.push({ path: "/settings/apikeys" });
      }
    });

    return {
      t,
      store,
      router,
      settingsTab,
      splitterModel: ref(200),
    };
  },
});
</script>
