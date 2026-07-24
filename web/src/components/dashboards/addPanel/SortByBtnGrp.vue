<template>
  {{ t("dashboard.sortBy") }}
  <OButtonGroup data-test="dashboard-sort-by-btn-group">
    <OButton
      :active="!fieldObj.sortBy"
      variant="outline"
      size="icon-xs"
      @click="updateSortOption(null)"
      data-test="dashboard-sort-by-item-clear"
    >
      <template #icon-left><OIcon name="block" size="sm" /></template>
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
import { computed, defineComponent } from "vue";
import AscSort from "@/components/icons/AscSort.vue";
import DescSort from "@/components/icons/DescSort.vue";
import { inject } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "SortByBtnGrp",
  components: { OButtonGroup, AscSort, DescSort, OButton, OIcon },
  props: {
    fieldObj: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData } = useDashboardPanelData(dashboardPanelDataPageKey);

    // same object reference as props.fieldObj; nested mutation is unchanged
    const fieldObjModel = computed(() => props.fieldObj);

    const updateSortOption = (value: any) => {
      fieldObjModel.value.sortBy = value;
    };

    return {
      t,
      dashboardPanelData,
      updateSortOption,
    };
  },
});
</script>
