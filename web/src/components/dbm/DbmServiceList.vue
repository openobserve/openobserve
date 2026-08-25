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

<!--
  The services calling a database or a query.

  The convention lives in `TraceServiceCell`: a service is its colour dot plus
  plain text, never a pill. The colour comes from the shared
  `serviceColorRegistry`, so a service is the SAME colour here, in the trace
  list, and on the service map — which is the whole point of a per-service
  colour. A default-grey tag would read as a status chip that had lost its
  status, and would break the one identity the dot exists to carry.

  We read the registry directly rather than through `useTraces`, because the
  composable's wrapper also writes into the traces search object; DBM has no
  business mutating that.
-->
<template>
  <div v-if="services.length" class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
    <span
      v-for="service in visible"
      :key="service"
      class="flex min-w-0 items-center gap-1"
      :data-test="dataTest"
    >
      <span
        class="size-1.5 shrink-0 rounded-full"
        :style="{ backgroundColor: colorOf(service) }"
        aria-hidden="true"
      ></span>
      <span class="text-text-body min-w-0 truncate text-xs">
        {{ raw(service) }}
        <OTooltip side="bottom" align="center">
          <template #content>{{ raw(service) }}</template>
        </OTooltip>
      </span>
    </span>
    <span v-if="hiddenCount > 0" class="text-text-muted text-2xs shrink-0">
      {{ t("dbm.databases.moreServices", { count: hiddenCount }) }}
    </span>
  </div>
  <span v-else class="text-text-muted">{{ raw("—") }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { getOrSetServiceColor } from "@/utils/traces/serviceColorRegistry";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Service names calling this database / query. */
    services?: string[];
    /** How many to render before collapsing the rest into a "+N" count. */
    max?: number;
    dataTest?: string;
  }>(),
  { services: () => [], max: 2, dataTest: "dbm-service" },
);

const { t } = useI18nTyped();

const visible = computed(() => props.services.slice(0, props.max));
const hiddenCount = computed(() => Math.max(0, props.services.length - props.max));

const colorOf = (service: string) => getOrSetServiceColor(service);
</script>
