<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="flex items-center gap-2">
    <img class="size-6" v-if="showIcon" :src="icon" alt="icon" />
    <span data-test="common-group-header-title" class="text-base font-bold leading-6">
      {{ title }}
    </span>
    <span class="flex-1">
      <OSeparator />
    </span>
  </div>
</template>

<script lang="ts">
import { getImageURL } from "@/utils/zincutils";
import { computed, defineComponent } from "vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  name: "GroupHeader",
  components: { OSeparator },
  props: {
    title: {
      type: String,
      default: "",
    },
    iconPath: {
      type: String,
      default: "",
    },
    showIcon: {
      type: Boolean,
      default: true,
    },
  },
  setup(props) {
    const icon = computed(() => {
      return getImageURL(props.iconPath);
    });
    return {
      icon,
    };
  },
});
</script>
