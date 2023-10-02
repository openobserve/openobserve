<template>
  <div>
    <div>
      <div class="row items-center no-wrap q-my-xs">
        <div class="error_type text-bold text-grey-9">{{ error.type }}</div>
      </div>
      <div class="error_message q-pt-xs row items-center">
        <div
          v-if="error.error_handling === 'unhandled'"
          :class="
            error.error_handling === 'unhandled'
              ? 'unhandled_error text-red-6 q-px-xs q-mr-sm'
              : ''
          "
        >
          {{ error.error_handling }}
        </div>
        {{ error.error_message }}
      </div>
      <div class="q-pt-sm q-pb-xs">
        <span class="text-bold">Event ID:</span>
        <span :title="eventId" class="q-pl-xs cursor-pointer"
          >{{ error.error_id }} <q-icon size="12px" name="content_copy"
        /></span>
        <span class="q-ml-lg">{{ error.timestamp }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineProps } from "vue";

const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const eventId = "c595b5645b3d45e3b0946c50609f0c82";
const getEventId = computed(() =>
  "c595b5645b3d45e3b0946c50609f0c82".slice(0, 8)
);
</script>

<style lang="scss">
.error_type {
  font-size: 22px;
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

.unhandled_error {
  border: 1px solid rgb(246, 68, 68);
  border-radius: 4px;
  font-size: 14px;
}
</style>
