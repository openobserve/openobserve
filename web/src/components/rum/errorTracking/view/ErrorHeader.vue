<template>
  <div>
    <div>
      <div class="q-pt-sm q-pb-xs">
        <span class="text-bold">Event ID:</span>
        <span :title="eventId" class="q-pl-xs cursor-pointer"
          >{{ getEventId }} <q-icon size="12px" name="content_copy"
        /></span>
        <span class="q-ml-lg">Sep 11, 11:35 AM </span>
      </div>
      <div class="row items-center no-wrap q-pt-xs">
        <div class="error_type">Reference Error</div>
        <div class="text-grey-8 error_description q-pl-md">
          Proxy.updateDashboardList(assets/Dashboards)
        </div>
      </div>
      <div class="error_message q-pt-xs row items-center">
        <div class="error_symbol q-mr-xs" />
        store is not defined
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const eventId = "c595b5645b3d45e3b0946c50609f0c82";
const getEventId = computed(() =>
  "c595b5645b3d45e3b0946c50609f0c82".slice(0, 8)
);
</script>

<style lang="scss">
.error_type {
  font-size: 22px;
  color: $info;
}

.error_description {
  font-size: 18px;
}

.error_message {
  font-size: 16px;
}
.error_symbol {
  width: 12px;
  height: 12px;
  background-color: rgb(251, 119, 119);
  border-radius: 50%;
}
.error_time {
  font-size: 16px;
}
</style>
