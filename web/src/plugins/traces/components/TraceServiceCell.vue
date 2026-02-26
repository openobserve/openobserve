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
  <div class="row items-center" data-test="trace-row-service">
    <!-- Service colour dot -->
    <span
      data-test="trace-row-service-dot"
      class="q-mr-sm"
      :style="{
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        flexShrink: '0',
        backgroundColor: rootColor,
        boxShadow: `0 0 0.5rem ${rootColor}`,
      }"
    />

    <!-- Service name + operation -->
    <div class="column" style="min-width: 0">
      <span
        data-test="trace-row-service-name"
        class="text-weight-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!"
      >
        {{ item.service_name }}
      </span>
      <span
        data-test="trace-row-operation-name"
        class="text-caption text-grey-6 ellipsis tw:text-[var(--o2-text-1)]!"
      >
        {{ item.operation_name }}
      </span>
    </div>

    <!-- +N more badge for multi-service traces -->
    <QBadge
      v-if="extraServices.length > 0"
      data-test="trace-row-extra-services"
      :label="`+${extraServices.length}`"
      class="tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.25rem]! tw:ml-[0.325rem]"
    >
      <QTooltip
        anchor="bottom middle"
        self="top middle"
        class="extra-services-tooltip"
      >
        <div
          v-for="svc in extraServices"
          :key="svc.name"
          class="tw:flex tw:items-center"
        >
          <div
            :style="{
              height: '0.5rem',
              width: '0.5rem',
              borderRadius: '2px',
              marginRight: '0.5rem',
              backgroundColor: svc.color,
              boxShadow: `0 0 0.5rem ${svc.color}`,
            }"
          />
          <span
            class="text-weight-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!"
          >
            {{ svc.name }}
          </span>
        </div>
      </QTooltip>
    </QBadge>
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
