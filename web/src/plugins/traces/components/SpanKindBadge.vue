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
    class="span-kind-badge"
    :class="`span-kind-badge--${kindClass}`"
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
</script>

<style scoped>
.span-kind-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  border-radius: 0.2rem;
  padding: 0.075rem 0.25rem;
  margin-right: 0.25rem;
  flex-shrink: 0;
  line-height: 1;
  cursor: default;
}

.span-kind-badge--client {
  color: var(--o2-span-kind-client-text);
  background: var(--o2-span-kind-client-bg);
}

.span-kind-badge--server {
  color: var(--o2-span-kind-server-text);
  background: var(--o2-span-kind-server-bg);
}

.span-kind-badge--producer {
  color: var(--o2-span-kind-producer-text);
  background: var(--o2-span-kind-producer-bg);
}

.span-kind-badge--consumer {
  color: var(--o2-span-kind-consumer-text);
  background: var(--o2-span-kind-consumer-bg);
}

.span-kind-badge--internal {
  color: var(--o2-span-kind-internal-text);
  background: var(--o2-span-kind-internal-bg);
}
</style>
