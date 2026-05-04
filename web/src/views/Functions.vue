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

<template>
  <q-page>
    <div class=" tw:pb-[0.625rem]">
      <q-splitter
        v-model="splitterModel"
        unit="px"
        :limits="[0, 400]"
        class="tw:overflow-hidden logs-splitter-smooth"
      >
        <template v-slot:before>
          <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem] q-pt-xs">
            <div
              v-if="showSidebar"
              class="card-container tw:h-[calc(100vh-50px)]"
              :class="{ 'compact-sidebar': isCompactSidebar }"
            >
              <OTabs
                v-model="activeTab"
                orientation="vertical"
                :class="{ 'compact-tabs': isCompactSidebar }"
              >
                <ORouteTab
                  v-if="
                    !store.state.zoConfig?.custom_hide_menus
                      ?.split(',')
                      .includes('pipelines')
                  "
                  data-test="stream-pipelines-tab"
                  name="streamPipelines"
                  :to="{
                    name: 'pipelines',
                    query: {
                      org_identifier: store.state.selectedOrganization.identifier,
                    },
                  }"
                  :label="isCompactSidebar ? undefined : t('function.streamPipeline')"
                  :icon="isCompactSidebar ? 'lan' : undefined"
                >
                  <q-tooltip
                    v-if="isCompactSidebar"
                    anchor="center right"
                    self="center left"
                    :offset="[8, 0]"
                  >
                    {{ t('function.streamPipeline') }}
                  </q-tooltip>
                </ORouteTab>
                <ORouteTab
                  data-test="function-stream-tab"
                  name="functions"
                  :to="{
                    name: 'functionList',
                    query: {
                      org_identifier: store.state.selectedOrganization.identifier,
                    },
                  }"
                  :label="isCompactSidebar ? undefined : t('function.header')"
                  :icon="isCompactSidebar ? functionIcon : undefined"
                >
                  <q-tooltip
                    v-if="isCompactSidebar"
                    anchor="center right"
                    self="center left"
                    :offset="[8, 0]"
                  >
                    {{ t('function.header') }}
                  </q-tooltip>
                </ORouteTab>
                <ORouteTab
                  data-test="function-enrichment-table-tab"
                  name="enrichmentTables"
                  :to="{
                    name: 'enrichmentTables',
                    query: {
                      org_identifier: store.state.selectedOrganization.identifier,
                    },
                  }"
                  :label="isCompactSidebar ? undefined : t('function.enrichmentTables')"
                  :icon="isCompactSidebar ? 'dataset' : undefined"
                >
                  <q-tooltip
                    v-if="isCompactSidebar"
                    anchor="center right"
                    self="center left"
                    :offset="[8, 0]"
                  >
                    {{ t('function.enrichmentTables') }}
                  </q-tooltip>
                </ORouteTab>
                <ORouteTab
                  v-if="config.isEnterprise == 'true'"
                  data-test="eval-templates-tab"
                  name="evalTemplates"
                  :to="{
                    name: 'evalTemplates',
                    query: {
                      org_identifier: store.state.selectedOrganization.identifier,
                    },
                  }"
                  :label="isCompactSidebar ? undefined : t('pipeline.evalTemplates')"
                  :icon="isCompactSidebar ? 'rule' : undefined"
                >
                  <q-tooltip
                    v-if="isCompactSidebar"
                    anchor="center right"
                    self="center left"
                    :offset="[8, 0]"
                  >
                    {{ t('pipeline.evalTemplates') }}
                  </q-tooltip>
                </ORouteTab>
              </OTabs>
            </div>
          </div>
        </template>
        <template #separator>
          <OButton
            data-test="logs-search-field-list-collapse-btn"
            :title="showSidebar ? 'Collapse Fields' : 'Open Fields'"
            variant="sidebar-button"
            size="sidebar-button"
            :class="showSidebar ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
            @click="collapseSidebar"
          >
            <q-icon :name="showSidebar ? 'chevron_left' : 'chevron_right'" size="12px" />
          </OButton>
        </template>
        <template v-slot:after>
          <!-- :templates="templates"
            :functionAssociatedStreams="functionAssociatedStreams"
            @get:functionAssociatedStreams="getFunctionAssociatedStreams"
            @get:templates="getTemplates" -->
            <div class=" q-pt-xs">
              <RouterView v-slot="{ Component }">
                <component :is="Component" @sendToAiChat="sendToAiChat" />
              </RouterView>
            </div>
        </template>
      </q-splitter>
    </div>
  </q-page>
