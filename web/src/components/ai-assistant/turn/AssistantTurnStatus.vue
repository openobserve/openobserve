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
  <component
    :is="variant === 'card' ? OCard : 'div'"
    v-if="status"
    aria-live="off"
    data-test="assistant-turn-status"
    :data-state="turn.state"
    :data-tone="status.tone"
    :data-variant="variant"
    :class="[
      'flex min-w-0 gap-2 text-xs',
      variant === 'card' ? 'flex-col p-3' : 'items-center',
      status.tone === 'warning' ? 'text-status-warning-text' : 'text-text-secondary',
    ]"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        <OIcon v-if="glyph" :name="glyph" size="xs" data-test="assistant-turn-status-glyph" />
        <OSpinner v-else variant="dots" size="xs" data-test="assistant-turn-status-spinner" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <OTruncatedText class="min-w-0" data-test="assistant-turn-status-text">{{
          status.line
        }}</OTruncatedText>
        <span v-if="status.second" class="min-w-0" data-test="assistant-turn-status-stall">{{
          status.second
        }}</span>
      </span>
    </div>
    <OButton
      v-if="variant !== 'block'"
      :variant="status.tone === 'warning' ? 'secondary' : 'outline'"
      size="sm"
      :disabled="turn.state === 'stopping'"
      class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
      data-test="assistant-turn-status-stop"
      @click="emit('stop')"
    >
      {{ t("assistant.turn.stopLabel") }}
    </OButton>
  </component>
</template>

<script lang="ts">
import type { TurnMeta, TurnState } from "@/composables/assistant/pure";

export interface AssistantTurnStatusProps {
  turn: TurnState;
  meta: TurnMeta;
  /** `block` under the running message (no Stop: the composer owns it); `line` the helper, `card` the RCA drawer. */
  variant: "block" | "line" | "card";
  ownedByThisTab: boolean;
  /** The answer's trail already shows the running tool as a row. */
  trailShown?: boolean;
  /** Injected by specs; elapsed is computed from it, never from a counter. */
  now?: () => number;
}

export interface AssistantTurnStatusEmits {
  (e: "stop"): void;
}

/** Elapsed redraws this often while a turn runs; the text changes, nothing moves (HT-01 AC 11). */
export const STATUS_TICK_MS = 1_000;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { isTerminal, stepLabel, turnStatusText } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantTurnStatusProps>(), {
  trailShown: false,
  now: undefined,
});

const emit = defineEmits<AssistantTurnStatusEmits>();

const { t } = useI18nTyped();
const tick = ref(0);
const reducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true;

const live = computed(() => props.turn.state !== "idle" && !isTerminal(props.turn));

const clock = () => (props.now ?? Date.now)();

const status = computed(() => {
  void tick.value;
  if (!live.value) return null;
  if (!props.ownedByThisTab)
    return { line: t("assistant.turn.elsewhere"), tone: "neutral" as const };
  const text = turnStatusText(props.turn, props.meta, t, clock());
  // A tool with no label of its own would only read "Running {tool}" beside the trail's real row.
  const repeatsTrail =
    props.variant === "block" &&
    props.trailShown &&
    props.turn.state === "running_tool" &&
    stepLabel(props.turn.tool, props.turn.target).key === "assistant.step.fallback";
  return repeatsTrail && !text?.second ? null : text;
});

// No motion while the turn waits on the user, and a static glyph under reduced motion (HT-01 AC 4, AC 11).
const glyph = computed(() => {
  if (!props.ownedByThisTab) return assistantGlyph.elsewhere;
  const state = props.turn.state;
  if (state === "awaiting_approval" || state === "awaiting_consent") return assistantGlyph.waiting;
  if (status.value?.line === t("assistant.turn.caughtUp")) return assistantGlyph.done;
  return reducedMotion ? assistantGlyph.working : null;
});

let timer: ReturnType<typeof setInterval> | null = null;

// The clock runs only while a turn is live, so an idle container keeps no timer (PERF-07).
watch(
  live,
  (running) => {
    if (running && !timer) timer = setInterval(() => (tick.value += 1), STATUS_TICK_MS);
    if (!running && timer) {
      clearInterval(timer);
      timer = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>
