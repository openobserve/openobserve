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
    v-if="remainingSecs !== null"
    class="text-xs font-medium whitespace-nowrap tabular-nums"
    :data-test="dataTest"
  >
    {{ countdownText(remainingSecs, t) }}
  </span>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import { useCountdown } from "@/composables/downtimes/useCountdown";
import { countdownText } from "@/utils/downtimes/banner";

const props = withDefaults(
  defineProps<{
    /** Microseconds. */
    endsAt: number;
    /** The clock to count against, e.g. the server-corrected one. */
    now?: () => number;
    dataTest?: string;
  }>(),
  { now: () => Date.now(), dataTest: "downtime-countdown" },
);

const { t } = useI18nTyped();
const { remainingSecs } = useCountdown(() => props.endsAt, props.now);
</script>
