<template>
  <div style="padding: 0px 10px; width: 50%">
    <div
      class="flex justify-between items-center q-py-md header"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>Override Config</span>
      </div>
      <q-btn
        icon="close"
        class="q-ml-xs"
        unelevated
        size="sm"
        round
        outline
        :title="t('dashboard.cancel')"
        @click.stop="closePopup"
      ></q-btn>
    </div>

    <div
      v-for="(unitMapping, index) in unitMappings"
      :key="index"
      class="q-mb-md flex items-center"
      style="gap: 15px"
    >
      <q-select
        v-model="unitMapping.field.value"
        :label="'Field'"
        :options="columnsOptions"
        style="width: 50%"
        :data-test="`dashboard-addpanel-config-unit-config-select-column-${index}`"
        input-debounce="0"
        filled
        borderless
        dense
        class="q-mb-xs tw-flex-1"
      />
      <div class="flex items-center" style="width: 45%; gap: 10px">
        <q-select
          v-model="unitMapping.config[0].value.unit"
          :label="'Unit'"
          :options="filteredUnitOptions(index)"
          :disable="!unitMapping.field.value"
          style="flex-grow: 1"
          :data-test="`dashboard-addpanel-config-unit-config-select-unit-${index}`"
          input-debounce="0"
          filled
          borderless
          dense
          class="q-mb-xs tw-flex-1"
        />
        <q-input
          v-if="unitMapping.config[0].value.unit.value === 'custom'"
          v-model="unitMapping.config[0].value.custom_unit"
          :label="t('dashboard.customunitLabel')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          filled
          dense
          label-slot
          data-test="dashboard-config-unit"
        />
        <q-btn
          @click="removeUnitMapping(index)"
          icon="close"
          class="delete-btn"
          dense
          flat
          round
          :data-test="`dashboard-addpanel-config-unit-config-delete-btn-${index}`"
        />
      </div>
    </div>
    <q-btn
      @click="addUnitMapping"
      label="+ Add field override"
      no-caps
      class="q-mt-md"
    />

    <q-card-actions align="right">
      <q-btn label="Save" color="primary" @click="saveMappings" />
    </q-card-actions>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "UnitMappingPopup",
  props: {
    columns: Array,
    valueMapping: Object,
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18n();

    const unitOptions = [
      {
        label: t("dashboard.default"),
        value: null,
      },
      {
        label: t("dashboard.numbers"),
        value: "numbers",
      },
      {
        label: t("dashboard.bytes"),
        value: "bytes",
      },
      {
        label: t("dashboard.kilobytes"),
        value: "kilobytes",
      },
      {
        label: t("dashboard.megabytes"),
        value: "megabytes",
      },
      {
        label: t("dashboard.bytesPerSecond"),
        value: "bps",
      },
      {
        label: t("dashboard.seconds"),
        value: "seconds",
      },
      {
        label: t("dashboard.milliseconds"),
        value: "milliseconds",
      },
      {
        label: t("dashboard.microseconds"),
        value: "microseconds",
      },
      {
        label: t("dashboard.nanoseconds"),
        value: "nanoseconds",
      },
      {
        label: t("dashboard.percent1"),
        value: "percent-1",
      },
      {
        label: t("dashboard.percent"),
        value: "percent",
      },
      {
        label: t("dashboard.currencyDollar"),
        value: "currency-dollar",
      },
      {
        label: t("dashboard.currencyEuro"),
        value: "currency-euro",
      },
      {
        label: t("dashboard.currencyPound"),
        value: "currency-pound",
      },
      {
        label: t("dashboard.currencyYen"),
        value: "currency-yen",
      },
      {
        label: t("dashboard.currencyRupees"),
        value: "currency-rupee",
      },

      {
        label: t("dashboard.custom"),
        value: "custom",
      },
    ];

    const originalUnitMappings = ref(
      JSON.parse(JSON.stringify(props.valueMapping.unitMappings || [])),
    );

    const unitMappings = ref(
      JSON.parse(
        JSON.stringify(
          props.valueMapping.unitMappings || [
            {
              field: { matchBy: "name", value: "" },
              config: [{ type: "unit", value: { unit: "", custom_unit: "" } }],
            },
          ],
        ),
      ),
    );

    const columnsOptions = computed(() =>
      props.columns.map((column: any) => ({
        label: column.label,
        value: column.alias,
      })),
    );

    const closePopup = () => {
      unitMappings.value = JSON.parse(
        JSON.stringify(originalUnitMappings.value),
      );
      emit("close");
    };

    const addUnitMapping = () => {
      unitMappings.value.push({
        field: { matchBy: "name", value: "" },
        config: [{ type: "unit", value: { unit: "", custom_unit: "" } }],
      });
    };

    const removeUnitMapping = (index: number) => {
      unitMappings.value.splice(index, 1);
    };

    const filteredUnitOptions = (index: number) => {
      return unitOptions;
    };

    const saveMappings = () => {
      originalUnitMappings.value = JSON.parse(
        JSON.stringify(unitMappings.value),
      );
      props.valueMapping.unitMappings = unitMappings.value;
      emit("save", unitMappings.value);
      emit("close");
    };

    return {
      unitOptions,
      columnsOptions,
      unitMappings,
      closePopup,
      addUnitMapping,
      removeUnitMapping,
      filteredUnitOptions,
      saveMappings,
      t,
    };
  },
});
</script>

<style lang="scss" scoped></style>
