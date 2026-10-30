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

<!-- The one page-body skeleton OPageLayout shows while a page's `loading` is true. -->
<template>
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden pt-2" data-test="o-page-skeleton">
    <div class="flex h-9 shrink-0 items-center gap-4">
      <OSkeleton v-for="n in 4" :key="n" type="text" class="h-3 w-20" />
    </div>
    <div class="grid min-h-0 flex-1 auto-rows-36 grid-cols-12 gap-2">
      <div
        v-for="(span, i) in CARD_SPANS"
        :key="i"
        class="border-border-default rounded-default flex flex-col gap-2 overflow-hidden border p-2 max-md:col-span-12"
        :class="span"
      >
        <OSkeleton type="text" class="h-3 w-1/3" />
        <OSkeleton class="min-h-0 flex-1" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "./OSkeleton.vue";

const CARD_SPANS = [
  "col-span-3 row-span-2",
  "col-span-5 row-span-2",
  "col-span-4 row-span-2",
  "col-span-6",
  "col-span-6",
];
</script>
