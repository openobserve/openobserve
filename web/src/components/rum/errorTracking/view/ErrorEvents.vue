<template>
  <div class="q-mt-lg">
    <div class="tags-title text-grey-8 text-bold q-mb-sm q-ml-xs">Events</div>
    <AppTable :columns="columns" :rows="[]" />
  </div>
</template>

<script setup lang="ts">
import AppTable from "@/components/AppTable.vue";
import { ref } from "vue";

const columns = ref([
  {
    name: "error_type",
    field: (row: any) => row["error"],
    prop: (row: any) => row["error"],
    label: "Type",
    align: "left",
    sortable: true,
    slot: true,
    slotName: "error_details",
  },
  {
    name: "category",
    field: (row: any) => row["type"],
    prop: (row: any) => row["type"],
    label: "Category",
    align: "left",
    sortable: true,
  },
  {
    name: "description",
    field: (row: any) => row["type"],
    label: "Description",
    align: "left",
    sortable: true,
  },
  {
    name: "level",
    field: (row: any) => row["error_count"],
    prop: (row: any) => row["error_count"],
    label: "Level",
    align: "left",
  },
  {
    name: "count",
    field: (row: any) => row["initial_view_name"],
    prop: (row: any) => row["initial_view_name"],
    label: "Count",
    align: "left",
    sortable: true,
  },
]);
</script>

<style scoped>
.tags-title {
  font-size: 16px;
}
</style>