</template>

<script lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import { defineComponent, ref, computed, onBeforeMount, onMounted, onUnmounted, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";

export default defineComponent({
  name: "AppFunctions",
  components: { OTabs, OTab, ORouteTab, OButton },
  emits: ["sendToAiChat"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const activeTab: any = ref("streamPipelines");
    const templates = ref([]);
    const functionAssociatedStreams = ref([]);
    // Responsive sidebar: icon-only at narrow widths
    const windowWidth = ref(window.innerWidth);
    const onWindowResize = () => {
      windowWidth.value = window.innerWidth;
    };
    const isCompactSidebar = computed(() => windowWidth.value <= 1440);

    const splitterModel = ref(220);

    const lastSplitterPosition = ref(splitterModel.value);

    const showSidebar = ref(true);

    // Function icon from SVG — same as logs page function toggle
    const functionIcon = computed(() => {
      return (
        "img:" +
        getImageURL(
          store.state.theme === "dark"
            ? "images/common/function_dark.svg"
            : "images/common/function.svg",
        )
      );
    });

    // Adjust splitter width when switching between compact/full mode
    watch(isCompactSidebar, (compact) => {
      if (showSidebar.value) {
        splitterModel.value = compact ? 65 : 220;
        lastSplitterPosition.value = splitterModel.value;
      }
    });

    onMounted(() => {
      window.addEventListener("resize", onWindowResize);
      // Apply initial compact width if needed
      if (isCompactSidebar.value && showSidebar.value) {
        splitterModel.value = 65;
        lastSplitterPosition.value = 65;
      }
    });

    onUnmounted(() => {
      window.removeEventListener("resize", onWindowResize);
    });

    watch(
      () => router.currentRoute.value,
      (currentRoute: any) => {
        if (
          currentRoute.name === "functionList" &&
          currentRoute.query.action === "add"
        ) {
          if (showSidebar.value) collapseSidebar();
        }
      },
    );

    watch(
      () => router.currentRoute.value.name,
      (routeName) => {
        // This is added to redirect to functionList if the user is on functions route
        // This case happens when user clicks on functions from menu when he is already on functions page
        if (routeName === "pipeline") router.back();
      },
    );

    onBeforeMount(() => {
      redirectRoute();
    });

    const collapseSidebar = () => {
      if (showSidebar.value) lastSplitterPosition.value = splitterModel.value;
      showSidebar.value = !showSidebar.value;
      splitterModel.value = showSidebar.value ? lastSplitterPosition.value : 0;
    };

    const redirectRoute = () => {
      if (router.currentRoute.value.name === "pipeline") {
        router.replace({
          name: "pipelines",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };

    const sendToAiChat = (value: any, append: boolean = false) => {
      emit("sendToAiChat", value, append);
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
      collapseSidebar,
      showSidebar,
      sendToAiChat,
      isCompactSidebar,
      functionIcon,
      config,
    };
  },
});
</script>

<style scoped lang="scss">
:deep(.q-splitter__before) {
  overflow: visible;
}

.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

// Compact sidebar styles for narrow viewports
.compact-sidebar {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0;
}

.compact-tabs {
  width: 100%;

  :deep(.o-tabs__content) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0;
  }

  :deep(.o-tab) {
    min-height: 2.5rem;
    min-width: 2.5rem;
    width: 2.5rem;
    padding: 0;
    transition: background-color 0.2s ease, color 0.2s ease;

    .o-tab__icon {
      font-size: 1.25rem;

      img {
        width: 1.25rem;
        height: 1.25rem;
      }
    }

    &:hover {
      background-color: var(--o2-hover-accent);
    }

    &.o-tab--active {
      background: color-mix(
        in srgb,
        var(--o2-primary-btn-bg) 20%,
        white 10%
      );
      color: var(--o2-text-primary);

      .o-tab__icon {
        color: var(--o2-text-primary);
      }
    }
  }
}
</style>
