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
    v-if="line"
    class="text-text-secondary min-w-0 truncate"
    data-test="assistant-run-status"
    :data-state="turn.state"
  >
    {{ line }}
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import {
  isTerminal,
  turnStatusText,
  type TurnMeta,
  type TurnState,
} from "@/composables/assistant/pure";
import { useI18nTyped } from "@/types/i18n";

const TICK_MS = 1_000;

const props = withDefaults(
  defineProps<{
    turn: TurnState;
    meta: TurnMeta;
    now?: () => number;
  }>(),
  { now: undefined },
);

const { t } = useI18nTyped();
const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const live = computed(() => props.turn.state !== "idle" && !isTerminal(props.turn));

// The one status source (D2 decision 15), so the line never disagrees with the transcript's status row.
const line = computed(() => {
  void tick.value;
  if (!live.value) return null;
  if (!props.meta.ownedByThisTab) return t("assistant.turn.elsewhere");
  return turnStatusText(props.turn, props.meta, t, (props.now ?? Date.now)())?.line ?? null;
});

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

watch(
  live,
  (running) => {
    stopTimer();
    if (running) timer = setInterval(() => (tick.value += 1), TICK_MS);
  },
  { immediate: true },
);

onBeforeUnmount(stopTimer);
</script>
