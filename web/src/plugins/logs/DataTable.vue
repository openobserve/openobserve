<template>
  <template v-if="tableRows.length && columnRows.length">
    <data-table ref="dataTableRef" :options="{ ajax: "", autoWidth: true,
    scrollY: '50vh', searching: false, lengthMenu: [25000], deferRender: true,
    order: [[1, 'asc']], processing: true, }" :data="tableRows"
    :columns="columnRows" class="display" @page="onPageChange" />
  </template>
</template>

<script setup lang="ts">
import { computed, defineProps, onMounted, ref, watch } from "vue";
import DataTable from "datatables.net-vue3";
import DataTablesCore from "datatables.net";
import rowsJson from "@/utils/test_logs.json";
// import "datatables.net-responsive";
// import "datatables.net-select";

const props = defineProps({
  rows: {
    type: Array,
    required: true,
  },
  columns: {
    type: Array,
    required: true,
  },
});

DataTable.use(DataTablesCore);

const dataTableRef = ref<any>(null);

const options = {
  responsive: true,
  select: true,
};

const tableRows = ref<any[]>([]);

const columnRows = ref<{ [key: string]: string }[]>([]);

onMounted(() => {
  console.log("rows and columns");
  getRows();
  getColumns();
});

watch(
  () => props.rows,
  () => {
    tableRows.value = [];
    getRows();
  }
);

watch(
  () => props.columns,
  () => {
    columnRows.value = [];
    getColumns();
    console.log("columns >>>>>>>>>>>>>>>>", columnRows.value);
  }
);

const getRows = () => {
  console.log(Date.now());
  tableRows.value = (rowsJson.slice(5000) || []).map((row: any) => {
    const _row: { [key: string]: string } = {};
    props.columns.forEach((column: any) => {
      _row[column.name === "@timestamp" ? "_timestamp" : column.name] =
        column.field(row);
    });
    return _row;
  });
  console.log(Date.now());
};

const getColumns = () => {
  columnRows.value = (props.columns || []).map((column: any) => {
    return {
      title: column.label,
      data: column.name === "@timestamp" ? "_timestamp" : column.name,
      width: "200px",
    };
  });
  columnRows.value.unshift({
    className: "dt-control",
    orderable: false,
    defaultContent: "",
  });
};

const onPageChange = (event: any) => {
  console.log(dataTableRef.value.dt.processing);
  console.log("page change", event.dt.value.page());
};
</script>

<style lang="scss">
@import "datatables.net-dt";
</style>
