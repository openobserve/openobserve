<template>
  <div>
    <div>
      <div class="row items-center no-wrap">
        <div style="font-size: 12px">{{ column.country }}</div>
      </div>
      <div class="row q-mt-xs items-center">
        <div class="text-grey-8">
          {{ column.city }}
        </div>
        <q-icon name="circle" size="4px" class="q-mx-md text-grey-6" />
        <div class="text-grey-8">{{ column.browser }}</div>
        <q-icon name="circle" size="4px" class="q-mx-md text-grey-6" />
        <div class="text-grey-8">{{ column.os }}</div>
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { defineProps } from "vue";
defineProps({
  column: {
    type: Object,
    required: true,
  },
});
</script>
<style lang="scss">
.error_type {
  font-size: 16px;
  color: $info;
}

.error_description {
  font-size: 14px;
}

.error_message {
  font-size: 14px;
}

.error_time {
  font-size: 12px;
}
</style>
