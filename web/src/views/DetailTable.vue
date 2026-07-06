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
  <OCard class="flex flex-col h-full flex-nowrap w-[74vw]">
    <OCardSection role="header">
      <div class="flex items-center flex-nowrap">
        <div class="flex flex-col">
          <div class="text-base font-bold text-gray-800">
            {{ t("search.rowDetail") }}
          </div>
        </div>
        <div class="col-auto">
          <OButton variant="ghost" size="icon" v-close-popup icon-left="cancel" />
        </div>
      </div>
    </OCardSection>
    <OSeparator />
    <OTabs v-model="tab" dense class="text-gray-500" align="justify">
      <OTab name="table" :label="t('common.table')" />
      <OTab name="json" :label="t('common.json')" />
    </OTabs>

    <OSeparator />

    <OTabPanels v-model="tab" animated>
      <OTabPanel name="table">
        <OCardSection class="p-0 mb-6">
          <div
            v-if="rowData.length == 0"
            class="pt-3"
            style="max-width: 350px"
          >
            No data available.
          </div>
          <div v-else class="indexDetailsContainer">
            <ul
              style="height: calc(100vh - 220px); width: 70vw"
              class="detail-list px-0 py-0 flex flex-col divide-y divide-border"
            >
              <li class="detail-item list-head flex items-center gap-2 px-3 py-2">
                <div class="font-bold w-1/4 break-all">
                  {{ t("search.sourceName") }}
                </div>
                <div class="font-bold w-3/4 break-all">
                  {{ t("search.sourceValue") }}
                </div>
              </li>

              <li
                v-for="(key, value) in rowData"
                :key="value"
                class="detail-item list-item flex items-center gap-2 px-3 py-2"
              >
                <div class="w-1/4 break-all">{{ value }}</div>
                <div class="w-3/4 break-all">{{ key }}</div>
              </li>
              <li class="detail-item flex items-center gap-2 px-3 py-2"></li>
            </ul>
          </div>
        </OCardSection>
      </OTabPanel>

      <OTabPanel name="json">
        <pre>
          {{ rowData }}
        </pre>
      </OTabPanel>
    </OTabPanels>
  </OCard>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
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
  components: { OSeparator, OTabs, OTab, OTabPanels, OTabPanel, OButton, OCard, OCardSection },
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
