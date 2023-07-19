<template>
    <div>
        
    </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, onMounted } from "vue";
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
        },
    },
    setup(props, context) {
        const chartData = ref([]);
        const error = ref("");
        console.log("props.selectedTimeObj", props.selectedTimeObj);
        console.log("props.data", props.data);

        const { loadData, data, errorDetail } = useSearchApi(
            props.data,
            props.selectedTimeObj,
            props,
            context.emit
        );

        onMounted(() => {
            loadData();
        });

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
