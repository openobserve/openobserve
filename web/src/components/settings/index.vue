<!-- Copyright 2023 Zinc Labs Inc.

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
            :label="t('settings.generalLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            v-if="config.isCloud == 'true'"
            exact
            default
            name="api_keys"
            :to="'/settings/apikeys'"
            icon="key"
            :label="t('settings.apikeyLabel')"
            content-class="tab_content"
          />
          <q-route-tab
            exact
            default
            name="authentication_sources"
            :to="'/settings/authentication_sources'"
            icon="source"
            :label="t('settings.authSourceLabel')"
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
import {
  defineComponent,
  ref,
  onBeforeMount,
  onActivated,
  onUpdated,
} from "vue";
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
      if (router.currentRoute.value.name === "settings") {
        settingsTab.value = "general";
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
      splitterModel: ref(250),
      outlinedSettings,
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
