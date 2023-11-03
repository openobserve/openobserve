<template>
  <div style="padding-left: 8px;">
    <q-select
    v-model="override.matcher.options"
    label="Field with name"
    :options="overrideFieldOptions"
    class="q-my-sm"
    behavior="menu"
    filled
    emit-value
    />
    
    <div v-for="(properties, index) in override.properties" :key="index">
      <div class="flex justify-between">
        <DisplayName v-if="properties.id === 'displayName'" :override="properties"/>
        <q-btn @click="() => override.properties.splice(index, 1)" icon="close" style="padding: 1px; align-self: center;"/>
      </div>
    </div>
    
    <q-btn 
      v-if="(!isDropdownVisible) && override.matcher.value"
      @click="showDropdown" 
      label="+ add override properties"
      class="q-mb-md text-bold no-border"
      color="secondary"
      padding="sm xl"
      style="width: 100%;"
      no-caps
    />

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
    const overridePropertyOptions = [{
      label: "Display Name",
      value: "displayName"
    }]
    const overrideFieldOptions = computed(() => {
      const queryLength = useDashboardPanelData().dashboardPanelData.data.query.length;
      const optionsArr = [];
      for(let i = 0; i < queryLength; i++) {
        optionsArr.push({
          label: `Query ${i + 1}`,
          value: `query ${i + 1}`
        })
      }
    })

    const showDropdown = () => {
      selectedPropertyOption.value = null;
      isDropdownVisible.value = true;
    };

    // value will be an object with label and value
    watch(selectedPropertyOption, (value: any) => {      
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
