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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div class="row">
      <div class="col-2 alerts-tabs q-pa-sm">
        <q-tabs
          v-model="activeTab"
          indicator-color="transparent"
          class="text-secondary"
          inline-label
          vertical
        >
          <q-route-tab
            name="alerts"
            to="/alerts/alerts"
            icon="data"
            label="Alerts"
            content-class="tab_content"
          />
          <q-route-tab
            name="destinations"
            to="/alerts/destinations"
            icon="data"
            label="Destinations"
            content-class="tab_content"
          />
          <q-route-tab
            name="templates"
            to="/alerts/templates"
            icon="data"
            label="Templates"
            content-class="tab_content"
          />
        </q-tabs>
      </div>
      <div class="col-10">
        <RouterView
          :templates="templates"
          :destinations="destinations"
          @get:destinations="getDestinations"
          @get:templates="getTemplates"
        ></RouterView>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts" setup>
import { ref, onActivated, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";

const store = useStore();
const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const activeTab: any = ref("destinations");
const templates = ref([]);
const destinations = ref([]);

onActivated(() => {
  const routeMapping: any = {
    alertList: "alerts",
    alertDestinations: "destinations",
    alertTemplates: "templates",
  };
  if (router.currentRoute.value.name) {
    activeTab.value = routeMapping[router.currentRoute.value.name];
  } else {
    activeTab.value = "alerts";
    router.push("/alerts");
  }
});

onBeforeMount(() => {
  if (!templates.value.length) getTemplates();
  if (!destinations.value.length) getDestinations();
});

const getTemplates = () => {
  templateService
    .list({
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then((res) => (templates.value = res.data));
};

const getDestinations = () => {
  destinationService
    .list({
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then((res) => (destinations.value = res.data));
};
</script>

<style lang="scss">
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.alerts-tabs {
  .q-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 0;
      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        color: $dark;

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
        }
      }
    }
  }
}
</style>
