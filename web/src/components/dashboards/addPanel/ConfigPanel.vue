<template>
  <div>
    <q-toggle v-if="dashboardPanelData.data.type != 'table'" v-model="dashboardPanelData.data.config.show_legends"
      label="Show Legends" />

    <div class="space"></div>

    <q-select v-if="dashboardPanelData.data.type != 'table'" outlined
      v-model="dashboardPanelData.data.config.legends_position" :options="legendsPositionOptions" dense
      label="Legends Positions" class="showLabelOnTop" stack-label emit-value
      :display-value="`${dashboardPanelData.data.config.legends_position ?? 'Auto'}`">
    </q-select>

    <div class="space"></div>

    <!-- <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promql_legend" label="Legend" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot> -->
      <div v-if="promqlMode"  class="q-py-md showLabelOnTop">Query
    <q-tabs v-model="dashboardPanelData.data.config.promql_legend" narrow-indicator dense>
      <q-tab no-caps v-for="(tab, index) in dashboardPanelData.data.queries" :key="index" :name="index"
        :label="'Query ' + (index + 1)">
      </q-tab>
    </q-tabs>
  </div>
    <!-- </q-input> -->
  </div>
   <div class="space"></div>

    <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promql_legend" label="Legend" color="input-border"
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
     <q-select v-if="promqlMode" outlined
        v-model="dashboardPanelData.data.config.unit" :options="unitOptions" dense
        label="Unit" class="showLabelOnTop" stack-label emit-value
        :display-value="`${dashboardPanelData.data.config.unit ? unitOptions.find(it => it.value == dashboardPanelData.data.config.unit)?.label : 'Default'}`">
      </q-select>
      <!-- :rules="[(val: any) => !!val || 'Field is required!']" -->
      <q-input v-if="promqlMode && dashboardPanelData.data.config.unit == 'custom'" v-model="dashboardPanelData.data.config.unit_custom" label="Custom unit" color="input-border"
        bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label filled dense label-slot/>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from '@/composables/useDashboardPanel';
import { defineComponent } from 'vue';

export default defineComponent({
  setup() {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData()
console.log(dashboardPanelData.data.config.promql_legend,"legend position");

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
    const unitOptions = [
      {
        label: 'Default',
        value: null
      },
      {
        label: 'Bytes',
        value: 'bytes'
      },
      {
        label: 'Bytes/Second',
        value: 'bps'
      },
      {
        label: 'Seconds (s)',
        value: 'seconds'
      },
        {
        label: 'Percent (0.0-1.0)',
        value: 'percent-1'
      },
      {
        label: 'Percent (0-100)',
        value: 'percent'
      },
      {
        label: 'Custom',
        value: 'custom'
      },
    ]
    return {
      dashboardPanelData,
      promqlMode,

      // legends position options
      legendsPositionOptions,
      unitOptions
    };
  }
});
</script>

<style scoped>
.space {
  margin-top: 10px;
  margin-bottom: 10px;
}
</style>
