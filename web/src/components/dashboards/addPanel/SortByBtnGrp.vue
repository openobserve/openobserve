<template>
  <OButtonGroup data-test="dashboard-sort-by-btn-group">
    <OButton
      icon-only
      :aria-label="t('dashboard.sortByClear')"
      :pressed="!fieldObj.sortBy"
      variant="secondary"
      @click="updateSortOption(null)"
      data-test="dashboard-sort-by-item-clear"
    >
      <template #icon><OIcon name="block" size="sm" /></template>
    </OButton>
    <OButton
      icon-only
      :aria-label="t('dashboard.sortByAsc')"
      :pressed="fieldObj.sortBy === 'ASC'"
      variant="secondary"
      @click="updateSortOption('ASC')"
      data-test="dashboard-sort-by-item-asc"
    >
      <template #icon><AscSort /></template>
    </OButton>
    <OButton
      icon-only
      :aria-label="t('dashboard.sortByDesc')"
      :pressed="fieldObj.sortBy === 'DESC'"
      variant="secondary"
      @click="updateSortOption('DESC')"
      data-test="dashboard-sort-by-item-desc"
    >
      <template #icon><DescSort /></template>
    </OButton>
  </OButtonGroup>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import { computed, defineComponent, inject } from "vue";
import AscSort from "@/components/icons/AscSort.vue";
import DescSort from "@/components/icons/DescSort.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";

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
    const { t } = useI18nTyped();
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData } = useDashboardPanelData(dashboardPanelDataPageKey, t);

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
