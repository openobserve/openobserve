<template>
  <div style="padding: 0px 10px; min-width: min(800px, 90vw)">
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
      class="q-mb-md flex items-center tw-w-full tw-flex"
      style="gap: 15px"
    >
      <q-select
        v-model="overrideConfig.field.value"
        :label="'Field'"
        :options="columnsOptions"
        :error="duplicateErrors[index]"
        :error-message="'This field has already been selected. Please choose a different field.'"
        style="width: 50%"
        :data-test="`dashboard-addpanel-config-unit-config-select-column-${index}`"
        input-debounce="0"
        filled
        emit-value
        map-options
        borderless
        dense
        class="tw-flex-1"
      />
      <div class="tw-flex items-center" style="width: 50%; gap: 10px">
        <q-select
          v-model="overrideConfig.config[0].type"
          :label="'Type'"
          :options="configTypeOptions"
          :disable="!overrideConfig.field.value"
          style="width: 150px"
          :data-test="`dashboard-addpanel-config-type-select-${index}`"
          input-debounce="0"
          filled
          emit-value
          map-options
          borderless
          dense
          @update:model-value="onConfigTypeChange(index)"
        />

        <div
          v-if="overrideConfig.config[0].type === 'unit'"
          class="tw-flex items-center"
          style="gap: 10px; flex-grow: 1"
        >
          <q-select
            v-model="overrideConfig.config[0].value.unit"
            :label="'Unit'"
            :options="filteredUnitOptions(index)"
            :disable="!overrideConfig.field.value"
            style="flex-grow: 1"
            :data-test="`dashboard-addpanel-config-unit-config-select-unit-${index}`"
            input-debounce="0"
            filled
            emit-value
            map-options
            borderless
            dense
            class="tw-flex-1"
          />
          <q-input
            v-if="overrideConfig.config[0].value.unit === 'custom'"
            v-model="overrideConfig.config[0].value.customUnit"
            :label="t('dashboard.customunitLabel')"
            color="input-border"
            bg-color="input-bg"
            stack-label
            filled
            dense
            label-slot
            data-test="dashboard-config-unit"
            style="width: 150px"
          />
        </div>

        <div
          v-else-if="overrideConfig.config[0].type === 'unique_value_color'"
          class="tw-flex items-center"
          style="gap: 10px; flex-grow: 1"
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
      class="q-mt-md"
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
    const duplicateErrors = ref<Array<boolean>>(
      props.overrideConfig.overrideConfigs?.map(() => false) || [],
    );

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
        return [
          {
            field: { matchBy: "name", value: "" },
            config: [
              {
                type: "unit",
                value: { unit: "", customUnit: "" },
              },
            ],
          },
        ];
      }

      return configs.map((config) => {
        const normalizedConfig = {
          field: {
            matchBy: config.field?.matchBy || config.field?.match_by || "name",
            value: config.field?.value || "",
          },
          config: [],
        };

        if (config.config && config.config.length > 0) {
          const configItem = config.config[0];

          if (configItem.type === "unit" || configItem.typee === "unit") {
            normalizedConfig.config.push({
              type: "unit",
              value: {
                unit: configItem.value?.unit || "",
                customUnit:
                  configItem.value?.customUnit ||
                  configItem.value?.custom_unit ||
                  "",
              },
            });
          } else if (
            configItem.type === "unique_value_color" ||
            configItem.typee === "unique_value_color"
          ) {
            normalizedConfig.config.push({
              type: "unique_value_color",
              autoColor: Boolean(
                configItem.autoColor ?? configItem.auto_color ?? false,
              ),
            });
          } else {
            // Default to unit type if type is not recognized
            normalizedConfig.config.push({
              type: "unit",
              value: { unit: "", customUnit: "" },
            });
          }
        } else {
          // Default config if no config found
          normalizedConfig.config.push({
            type: "unit",
            value: { unit: "", customUnit: "" },
          });
        }

        return normalizedConfig;
      });
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
      duplicateErrors.value.fill(false);
      emit("close");
    };

    const addOverrideConfig = () => {
      overrideConfigs.value.push({
        field: { matchBy: "name", value: "" },
        config: [{ type: "unit", value: { unit: "", customUnit: "" } }],
      });
      duplicateErrors.value.push(false);
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
      duplicateErrors.value.splice(index, 1);
    };

    const filteredUnitOptions = (index: number) => {
      return unitOptions;
    };

    const saveOverrides = () => {
      const names = overrideConfigs.value.map((config: any) => config.field.value);
      duplicateErrors.value = names.map(
        (name: any, idx: any) => names.indexOf(name) !== idx,
      );

      if (duplicateErrors.value.some((isDuplicate) => isDuplicate)) {
        return;
      }

      // Transform data to match backend expectations
      const transformedConfigs = overrideConfigs.value
        .filter((config: any) => config.field.value) // Only include configs with field values
        .map((config: any) => {
          const transformedConfig = {
            field: {
              matchBy: config.field.matchBy,
              value: config.field.value,
            },
            config: [],
          };

          const configItem = config.config[0];
          if (configItem.type === "unit") {
            transformedConfig.config.push({
              type: "unit",
              value: {
                unit: configItem.value?.unit || "",
                customUnit: configItem.value?.customUnit || "",
              },
            });
          } else if (configItem.type === "unique_value_color") {
            transformedConfig.config.push({
              type: "unique_value_color",
              autoColor: configItem.autoColor === true,
            });
          }

          return transformedConfig;
        });

      originalOverrideConfigs.value = JSON.parse(
        JSON.stringify(transformedConfigs),
      );
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

    return {
      configTypeOptions,
      unitOptions,
      columnsOptions,
      overrideConfigs,
      closePopup,
      addOverrideConfig,
      removeOverrideConfig,
      filteredUnitOptions,
      saveOverrides,
      duplicateErrors,
      onConfigTypeChange,
      normalizeOverrideConfigs,
      t,
    };
  },
});
</script>

<style lang="scss" scoped></style>
