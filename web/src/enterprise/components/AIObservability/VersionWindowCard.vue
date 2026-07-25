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
  VersionWindowCard — one card per compare arm (A or B), summarizing which
  env/version it is, its resolved window, and its trace count. The label is
  ENV-AWARE ("{env} · {version} — {window} · {n} traces") so an env-only
  compare (same version, different env) still reads correctly instead of
  showing two identical-looking "1.5.0" cards.

  When `windows.limitedBy` names THIS arm's counterpart (e.g. this is arm "a"
  and limitedBy === "b"), this arm's window was clamped down to match the
  shorter one, so we append the clamp explanation. When limitedBy names this
  arm itself (its own natural window was the shorter one, unclamped) or is
  null (equal-length or manual/sameWallClock alignment), no clamp copy renders.

  Series color chip mirrors VersionDeltaStrip / VersionOverlayChart's identity:
  arm a = accent, arm b = series-b.
-->
<template>
  <OCard
    class="min-w-48 flex-1 rounded-surface! border border-border-default bg-surface-panel"
    :data-test="`version-window-card-${arm}`"
  >
    <OCardSection role="body" class="flex flex-col gap-1 p-3!">
      <div class="flex items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="arm === 'a' ? 'bg-accent' : 'bg-series-b'"
          :data-test="`version-window-card-${arm}-chip`"
        />
        <span class="text-sm text-text-body" :data-test="`version-window-card-${arm}-label`">
          {{ label }}
        </span>
      </div>

      <span
        v-if="showClamp"
        class="text-xs text-text-secondary"
        :data-test="`version-window-card-${arm}-clamp`"
      >
        {{ t("aiObservability.versionCompare.windowCard.clamp", { duration: clampDuration }) }}
      </span>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import type { Win } from "@/plugins/traces/versionCompare/windows";
import { formatDuration } from "@/plugins/traces/versionCompare/formatDuration";

const props = defineProps<{
  /** Which compare arm this card represents. */
  arm: "a" | "b";
  env: string;
  version: string;
  window: Win;
  traceCount: number;
  /** From CompareWindows.limitedBy — which arm's natural window was shorter
      (the OTHER arm gets clamped to match it). */
  limitedBy: "a" | "b" | null;
  /** Clamped window length in hours, for the clamp explanation. */
  deltaHours: number;
}>();

const { t } = useI18n();

function formatWindow(win: Win): string {
  return formatDuration((win.end - win.start) / 3_600_000_000);
}

const label = computed(() =>
  t("aiObservability.versionCompare.windowCard.label", {
    env: props.env,
    version: props.version,
    window: formatWindow(props.window),
    count: props.traceCount,
  }),
);

// This arm's counterpart is the OTHER arm — clamp copy renders on this card
// only when the counterpart's window was the limiter (i.e. this arm was
// clamped down to match it).
const counterpart = computed<"a" | "b">(() => (props.arm === "a" ? "b" : "a"));
const showClamp = computed(() => props.limitedBy === counterpart.value);
// Pre-formatted clamp duration (never a raw float in the copy).
const clampDuration = computed(() => formatDuration(props.deltaHours));
</script>
