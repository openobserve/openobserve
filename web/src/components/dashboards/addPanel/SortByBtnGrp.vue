<template>
  Sort By:
  <q-btn-group class="el-border">
    <OButton
  size="icon"
  @click="updateSortOption(null)"
  data-test="dashboard-sort-by-item-clear"
  :class="[!fieldObj.sortBy ? 'selected' : '', 'tw:px-2.5', 'el-border']">
  <template #icon-left><Ban class="tw:w-4 tw:h-4" /></template>
</OButton>
    <OButton
  @click="updateSortOption('ASC')"
  data-test="dashboard-sort-by-item-asc"
  :class="[
        fieldObj.sortBy === 'ASC' ? 'selected' : '',
        'tw:px-2',
        'custom-border',
      ]"><AscSort /></OButton>
    <OButton
  @click="updateSortOption('DESC')"
  data-test="dashboard-sort-by-item-desc"
  :class="[
        fieldObj.sortBy === 'DESC' ? 'selected' : '',
        'tw:px-2.5',
        'el-border',
      ]"><DescSort /></OButton>
  </q-btn-group>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { defineComponent } from "vue";
import AscSort from "@/components/icons/AscSort.vue";
import DescSort from "@/components/icons/DescSort.vue";
import { inject } from "vue";

import OButton from "@/lib/core/Button/Button.vue";

import { Ban } from "lucide-vue-next";
export default defineComponent({
  name: "SortByBtnGrp",
  components: { AscSort, DescSort,
    OButton,
    Ban,
},
  props: {
    fieldObj: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const updateSortOption = (value: any) => {
      props.fieldObj.sortBy = value;
    };

    return {
      dashboardPanelData,
      updateSortOption,
    };
  },
});
</script>
<style lang="scss" scoped>
.selected {
  background-color: var(--q-primary) !important;
  font-weight: bold;
  color: white;
}

.no-border {
  border: none !important;
}

.custom-border {
  border-top: 0px solid !important;
  border-bottom: 0px solid !important;
  border-left: 1px solid #d5d5d5 !important;
  border-right: 1px solid #d5d5d5 !important;
}

.q-btn {
  border: none;
}
</style>
