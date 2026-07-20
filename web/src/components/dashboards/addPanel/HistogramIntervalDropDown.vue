<template>
  <!-- histogram interval for sql queries -->
  <OSelect
    v-model="histogramIntervalModel"
    :label="t('dashboard.histogramIntervalDropDown.histogramInterval')"
    label-position="inside"
    :options="histogramIntervalOptions"
    data-test="histogram-interval-dropdown"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "HistogramIntervalDropDown",
  components: { OSelect },
  props: {
    modelValue: {
      type: String,
      required: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props) {
    const { t } = useI18n();

    const histogramIntervalOptions = [
      {
        label: t("dashboard.histogramIntervalDropDown.auto"),
        value: null,
      },
      {
        label: t("dashboard.histogramIntervalDropDown.oneSecond"),
        value: "1 second",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.fiveSeconds"),
        value: "5 seconds",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.tenSeconds"),
        value: "10 seconds",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.thirtySeconds"),
        value: "30 seconds",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.oneMinute"),
        value: "1 minute",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.fiveMinutes"),
        value: "5 minutes",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.tenMinutes"),
        value: "10 minutes",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.fifteenMinutes"),
        value: "15 minutes",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.thirtyMinutes"),
        value: "30 minutes",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.fortyFiveMinutes"),
        value: "45 minutes",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.oneHour"),
        value: "1 hour",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.twoHours"),
        value: "2 hours",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.threeHours"),
        value: "3 hours",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.sixHours"),
        value: "6 hours",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.eightHours"),
        value: "8 hours",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.twelveHours"),
        value: "12 hours",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.oneDay"),
        value: "1 day",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.twoDays"),
        value: "2 days",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.threeDays"),
        value: "3 days",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.fiveDays"),
        value: "5 days",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.sevenDays"),
        value: "7 days",
      },
      {
        label: t("dashboard.histogramIntervalDropDown.thirtyDays"),
        value: "30 days",
      },
    ];

    const histogramIntervalModel = ref<string | null>(
      props.modelValue ?? null,
    );

    // on modelvalue change, update the model
    watch(
      () => props.modelValue,
      () => {
        histogramIntervalModel.value = props.modelValue ?? null;
      },
    );

    return {
      t,
      histogramIntervalModel,
      histogramIntervalOptions,
    };
  },
});
</script>

