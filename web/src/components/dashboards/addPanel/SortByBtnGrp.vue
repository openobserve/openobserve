<template>
  <OButtonGroup data-test="dashboard-sort-by-btn-group">
    <OButton
      :aria-label="t('dashboard.sortByClear')"
      :active="!fieldObj.sortBy"
      variant="outline"
      size="icon-xs"
      icon-left="block"
      @click="updateSortOption(null)"
      data-test="dashboard-sort-by-item-clear"
    >
      <OTooltip :content="t('dashboard.sortByClear')" />
    </OButton>
    <OButton
      :aria-label="t('dashboard.sortByAsc')"
      :active="fieldObj.sortBy === 'ASC'"
      variant="outline"
      size="icon-xs"
      @click="updateSortOption('ASC')"
      data-test="dashboard-sort-by-item-asc"
    >
      <template #icon-left><AscSort /></template>
      <OTooltip :content="t('dashboard.sortByAsc')" />
    </OButton>
    <OButton
      :aria-label="t('dashboard.sortByDesc')"
      :active="fieldObj.sortBy === 'DESC'"
      variant="outline"
      size="icon-xs"
      @click="updateSortOption('DESC')"
      data-test="dashboard-sort-by-item-desc"
    >
      <template #icon-left><DescSort /></template>
      <OTooltip :content="t('dashboard.sortByDesc')" />
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

export default defineComponent({
  name: "SortByBtnGrp",
  components: { OButtonGroup, AscSort, DescSort, OButton, OTooltip },
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
