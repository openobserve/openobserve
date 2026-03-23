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
  <div class="row items-center tw:flex-nowrap!" data-test="trace-row-service">
    <!-- Service colour dot -->
    <span
      data-test="trace-row-service-dot"
      class="q-mr-sm tw:inline-block tw:w-[0.625rem] tw:h-[0.625rem] tw:rounded-full tw:shrink-0"
      :style="{
        backgroundColor: rootColor,
        boxShadow: `0 0 0.5rem ${rootColor}`,
      }"
    />

    <!-- Service name + badge -->
    <div class="row items-center tw:gap-[0.325rem] tw:min-w-0 tw:flex-nowrap!">
      <span
        data-test="trace-row-service-name"
        class="text-weight-bold ellipsis tw:min-w-0 tw:text-[var(--o2-text-1)]! tw:text-[0.8rem]! tw:tracking-[0.03rem]!"
      >
        {{ item.service_name }}
        <QTooltip anchor="bottom middle" self="top middle">
          {{ item.service_name }}
        </QTooltip>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { QBadge, QTooltip } from "quasar";
import useTraces from "@/composables/useTraces";

const props = defineProps<{
  item: Record<string, any>;
}>();

const { searchObj } = useTraces();
const serviceColors = computed(() => searchObj.meta.serviceColors ?? {});

const rootColor = computed(
  () => serviceColors.value[props.item.service_name] ?? "#9e9e9e",
);

const extraServices = computed(() => {
  const svcs = props.item.services ?? {};
  return Object.keys(svcs)
    .filter((s) => s !== props.item.service_name)
    .map((s) => ({ name: s, color: serviceColors.value[s] ?? "#9e9e9e" }));
});
</script>
