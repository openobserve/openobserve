<template>
  <ODialog data-test="filter-creator-popup-dialog" v-model:open="show" size="sm" :title="fieldName"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('common.apply')"
    @click:secondary="show = false"
    @click:primary="applyFilter"
  >
    <div class="tw:p-3 filter-container">
      <OCardSection class="tw:p-0">
        <OSelect
          data-test="filter-creator-popup-operator-select"
          v-model="selectedOperator"
          :options="operators"
          :label="t('filter.operator')"
          class="tw:py-2"
          :error="!!selectedOperatorError"
          :error-message="selectedOperatorError"
          @update:model-value="selectedOperatorError = ''"
        />
      </OCardSection>
      <OCardSection class="tw:p-0">
        <div class="tw:font-bold tw:pb-1 tw:pt-2">Values</div>
        <div class="filter-values-container">
          <div v-show="!fieldValues?.length">No values present</div>
          <ul class="tw:flex tw:flex-col tw:m-0 tw:p-0 tw:list-none">
            <li v-for="value in fieldValues" :key="value">
              <label
                :data-test="`filter-creator-popup-value-${value}`"
                class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:cursor-pointer hover:tw:bg-muted/50"
              >
                <OCheckbox
                  v-model="selectedValues"
                  :value="value"
                  class="tw:shrink-0"
                />
                <span class="tw:text-sm tw:flex-1 tw:min-w-0 tw:truncate">{{ value }}</span>
              </label>
            </li>
          </ul>
        </div>
      </OCardSection>
    </div>
  </ODialog>
</template>

<script lang="ts">
// Define setup function
import { defineComponent, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
export default defineComponent({
  name: "FilterCreatorPopup",
  components: { ODialog, OSelect, OCheckbox, OCardSection },
  props: [
    "fieldName",
    "fieldValues",
    "operators",
    "defaultOperator",
    "defaultValues",
  ],
  setup(props, { emit }) {
    const show = ref(true);
    const selectedValues = ref(props.defaultValues);
    const selectedOperator = ref(props.defaultOperator);
    const selectedOperatorError = ref("");
    const { t } = useI18n();

    onBeforeMount(() => {});

    interface Filter {
      fieldName: string;
      selectedValues: string[];
      selectedOperator: string;
    }
    const applyFilter = () => {
      if (!selectedOperator.value) {
        selectedOperatorError.value = "Field is required!";
        return;
      }
      emit("apply", {
        fieldName: props.fieldName,
        selectedValues: selectedValues.value,
        selectedOperator: selectedOperator.value,
      } as Filter);
    };
    return {
      t,
      show,
      selectedValues,
      selectedOperator,
      selectedOperatorError,
      applyFilter,
    };
  },
});
</script>

<style scoped lang="scss">
.filter-container {
  width: 200px;
  overflow: hidden;
}
.filter-values-container {
  max-height: 150px;
  overflow: auto;
}
</style>
