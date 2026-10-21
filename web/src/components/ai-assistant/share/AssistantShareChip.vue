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
  <OTag
    v-if="share && !expired"
    type="assistantShare"
    :value="tone"
    :label="label"
    clickable
    data-test="assistant-thread-share-chip"
    @click="emit('open', $event)"
  />
</template>

<script lang="ts">
import type { ShareSummary } from "@/composables/assistant";

export interface AssistantShareChipProps {
  share: ShareSummary | null;
  /** Epoch ms, injected so the time left is testable. */
  now?: number;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { WARM_EXPIRY_MS } from "./chatShare";

const props = withDefaults(defineProps<AssistantShareChipProps>(), { now: undefined });

const emit = defineEmits<{ open: [event: MouseEvent | KeyboardEvent] }>();

const { t } = useI18nTyped();

const HOUR_MS = 3_600_000;

const MINUTE_MS = 60_000;

const clock = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

const left = computed(() => {
  const expiresAt = props.share?.expiresAt;
  if (!expiresAt) return null;
  const ms = expiresAt - (props.now ?? clock.value);
  return ms > 0 && ms <= WARM_EXPIRY_MS ? ms : null;
});

// Only a link inside its last day needs the minute clock; the rest read the time once.
watch(
  () => {
    const expiresAt = props.share?.expiresAt;
    return props.now === undefined && !!expiresAt && expiresAt - Date.now() <= WARM_EXPIRY_MS;
  },
  (ticking) => {
    stopTicker();
    if (!ticking) return;
    clock.value = Date.now();
    ticker = setInterval(() => (clock.value = Date.now()), MINUTE_MS);
  },
  { immediate: true },
);

onBeforeUnmount(stopTicker);

const expired = computed(() => {
  const expiresAt = props.share?.expiresAt;
  return !!expiresAt && expiresAt <= (props.now ?? clock.value);
});

const tone = computed(() => {
  if (left.value !== null) return "expiring";
  return props.share?.visibility ?? "org";
});

const label = computed<I18nText>(() => {
  const share = props.share;
  if (!share) return raw("");
  const base = share.count > 1 ? t("assistant.share.multi", { count: share.count }) : single(share);
  return share.outOfDate ? t("assistant.share.chipOutOfDate", { chip: base }) : base;
});

function single(share: ShareSummary): I18nText {
  const visibility =
    share.visibility === "public" ? t("assistant.share.chipPublic") : t("assistant.share.chipOrg");
  if (left.value !== null) {
    return t("assistant.share.chipExpiring", { visibility, left: timeLeft(left.value) });
  }
  const content =
    share.mode === "live" ? t("assistant.share.liveMode") : t("assistant.share.snapshot");
  return t("assistant.share.chip", { visibility, content });
}

function stopTicker(): void {
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
}

function timeLeft(ms: number): I18nText {
  const hours = Math.floor(ms / HOUR_MS);
  const time =
    hours >= 1
      ? t("assistant.share.hours", { count: hours })
      : t("assistant.share.minutes", { count: Math.max(1, Math.round(ms / 60_000)) });
  return t("assistant.share.expiresIn", { time });
}
</script>
