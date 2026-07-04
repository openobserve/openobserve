<template>
  <ODialog data-test="filter-creator-popup-dialog" v-model:open="show" size="sm" :title="fieldName"
    form-id="filter-creator-popup-form"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('common.apply')"
    @click:secondary="show = false"
  >
    <OForm
      id="filter-creator-popup-form"
      :schema="filterCreatorPopupSchema"
      :default-values="filterCreatorDefaults"
      @submit="applyFilter"
    >
      <div class="tw:p-3 tw:w-50 tw:overflow-hidden">
        <OCardSection class="tw:p-0">
          <OFormSelect
            name="selectedOperator"
            data-test="filter-creator-popup-operator-select"
            :options="operators"
            :label="t('filter.operator')"
            required
            class="tw:py-2"
          />
        </OCardSection>
        <OCardSection class="tw:p-0">
          <div class="tw:font-bold tw:pb-1 tw:pt-2">Values</div>
          <div class="tw:max-h-37.5 tw:overflow-auto">
            <div v-show="!fieldValues?.length">No values present</div>
            <OFormCheckboxGroup name="selectedValues">
              <ul class="tw:flex tw:flex-col tw:m-0 tw:p-0 tw:list-none">
                <li v-for="value in fieldValues" :key="value">
                  <label
                    :data-test="`filter-creator-popup-value-${value}`"
                    class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:cursor-pointer tw:hover:bg-muted/50"
                  >
                    <OCheckbox
                      :value="value"
                      class="tw:shrink-0"
                    />
                    <span class="tw:text-sm tw:flex-1 tw:min-w-0 tw:truncate">{{ value }}</span>
                  </label>
                </li>
              </ul>
            </OFormCheckboxGroup>
          </div>
        </OCardSection>
      </div>
    </OForm>
  </ODialog>
</template>

<script lang="ts">
// Define setup function
import { computed, defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCheckboxGroup from "@/lib/forms/Checkbox/OFormCheckboxGroup.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import {
  filterCreatorPopupSchema,
  type FilterCreatorPopupForm,
} from "./FilterCreatorPopup.schema";
export default defineComponent({
  name: "FilterCreatorPopup",
  components: {
    ODialog,
    OForm,
    OFormSelect,
    OFormCheckboxGroup,
    OCheckbox,
    OCardSection,
  },
  props: [
    "fieldName",
    "fieldValues",
    "operators",
    "defaultOperator",
    "defaultValues",
  ],
  setup(props, { emit }) {
    const show = ref(true);
    const { t } = useI18n();

    // Dynamic defaults (seeded from props) → a typed component computed, not a
    // factory in the schema file. selectedValues must always be an array so the
    // OFormCheckboxGroup binds correctly even when defaultValues is absent.
    const filterCreatorDefaults = computed((): FilterCreatorPopupForm => ({
      selectedOperator: props.defaultOperator ?? "",
      selectedValues: Array.isArray(props.defaultValues)
        ? props.defaultValues
        : [],
    }));

    interface Filter {
      fieldName: string;
      selectedValues: string[];
      selectedOperator: string;
    }

    // @submit fires only once the schema passes (selectedOperator required), so
    // there is no imperative required-guard here anymore.
    const applyFilter = (value: FilterCreatorPopupForm) => {
      emit("apply", {
        fieldName: props.fieldName,
        selectedValues: value.selectedValues,
        selectedOperator: value.selectedOperator,
      } as Filter);
    };
    return {
      t,
      show,
      // Returned from setup() so the Options-API template can resolve
      // `:schema` / `:default-values` (a module-level import would be out of
      // the template's scope → `:schema` would be undefined and never validate).
      filterCreatorPopupSchema,
      filterCreatorDefaults,
      applyFilter,
    };
  },
});
</script>
