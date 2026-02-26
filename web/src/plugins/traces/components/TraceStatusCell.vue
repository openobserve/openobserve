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
    :style="{
      borderRadius: '12px',
      padding: '2px 10px',
      display: 'inline-flex',
      alignItems: 'center',
      width: 'fit-content',
      background: pillBg,
      color: pillColor,
    }"
  >
    <span
      class="q-mr-xs"
      :style="{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        flexShrink: '0',
        backgroundColor: dotColor,
      }"
    />
    <span
      :style="{
        fontSize: '0.7rem',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        fontWeight: 'bold',
      }"
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
    ? `${props.item.errors} ${props.item.errors !== 1 ? t('traces.errors') : t('traces.error')}`
    : t('traces.success'),
);

const pillBg = computed(() =>
  hasErrors.value ? "rgba(244, 67, 54, 0.12)" : "rgba(76, 175, 80, 0.12)",
);

const pillColor = computed(() =>
  hasErrors.value
    ? "var(--q-negative, #c62828)"
    : "var(--q-positive, #388e3c)",
);

const dotColor = computed(() =>
  hasErrors.value
    ? "var(--q-negative, #f44336)"
    : "var(--q-positive, #4caf50)",
);
</script>
