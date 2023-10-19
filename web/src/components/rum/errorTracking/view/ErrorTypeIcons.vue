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
  <div>
    <img
      :alt="column.category"
      :src="typeIcons"
      style="width: 22px; height: 22px"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import error from "@/assets/images/rum/events/error.png";
import navigation from "@/assets/images/rum/events/navigation.png";
import user from "@/assets/images/rum/events/user.png";
import xhr from "@/assets/images/rum/events/xhr.png";

const props = defineProps({
  column: {
    type: Object,
    required: true,
  },
});

const typeIcons = computed(() => {
  if (props.column.category.toLowerCase() === "error") {
    return error;
  } else if (props.column.category.toLowerCase() === "xhr") {
    return xhr;
  } else if (props.column.category.toLowerCase() === "navigation") {
    return navigation;
  } else if (props.column.category.toLowerCase() === "click") {
    return user;
  } else if (props.column.category.toLowerCase() === "reload") {
    return navigation;
  }
  return error;
});
</script>

<style scoped></style>
