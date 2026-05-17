<template>
  Sort By:
  <OButtonGroup>
    <OButton
      :active="!fieldObj.sortBy"
      variant="outline"
      size="icon-xs"
      @click="updateSortOption(null)"
      data-test="dashboard-sort-by-item-clear"
    >
      <template #icon-left
        ><OIcon name="block" size="sm" style="font-size: 16px"
      /></template>
    </OButton>
    <OButton
      :active="fieldObj.sortBy === 'ASC'"
      variant="outline"
      size="icon-xs"
      @click="updateSortOption('ASC')"
      data-test="dashboard-sort-by-item-asc"
    >
      <template #icon-left><AscSort /></template>
    </OButton>
    <OButton
      :active="fieldObj.sortBy === 'DESC'"
      variant="outline"
      size="icon-xs"
      @click="updateSortOption('DESC')"
      data-test="dashboard-sort-by-item-desc"
    >
      <template #icon-left><DescSort /></template>
    </OButton>
  </OButtonGroup>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import { defineComponent } from "vue";
import AscSort from "@/components/icons/AscSort.vue";
import DescSort from "@/components/icons/DescSort.vue";
import { inject } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "SortByBtnGrp",
  components: { OButtonGroup, AscSort, DescSort, OButton,
    OIcon,
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
