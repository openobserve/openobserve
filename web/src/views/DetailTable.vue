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
  <q-card class="column full-height no-wrap searchdetaildialog">
    <q-card-section class="q-pa-md q-pb-md">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-body1 text-bold text-dark">
            {{ t("search.rowDetail") }}
          </div>
        </div>
        <div class="col-auto">
          <OButton variant="ghost" size="icon" v-close-popup icon-left="cancel" />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <OTabs v-model="tab" dense class="text-grey" align="justify">
      <OTab name="table" :label="t('common.table')" />
      <OTab name="json" :label="t('common.json')" />
    </OTabs>

    <q-separator />

    <OTabPanels v-model="tab" animated>
      <OTabPanel name="table">
        <q-card-section class="q-pa-none q-mb-lg">
          <div
            v-if="rowData.length == 0"
            class="q-pt-md"
            style="max-width: 350px"
          >
            No data available.
          </div>
          <div v-else class="indexDetailsContainer">
            <ul
              style="height: calc(100vh - 220px); width: 70vw"
              class="detail-list q-px-none q-py-none tw:flex tw:flex-col tw:divide-y tw:divide-border"
            >
              <li class="detail-item list-head tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2">
                <div class="detail-section text-bold col-3 tw:break-all">
                  {{ t("search.sourceName") }}
                </div>
                <div class="detail-section text-bold col-9 tw:break-all">
                  {{ t("search.sourceValue") }}
                </div>
              </li>

              <li
                v-for="(key, value) in rowData"
                :key="value"
                class="detail-item list-item tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2"
              >
                <div class="detail-section col-3 tw:break-all">{{ value }}</div>
                <div class="detail-section col-9 tw:break-all">{{ key }}</div>
              </li>
              <li class="detail-item tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2"></li>
            </ul>
          </div>
        </q-card-section>
      </OTabPanel>

      <OTabPanel name="json">
        <pre>
          {{ rowData }}
        </pre>
      </OTabPanel>
    </OTabPanels>
  </q-card>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../utils/zincutils";

const defaultValue: any = () => {
  return {
    data: {},
  };
};

export default defineComponent({
  name: "SearchDetail",
  components: { OTabs, OTab, OTabPanels, OTabPanel, OButton },
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  setup() {
    const { t } = useI18n();
    const rowData: any = ref({});

    return {
      t,
      rowData,
      tab: ref("table"),
      getImageURL,
    };
  },
  created() {
    this.rowData = this.modelValue;
  },
});
</script>

<style scoped>
.searchdetaildialog {
  width: 74vw;
}
.detail-section {
  word-break: break-all;
}
.indexDetailsContainer .detail-list .detail-item {
  height: auto;
}
</style>
