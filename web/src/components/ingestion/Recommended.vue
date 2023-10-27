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
  <q-splitter
    v-model="splitterModel"
    unit="px"
    style="min-height: calc(100vh - 130px)"
  >
    <template v-slot:before>
      <q-tabs
            v-model="ingestTabType"
            indicator-color="transparent"
            inline-label
            vertical
          >
            <q-route-tab
              default
              name="ingestFromKubernetes"
              :to="{
                name: 'ingestFromKubernetes',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Kubernetes"
              content-class="tab_content"
            />
            <q-route-tab
              default
              name="ingestFromWindows"
              :to="{
                name: 'ingestFromWindows',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Windows"
              content-class="tab_content"
            />
            <q-route-tab
              name="ingestFromLinux"
              :to="{
                name: 'ingestFromLinux',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Linux"
              content-class="tab_content"
            />
            <q-route-tab
              name="ingestFromOtel"
              :to="{
                name: 'ingestFromOtel',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="OTEL"
              content-class="tab_content"
            />
            <q-route-tab
              name="frontendMonitoring"
              :to="{
                name: 'frontendMonitoring',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              label="Frontend Monitoring"
              content-class="tab_content"
            />
          </q-tabs>
    </template>

    <template v-slot:after>
      <router-view
        :title="tabs"
        :currOrgIdentifier="currOrgIdentifier"
        :currUserEmail="currentUserEmail"
        @copy-to-clipboard-fn="copyToClipboardFn"
      >
      </router-view>
    </template>
  </q-splitter>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onBeforeMount, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard, useQuasar } from "quasar";
import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";

export default defineComponent({
  name: "RecommendedPage",
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const tabs = ref("");
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier
    );

    onBeforeMount(() => {
      const ingestRoutes = [
        "curl",
        "fluentbit",
        "fluentd",
        "kinesisfirehose",
        "vector",
        "syslog",
        "gcpLogs",
        "syslogNg",
      ];
      if (ingestRoutes.includes(router.currentRoute.value.name)) {
        router.push({
          name: router.currentRoute.value.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
      if (router.currentRoute.value.name === "ingestLogs") {
        router.push({
          name: "curl",
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
      splitterModel: ref(250),
      currentUserEmail: store.state.userInfo.email,
      currentOrgIdentifier,
      getImageURL,
      verifyOrganizationStatus,
      tabs,
    };
  },
});
</script>

<style scoped lang="scss">
.ingestionPage {
  padding: 1.5rem 0 0;
  .head {
    padding-bottom: 1rem;
  }
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
}
</style>
<style lang="scss">
.ingestionPage {
  .q-tab-panel {
    padding: 0 !important;
    .tab_content {
      .q-tab__label {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
    }
  }

  .q-icon > img {
    height: auto !important;
  }
}
</style>
