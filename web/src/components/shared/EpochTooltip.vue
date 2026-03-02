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
  EpochTooltip
  Wraps any value. If the value looks like an epoch timestamp,
  renders a q-tooltip on hover with the decoded human-readable datetime.
  Never replaces the original value — tooltip is purely additive.

  Usage:
    <epoch-tooltip :value="attrValue" :field-key="attrKey">{{ attrValue }}</epoch-tooltip>
-->
<template>
  <span class="epoch-tooltip-wrapper">
    <slot />
    <q-tooltip
      v-if="decoded"
      anchor="bottom left"
      self="top left"
      :delay="300"
      class="epoch-tooltip"
    >
      <div class="tw:text-xs tw:flex tw:flex-col tw:space-y-[2px]">
        <span class="tw:font-semibold tw:text-[var(--o2-text-secondary)]">
          Possible timestamp ({{ unitLabel }})
        </span>
        <span class="tw:font-mono tw:text-white">{{ decoded }}</span>
        <span class="tw:font-mono tw:text-[var(--o2-text-secondary)]">{{ decodedLocal }}</span>
      </div>
    </q-tooltip>
  </span>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { tryDecodeEpoch, epochUnitLabel, decodeEpochMs } from "@/utils/epochUtils";

export default defineComponent({
  name: "EpochTooltip",
  props: {
    value: {
      type: [String, Number],
      default: null,
    },
    fieldKey: {
      type: String,
      default: undefined,
    },
  },
  setup(props) {
    const result = computed(() =>
      tryDecodeEpoch(props.value, props.fieldKey),
    );

    const decoded = computed(() => result.value?.decoded ?? null);
    const unitLabel = computed(() =>
      result.value ? epochUnitLabel(result.value.unit) : "",
    );
    const decodedLocal = computed(() =>
      result.value ? decodeEpochMs(result.value.ms) : "",
    );

    return { decoded, unitLabel, decodedLocal };
  },
});
</script>

<style scoped>
.epoch-tooltip-wrapper {
  display: inline;
}
.epoch-tooltip {
  background: #1e1e2e;
  padding: 6px 10px;
  border-radius: 4px;
}
</style>
