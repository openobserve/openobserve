<template>
    <div>
    </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref } from "vue";
import { useSearchApi } from "@/composables/useSearchApi";

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
        }
    },
    setup(props) {
        const chartData = ref([]);
        console.log("propsss", props.selectedTimeObj);
        
        const { data, loadData } = useSearchApi( props.selectedTimeObj, props, (event: any) => {
            console.log("data",data);
            
            console.error(event);
        });
console.log("data", data.value);

        watch(() => data.value, (newData) => {
            chartData.value = newData;
            console.log('Chart data updated:', newData);
        });

        watch(() => props.selectedTimeObj, (newTimeObj) => {
            if (newTimeObj.start_time && newTimeObj.end_time) {
                loadData();
                console.log("Data loaded");
            }
        });

        return {
            chartData,
        };
    },
});
</script>

<style lang="scss" scoped></style>
