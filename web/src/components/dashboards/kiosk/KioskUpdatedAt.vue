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
  <span
    class="text-text-heading font-medium whitespace-nowrap tabular-nums"
    :tabindex="lastSuccessAt ? 0 : undefined"
  >
    {{ updatedText }}
    <OTooltip v-if="lastSuccessAt" :content="exactTimeText" />
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";
import { formatAge, formatClockTime } from "@/utils/dashboard/kiosk";

const props = withDefaults(
  defineProps<{
    lastSuccessAt?: number | null;
    timezone?: string;
  }>(),
  { lastSuccessAt: null, timezone: undefined },
);

const { t } = useI18nTyped();

const now = ref(Date.now());
let ageTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  ageTimer = setInterval(() => (now.value = Date.now()), 10_000);
});
onBeforeUnmount(() => {
  if (ageTimer) clearInterval(ageTimer);
});
watch(
  () => props.lastSuccessAt,
  () => (now.value = Date.now()),
);

const updatedText = computed(() =>
  props.lastSuccessAt
    ? t("dashboard.kiosk.updatedAt", { time: formatAge(now.value - props.lastSuccessAt, t) })
    : t("common.loading"),
);

const exactTimeText = computed(() =>
  t("refreshButton.lastRefreshed", {
    time: formatClockTime(props.lastSuccessAt ?? 0, props.timezone),
  }),
);
</script>
