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
        v-model="unitMapping.selected_column"
        :label="'Field'"
        :options="columnsOptions"
        style="width: 30%"
        @change="updateUnitOptions(index)"
      />

      <div
        class="flex items-center"
        style="width: 65%; display: flex; align-items: center; gap: 10px"
      >
        <q-select
          v-model="unitMapping.selected_unit"
          :label="'Unit'"
          :options="filteredUnitOptions(index)"
          :disable="!unitMapping.selected_column"
          style="flex-grow: 1"
        />
        <q-btn
          @click="removeUnitMapping(index)"
          icon="close"
          class="delete-btn"
          dense
          flat
          round
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

    // Initialize unitMappings from props valueMapping if available
    const unitMappings = ref(
      props.valueMapping.unitMappings || [
        { selected_column: null, selected_unit: null },
      ],
    );

    // Computed property for columnsOptions
    const columnsOptions = computed(() =>
      props.columns.map((column: any) => ({
        label: column.label,
        value: column.alias,
      })),
    );

    const closePopup = () => {
      emit("close");
    };

    const addUnitMapping = () => {
      unitMappings.value.push({ selected_column: null, selected_unit: null });
    };

    const removeUnitMapping = (index: number) => {
      unitMappings.value.splice(index, 1);
    };

    const updateUnitOptions = (index: number) => {
      console.log("index", index);
      console.log(
        `Column ${unitMappings.value[index].selected_column} selected.`,
      );
    };

    const filteredUnitOptions = (index: number) => {
      return unitOptions;
    };

    const saveMappings = () => {
      console.log("unitMappings.value", unitMappings.value);
      console.log("props.valueMapping", props.valueMapping);

      props.valueMapping.unitMappings = unitMappings.value;

      emit("save", unitMappings.value);
      closePopup();
    };

    return {
      unitOptions,
      columnsOptions,
      unitMappings,
      closePopup,
      addUnitMapping,
      removeUnitMapping,
      updateUnitOptions,
      filteredUnitOptions,
      saveMappings,
      t,
    };
  },
});
</script>

<style lang="scss" scoped></style>
