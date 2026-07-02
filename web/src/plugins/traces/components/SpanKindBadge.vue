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
  <span
    v-if="abbrev"
    class="inline-flex items-center justify-center text-[0.6rem] font-bold tracking-[0.03em] rounded-[0.2rem] py-[0.075rem] px-[0.25rem] mr-[0.25rem] shrink-0 leading-none cursor-default"
    :class="kindColorClasses"
    :data-test="`trace-tree-span-kind-badge-${kindClass}`"
  >
    {{ abbrev }}
    <OTooltip :content="kind" side="bottom" align="center" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  /** Human-readable span kind label, e.g. "Client", "Server", "Internal" */
  kind: string;
}>();

const kindClass = computed(() => props.kind.toLowerCase());

/** Single-letter abbreviation shown inside the badge. Returns empty for Unspecified. */
const abbrev = computed(() => {
  switch (props.kind) {
    case "Client":
      return "C";
    case "Server":
      return "S";
    case "Producer":
      return "P";
    case "Consumer":
      return "CO";
    case "Internal":
      return "I";
    default:
      return "";
  }
});

const kindColorClasses = computed(() => {
  switch (kindClass.value) {
    case "client":
      return "text-(--o2-span-kind-client-text) bg-(--o2-span-kind-client-bg)";
    case "server":
      return "text-(--o2-span-kind-server-text) bg-(--o2-span-kind-server-bg)";
    case "producer":
      return "text-(--o2-span-kind-producer-text) bg-(--o2-span-kind-producer-bg)";
    case "consumer":
      return "text-(--o2-span-kind-consumer-text) bg-(--o2-span-kind-consumer-bg)";
    case "internal":
      return "text-(--o2-span-kind-internal-text) bg-(--o2-span-kind-internal-bg)";
    default:
      return "";
  }
});
</script>
