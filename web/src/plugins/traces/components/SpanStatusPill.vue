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
    class="tw:rounded tw:px-[0.625rem] tw:inline-flex tw:items-center tw:w-fit"
    :class="
      isError
        ? 'o2-status-pill--error'
        : isOk
          ? 'o2-status-pill--success'
          : 'o2-status-pill--unset'
    "
  >
    <span
      class="q-mr-xs tw:inline-block tw:w-[0.375rem] tw:h-[0.375rem] tw:rounded-full tw:shrink-0 o2-status-pill__dot"
    />
    <span
      class="tw:text-[0.7rem] tw:tracking-[0.03em] tw:leading-[1.0625rem] tw:uppercase tw:font-bold"
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

<style scoped>
.o2-status-pill--success {
  color: var(--o2-status-success-text);
  background: var(--o2-status-success-bg);
}
.o2-status-pill--success .o2-status-pill__dot {
  background-color: var(--o2-status-success-text);
}

.o2-status-pill--error {
  color: var(--o2-status-error-text);
  background: var(--o2-status-error-bg);
}
.o2-status-pill--error .o2-status-pill__dot {
  background-color: var(--o2-status-error-text);
}

.o2-status-pill--unset {
  color: var(--o2-status-unset-text, #888888);
  background: var(--o2-status-unset-bg, #f0f0f0);
}
.o2-status-pill--unset .o2-status-pill__dot {
  background-color: var(--o2-status-unset-text, #888888);
}
</style>
