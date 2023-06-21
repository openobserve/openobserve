<template>
  <div>
    <q-toggle v-if="dashboardPanelData.data.type != 'table'" v-model="dashboardPanelData.data.config.show_legends"
      label="Show Legends" />

    <div class="space"></div>

    <q-select v-if="dashboardPanelData.data.type != 'table'" outlined
      v-model="dashboardPanelData.data.config.legends_position" :options="legendsPositionOptions" dense
      label="Legends Positions" class="showLabelOnTop" stack-label emit-value>
    </q-select>

    <div class="space"></div>

    <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promqlLegend" label="Legend" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot>
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          Legend
          <div>
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle">
              Series name overrides. For example, {endpoint} with be replaced with the label value for endpoint.
            </q-tooltip>
          </div>
        </div>
      </template>
    </q-input>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from '@/composables/useDashboardPanel';
import { ref, watch } from 'vue';

export default {
  props: {},
  emits: [],
  setup(props) {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData()

    // options for legends position
    const legendsPositionOptions = [
      {
        label: 'Auto',
        value: null
      },
      {
        label: 'Right',
        value: 'right'
      },
      {
        label: 'Bottom',
        value: 'bottom'
      },
    ]
    return {
      dashboardPanelData,
      promqlMode,

      // legends position options
      legendsPositionOptions,

    };
  }
};
</script>

<style scoped>
.space {
  margin-top: 10px;
  margin-bottom: 10px;
}
</style>
