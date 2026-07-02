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
  <div class="tw:flex tw:items-center tw:flex-nowrap tw:mr-2 tw:mt-2 tw:border tw:border-solid tw:border-(--o2-border) tw:rounded">
    <div class="tw:px-3">{{ tag.key }}</div>
    <OSeparator data-test="separator" vertical />
    <div class="tw:px-3 tw:bg-[var(--o2-table-header-bg)] tw:break-all">
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
