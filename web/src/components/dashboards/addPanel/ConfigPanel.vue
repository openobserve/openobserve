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
        :display-value="`${dashboardPanelData.data.config.unit ?? 'Default'}`">
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
        label: 'Seconds (s)',
        value: 'seconds'
      },
      {
        label: 'Bytes/Second',
        value: 'bps'
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
