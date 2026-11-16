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
  <StaleRangeStrip
    v-if="copy"
    :text="copy.text"
    :run-label="copy.run"
    :back-label="copy.back"
    :data-test="dataTest"
    @run="emit('run')"
    @back="emit('back')"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import StaleRangeStrip from "@/components/StaleRangeStrip.vue";
import useTimeRangeContext from "@/composables/useTimeRangeContext";
import type { TimeRangeGuard } from "@/composables/useTimeRangeHost";
import { useI18nTyped } from "@/types/i18n";
import { formatTimeRange } from "@/utils/timeRangeFormat";

const props = defineProps<{ guard: TimeRangeGuard | null; dataTest: string }>();
const emit = defineEmits<{ run: []; back: [] }>();
const { t } = useI18nTyped();
const { now } = useTimeRangeContext();

const copy = computed(() => {
  const held = props.guard;
  if (!held) return null;
  const ctx = now();
  const range = formatTimeRange(held.from, ctx, "toast");
  const next = formatTimeRange(held.to, ctx, "toast");
  return {
    text: t("timeRangeHost.guardHeld", { range, next, days: held.days }),
    run: held.panels > 0 ? t("timeRangeHost.guardRun", held.panels) : undefined,
    back: t("dateTime.backTo", { range }),
  };
});
</script>
