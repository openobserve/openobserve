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
  <div
    data-test="trace-row-status-pill"
    class="rounded py-[0.125rem] px-[0.625rem] inline-flex items-center w-fit"
    :class="
      hasErrors
        ? 'o2-status-pill--error text-(--o2-status-error-text) bg-(--o2-status-error-bg)'
        : 'o2-status-pill--success text-(--o2-status-success-text) bg-(--o2-status-success-bg)'
    "
  >
    <span
      class="mr-1 inline-block w-[0.4375rem] h-[0.4375rem] rounded-full shrink-0 o2-status-pill__dot"
      :class="
        hasErrors
          ? 'bg-[var(--o2-status-error-text)]'
          : 'bg-[var(--o2-status-success-text)]'
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
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  item: Record<string, any>;
}>();

const hasErrors = computed(() => (props.item.errors ?? 0) > 0);

const label = computed(() =>
  hasErrors.value
    ? `${props.item.errors} ${props.item.errors !== 1 ? t("traces.errors") : t("traces.error")}`
    : t("traces.success"),
);
</script>

