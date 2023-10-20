<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="q-mt-lg">
    <div class="tags-title text-grey-8 text-bold q-mb-sm q-ml-xs">Events</div>
    <AppTable :columns="columns || []" :rows="error.events || []">
      <template v-slot:error-type="slotProps">
        <ErrorTypeIcons :column="slotProps.column.row" />
      </template>
      <template v-slot:description="slotProps">
        <ErrorEventDescription :column="slotProps.column.row" />
      </template>
    </AppTable>
  </div>
</template>

<script setup lang="ts">
import AppTable from "@/components/AppTable.vue";
import { ref } from "vue";
import ErrorEventDescription from "@/components/rum/errorTracking/view/ErrorEventDescription.vue";
import { date } from "quasar";
import ErrorTypeIcons from "./ErrorTypeIcons.vue";

defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const columns = ref([
  {
    name: "type",
    label: "Type",
    align: "left",
    sortable: true,
    style: (row: any) =>
      row["type"] === "error" ? "border-bottom: 1px solid red" : "",
    classes: "error-type",
    slot: true,
    slotName: "error-type",
  },
  {
    name: "category",
    field: (row: any) => getErrorCategory(row),
    prop: (row: any) => getErrorCategory(row),
    label: "Category",
    align: "left",
    sortable: true,
    style: (row: any) =>
      row["type"] === "error" ? "border-bottom: 1px solid red" : "",
  },
  {
    name: "description",
    label: "Description",
    align: "left",
    sortable: true,
    style: (row: any) =>
      row["type"] === "error" ? "border-bottom: 1px solid red" : "",
    classes: "description-column",
    slot: true,
    slotName: "description",
  },
  {
    name: "level",
    field: (row: any) => (row["type"] === "error" ? "error" : "info"),
    prop: (row: any) => (row["type"] === "error" ? "error" : "info"),
    label: "Level",
    align: "left",
    style: (row: any) =>
      row["type"] === "error" ? "color: red; border-bottom: 1px solid red" : "",
    classes: "error-level",
  },
  {
    name: "timestamp",
    field: (row: any) => getFormattedDate(row["_timestamp"] / 1000),
    prop: (row: any) => getFormattedDate(row["_timestamp"] / 1000),
    label: "timestamp",
    align: "left",
    style: (row: any) =>
      row["type"] === "error" ? "border-bottom: 1px solid red" : "",
    sortable: true,
  },
]);

const getErrorCategory = (row: any) => {
  if (row["type"] === "error") return row["error_type"] || "Error";
  else if (row["type"] === "resource") return row["resource_type"];
  else if (row["type"] === "view")
    return row["view_loading_type"] === "route_change"
      ? "Navigation"
      : "Reload";
  else if (row["type"] === "action") return row["action_type"];
  else return row["type"];
};

const getFormattedDate = (timestamp: number) =>
  date.formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");
</script>

<style scoped>
.tags-title {
  font-size: 16px;
}
</style>

<style>
.description-column {
  max-width: 60vw;
}

.error-level {
  border: 1px solid #e0e0e0;
}
</style>
