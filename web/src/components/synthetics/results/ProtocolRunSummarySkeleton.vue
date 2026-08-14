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
import { useI18nTyped } from "@/types/i18n";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const { t } = useI18nTyped();
</script>

<template>
  <div
    role="status"
    :aria-label="t('synthetics.protocolRun.loading')"
    aria-live="polite"
    class="flex max-w-[53.75rem] flex-col gap-4"
    data-test="synthetics-protocol-run-skeleton"
  >
    <!-- Mirrors the "Result" card: accent-strip header bar + grid-cols-2 label/value cells -->
    <div class="rounded-default border-border-default border">
      <div class="border-border-default flex items-center border-b px-3 py-2">
        <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
        <OSkeleton type="text" class="h-4 w-16" />
      </div>
      <div class="grid grid-cols-2 gap-3 px-3 py-3">
        <div
          v-for="i in 4"
          :key="i"
          class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3"
        >
          <OSkeleton type="text" class="h-3 w-16" />
          <OSkeleton type="text" class="h-4 w-24" />
        </div>
      </div>
    </div>
  </div>
</template>
