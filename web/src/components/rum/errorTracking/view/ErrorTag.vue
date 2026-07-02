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
  <div class="flex items-center flex-nowrap mr-2 mt-2 border border-solid border-(--o2-border) rounded">
    <div class="px-3">{{ tag.key }}</div>
    <OSeparator data-test="separator" vertical />
    <div class="px-3 bg-[var(--o2-table-header-bg)] break-all">
      {{ tag.value }}
    </div>
  </div>
</template>

<script setup lang="ts">
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
defineProps({
  tag: {
    type: Object,
    required: true,
  },
});
</script>
