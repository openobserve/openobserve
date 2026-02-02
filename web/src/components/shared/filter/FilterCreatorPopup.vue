<template>
  <q-dialog class="filter-container">
    <q-card class="q-pa-md">
      <q-card-section class="q-pa-none">
        <div class="text-h6">{{ fieldName }}</div>
      </q-card-section>
      <q-card-section class="q-pa-none">
        <q-select
          v-model="selectedOperator"
          :options="operators"
          :label="t('filter.operator')"
          :popup-content-style="{ textTransform: 'capitalize' }"
          color="input-border"
          bg-color="input-bg"
          class="q-py-sm showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val: any) => !!val || 'Field is required!']"
        />
      </q-card-section>
      <q-card-section class="q-pa-none">
        <div class="text-bold q-pb-xs q-pt-sm">Values</div>
        <div class="filter-values-container">
          <div v-show="!fieldValues?.length">No values present</div>
          <div v-for="value in fieldValues" :key="value">
            <q-list dense>
              <q-item tag="label">
                <q-item-section avatar>
                  <q-checkbox
                    size="xs"
                    dense
                    v-model="selectedValues"
                    :val="value"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="ellipsis">{{ value }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn
          v-close-popup
          class="q-mr-md o2-secondary-button tw:h-[36px]"
          :label="t('common.cancel')"
          no-caps
          flat
        />
        <q-btn
          class="o2-primary-button no-border tw:h-[36px]"
          :label="t('common.apply')"
          no-caps
          flat
          @click="applyFilter"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
// Define setup function
import { defineComponent, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
export default defineComponent({
  name: "FilterCreatorPopup",
  props: [
    "fieldName",
    "fieldValues",
    "operators",
    "defaultOperator",
    "defaultValues",
  ],
  setup(props, { emit }) {
    const selectedValues = ref(props.defaultValues);
    const selectedOperator = ref(props.defaultOperator);
    const { t } = useI18n();

    onBeforeMount(() => {});

    interface Filter {
      fieldName: string;
      selectedValues: string[];
      selectedOperator: string;
    }
    const applyFilter = () => {
      emit("apply", {
        fieldName: props.fieldName,
        selectedValues: selectedValues.value,
        selectedOperator: selectedOperator.value,
      } as Filter);
    };
    return {
      t,
      selectedValues,
      selectedOperator,
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
<style lang="scss">
.filter-values-container {
  .q-item {
    padding-left: 2px !important;
  }
  .q-focus-helper {
    background: transparent !important;
  }
}
</style>
