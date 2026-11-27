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
<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { StarterPack } from "@/composables/starterPacks/types";
import { getImageURL } from "@/utils/zincutils";

defineProps<{ pack: Pick<StarterPack, "logo"> }>();
</script>

<template>
  <span
    class="border-border-default bg-surface-base rounded-default flex size-8 shrink-0 items-center justify-center border"
  >
    <img v-if="pack.logo" :src="getImageURL(pack.logo)" class="size-5 object-contain" alt="" />
    <OIcon v-else name="inventory-2" size="sm" class="text-text-secondary" />
  </span>
</template>
