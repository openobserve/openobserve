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

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="padding: 0px 10px; min-width: 30%" class="scroll o2-input">
    <div
      class="flex justify-between items-center q-pa-md"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span v-if="isEditMode">Edit Chip Column</span>
        <span v-else>Create Chip Column</span>
      </div>
    </div>
    <q-input
      v-model="chipColumnData.column_name"
      :label="t('dashboard.nameOfChipColumn') + ' * ' + ' : '"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      :rules="[
        (val: any) => !!val.trim() || t('dashboard.nameChipColumnRequired'),
      ]"
      :lazy-rules="true"
    />
    <q-select
      outlined
      v-model="chipColumnData.operator"
      :options="operatorOptions"
      dense
      :label="t('dashboard.when')"
      class="showLabelOnTop selectedLabel q-mb-md"
      stack-label
      emit-value
    ></q-select>
    <div>
      <div
        class="row q-col-gutter-md"
        v-for="(value, index) in chipColumnData.values"
        :key="value.key"
      >
        <div class="col-5">
          <q-input
            v-model="chipColumnData.values[index].property_value"
            :label="t('dashboard.propertyValue') + ' * '"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[
              (val: any) =>
                !!val.trim() || t('dashboard.propertyValueRequired'),
            ]"
            :lazy-rules="true"
          />
        </div>
        <div class="col-5">
          <q-select
            outlined
            v-model="chipColumnData.values[index].color"
            :options="colorOptions"
            dense
            :label="t('dashboard.colorOfChipColumn') + ' * '"
            class="showLabelOnTop selectedLabel q-mb-md"
            stack-label
            :rules="[
              (val: any) =>
                !!val.trim() || t('dashboard.colorChipColumnRequired'),
            ]"
            :lazy-rules="true"
            emit-value
          ></q-select>
        </div>
        <div class="col-2 q-mt-lg">
          <q-btn
            @click="removeChip(index)"
            style="cursor: pointer; padding: 0px 5px"
            label="Remove"
            no-caps
          />
        </div>
      </div>
      <q-btn
        @click="addChip()"
        style="cursor: pointer; padding: 0px 5px"
        label="+ Add chip"
        no-caps
      />
    </div>
    <q-card-actions class="confirmActions">
      <q-btn
        unelevated
        no-caps
        class="q-mr-sm"
        @click="$emit('close')"
        data-test="cancel-button"
      >
        {{ t("confirmDialog.cancel") }}
      </q-btn>
      <q-btn
        unelevated
        no-caps
        class="no-border"
        color="primary"
        @click="saveChipColumn"
        style="min-width: 60px"
        data-test="confirm-button"
        :disable="!isFormValid"
        :label="isEditMode ? 'Update' : 'Add'"
      />
    </q-card-actions>
  </div>
</template>

<script lang="ts">
import { computed, inject, ref } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";

export default defineComponent({
  name: "ChipColumnPopUp",
  props: {
    isEditMode: {
      type: Boolean,
      default: false,
    },
    chipColumnDataIndex: {
      type: Number,
      default: -1,
    },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const getDefaultChipColumnData = () => ({
      column_name: "",
      operator: "",
      values: [
        {
          property_value: null,
          color: null,
        },
      ],
    });

    const chipColumnData = ref<ReturnType<typeof getDefaultChipColumnData>>(
      props?.isEditMode
        ? JSON.parse(
            JSON.stringify(
              dashboardPanelData.data.config.chip_column[
                props?.chipColumnDataIndex
              ],
            ),
          )
        : getDefaultChipColumnData(),
    );

    const operatorOptions = [
      {
        label: t("dashboard.equals"),
        value: "equals",
      },
      {
        label: t("dashboard.contains"),
        value: "contains",
      },
    ];

    const colorOptions = [
      {
        label: "Green",
        value: "green",
      },
      {
        label: "Yellow",
        value: "yellow",
      },
      {
        label: "Orange",
        value: "orange",
      },
      {
        label: "Red",
        value: "red",
      },
      {
        label: "Blue",
        value: "blue",
      },
      {
        label: "Purple",
        value: "purple",
      },
    ];

    const addChip = () => {
      chipColumnData.value.values.push({
        property_value: null,
        color: null,
      });
    };

    const removeChip = (index: number) => {
      if (chipColumnData.value.values.length == 1)
        chipColumnData.value.values[0] = {
          property_value: "",
          color: "",
        };
      else chipColumnData.value.values.splice(index, 1);
    };

    const isFormValid = computed(() => {
      let isValid = true;
      if (!chipColumnData.value.column_name.trim()) {
        isValid = false;
      }
      if (!chipColumnData.value.operator) {
        isValid = false;
      }
      if (
        !chipColumnData.value.values.every(
          (x) =>
            x.color != null &&
            x.color != "" &&
            x.property_value != null &&
            x.property_value != "",
        )
      )
        isValid = false;
      return isValid;
    });

    const saveChipColumn = () => {
      if (props?.isEditMode) {
        dashboardPanelData.data.config.chip_column[props?.chipColumnDataIndex] =
          chipColumnData.value;
      } else {
        dashboardPanelData.data.config.chip_column.push(chipColumnData.value);
      }
      emit("close");
    };

    return {
      t,
      chipColumnData,
      operatorOptions,
      colorOptions,
      addChip,
      removeChip,
      isFormValid,
      saveChipColumn,
    };
  },
});
</script>
