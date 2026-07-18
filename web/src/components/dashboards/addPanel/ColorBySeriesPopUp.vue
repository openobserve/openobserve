<!-- Copyright 2026 OpenObserve Inc.

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
<!--
  OForm migration: the whole form is the dynamic `series[]` array, a FORM-OWNED
  field-array. This component OWNS <OForm>, so it creates the form with useOForm
  and reads `series` reactively via form.useStore (rule ③: one source, no mirror)
  to render the draggable v-for. Each row's `value` is an OFormCombobox and
  `color` an OFormColor, both with indexed names (`series[i].value/color`); rows
  are added/removed/reordered through form.pushFieldValue / removeFieldValue /
  setFieldValue. The per-row Zod rules (non-empty value + non-null color) gate
  submit — replacing the old `isFormValid` Save-disabled gate (R3). Save submits
  via `form-id` (R4); the save handler is baked into useOForm({ onSubmit }).
-->
<template>
  <ODialog data-test="color-by-series-popup-dialog"
    :open="open"
    @update:open="(v) => { if (!v) cancelEdit(); }"
    :title="t('dashboard.colorBySeriesPopUp.title')"
    size="lg"
    :neutral-button-label="t('dashboard.colorBySeriesPopUp.addNewColor')"
    neutral-button-variant="outline"
    :primary-button-label="t('dashboard.colorBySeriesPopUp.save')"
    form-id="color-by-series-form"
    @click:neutral="addcolorBySeries"
  >
    <OForm id="color-by-series-form" :form="form">
    <div data-test="dashboard-color-by-series-popup">
      <draggable
        :model-value="editColorBySeries"
        @update:model-value="onReorder"
        :options="dragOptions"
        @mousedown.stop="() => {}"
        data-test="dashboard-addpanel-config-color-by-series-drag"
      >
        <div
          v-for="(series, index) in editColorBySeries"
          :key="index"
          class="flex items-center justify-between mb-2"
        >
          <div class="cursor-move p-2 self-center">
            <OIcon
              name="drag-indicator" size="sm"
              class="mr-1"
              :data-test="`dashboard-addpanel-config-color-by-series-drag-handle-${index}`"
            />
          </div>
          <div class="flex items-center justify-between flex-1 gap-x-3">
            <div class="flex-1 min-w-0">
              <OFormCombobox
                :name="`series[${index}].value`"
                :items="seriesDataItems"
                search-regex="(?:{([^}])(?:{.})*$|([a-zA-Z-_]+)$)"
                :label="t('dashboard.colorBySeriesPopUp.selectSeries')"
                label-position="inside"
                required
                :value-replace-fn="selectColorBySeriesOption"
                :data-test="`dashboard-addpanel-config-color-by-series-series-select-${index}`"
              />
            </div>

            <!-- Color Picker -->
            <div
              class="flex items-center shrink-0"
              :data-test="`dashboard-addpanel-config-color-by-series-color-section-${index}`"
            >
              <div
                v-if="series.color !== null"
                class="items-center flex gap-1"
              >
                <OFormColor
                  :name="`series[${index}].color`"
                  class="flex-1"
                  clearable
                  @clear="removeColorByIndex(index)"
                />
              </div>
              <div v-else class="w-full">
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  class="w-full"
                  :data-test="`dashboard-addpanel-config-color-by-series-set-color-btn-${index}`"
                  @click="setColorByIndex(index)"
                  >{{ t('dashboard.colorBySeriesPopUp.setColor') }}</OButton
                >
              </div>
            </div>

              <!-- Delete series -->
              <OButton
                variant="ghost"
                size="icon"
                @click="removecolorBySeriesByIndex(index)"
                :data-test="`dashboard-addpanel-config-color-by-series-delete-btn-${index}`"
              >
                <template #icon-left><OIcon name="close" size="sm" /></template>
              </OButton>
            </div>
          </div>
        </draggable>
    </div>
    </OForm>
  </ODialog>
