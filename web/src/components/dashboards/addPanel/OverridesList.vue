<template>
  <div>
    <div v-for="(override, index) in overridesArray" :key="index">
      <div class="flex justify-between">
        <div style="font-weight: 700; align-self: center;">Override {{ index + 1 }}</div>
        <q-btn @click="() => overridesArray.splice(index, 1)" icon="delete" style="padding: 1px;"/>
      </div>
      <OverrideByFieldName v-if="override.matcher.id == 'byName'" :override="override"/>
    </div>
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
    const isDropdownVisible = ref(false);
    const selectedOption = ref(null);
    const overrideOptions = [{
      label: "By filed name",
      value: "byName"
    }]
    const { dashboardPanelData } = useDashboardPanelData();
    const overridesArray: any = ref(dashboardPanelData.data.overrides);

    const showDropdown = () => {
      selectedOption.value = null;
      isDropdownVisible.value = true;
    };

    // value will be an object with label and value
    watch(selectedOption, (value: any) => {      
      if (value) {
        overridesArray.value.push({
          matcher: {
            id: value.value
          },
          properties:[]
        })
      }
    })

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
