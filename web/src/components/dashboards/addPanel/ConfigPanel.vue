<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div>
    <q-toggle v-if="dashboardPanelData.data.type != 'table' && dashboardPanelData.data.type != 'heatmap'" v-model="dashboardPanelData.data.config.show_legends"
      label="Show Legends" />

    <div class="space"></div>

    <q-select v-if="dashboardPanelData.data.type != 'table' && dashboardPanelData.data.type != 'heatmap'" outlined
      v-model="dashboardPanelData.data.config.legends_position" :options="legendsPositionOptions" dense
      label="Legends Positions" class="showLabelOnTop" stack-label emit-value
      :display-value="`${dashboardPanelData.data.config.legends_position ?? 'Auto'}`">
    </q-select>

    <div class="space"></div>

    <q-select outlined v-model="dashboardPanelData.data.config.unit" :options="unitOptions" dense label="Unit"
      class="showLabelOnTop selectedLabel" stack-label emit-value
      :display-value="`${dashboardPanelData.data.config.unit ? unitOptions.find(it => it.value == dashboardPanelData.data.config.unit)?.label : 'Default'}`">
    </q-select>
    <!-- :rules="[(val: any) => !!val || 'Field is required!']" -->
    <q-input v-if="dashboardPanelData.data.config.unit == 'custom'" v-model="dashboardPanelData.data.config.unit_custom" label="Custom unit" color="input-border"
    bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label filled dense label-slot/>

    <div class="space"></div>

    <q-select v-if="dashboardPanelData.data.type == 'geomap'" outlined
        v-model="dashboardPanelData.data.config.base_map.type" :options="basemapTypeOptions" dense
        label="Base Map" class="showLabelOnTop" stack-label emit-value
        :display-value="'OpenStreetMap'">
      </q-select>

      <div class="space"></div>
      <div v-if="dashboardPanelData.data.type == 'geomap'">
        <span>Initial View:</span>
        <div class="row">
          <q-input  v-model.number="dashboardPanelData.data.config.map_view.lat" label="Latitude" color="input-border"
            bg-color="input-bg" class="col-6 q-py-md showLabelOnTop" stack-label outlined filled dense label-slot :type="'number'">
          </q-input>
          <q-input v-model.number="dashboardPanelData.data.config.map_view.lng" label="Longitude" color="input-border"
            bg-color="input-bg" class="col-6 q-py-md showLabelOnTop" stack-label outlined filled dense label-slot :type="'number'">
          </q-input>
        </div>
        <q-input v-model.number="dashboardPanelData.data.config.map_view.zoom" label="Zoom" color="input-border"
            bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot :type="'number'">
          </q-input>
      </div>
          
    <div class="space"></div>

    <!-- <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promql_legend" label="Legend" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot> -->
      <div v-if="promqlMode || dashboardPanelData.data.type == 'geomap'"  class="q-py-md showLabelOnTop">Query
    <q-tabs v-model="dashboardPanelData.layout.currentQueryIndex" narrow-indicator dense inline-label outside-arrows mobile-arrows>
      <q-tab no-caps v-for="(tab, index) in dashboardPanelData.data.queries" :key="index" :name="index"
        :label="'Query ' + (index + 1)">
      </q-tab>
    </q-tabs>
  </div>
    <!-- </q-input> -->
   <div class="space"></div>

    <q-input v-if="promqlMode" v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.promql_legend" label="Legend" color="input-border"
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

    <div class="space"></div>

    <q-select v-if="dashboardPanelData.data.type == 'geomap'" outlined
      v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.layer_type" :options="layerTypeOptions" dense
      label="Layer Type" class="showLabelOnTop" stack-label emit-value
      :display-value="`${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.layer_type}`">
    </q-select>

    <div class="space"></div>

   <q-input v-if="dashboardPanelData.data.type == 'geomap' && !isWeightFieldPresent" v-model.number="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.weight_fixed" label="Weight" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot :type="'number'">
    </q-input>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from '@/composables/useDashboardPanel';
import { computed, defineComponent, watch } from 'vue';

export default defineComponent({
  setup() {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData()

    const basemapTypeOptions = [
      {
        label: 'OpenStreetMap',
        value: 'osm'
      }
    ]

    const layerTypeOptions = [
      {
        label: 'Scatter',
        value: 'scatter'
      },
      {
        label: 'Heatmap',
        value: 'heatmap'
      }
    ]
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
        label: 'Microseconds (μs)',
        value: 'microseconds'
      },
      {
        label: 'Milliseconds (ms)',
        value: 'milliseconds'
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
    const isWeightFieldPresent = computed(() => {
      const layoutFields = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields; 
      return !!layoutFields?.weight;
    });
    return {
      dashboardPanelData,
      promqlMode,
      basemapTypeOptions,
      layerTypeOptions,
      legendsPositionOptions,
      unitOptions,
      isWeightFieldPresent
    };
  }
});
</script>

<style lang="scss" scoped>
:deep(.selectedLabel span) {
  text-transform: none !important;
}

.space {
  margin-top: 10px;
  margin-bottom: 10px;
}
</style>
