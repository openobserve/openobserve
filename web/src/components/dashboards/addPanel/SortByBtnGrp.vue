<template>
  Sort By:
  <q-btn-group class="q-mr-sm">
    <q-btn
      :class="!fieldObj.sortBy || fieldObj.sortBy === 'None' ? 'selected' : ''"
      @click="updateSortOption('None')"
      icon="block"
      size="sm"
    />
    <q-btn
      :class="fieldObj.sortBy === 'ASC' ? 'selected' : ''"
      @click="updateSortOption('ASC')"
      ><AscSort
    /></q-btn>
    <q-btn
      :class="fieldObj.sortBy === 'DESC' ? 'selected' : ''"
      @click="updateSortOption('DESC')"
      ><DescSort
    /></q-btn>
  </q-btn-group>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { defineComponent } from "vue";
import AscSort from "@/components/icons/AscSort.vue";
import DescSort from "@/components/icons/DescSort.vue";

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
    const { dashboardPanelData } = useDashboardPanelData();

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
</style>