</template>
<script lang="ts">
import { computed, ref, nextTick } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { onMounted } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormColor from "@/lib/forms/Color/OFormColor.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeColorBySeriesPopUpSchema,
  type ColorBySeriesPopUpForm,
} from "./ColorBySeriesPopUp.schema";

export default defineComponent({
  name: "colorBySeriesPopUp",
  components: {
    draggable: VueDraggableNext as any,
    OButton,
    ODialog,
    OForm,
    OFormColor,
    OFormCombobox,
    OIcon,
},
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    colorBySeries: {
      type: Array,
      default: () => [],
    },
    seriesOptions: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18n();

    // The whole form is the `series[]` field-array — the FORM is the SOLE source
    // (rule ②). This component OWNS <OForm> and needs to read `series` to render
    // the draggable v-for, so it creates the form here with useOForm and reads it
    // reactively via form.useStore — ONE source of truth, no mirror (rule ③).
    const makeDefaultRows = () =>
      props.colorBySeries?.length
        ? JSON.parse(JSON.stringify(props.colorBySeries))
        : [{ type: "value", value: "", color: null }];

    // onSubmit (baked into useOForm) fires only when the schema passes (every row
    // has a non-empty value + a non-null color). The validated value carries the
    // row order from the drag. Save submits via form-id (R4) → handleSubmit.
    const form = useOForm<ColorBySeriesPopUpForm>({
      defaultValues: { series: makeDefaultRows() },
      schema: makeColorBySeriesPopUpSchema(t),
      onSubmit: (value) => {
        emit("save", value.series);
      },
    });

    // Reactive READ of the form's `series` array (rule ③: form.useStore, NOT a
    // local copy) — drives the draggable + v-for.
    const editColorBySeries = form.useStore((s: any) => s.values?.series ?? []);

    // Re-seed the form on open (the overlay may keep the body mounted).
    watch(
      () => props.open,
      async (isOpen) => {
        if (!isOpen) return;
        await nextTick();
        form.reset({ series: makeDefaultRows() });
      },
    );

    const dragOptions = ref({
      animation: 200,
    });

    // Structural mutations go through the form (the single source).
    const addcolorBySeries = () => {
      form.pushFieldValue("series", {
        type: "value",
        value: "",
        color: null,
      });
    };

    // Use props.options for series dropdown options (not for initialization)
    const seriesDataItems = computed(
      () =>
        props?.seriesOptions
          ?.map((it: any) => ({
            label: it?.name,
            value: it?.name,
          }))
          .filter((item: any) => item.label !== undefined) || [],
    );

    const selectColorBySeriesOption = (seriesOptions: any) => {
      return seriesOptions.value || seriesOptions.label || seriesOptions;
    };

    const removecolorBySeriesByIndex = (index: number) => {
      form.removeFieldValue("series", index);
    };

    // Draggable reorder → write the new order back to the form.
    const onReorder = (newOrder: any[]) => {
      form.setFieldValue("series", newOrder);
    };

    onMounted(() => {
      if ((form.getFieldValue("series") ?? []).length === 0) {
        addcolorBySeries();
      }
    });

    const setColorByIndex = (index: number) => {
      form.setFieldValue(`series[${index}].color`, "#5960b2");
    };

    const removeColorByIndex = (index: number) => {
      form.setFieldValue(`series[${index}].color`, null);
    };

    const cancelEdit = () => {
      // Reset to last saved state so unsaved edits are discarded
      form.reset({ series: makeDefaultRows() });
      emit("close");
    };

    // Method to open color picker directly
    const openColorPicker = (index: number) => {
      // This method is called when the colorize icon is clicked
      // The color picker should open automatically due to q-popup-proxy
    };

    return {
      t,
      form,
      addcolorBySeries,
      removecolorBySeriesByIndex,
      onReorder,
      dragOptions,
      setColorByIndex,
      removeColorByIndex,
      cancelEdit,
      editColorBySeries,
      "cancel": "cancel",
      seriesDataItems,
      openColorPicker,
      selectColorBySeriesOption,
    };
  },
});
</script>
