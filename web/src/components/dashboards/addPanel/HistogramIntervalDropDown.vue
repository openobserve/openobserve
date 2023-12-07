<template>
  <!-- histogram interval for sql queries -->
  <q-select
    v-model="histogramIntervalModel"
    label="Histogram interval"
    :options="histogramIntervalOptions"
    behavior="menu"
    filled
    borderless
    dense
    @update:model-value="$emit('update:modelValue', $event)"
    :display-value="`${
        histogramIntervalModel.label ?? 'Auto'
    }`"
  >
  </q-select>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";

export default defineComponent({
  name: "HistogramIntervalDropDown",
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props) {
    const histogramIntervalOptions = [
      {
        label: "Auto",
        value: null,
      },
      {
        label: "1 second",
        value: "1 second",
      },
      {
        label: "5 seconds",
        value: "5 seconds",
      },
      {
        label: "10 seconds",
        value: "10 seconds",
      },
      {
        label: "30 seconds",
        value: "30 seconds",
      },
      {
        label: "1 minute",
        value: "1 minute",
      },
      {
        label: "5 minutes",
        value: "5 minutes",
      },
      {
        label: "10 minutes",
        value: "10 minutes",
      },
      {
        label: "30 minutes",
        value: "30 minutes",
      },
      {
        label: "1 hour",
        value: "1 hour",
      },
      {
        label: "6 hours",
        value: "6 hours",
      },
      {
        label: "12 hours",
        value: "12 hours",
      },
      {
        label: "1 day",
        value: "1 day",
      },
      {
        label: "7 days",
        value: "7 days",
      },
      {
        label: "30 days",
        value: "30 days",
      },
    ];

    const histogramIntervalModel = ref(props.modelValue);

    // on modelvalue change, update the model
    watch(
      () => props.modelValue,
      () => {
        histogramIntervalModel.value = props.modelValue;
      }
    );

    return {
      histogramIntervalModel,
      histogramIntervalOptions,
    };
  },
});
</script>
<style lang="scss" scoped></style>
