<template>
  <div style="padding: 0px 10px; min-width: min(1000px, 90vw)">
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
      v-for="(overrideConfig, index) in overrideConfigs"
      :key="index"
      class="q-mb-md flex items-start tw:w-full tw:flex"
      style="gap: 15px"
    >
      <q-select
        v-model="overrideConfig.field.value"
        :label="'Field'"
        :options="columnsOptions"
        :display-value="getFieldDisplayValue(overrideConfig.field.value)"
        style="width: 40%"
        :data-test="`dashboard-addpanel-config-unit-config-select-column-${index}`"
        input-debounce="0"
        emit-value
        map-options
        borderless
        dense
        class="tw:flex-1 o2-custom-select-dashboard"
       hide-bottom-space/>
      <div class="tw:flex items-center" style="width: 60%; gap: 10px">
        <q-select
          v-model="overrideConfig.config[0].type"
          :label="'Type'"
          :options="configTypeOptions"
          :disable="!overrideConfig.field.value"
          style="width: 40%"
          :data-test="`dashboard-addpanel-config-type-select-${index}`"
          input-debounce="0"
          emit-value
          map-options
          borderless
          dense
          class="o2-custom-select-dashboard"
          @update:model-value="onConfigTypeChange(index)"
         hide-bottom-space/>

        <div
          v-if="overrideConfig.config[0].type === 'unit'"
          class="tw:flex items-center"
          style="gap: 10px; flex-grow: 1; width: 60%"
        >
          <q-select
            v-model="overrideConfig.config[0].value.unit"
            :label="'Unit'"
            :options="unitOptions"
            :disable="!overrideConfig.field.value"
            style="flex-grow: 1; width: 50%"
            :data-test="`dashboard-addpanel-config-unit-config-select-unit-${index}`"
            input-debounce="0"
            emit-value
            map-options
            borderless
            dense
            class="tw:flex-1 o2-custom-select-dashboard"
           hide-bottom-space/>
          <q-input
            v-if="overrideConfig.config[0].value.unit === 'custom'"
            v-model="overrideConfig.config[0].value.customUnit"
            :label="t('dashboard.customunitLabel')"
            color="input-border"
            bg-color="input-bg"
            stack-label
            dense
            label-slot
            data-test="dashboard-config-unit"
            style="width: 50%"
           borderless hide-bottom-space/>
        </div>

        <div
          v-else-if="overrideConfig.config[0].type === 'unique_value_color'"
          class="tw:flex items-center"
          style="gap: 10px; flex-grow: 1; width: 60%"
        >
          <q-checkbox
            v-model="overrideConfig.config[0].autoColor"
            :label="'Unique Value Color'"
            :disable="!overrideConfig.field.value"
            dense
          />
        </div>

        <q-btn
          @click="removeOverrideConfig(index)"
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
      @click="addOverrideConfig"
      label="+ Add field override"
      no-caps
      class="q-mt-md el-border"
    />

    <q-card-actions align="right">
      <q-btn label="Save" color="primary" @click="saveOverrides" />
    </q-card-actions>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, PropType, onMounted } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "OverrideConfigPopup",
  props: {
    columns: {
      type: Array as PropType<Array<{ label: string; alias: string }>>,
      required: true,
      validator: (value: any[]) => value.every(item => 
        typeof item.label === 'string' && 
        typeof item.alias === 'string'
      )
    },
    overrideConfig: {
      type: Object as PropType<{
        overrideConfigs?: Array<{
          field: { matchBy: string; value: string };
          config: Array<{
            type: string;
            value?: { unit: string; customUnit: string };
            autoColor?: boolean;
          }>;
        }>;
      }>,
      required: true
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18n();

    const configTypeOptions = [
      {
        label: "Unit",
        value: "unit",
      },
      {
        label: "Unique Value Color",
        value: "unique_value_color",
      },
    ];

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

    const originalOverrideConfigs = ref(
      JSON.parse(JSON.stringify(props.overrideConfig.overrideConfigs || [])),
    );

    const overrideConfigs = ref(
      JSON.parse(
        JSON.stringify(
          normalizeOverrideConfigs(props.overrideConfig.overrideConfigs || []),
        ),
      ),
    );

    function normalizeOverrideConfigs(configs: any[]) {
      if (configs.length === 0) {
        return [];
      }

      return configs.map((config) => ({
        field: {
          matchBy: config.field?.matchBy || "name",
          value: config.field?.value || "",
        },
        config: [
          config.config?.[0]?.type === "unique_value_color"
            ? {
                type: "unique_value_color",
                autoColor: Boolean(config.config[0].autoColor),
              }
            : {
                type: "unit",
                value: {
                  unit: config.config?.[0]?.value?.unit || "",
                  customUnit: config.config?.[0]?.value?.customUnit || "",
                },
              },
        ],
      }));
    }

    const columnsOptions = computed(() =>
      props.columns.map((column: any) => ({
        label: column.label,
        value: column.alias,
      })),
    );

    const closePopup = () => {
      overrideConfigs.value = JSON.parse(
        JSON.stringify(originalOverrideConfigs.value),
      );
      emit("close");
    };

    const addOverrideConfig = () => {
      overrideConfigs.value.push({
        field: { matchBy: "name", value: "" },
        config: [{ type: "unit", value: { unit: "", customUnit: "" } }],
      });
    };

    const onConfigTypeChange = (index: number) => {
      const config = overrideConfigs.value[index].config[0];
      if (config.type === "unit") {
        // Initialize unit config
        config.value = { unit: "", customUnit: "" };
        delete config.autoColor;
      } else if (config.type === "unique_value_color") {
        // Initialize color config
        config.autoColor = Boolean(config.autoColor ?? false);
        delete config.value;
      }
    };

    const removeOverrideConfig = (index: number) => {
      overrideConfigs.value.splice(index, 1);
    };

    const saveOverrides = () => {
      const transformedConfigs = overrideConfigs.value
        .filter((config: any) => config.field.value) // Only include configs with field values
        .map((config: any) => ({
          field: {
            matchBy: config.field.matchBy,
            value: config.field.value,
          },
          config: [
            config.config[0].type === "unit"
              ? {
                  type: "unit",
                  value: {
                    unit: config.config[0].value?.unit || "",
                    customUnit: config.config[0].value?.customUnit || "",
                  },
                }
              : {
                  type: "unique_value_color",
                  autoColor: config.config[0].autoColor === true,
                },
          ],
        }));

      props.overrideConfig.overrideConfigs = transformedConfigs;
      emit("save", transformedConfigs);
      emit("close");
    };

    onMounted(() => {
      // if overrideconfig is empty, add default overrideconfig
      if (overrideConfigs.value.length == 0) {
        addOverrideConfig();
      }
    });

    watch(
      () =>
        overrideConfigs.value.map((config: any) =>
          config.config[0].type === "unit"
            ? config.config[0].value?.unit
            : null,
        ),
      (newUnits, oldUnits) => {
        newUnits.forEach((newUnit: any, index: any) => {
          const config = overrideConfigs.value[index].config[0];
          if (
            config.type === "unit" &&
            newUnit !== "custom" &&
            oldUnits[index] === "custom"
          ) {
            if (config.value) {
              config.value.customUnit = "";
            }
          }
        });
      },
      { deep: true },
    );

    const getFieldDisplayValue = (fieldValue: string) => {
      if (!fieldValue) return "";

      const option = columnsOptions.value.find(
        (option) => option.value === fieldValue,
      );

      if (option) {
        return option.label;
      } else {
        // Field not found, show with error message
        return `${fieldValue} (Field not found)`;
      }
    };

    return {
      configTypeOptions,
      unitOptions,
      columnsOptions,
      overrideConfigs,
      closePopup,
      addOverrideConfig,
      removeOverrideConfig,
      saveOverrides,
      onConfigTypeChange,
      getFieldDisplayValue,
      t,
    };
  },
});
</script>

<style lang="scss" scoped></style>
