<template>
  Sort By:
  <q-btn-group class="el-border">
    <q-btn
      :class="[!fieldObj.sortBy ? 'selected' : '', 'tw:px-2.5', 'el-border']"
      @click="updateSortOption(null)"
      icon="block"
      size="sm"
      data-test="dashboard-sort-by-item-clear"
    />
    <q-btn
      :class="[fieldObj.sortBy === 'ASC' ? 'selected' : '', 'tw:px-2', 'custom-border']"
      @click="updateSortOption('ASC')"
      data-test="dashboard-sort-by-item-asc"
      ><AscSort
    /></q-btn>
    <q-btn
      :class="[fieldObj.sortBy === 'DESC' ? 'selected' : '', 'tw:px-2.5', 'el-border']"
      @click="updateSortOption('DESC')"
      data-test="dashboard-sort-by-item-desc"
      ><DescSort
    /></q-btn>
  </q-btn-group>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { defineComponent } from "vue";
import AscSort from "@/components/icons/AscSort.vue";
import DescSort from "@/components/icons/DescSort.vue";
import { inject } from "vue";

export default defineComponent({
  name: "SortByBtnGrp",
  components: { AscSort, DescSort },
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
