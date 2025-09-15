<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div style="padding: 3px 16px 16px 16px; display: flex; gap: 16px">
    <div>
      <q-input
        dense
        filled
        data-test="dashboard-x-item-input"
        :label="t('common.label')"
        v-model="modelValue.label"
        :rules="[(val: any) => val.length > 0 || 'Required']"
      />
      <div v-if="!customQuery && modelValue.isDerived">
        <SortByBtnGrp :fieldObj="modelValue" />
      </div>
    </div>
    <div>
      <div v-if="!customQuery && !modelValue.isDerived" class="q-mr-xs q-mb-sm">
        <DynamicFunctionPopUp
          :modelValue="modelValue"
          @update:modelValue="(newValue) => emit('update:modelValue', newValue)"
          :allowAggregation="false"
          :chartType="chartType"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject } from "vue";

import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "BuildFieldPopUp",
  components: {
    SortByBtnGrp,
    DynamicFunctionPopUp,
  },
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
    customQuery: {
      type: Boolean,
      default: false,
    },
    chartType: {
      type: String,
      default: "bar",
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();

    return {
      t,
      emit,
    };
  },
});
</script>

<style lang="scss" scoped></style>