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
  <div style="padding-left: 8px;">
  <!-- select field name -->
    <q-select
    v-model="override.matcher.options"
    label="Field with name"
    :options="overrideFieldOptions"
    class="q-my-sm"
    behavior="menu"
    filled
    emit-value
    />
    
    <!-- render each properties -->
    <div v-for="(properties, index) in override.properties" :key="index">
      <div class="flex justify-between">
        <DisplayName v-if="properties.id === 'displayName'" :override="properties"/>
        <q-btn @click="() => override.properties.splice(index, 1)" icon="close" style="padding: 1px; align-self: center;"/>
      </div>
    </div>
    
    <!-- add override properties -->
    <q-btn 
      v-if="(!isDropdownVisible) && override.matcher.options"
      @click="showDropdown" 
      label="+ add override properties"
      class="q-mb-md text-bold no-border"
      color="secondary"
      padding="sm xl"
      style="width: 100%;"
      no-caps
    />

    <!-- dropdown to select property from list -->
    <div v-if="isDropdownVisible">
      <q-select 
        v-model="selectedPropertyOption"
        @popup-hide="() => isDropdownVisible = false"
        :options="overridePropertyOptions"
        label="Select Property"
        class="q-my-md"
        behavior="menu"
        filled
      />
    </div>

  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';
import DisplayName from "@/components/dashboards/addPanel/overrideProperties/DisplayName.vue"
import useDashboardPanelData from '@/composables/useDashboardPanel';

export default defineComponent({
  name: "OverrideByFieldName",
  components: {
    DisplayName
  },
  props: {
    override:{
      type: Object,
      required: true
    }
  },
  setup(props) {
    const isDropdownVisible = ref(false);
    const selectedPropertyOption = ref(null);
    // list of properties
    const overridePropertyOptions = [{
      label: "Display Name",
      value: "displayName"
    }]
    // list of fields (which is equal to length of query)
    const overrideFieldOptions = computed(() => {
      const queryLength = useDashboardPanelData().dashboardPanelData?.data?.queries?.length ?? 1;
      const optionsArr = [];
      for(let i = 0; i < queryLength; i++) {
        optionsArr.push({
          label: `Query ${i + 1}`,
          value: `query ${i + 1}`
        })
      }
      return optionsArr;
    })

    const showDropdown = () => {
      selectedPropertyOption.value = null;
      isDropdownVisible.value = true;
    };

    // value will be an object with label and value
    watch(selectedPropertyOption, (value: any) => {
      // if value is selected then push properties in override array
      if (value) {
        // add the property to the override
        props.override.properties.push({
          id: value.value,
          value: ""
        })
      }
    })


    return {
      isDropdownVisible,
      showDropdown,
      overrideFieldOptions,
      selectedPropertyOption,
      overridePropertyOptions
    };
  }
})
</script>
