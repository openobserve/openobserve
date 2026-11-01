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
  <div aria-hidden="true" data-test="logs-search-result-table-skeleton">
    <div class="border-card-glass-border flex h-7 items-center gap-6 border-b px-3">
      <OSkeleton type="text" class="h-3 w-40" />
      <OSkeleton type="text" class="h-3 w-24" />
    </div>
    <div v-for="row in ROWS" :key="row" class="flex h-6 items-center gap-6 px-3">
      <OSkeleton type="text" class="h-3 w-40" />
      <OSkeleton type="text" class="h-3 flex-1" />
    </div>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const ROWS = 8;
</script>
