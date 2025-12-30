<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="tw:flex tw:items-center tw:gap-2">
    <img v-if="showIcon" style="width: 24px; height: 24px;" :src="icon" alt="icon" />
    <span class="title-text">
      {{ title }}
    </span>
    <span class="tw:flex-1">
      <q-separator />
    </span>
  </div>
</template>
  
<script lang="ts">
import { getImageURL } from "@/utils/zincutils";
import { computed, defineComponent } from "vue";

export default defineComponent({
  name: "GroupHeader",
  components: {},
  props: {
    title: {
      type: String,
      default: "",
    },
    iconPath:{
      type: String,
      default: "",
    },
    showIcon: {
      type: Boolean,
      default: true,
    }
  },
  setup(props, { emit }) {
    const icon = computed(() => {
      return getImageURL(props.iconPath)
    })
    return {
      icon,
    };
  },
});
</script>
    
<style scoped lang="scss">
.title-text{
  font-size: 16px;
  font-weight: 700;
  line-height: 24px;
}
</style>
    