<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <DataSourceSidebarLayout v-model="ingestiontabs" :splitter-width="250">
    <template #tabs>
      <ORouteTab
        name="profilesOtelCollector"
        data-test="ingestion-profiles-tab-otelCollector"
        :to="{
          name: 'profilesOtelCollector',
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        }"
        :icon="'img:' + getImageURL('images/ingestion/otlp.svg')"
        :label="t('ingestion.otelCollectorTabLabel')"
      />
    </template>

    <div class="h-full w-full">
      <div class="bg-card-glass-bg h-full overflow-y-auto pt-0.5">
        <router-view
          :title="ingestiontabs"
          :currOrgIdentifier="currOrgIdentifier"
          :currUserEmail="currentUserEmail"
          @copy-to-clipboard-fn="copyToClipboardFn"
        >
        </router-view>
      </div>
    </div>
  </DataSourceSidebarLayout>
</template>

<script lang="ts">
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import DataSourceSidebarLayout from "@/components/ingestion/DataSourceSidebarLayout.vue";
import { defineComponent, ref, onBeforeMount, onUpdated } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import segment from "@/services/segment_analytics";
import { getImageURL } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";

export default defineComponent({
  name: "IngestProfiles",
  components: {
    ORouteTab,
    DataSourceSidebarLayout,
  },
  data() {
    return {};
  },
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();
    const currentRouteName = () => String(router.currentRoute.value.name ?? "");
    const ingestiontabs = ref(
      resolveTab("ingestProfiles", currentRouteName(), "profilesOtelCollector"),
    );

    onBeforeMount(() => {
      const ingestRoutes = ["profilesOtelCollector"];
      const routeName = currentRouteName();
      if (ingestRoutes.includes(routeName)) {
        router.push({
          name: routeName,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
      if (routeName === "ingestProfiles") {
        router.push({
          name: "profilesOtelCollector",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (currentRouteName() === "ingestProfiles") {
        router.push({
          name: "profilesOtelCollector",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const copyToClipboardFn = (content: { innerText: string }) => {
      copyToClipboard(content.innerText, t, {
        successMessage: t("common.contentCopiedSuccessfully"),
        errorMessage: t("ingestion.copyContentError"),
        timeout: 5000,
      }).then((success: boolean) => {
        if (success) {
          segment.track("Button Click", {
            button: "Copy to Clipboard",
            ingestion: currentRouteName(),
            user_org: store.state.selectedOrganization.identifier,
            user_id: store.state.userInfo.email,
            page: "Ingestion",
          });
        }
      });
    };

    return {
      t,
      store,
      router,
      currentUserEmail: store.state.userInfo.email,
      copyToClipboardFn,
      ingestiontabs,
      getImageURL,
    };
  },
});
</script>
