<template>
  <div class="relative">
    <q-input
      dense
      filled
      v-if="!['Is Null', 'Is Not Null'].includes(field?.operator)"
      v-model="field.value"
      :label="t('common.value')"
      style="width: 100%; margin-top: 5px"
      :rules="[(val) => val?.length > 0 || 'Required']"
      @update:model-value="fieldsFilterFn"
      @focus="showOptions = true"
      @blur="hideOptionsWithDelay"
    />
    <div
      class="options-container"
      v-if="showOptions && fieldsFilteredOptions.length > 0"
      :style="{
        'background-color': store.state.theme === 'dark' ? '#2d2d2d' : 'white',
      }"
    >
      <div
        v-for="(option, index) in fieldsFilteredOptions"
        :key="index"
        class="option"
        @click="selectOption(option, field)"
      >
        {{ option }}
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed, toRef, defineComponent } from "vue";
import { useAutoCompleteForPromql } from "@/composables/useAutoCompleteForPromql";
import { useStore } from "vuex";
import { getDashboard } from "../../../utils/commons";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "CommonAutoComplete",
  props: {
    field: Object,
    index: Number,
  },
  setup(props) {
    const store = useStore();
    const showOptions = ref(false);
    const { t } = useI18n();
    let hideOptionsTimeout;

    const route = useRoute();
    const dashboardVariablesList = ref([]);

    onMounted(async () => {
      await getDashboardData();
    });

    const getDashboardData = async () => {
      const data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      );
      dashboardVariablesList.value = (data?.variables?.list ?? []).map(
        (it) => it.name
      );
    };

    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useAutoCompleteForPromql(toRef(dashboardVariablesList), "name");

    const hideOptionsWithDelay = () => {
      clearTimeout(hideOptionsTimeout);
      hideOptionsTimeout = setTimeout(() => {
        showOptions.value = false;
      }, 200);
    };

    const selectOption = (option, field) => {
      const newValue = "'" + "$" + option + "'";
      field.value = newValue;
      showOptions.value = false;
    };

    return {
      showOptions,
      fieldsFilterFn,
      fieldsFilteredOptions,
      hideOptionsWithDelay,
      selectOption,
      store,
      t
    };
  },
});
</script>

<style scoped>
.options-container {
  z-index: 10;
  position: absolute;
  left: 0;
  right: 0;
  border: 1px solid #ccc;
  max-height: 100px;
  overflow-y: auto;
  top: 42px;
}

.relative {
  position: relative;
  width: 100%;
}

.option {
  padding: 8px;
  cursor: pointer;
}

.option:hover {
  background-color: #f0f0f0b1;
}
</style>
