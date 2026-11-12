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

<script setup lang="ts">
import { computed } from "vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { LONG_WAIT_MS } from "@/lib/styles/motion";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { loadingText, type Partitions, type RegionNoun } from "./regionText";

const props = withDefaults(
  defineProps<{
    /** What the region loads, from the shared noun list. */
    noun: RegionNoun;
    /** Whole seconds since the run started, from `useRegionLoading`. */
    elapsedSeconds: number;
    /** Partition progress, when the server reports it. */
    partitions?: Partitions | null;
    /** Words that name this run (e.g. a range change), shown at once without the spinner or elapsed time. */
    message?: I18nText | null;
    dataTest?: string;
  }>(),
  { partitions: null, message: null, dataTest: "region-status" },
);

const { t } = useI18nTyped();

const shown = computed(() => props.elapsedSeconds * 1000 >= LONG_WAIT_MS);
const status = computed(() => loadingText(t, props.noun));
const visible = computed(() =>
  props.partitions && props.partitions.total > 0
    ? t("regionStatus.searchingPartitions", {
        done: props.partitions.done,
        total: props.partitions.total,
        seconds: props.elapsedSeconds,
      })
    : t("regionStatus.elapsed", { status: status.value, seconds: props.elapsedSeconds }),
);
</script>

<template>
  <!-- Not a live region either: the caller's useRegionLoading speaks the same words once. -->
  <span
    v-if="message"
    class="text-text-secondary inline-flex min-w-0 items-center text-xs whitespace-nowrap tabular-nums"
    :data-test="dataTest"
  >
    <span class="truncate">{{ message }}</span>
  </span>
  <!-- Not a live region: useRegionLoading is the one speaker, so the ticking text is hidden and a fixed name stays for browsing. -->
  <span
    v-else-if="shown"
    class="text-text-secondary inline-flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap tabular-nums"
    :data-test="dataTest"
  >
    <OSpinner size="xs" aria-hidden="true" />
    <span aria-hidden="true">{{ visible }}</span>
    <span class="sr-only">{{ status }}</span>
  </span>
</template>
