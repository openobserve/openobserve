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
  <date-time ref="dateTimePicker" auto-apply :default-type="modelValue.type" :default-absolute-time="{
    startTime: modelValue.startTime,
    endTime: modelValue.endTime,
  }" :default-relative-time="modelValue.relativeTimePeriod" @on:date-change="updateDateTime">
  </date-time>
</template>

<script lang="ts">
import { ref, defineComponent, reactive, watch, computed } from "vue";
import DateTime from "@/components/DateTime.vue";


export default defineComponent({
  name: "DateTimePickerDashboard",
  components: {
    DateTime
  },
  props: {
    modelValue: {
      type: Object,
      default: () => ({
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "15m",
        valueType: "relative",
      }),
    },
  },
  emits: ["update:modelValue"],

  setup(props, { emit }) {

    const dateTimePicker : any = ref(null)

    const updateDateTime = (date: any) => {
      const newValue = {
        startTime: date.startTime,
        endTime: date.endTime,
        relativeTimePeriod: date.relativeTimePeriod,
        valueType: ["relative", "relative-custom"].includes(date.valueType) ? "relative" : "absolute",
      }

      emit("update:modelValue", newValue);
    }

    const refresh = () => {
      dateTimePicker.value.refresh()
    }

    return {
      updateDateTime,
      refresh,
      dateTimePicker
    };
  },
});
</script>

<style lang="scss" scoped></style>
