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
    <!-- Service type icon -->
    <img
      data-test="trace-row-service-icon"
      :src="serviceIconUrl"
      class="q-mr-sm tw:shrink-0 tw:w-[1.25rem] tw:h-[1.25rem]"
      aria-hidden="true"
      alt=""
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
import { QTooltip, useQuasar } from "quasar";
import useTraces from "@/composables/useTraces";
import { getServiceIconDataUrl } from "@/utils/traces/convertTraceData";

const props = defineProps<{
  item: Record<string, any>;
}>();

const $q = useQuasar();
const { getOrSetServiceColor } = useTraces();

const rootColor = computed(
  () => getOrSetServiceColor(props.item.service_name) ?? "#9e9e9e",
);

const serviceIconUrl = computed(() =>
  getServiceIconDataUrl(
    props.item.service_name,
    $q.dark.isActive,
    rootColor.value,
  ),
);

const extraServices = computed(() => {
  const svcs = props.item.services ?? {};
  return Object.keys(svcs)
    .filter((s) => s !== props.item.service_name)
    .map((s) => ({ name: s, color: getOrSetServiceColor(s) ?? "#9e9e9e" }));
});
</script>
