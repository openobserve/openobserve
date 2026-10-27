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

<!-- The status block at the end of an onboarding page while it waits for data. It mirrors an
     inline first-event status on the page, and turns into the success panel when data lands.
     The `rail` variant is its status line alone, for a side rail that lays out the rest. -->
<template>
  <div :class="rail ? undefined : 'mt-8'">
    <div
      :class="
        rail
          ? undefined
          : [
              'rounded-surface border transition-colors duration-200 motion-reduce:transition-none',
              tone.border,
            ]
      "
      :data-state="state"
      aria-live="polite"
      data-test="onboarding-listen-bar"
    >
      <OnboardingFirstData
        v-if="result"
        :title="successTitle"
        :note="successNote"
        :result="result"
        :route="route"
      >
        <template #actions><slot name="success-actions" /></template>
      </OnboardingFirstData>
      <div
        v-else
        :class="
          rail
            ? 'flex items-start gap-2.5'
            : 'flex items-center gap-x-3.5 gap-y-2.5 px-4 py-3 max-md:flex-wrap'
        "
        data-test="onboarding-listen-bar-row"
      >
        <span
          :class="[
            'inline-flex shrink-0 items-center justify-center rounded-full',
            rail ? 'size-7' : 'size-9',
            tone.icon,
          ]"
          aria-hidden="true"
        >
          <span v-if="look.tone === 'waiting'" class="relative inline-flex size-2.5">
            <span
              class="bg-accent absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping"
            />
            <span class="bg-accent relative size-2.5 rounded-full" />
          </span>
          <OIcon v-else-if="look.icon" :name="look.icon" size="sm" />
        </span>
        <div class="min-w-0 flex-1">
          <p
            class="text-text-heading text-sm font-semibold"
            data-test="onboarding-listen-bar-title"
          >
            {{ message.title }}
          </p>
          <p class="text-text-secondary text-xs">{{ message.hint }}</p>
        </div>
        <!-- Out of the live region's speech: a clock read every second is noise. -->
        <span
          v-if="state === 'waiting'"
          class="text-text-heading shrink-0 font-mono text-sm tabular-nums"
          aria-hidden="true"
          data-test="onboarding-listen-bar-elapsed"
          >{{ elapsed }}</span
        >
        <OButton
          v-if="!rail"
          variant="outline"
          size="sm"
          icon-left="help-outline"
          class="max-md:w-full"
          data-test="onboarding-listen-bar-troubleshoot"
          @click="showStatus"
        >
          {{ t("ingestion.firstEvent.troubleshoot") }}
        </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { prefersReducedMotion } from "@/components/ingestion/setupCard/useStreamDetect";
import type {
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import OnboardingFirstData from "./OnboardingFirstData.vue";

export type ListenBarCopy = Record<
  Exclude<FirstEventState, "received">,
  { title: I18nText; hint: I18nText }
>;

const props = defineProps<{
  state: FirstEventState;
  /** The bar's title and hint for each state; the page decides what it is waiting for. */
  copy: ListenBarCopy;
  /** Set once data lands; the bar then shows the success panel. */
  result?: FirstEventResult;
  successTitle: I18nText;
  successNote?: I18nText;
  /** The app route the page sets up, for analytics. */
  route: string;
  /** Holds the inline first-event status that Troubleshoot scrolls to. */
  statusRoot: HTMLElement | null;
  /** `rail`: the status line alone, with no frame and no Troubleshoot; the rail shows success itself. */
  variant?: "bar" | "rail";
}>();

const { t } = useI18nTyped();

const rail = computed(() => props.variant === "rail");

type Tone = "idle" | "waiting" | "warning" | "error" | "success";
const TONES: Record<Tone, { border: string; icon: string }> = {
  idle: { border: "border-border-default", icon: "border-border-default border-2 border-dashed" },
  waiting: { border: "border-accent/40", icon: "bg-icon-chip-primary-bg" },
  warning: {
    border: "border-banner-warning-border",
    icon: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
  },
  error: {
    border: "border-banner-error-soft-border",
    icon: "bg-icon-chip-error-bg text-icon-chip-error-text",
  },
  success: { border: "border-banner-success-border", icon: "" },
};

const LOOKS: Partial<Record<FirstEventState, { tone: Tone; icon?: IconName }>> = {
  idle: { tone: "idle" },
  stopped: { tone: "warning", icon: "warning" },
  "no-requests": { tone: "warning", icon: "warning" },
  rejected: { tone: "error", icon: "error-outline" },
};
const look = computed(() => LOOKS[props.state] ?? { tone: "waiting" as const });
const message = computed(() =>
  props.state === "received" ? props.copy.waiting : props.copy[props.state],
);
const tone = computed(() => TONES[props.result ? "success" : look.value.tone]);

// Elapsed time since the current wait began, as m:ss.
const now = ref(Date.now());
const waitingSince = ref(Date.now());
watch(
  () => props.state,
  (next, prev) => {
    if (next === "waiting" && prev !== "waiting") waitingSince.value = Date.now();
  },
);
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => clearInterval(clock));
const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - waitingSince.value) / 1000));
  return raw(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
});

// The inline status holds the diagnosis, the first record and the outcome; the bar points there.
const showStatus = () => {
  const status = props.statusRoot?.querySelector<HTMLElement>('[data-test="first-event-status"]');
  if (!status) return;
  status.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  // Keyboard and screen-reader users follow the scroll, so focus moves to the status too.
  status.tabIndex = -1;
  status.focus({ preventScroll: true });
};
</script>
