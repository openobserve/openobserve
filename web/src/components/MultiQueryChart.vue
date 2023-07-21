<template>
  <div>
    <Chart :data="chartData" />
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, onMounted } from "vue";
import { useSearchApi } from "@/composables/useSearchApi";
// import { useDataTransform } from "@/composables/useDataTransform";
import { convertData } from "@/utils/Dashboard/convertData";
import { useStore } from "vuex";

export default defineComponent({
  name: "MultiQueryChart",
  props: {
    selectedTimeObj: {
      required: true,
      type: Object,
    },
    data: {
      required: true,
      type: Object,
    },
    traces: {
      required: true,
      type: Array,
    },
    layout: {
      required: true,
      type: Object,
    }
  },
  setup(props, context) {
    const chartData = ref();
    const error = ref("");
    console.log("props.selectedTimeObj", props.selectedTimeObj);
    console.log("props.data", props.data);
    const store= useStore();
    const { loadData, data, errorDetail } = useSearchApi(
      props.data,
      props.selectedTimeObj,
      props,
      context.emit
    );

    onMounted(() => {
      loadData();
    });

    watch(data, () => {
      chartData.value = convertData(props.traces, props.layout, store);
    })
    return {
      loadData,
      data,
      chartData,
      error,
    };
  },
});
</script>

<style lang="scss" scoped></style>
