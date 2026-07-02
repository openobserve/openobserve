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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <div
    data-test="span-row-status-pill"
    class="rounded px-[0.625rem] inline-flex items-center w-fit"
    :class="
      isError
        ? 'o2-status-pill--error text-(--o2-status-error-text) bg-(--o2-status-error-bg)'
        : isOk
          ? 'o2-status-pill--success text-(--o2-status-success-text) bg-(--o2-status-success-bg)'
          : 'o2-status-pill--unset text-[var(--o2-status-unset-text,#888888)] bg-[var(--o2-status-unset-bg,#f0f0f0)]'
    "
  >
    <span
      class="mr-1 inline-block w-[0.375rem] h-[0.375rem] rounded-full shrink-0 o2-status-pill__dot"
      :class="
        isError
          ? 'bg-[var(--o2-status-error-text)]'
          : isOk
            ? 'bg-[var(--o2-status-success-text)]'
            : 'bg-[var(--o2-status-unset-text,#888888)]'
      "
    />
    <span
      class="text-[0.7rem] tracking-[0.03em] leading-[1.0625rem] uppercase font-bold"
    >
      {{ label }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  status?: string;
}>();

const isError = computed(() => (props.status ?? "").toUpperCase() === "ERROR");

const isOk = computed(() => (props.status ?? "").toUpperCase() === "OK");

const label = computed(() => props.status || "UNSET");
</script>
