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

<!-- A page's body, or the license message in its place while the route's feature is locked: the header, tabs and rails around it stay. A sidebar-only shell passes its routed child through, so the child keeps its own header. -->
<template>
  <div
    v-if="locked && replace"
    class="flex h-full min-h-0 w-full flex-1 items-center justify-center"
    data-test="page-layout-license-locked"
  >
    <LicenseDeniedState :features="feature ? [feature] : []" />
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import { useFeatureLock } from "@/composables/useFeatureLock";

withDefaults(defineProps<{ replace?: boolean }>(), { replace: true });

const { locked, feature } = useFeatureLock();
</script>
