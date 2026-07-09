<!-- Copyright 2026 OpenObserve Inc.

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
  <div
    data-test="dashboard-build-field-popup-container"
    style="padding: 3px 16px 16px 16px; display: flex; gap: 16px"
  >
    <div data-test="dashboard-build-field-popup-left-section">
      <OForm
        id="dashboard-build-field-popup-form"
        ref="buildFieldFormRef"
        :schema="buildFieldPopUpSchema"
        :default-values="buildFieldPopUpDefaults"
      >
        <OFormInput
          data-test="dashboard-x-item-input"
          name="label"
          :label="t('common.label')"
          required
        />
      </OForm>
      <div v-if="!customQuery && modelValue.isDerived">
        <SortByBtnGrp :fieldObj="modelValue" />
      </div>
    </div>
    <div data-test="dashboard-build-field-popup-right-section">
      <div v-if="!customQuery && !modelValue.isDerived" class="mr-1 mb-2">
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
import { computed, defineComponent, ref, watch } from "vue";

import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import { useI18n } from "vue-i18n";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import {
  makeBuildFieldPopUpSchema,
  type BuildFieldPopUpForm,
} from "./BuildFieldPopUp.schema";

export default defineComponent({
  name: "BuildFieldPopUp",
  components: {
    SortByBtnGrp,
    DynamicFunctionPopUp,
    OForm,
    OFormInput,
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
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const buildFieldFormRef: any = ref(null);
    const buildFieldPopUpSchema = makeBuildFieldPopUpSchema(t);

    // The form owns `label`; seed it from the incoming modelValue (read once at
    // mount — this is a plain fragment, not a remounting overlay).
    const buildFieldPopUpDefaults = computed(
      (): BuildFieldPopUpForm => ({
        label: props.modelValue?.label ?? "",
      }),
    );

    // Sync the form-owned `label` OUT to the parent via `update:modelValue` so the
    // existing contract (parent reads modelValue.label) is preserved WITHOUT
    // mutating the prop. This is a form → parent value handoff over the v-model
    // event (the same direction the old v-model wrote); the parent binds this
    // component with v-model, so the emitted value flows back down as modelValue.
    let stopLabelWatch: (() => void) | null = null;
    watch(
      () => buildFieldFormRef.value,
      (formRef: any) => {
        stopLabelWatch?.();
        stopLabelWatch = null;
        if (formRef?.form) {
          const labelStore = formRef.form.useStore(
            (s: any) => s.values?.label,
          );
          stopLabelWatch = watch(
            labelStore,
            (v: any) => {
              const next = v ?? "";
              // Skip when it already matches modelValue.label so we don't emit a
              // redundant NEW object — e.g. the immediate flush on (re)subscription
              // when the form value still equals the incoming prop. That matters
              // because the parent's v-model target lives inside a deeply-watched
              // panel state, and a same-content-new-reference emit would needlessly
              // mark it dirty.
              if (props.modelValue?.label === next) return;
              emit("update:modelValue", {
                ...(props.modelValue ?? {}),
                label: next,
              });
            },
            // immediate so the current form value is flushed out as soon as the
            // subscription is (re)established — covers the case where a change
            // lands before the post-mount subscription runs (the guard above makes
            // the common "unchanged" case a no-op).
            { immediate: true },
          );
        }
      },
      { immediate: true },
    );

    return {
      t,
      emit,
      buildFieldFormRef,
      buildFieldPopUpSchema,
      buildFieldPopUpDefaults,
    };
  },
});
</script>
