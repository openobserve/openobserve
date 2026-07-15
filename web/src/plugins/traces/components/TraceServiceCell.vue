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
  <div class="flex items-center flex-nowrap!" :data-test="dataTest || 'trace-row-service'">
    <!-- Service type icon -->
    <img
      data-test="trace-row-service-icon"
      :src="serviceIconUrl"
      class="mr-2 shrink-0 w-[1.25rem] h-[1.25rem]"
      aria-hidden="true"
      alt=""
    />

    <!-- Service name + badge -->
    <div class="flex items-center gap-[0.325rem] min-w-0 flex-nowrap!">
      <span
        data-test="trace-row-service-name"
        class="text-weight-bold truncate min-w-0 text-(--color-grey-500)! text-[0.8rem]! tracking-[0.03rem]! [font-family:var(--font-mono)]"
      >
        {{ item.service_name }}
        <OTooltip side="bottom" align="center">
          <template #content>{{ item.service_name }}</template>
        </OTooltip>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useTraces from "@/composables/useTraces";
import { getServiceIconDataUrl } from "@/utils/traces/convertTraceData";

const props = defineProps<{
  item: Record<string, any>;
  dataTest?: string;
}>();

const store = useStore();

const { getOrSetServiceColor } = useTraces();

const rootColor = computed(
  () => getOrSetServiceColor(props.item.service_name) ?? "#9e9e9e",
);

const serviceIconUrl = computed(() =>
  getServiceIconDataUrl(
    props.item.service_name,
    store.state.theme === "dark",
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
