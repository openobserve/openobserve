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
  <Teleport to="body">
    <section
      v-if="line"
      :aria-label="t('assistant.notice.region', { product })"
      data-assistant-surface
      data-dd-privacy="mask"
      class="bg-surface-base border-border-default rounded-surface fixed end-4 bottom-[calc(var(--o-assistant-inset-bottom,0rem)+1rem)] z-5000 flex w-[min(22.5rem,calc(100vw-2rem))] flex-wrap items-center justify-between gap-x-3 gap-y-2 border p-3 shadow-lg"
      data-test="assistant-decision-notice"
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <OText variant="body" as="p" class="break-words" data-test="assistant-decision-notice-line">
          {{ line }}
        </OText>
        <OText v-if="subject" variant="meta" as="p" class="break-words">
          {{ runTitle(subject, t) }}
        </OText>
        <OText
          v-if="clock"
          variant="meta"
          as="p"
          aria-live="off"
          class="tabular-nums"
          data-test="assistant-decision-notice-clock"
        >
          {{ clock }}
        </OText>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <OButton
          variant="ghost"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-decision-notice-hide"
          @click="hide"
        >
          {{ t("assistant.notice.hide") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-decision-notice-review"
          @click="review"
        >
          {{ t("assistant.runs.review") }}
        </OButton>
      </div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";

import {
  approvalClock,
  approvalDuration,
  shownSids,
  useAssistantName,
  useAssistantRuns,
  useAssistantStore,
  type RunRow,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { runTitle } from "./runsText";

const TICK_MS = 1_000;

/** Background sentences stay this far apart, and a warning is never dropped (`95` §2.1). */
const SPEAK_GAP_MS = 3_000;

const WARN_FIRST_MS = 60_000;

const WARN_LAST_MS = 20_000;

const SHARED_ROUTES: ReadonlySet<unknown> = new Set(["sharedChat", "publicSharedChat"]);

const emit = defineEmits<{
  /** One sentence for the header region, the notice's only voice. */
  announce: [text: I18nText];
  /** Hide notice was pressed; focus goes to the header button. */
  hidden: [];
}>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const runs = useAssistantRuns();
const route = useRoute();
const now = ref(Date.now());
const modalOpen = ref(false);
const hiddenRequests = ref(new Set<string>());
const warning = ref(new Set<string>());
const warnedWindows = new Set<string>();
const queue: I18nText[] = [];
let gap: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const requestOf = (row: RunRow) => row.request ?? row.sid;
const decisions = computed(() => runs.decisions.value);
const warned = computed(() => decisions.value.filter((row) => warning.value.has(requestOf(row))));
// A visible container showing another chat changes only the Runs button, until a card is about to expire.
const plain = computed(() =>
  shownSids(store.state).length
    ? []
    : decisions.value.filter((row) => !hiddenRequests.value.has(requestOf(row))),
);
const blocked = computed(() => modalOpen.value || SHARED_ROUTES.has(route?.name));
const subject = computed<RunRow | null>(() => {
  if (blocked.value) return null;
  return warned.value[0] ?? (plain.value.length === 1 ? plain.value[0] : null);
});
const line = computed<I18nText | null>(() => {
  if (subject.value) return t("assistant.notice.decision", { product });
  if (blocked.value || !plain.value.length) return null;
  return t("assistant.notice.decisionMany", { n: plain.value.length });
});
const clock = computed<I18nText | null>(() => {
  const until = subject.value?.expiresAt;
  if (typeof until !== "number") return null;
  const time = raw(approvalClock(until - now.value));
  return until - now.value <= WARN_FIRST_MS
    ? t("assistant.approval.expiringSoon", { time })
    : t("assistant.approval.expiresIn", { time });
});

function drain(): void {
  if (gap || !queue.length) return;
  emit("announce", queue.shift() as I18nText);
  gap = setTimeout(() => {
    gap = null;
    drain();
  }, SPEAK_GAP_MS);
}

function speak(text: I18nText): void {
  queue.push(text);
  drain();
}

function warningLine(row: RunRow, left: number): I18nText {
  const key =
    row.extendsLeft === 0
      ? "assistant.announce.approvalExpiringNoticeFinal"
      : "assistant.announce.approvalExpiringNotice";
  return t(key, { title: runTitle(row, t), duration: approvalDuration(left, t), product });
}

// A hidden notice comes back at each warning of each window, without taking focus (`20` §6.2).
function checkWarning(row: RunRow): void {
  if (row.expiresAt === null) return;
  const left = row.expiresAt - now.value;
  const request = requestOf(row);
  if (left <= 0 || left > WARN_FIRST_MS) return void warning.value.delete(request);
  const window = `${request}:${row.expiresAt}:${left <= WARN_LAST_MS ? WARN_LAST_MS : WARN_FIRST_MS}`;
  if (warnedWindows.has(window)) return;
  warnedWindows.add(window);
  warning.value.add(request);
  hiddenRequests.value.delete(request);
  speak(warningLine(row, left));
}

function tick(): void {
  now.value = Date.now();
  modalOpen.value = !!document.querySelector('[data-o2-dialog][data-state="open"]');
  decisions.value.forEach(checkWarning);
}

function hide(): void {
  const rows = warned.value.length ? warned.value : plain.value;
  rows.forEach((row) => {
    hiddenRequests.value.add(requestOf(row));
    warning.value.delete(requestOf(row));
  });
  emit("hidden");
}

function review(): void {
  const row = subject.value;
  if (row) void runs.open(row, { focus: "card" });
  else void runs.requestOpen();
}

// The header's light names one chat; a later request of the same light has no other voice.
function announceNew(rows: RunRow[], before: RunRow[] = []): void {
  const known = new Set(before.map(requestOf));
  const lit = store.headerLight.value.sid;
  for (const row of rows) {
    if (known.has(requestOf(row))) continue;
    if (row.sid !== lit || !store.state.sessions[row.sid])
      speak(t("assistant.header.announceNeedsYou", { product, title: runTitle(row, t) }));
  }
}

watch(
  decisions,
  (rows, before) => {
    const live = new Set(rows.map(requestOf));
    for (const set of [hiddenRequests.value, warning.value])
      for (const request of set) if (!live.has(request)) set.delete(request);
    announceNew(rows, before);
    if (rows.length && !timer) {
      tick();
      timer = setInterval(tick, TICK_MS);
    } else if (!rows.length && timer) {
      clearInterval(timer);
      timer = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (gap) clearTimeout(gap);
});
</script>
