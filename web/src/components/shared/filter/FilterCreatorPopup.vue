<template>
  <ODialog data-test="filter-creator-popup-dialog" v-model:open="show" size="sm" :title="fieldName"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('common.apply')"
    @click:secondary="show = false"
    @click:primary="applyFilter"
  >
    <div class="p-3 w-50 overflow-hidden">
      <OCardSection class="p-0">
        <OSelect
          data-test="filter-creator-popup-operator-select"
          v-model="selectedOperator"
          :options="operators"
          :label="t('filter.operator')"
          class="py-2"
          :error="!!selectedOperatorError"
          :error-message="selectedOperatorError"
          @update:model-value="selectedOperatorError = ''"
        />
      </OCardSection>
      <OCardSection class="p-0">
        <div class="font-bold pb-1 pt-2">Values</div>
        <div class="max-h-37.5 overflow-auto">
          <div v-show="!fieldValues?.length">No values present</div>
          <ul class="flex flex-col m-0 p-0 list-none">
            <li v-for="value in fieldValues" :key="value">
              <label
                :data-test="`filter-creator-popup-value-${value}`"
                class="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-muted/50"
              >
                <OCheckbox
                  v-model="selectedValues"
                  :value="value"
                  class="shrink-0"
                />
                <span class="text-sm flex-1 min-w-0 truncate">{{ value }}</span>
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

