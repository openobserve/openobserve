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
  <OTag
    v-if="abbrev"
    type="spanKind"
    :value="kind"
    :data-test="`trace-tree-span-kind-badge-${kindClass}`"
  >
    {{ abbrev }}
    <OTooltip :content="kind" side="bottom" align="center" />
  </OTag>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

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
