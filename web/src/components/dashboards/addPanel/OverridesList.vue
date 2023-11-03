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
    <!-- render each override -->
    <div v-for="(override, index) in overridesArray" :key="index">
      <div class="flex justify-between">
        <div style="font-weight: 700; align-self: center;">Override {{ index + 1 }}</div>
        <q-btn @click="() => overridesArray.splice(index, 1)" icon="delete" style="padding: 1px;"/>
      </div>
      <!-- each override can contain multiple properties -->
      <OverrideByFieldName v-if="override.matcher.id == 'byName'" :override="override"/>
    </div>

    <!-- add field override -->
    <q-btn 
      v-if="!isDropdownVisible"
      @click="showDropdown" 
      label="+ add field override"
      class="q-mb-md text-bold no-border"
      color="secondary"
      padding="sm xl"
      style="width: 100%;"
      no-caps
    />

    <!-- dropdown to select the override type (like by field name, by field value, by field regex) -->
    <div v-if="isDropdownVisible">
      <q-select 
        v-model="selectedOption"
        @popup-hide="() => isDropdownVisible = false"
        :options="overrideOptions"
        label="Add field override"
        class="q-my-md"
        behavior="menu"
        filled
      />
    </div>

  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue';
import OverrideByFieldName from './OverrideByFieldName.vue';
import useDashboardPanelData from '@/composables/useDashboardPanel';

export default defineComponent({
  name: "OverridesList",
  components:{
    OverrideByFieldName
  },
  setup() {
    // dropdown visibility for override type selection
    const isDropdownVisible = ref(false);
    const selectedOption = ref(null);

    // dropdown options visibility
    const overrideOptions = [{
      label: "By filed name",
      value: "byName"
    }]
    const { dashboardPanelData } = useDashboardPanelData();
    
    // check if overrides are present else use empty array
    dashboardPanelData.data.config.overrides = dashboardPanelData.data.config.overrides ?? [];
    const overridesArray: any = ref(dashboardPanelData.data.config.overrides);

    const showDropdown = () => {
      selectedOption.value = null;
      isDropdownVisible.value = true;
    };

    // value will be an object with label and value
    watch(selectedOption, (value: any) => {      
      // if value is selected then push matcher in override array
      if (value) {
        overridesArray.value.push({
          matcher: {
            id: value.value
          },
          properties:[]
        })
      }
    })

    watch(dashboardPanelData, () => {
      console.log(dashboardPanelData, "dashboardPanelData");
    }, {deep: true})

    return {
      isDropdownVisible,
      selectedOption,
      showDropdown,
      overrideOptions,
      overridesArray
    };
  }
})
</script>
