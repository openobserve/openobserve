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
  <OButton
    data-test="logs-search-bar-more-options-btn"
    class="download-logs-btn"
    variant="outline"
    size="icon-toolbar"
    style="order: 4"
  >
    <q-icon name="menu" size="16px" />
    <q-menu>
      <q-list>
        <!-- Share Link (moved from toolbar at <= 1100px) -->
        <q-item
          v-if="shouldMoveShareToMenu"
          clickable
          v-close-popup
          data-test="logs-search-bar-menu-share-link-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <share-button
              :url="shareURL"
              variant="outline"
              size="sm-action"
              :show-label="true"
              class="tw:w-full"
            />
          </q-item-section>
        </q-item>

        <q-separator v-if="shouldMoveShareToMenu" />

        <q-item
          data-test="search-history-item-btn"
          class="q-pa-sm saved-view-item"
          clickable
          v-close-popup
        >
          <q-item-section @click.stop="showSearchHistoryfn">
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <img
                :src="searchHistoryIcon"
                alt="Search History"
                style="width: 20px; height: 20px"
              />
              {{ t("search.searchHistory") }}</q-item-label
            >
          </q-item-section>
        </q-item>
        <q-separator />
        <q-item
          style="min-width: 150px"
          class="q-pa-sm saved-view-item download-menu-parent"
          clickable
          v-close-popup
          @mouseenter="showDownloadMenu = true"
        >
          <q-item-section class="cursor-pointer">
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <img
                :src="downloadTableIcon"
                alt="Download Table"
                style="width: 20px; height: 20px"
              />
              {{ t("search.downloadTable") }}</q-item-label
            >
          </q-item-section>
          <q-item-section side>
            <q-icon name="keyboard_arrow_right" />
          </q-item-section>
          <q-menu
            v-model="showDownloadMenu"
            anchor="top end"
            self="top start"
            :offset="[0, 0]"
            @mouseenter="showDownloadMenu = true"
            @mouseleave="showDownloadMenu = false"
          >
            <q-list>
              <q-item
                data-test="search-download-csv-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
                @click="
                  downloadLogs(searchObj.data.queryResults.hits, 'csv')
                "
              >
                <q-icon
                  name="grid_on"
                  size="14px"
                  class="q-pr-sm q-pt-xs"
                />
                <q-item-section>
                  <q-item-label
                    class="tw:flex tw:items-center tw:gap-2 q-mr-md"
                  >
                    {{ t("search.downloadCSV") }}
                  </q-item-label>
                </q-item-section>
              </q-item>
              <q-item
                data-test="search-download-json-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
                @click="
                  downloadLogs(searchObj.data.queryResults.hits, 'json')
                "
              >
                <q-icon
                  name="data_object"
                  size="14px"
                  class="q-pr-sm q-pt-xs"
                />
                <q-item-section>
                  <q-item-label
                    class="tw:flex tw:items-center tw:gap-2 q-mr-md"
                  >
                    {{ t("search.downloadJSON") }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-item>
        <q-item
          class="q-pa-sm saved-view-item"
          style="min-width: 150px"
          clickable
          v-close-popup
        >
          <q-item-section
            @click.stop="toggleCustomDownloadDialog"
            v-close-popup
          >
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <img
                :src="customRangeIcon"
                alt="Custom Range"
                style="width: 20px; height: 20px"
              />

              {{ t("search.customRange") }}</q-item-label
            >
          </q-item-section>
        </q-item>
        <q-separator />
        <q-item
          v-if="searchObj.meta.sqlMode"
          data-test="logs-search-bar-explain-query-menu-btn"
          class="q-pa-sm saved-view-item"
          clickable
          v-close-popup
          :disable="
            !searchObj.data.query || searchObj.data.query.trim() === ''
          "
          @click="openExplainDialog"
        >
          <q-item-section v-close-popup>
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <q-icon name="lightbulb" size="20px" />
              {{ t("search.explainQuery") }}</q-item-label
            >
          </q-item-section>
        </q-item>
        <q-separator v-if="searchObj.meta.sqlMode" />
        <q-item
          v-if="config.isEnterprise == 'true'"
          data-test="search-scheduler-create-new-btn"
          class="q-pa-sm saved-view-item"
          clickable
          v-close-popup
          @click="createScheduleJob"
        >
          <q-item-section v-close-popup>
            <q-item-label
              class="tw:flex tw:items-center tw:gap-2"
              data-test="search-scheduler-create-new-label"
            >
              <img
                :src="createScheduledSearchIcon"
                alt="Create Scheduled Search"
                style="width: 20px; height: 20px"
              />
              {{ t("search.createScheduledSearch") }}</q-item-label
            >
          </q-item-section>
        </q-item>
        <q-item
          v-if="config.isEnterprise == 'true'"
          data-test="search-scheduler-list-btn"
          class="q-pa-sm saved-view-item"
          clickable
          v-close-popup
          @click="routeToSearchSchedule"
        >
          <q-item-section v-close-popup>
            <q-item-label
              class="tw:flex tw:items-center tw:gap-2"
              data-test="search-scheduler-list-label"
            >
              <img
                :src="listScheduledSearchIcon"
                alt="List Scheduled Search"
                style="width: 20px; height: 20px"
              />
              {{ t("search.listScheduledSearch") }}</q-item-label
            >
          </q-item-section>
        </q-item>
        <q-separator v-if="config.isEnterprise == 'true'" />
        <q-item
          v-if="
            config.isEnterprise == 'true' &&
            config.isCloud == 'false' &&
            store.state.zoConfig.search_inspector_enabled
          "
          data-test="search-inspect-btn"
          class="q-pa-sm saved-view-item"
          clickable
          v-close-popup
          @click="emit('search-inspect')"
        >
          <q-item-section v-close-popup>
            <q-item-label
              class="tw:flex tw:items-center tw:gap-2"
              data-test="search-inspect-label"
            >
              <q-icon name="troubleshoot" size="20px" />
              Search Inspect
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
    <q-tooltip style="width: 110px">
      {{ t("search.moreActions") }}
    </q-tooltip>
  </OButton>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import { searchState } from "@/composables/useLogs/searchState";
import downloadLogsUtil from "@/utils/logs/downloadLogs";
import config from "@/aws-exports";

const { t } = useI18n();
const store = useStore();
const { searchObj } = searchState();

const props = defineProps<{
  shouldMoveShareToMenu: boolean;
  shareURL: string;
}>();

const emit = defineEmits<{
  "toggle-custom-download": [];
  "open-explain": [];
  "create-schedule": [];
  "list-schedules": [];
  "show-search-history": [];
  "search-inspect": [];
}>();

const showDownloadMenu = ref(false);

const searchHistoryIcon = computed(
  () =>
    "/" +
    (store.state.theme === "dark"
      ? "images/common/search_history_icon_dark.svg"
      : "images/common/search_history_icon_light.svg")
);

const downloadTableIcon = computed(
  () =>
    "/" +
    (store.state.theme === "dark"
      ? "images/common/download_icon_dark.svg"
      : "images/common/download_icon_light.svg")
);

const customRangeIcon = computed(
  () =>
    "/" +
    (store.state.theme === "dark"
      ? "images/common/customdownload_icon_dark.svg"
      : "images/common/customdownload_icon_light.svg")
);

const createScheduledSearchIcon = computed(
  () =>
    "/" +
    (store.state.theme === "dark"
      ? "images/common/scheduled_search_icon_dark.svg"
      : "images/common/scheduled_search_icon_light.svg")
);

const listScheduledSearchIcon = computed(
  () =>
    "/" +
    (store.state.theme === "dark"
      ? "images/common/scheduled_list_search_icon_dark.svg"
      : "images/common/scheduled_list_search_icon_light.svg")
);

const downloadLogs = async (data: any[], format: "csv" | "json") => {
  await downloadLogsUtil(data, format);
  showDownloadMenu.value = false;
};

const toggleCustomDownloadDialog = () => {
  emit("toggle-custom-download");
};

const openExplainDialog = () => {
  emit("open-explain");
};

const createScheduleJob = () => {
  emit("create-schedule");
};

const routeToSearchSchedule = () => {
  emit("list-schedules");
};

const showSearchHistoryfn = () => {
  emit("show-search-history");
};
</script>
