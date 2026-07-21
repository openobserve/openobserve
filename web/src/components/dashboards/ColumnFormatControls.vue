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
    class="divide-y divide-[color-mix(in_srgb,var(--color-grey-500)_8%,transparent)]"
  >
    <!-- Field type -->
    <div class="px-3 py-2">
      <div class="o-input-label text-compact font-medium leading-tight text-input-label-text block mb-1.5">
        {{ t("dashboard.sectionFieldType") }}
      </div>
      <OToggleGroup
        class="cf-seg h-8"
        type="single"
        v-model="col.fieldType"
      >
        <OToggleGroupItem
          v-for="ft in fieldTypeOptions"
          :key="ft.value"
          :value="ft.value"
          size="sm"
          :data-test="`o2-format-field-type-${ft.value}-${col.field}`"
        >
          {{ ft.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Value formatting (numeric only) -->
    <div v-if="isNumeric" class="px-3 py-2">
      <div class="o-input-label text-compact font-medium leading-tight text-input-label-text block mb-1.5">
        {{ t("dashboard.sectionValueFormatting") }}
      </div>
      <OSelect
        v-model="col.unit"
        :options="unitOptions"
        class="w-full max-w-[22.5rem]"
        :data-test="`o2-format-unit-${col.field}`"
      />
      <OInput
        v-if="col.unit === 'custom'"
        v-model="col.customUnit"
        :label="t('dashboard.customunitLabel')"
        class="w-full max-w-[22.5rem] mt-2"
        :data-test="`o2-format-custom-unit-${col.field}`"
      />
    </div>

    <!-- Alignment -->
    <div class="px-3 py-2">
      <div class="o-input-label text-compact font-medium leading-tight text-input-label-text block mb-1.5">
        {{ t("dashboard.sectionAlignment") }}
      </div>
      <OToggleGroup
        class="cf-seg h-8"
        type="single"
        v-model="alignmentModel"
      >
        <OToggleGroupItem
          v-for="a in alignOptions"
          :key="a.value"
          :value="a.value"
          size="sm"
        >
          {{ a.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>


    <!-- Styling -->
    <div class="px-3 py-2">
      <div class="o-input-label text-compact font-medium leading-tight text-input-label-text block mb-1.5">{{ t("dashboard.sectionStyling") }}</div>
      <div class="flex items-center gap-2 mt-2 flex-wrap">
        <span class="o-input-label text-compact font-medium leading-tight text-input-label-text shrink-0 w-24">{{ t("dashboard.textColor") }}</span>
        <ColorSwatchPicker
          v-model="col.textColor"
          :swatches="TEXT_SWATCHES"
          :data-test="`o2-format-text-color-${col.field}`"
        />
      </div>
      <div class="flex items-center gap-2 mt-2 flex-wrap">
        <span class="o-input-label text-compact font-medium leading-tight text-input-label-text shrink-0 w-24">{{ t("dashboard.bgColor") }}</span>
        <ColorSwatchPicker
          v-model="col.bgColor"
          :swatches="BG_SWATCHES"
          :data-test="`o2-format-bg-color-${col.field}`"
        />
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 py-1.5 px-2.5 mt-3 rounded-default border cursor-pointer text-left transition-colors hover:border-primary-600"
        :class="
          col.autoColor
            ? 'border-primary-600 bg-[color-mix(in_srgb,var(--color-primary-600)_7%,transparent)]'
            : 'border-[color-mix(in_srgb,var(--color-grey-500)_28%,transparent)] bg-transparent'
        "
        :data-test="`o2-format-unique-color-${col.field}`"
        @click="col.autoColor = !col.autoColor"
      >
        <OCheckbox :model-value="col.autoColor" size="sm" class="pointer-events-none" />
        <span class="o-input-label text-compact font-medium leading-tight text-input-label-text cursor-pointer">{{
          t("dashboard.overrideConfigUniqueValueColor")
        }}</span>
      </button>
    </div>

    <!-- Conditional (numeric only) -->
    <div v-if="isNumeric" class="px-3 py-2">
      <div class="o-input-label text-compact font-medium leading-tight text-input-label-text block mb-1.5">
        {{ t("dashboard.sectionConditionalStyling") }}
      </div>
      <div
        v-if="!col.conditions.length"
        class="text-compact text-text-secondary mb-1.5"
      >
        {{ t("dashboard.conditionNoRules") }}
      </div>
      <div
        v-for="(rule, ruleIdx) in col.conditions"
        :key="ruleIdx"
        class="flex flex-col gap-2 py-2 px-2.5 mb-1.5 rounded-default bg-[color-mix(in_srgb,var(--color-grey-500)_4%,transparent)] border border-[color-mix(in_srgb,var(--color-grey-500)_10%,transparent)]"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <span class="o-input-label text-compact font-medium leading-tight text-input-label-text shrink-0 w-28">{{ t("dashboard.conditionIfValue") }}</span>
          <div class="w-52 shrink-0">
            <OSelect
              v-model="rule.operator"
              :options="conditionOperators"
              class="w-full"
            />
          </div>
          <div class="w-28 shrink-0">
            <OInput
              v-model="rule.threshold"
              type="number"
              :placeholder="t('dashboard.conditionThreshold')"
              class="w-full"
              :data-test="`o2-format-cond-threshold-${col.field}-${ruleIdx}`"
            />
          </div>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="close"
            :title="t('common.remove')"
            class="shrink-0 ml-auto"
            @click="col.conditions.splice(ruleIdx, 1)"
          />
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="o-input-label text-compact font-medium leading-tight text-input-label-text shrink-0 w-28">{{ t("dashboard.conditionThenText") }}</span>
          <ColorSwatchPicker
            v-model="rule.textColor"
            :swatches="TEXT_SWATCHES"
            :data-test="`o2-format-cond-text-${col.field}-${ruleIdx}`"
          />
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="o-input-label text-compact font-medium leading-tight text-input-label-text shrink-0 w-28">{{ t("dashboard.conditionAndBg") }}</span>
          <ColorSwatchPicker
            v-model="rule.bgColor"
            :swatches="BG_SWATCHES"
            :data-test="`o2-format-cond-bg-${col.field}-${ruleIdx}`"
          />
        </div>
      </div>
      <OButton
        variant="outline"
        size="sm"
        class="mt-1"
        :data-test="`o2-format-add-rule-${col.field}`"
        @click="col.conditions.push(emptyConditionalRule())"
      >
        {{ t("dashboard.conditionAddRule") }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ColorSwatchPicker from "./ColorSwatchPicker.vue";
import {
  type ColumnOverrideUI,
  emptyConditionalRule,
  useColumnFormattingOptions,
  TEXT_SWATCHES,
  BG_SWATCHES,
} from "@/composables/dashboard/useColumnFormatting";

export default defineComponent({
  name: "ColumnFormatControls",
  components: {
    OButton,
    OSelect,
    OInput,
    OCheckbox,
    OToggleGroup,
    OToggleGroupItem,
    ColorSwatchPicker,
  },
  props: {
    col: { type: Object as PropType<ColumnOverrideUI>, required: true },
    isNumeric: { type: Boolean, default: false },
  },
  setup(props) {
    const { t } = useI18n();
    const { unitOptions, fieldTypeOptions, alignOptions, conditionOperators } =
      useColumnFormattingOptions();

    // Explicit "Auto" replaces tap-to-clear: null ⇄ the "auto" sentinel item.
    const alignmentModel = computed({
      get: () => props.col.alignment ?? "auto",
      set: (v: string) => {
        props.col.alignment = v === "auto" ? null : v;
      },
    });

    return {
      t,
      unitOptions,
      fieldTypeOptions,
      alignOptions,
      alignmentModel,
      conditionOperators,
      TEXT_SWATCHES,
      BG_SWATCHES,
      emptyConditionalRule,
    };
  },
});
</script>

<style lang="scss" scoped>
/* keep(lib-override:o2-toggle-group): OToggleGroup renders its own <button>
   children, so their intrinsic min-height can only be reset from the parent via
   :deep() — no utility on this component can reach that generated element. */
.cf-seg :deep(button) {
  height: 100% !important;
  min-height: 0 !important;
}
</style>
