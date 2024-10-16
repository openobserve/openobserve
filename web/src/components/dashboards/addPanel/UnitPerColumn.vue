<template>
  <div>
    <div class="q-mb-sm" style="font-weight: 600">
      <span>Override Config</span>
      <q-btn
        no-caps
        padding="xs"
        size="sm"
        flat
        icon="info_outline"
        data-test="dashboard-addpanel-config-drilldown-info"
      >
        <q-tooltip
          class="bg-grey-8"
          anchor="bottom middle"
          self="top middle"
          max-width="250px"
        >
          Map units to the selected columns for enhanced data visualization.
        </q-tooltip>
      </q-btn>
    </div>

    <q-btn
      @click="openUnitMappingPopup"
      style="cursor: pointer; padding: 0px 5px"
      :label="' Add field override'"
      no-caps
      data-test="dashboard-addpanel-config-unit-mapping-add-btn"
    />

    <q-dialog v-model="showUnitMappingPopup">
      <UnitPerColumnPopUp
        :columns="columns"
        :value-mapping="unitMappings"
        :common-unit="dashboardPanelData.data.config.commonUnit"
        @close="showUnitMappingPopup = false"
        @save="saveUnitMappingConfig"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, inject } from "vue";
import { useStore } from "vuex";
import UnitPerColumnPopUp from "../UnitPerColumnPopUp.vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";

export default defineComponent({
  name: "UnitPerColumn",
  components: { UnitPerColumnPopUp },
  setup() {
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const showUnitMappingPopup = ref(false);
    const columns: any = ref([]);
    const unitMappings = ref({});

    const fetchColumns = () => {
      const x = dashboardPanelData.data.queries[0].fields.x || [];
      const y = dashboardPanelData.data.queries[0].fields.y || [];
      columns.value = [...x, ...y];
    };

    const openUnitMappingPopup = () => {
      fetchColumns();
      showUnitMappingPopup.value = true;
    };

    const saveUnitMappingConfig = (
      valueMapping: any,
      selectedCommonUnit: any,
    ) => {
      dashboardPanelData.data.config.override_config = valueMapping;
      dashboardPanelData.data.config.commonUnit = selectedCommonUnit;
      applyUnitMappings();
      showUnitMappingPopup.value = false;
    };

    const applyUnitMappings = () => {
      const mappings = dashboardPanelData.data.config.override_config || {};
      const commonUnit = dashboardPanelData.data.config.commonUnit;

      columns.value = columns.value.map((col: any) => {
        return {
          name: col.alias,
          label: col.label,
          field: col.alias,
          format: (val: any) => {
            const unit = mappings[col.alias] || commonUnit || "";
            return `${val} ${unit}`;
          },
        };
      });
    };

    fetchColumns();
    applyUnitMappings();

    return {
      store,
      dashboardPanelData,
      showUnitMappingPopup,
      openUnitMappingPopup,
      saveUnitMappingConfig,
      columns,
      unitMappings,
    };
  },
});
</script>
