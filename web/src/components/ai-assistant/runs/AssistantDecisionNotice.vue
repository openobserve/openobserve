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
  <!-- In the header's flow, never floating over the page (BRIEF-R7 rule 3); a phone keeps the header button's light -->
  <!-- The header shrinks only this strip; too narrow for Review, it steps aside and the header button's count stands in -->
  <section
    v-if="line"
    ref="strip"
    :aria-label="t('assistant.notice.region', { product })"
    data-assistant-surface
    data-dd-privacy="mask"
    :class="[
      'border-border-default bg-surface-base rounded-default hidden h-7.5 max-w-[26rem] min-w-0 shrink! items-center gap-2 overflow-hidden border ps-2 pe-0.5 md:inline-flex',
      fits ? '' : 'invisible',
    ]"
    :data-fits="fits ? 'true' : 'false'"
    data-test="assistant-decision-notice"
  >
    <AssistantStatusDot state="attention" class="shrink-0" data-keep />
    <span
      class="text-text-heading shrink-0 text-xs font-medium whitespace-nowrap"
      data-keep
      data-test="assistant-decision-notice-line"
      >{{ line }}</span
    >
    <!-- The full title sizes the strip and is what is read aloud; the visible copy is cut at a word -->
    <span
      v-if="subject"
      ref="chat"
      class="relative min-w-0 shrink-[8] truncate text-xs text-transparent"
      :title="ask ? String(ask) : undefined"
      data-test="assistant-decision-notice-chat"
      >{{ chatTitle
      }}<span
        aria-hidden="true"
        class="text-text-secondary absolute inset-0 truncate"
        data-test="assistant-decision-notice-chat-shown"
        >{{ shownTitle ?? chatTitle }}</span
      ></span
    >
    <span
      v-if="clock"
      class="text-assistant-signal-attention shrink-0 text-xs tabular-nums"
      aria-live="off"
      data-test="assistant-decision-notice-clock"
      >{{ clock }}</span
    >
    <span
      v-if="orgLabel"
      class="text-text-secondary shrink-0 text-xs whitespace-nowrap"
      data-test="assistant-decision-notice-org"
      >{{ orgLabel }}</span
    >
    <OButton
      variant="ghost-primary"
      size="chip"
      class="shrink-0"
      data-keep
      data-test="assistant-decision-notice-review"
      @click="review"
    >
      {{ t("assistant.runs.review") }}
    </OButton>
    <OButton
      variant="ghost"
      size="chip"
      class="shrink-0"
      data-keep
      data-test="assistant-decision-notice-hide"
      @click="hide"
    >
      {{ t("assistant.notice.hide") }}
    </OButton>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { textMeasure, wordFit } from "@/components/ai-assistant/shell/wordFit";
import {
  approvalClock,
  approvalDuration,
  useAssistantName,
  useAssistantRuns,
  useAssistantStore,
  type RunRow,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { runRequest, runTitle } from "./runsText";

const TICK_MS = 1_000;

/** Background sentences stay this far apart, and a warning is never dropped (`95` §2.1). */
const SPEAK_GAP_MS = 3_000;

const WARN_FIRST_MS = 60_000;

const WARN_LAST_MS = 20_000;

const SHARED_ROUTES: ReadonlySet<unknown> = new Set(["sharedChat", "publicSharedChat"]);

/** Room the chat's title keeps beside the count, Review and Hide; below it the strip steps aside. */
const MIN_TEXT_PX = 48;

const emit = defineEmits<{
  /** One sentence for the header region, the notice's only voice. */
  announce: [text: I18nText];
  /** Hide was pressed; focus goes to the header button. */
  hidden: [];
}>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const runs = useAssistantRuns();
const route = useRoute();
const vuex = useStore();
const { lgUp } = useBreakpoint();
const now = ref(Date.now());
const modalOpen = ref(false);
const hiddenRequests = ref(new Set<string>());
const warning = ref(new Set<string>());
const warnedWindows = new Set<string>();
const queue: I18nText[] = [];
let gap: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const strip = ref<HTMLElement | null>(null);
const chat = ref<HTMLElement | null>(null);
const fits = ref(true);
const shownTitle = ref<string | null>(null);
let sizeObserver: ResizeObserver | null = null;

const requestOf = (row: RunRow) => row.request ?? row.sid;
const decisions = computed(() => runs.decisions.value);
const warned = computed(() => decisions.value.filter((row) => warning.value.has(requestOf(row))));
const plain = computed(() =>
  decisions.value.filter((row) => !hiddenRequests.value.has(requestOf(row))),
);
// A full phone sheet covers the notice; its own warning row stands in.
const coveredBySheet = computed(() => {
  const { placement, sheetSnap } = store.state.shell;
  return !lgUp.value && placement.kind !== "hidden" && sheetSnap === "full";
});
const blocked = computed(
  () => modalOpen.value || coveredBySheet.value || SHARED_ROUTES.has(route?.name),
);
// Line 1 counts; lines 2 and 3 name the request that ends first, and a warning brings its own back.
const listedRows = computed(() => {
  const warnedRows = warned.value.filter((row) => !plain.value.includes(row));
  return [...warnedRows, ...plain.value];
});
const subject = computed<RunRow | null>(() =>
  blocked.value ? null : (listedRows.value[0] ?? null),
);
const line = computed<I18nText | null>(() => {
  if (!subject.value) return null;
  const count = listedRows.value.length;
  return count > 1
    ? t("assistant.notice.decisionMany", { n: count })
    : t("assistant.notice.decision");
});
const ask = computed(() => (subject.value ? runRequest(subject.value, t) : null));
const chatTitle = computed(() => (subject.value ? String(runTitle(subject.value, t)) : ""));
// The time joins the request at the warnings, in amber; the bare clock stays on the card.
const clock = computed<string | null>(() => {
  const until = subject.value?.expiresAt;
  if (typeof until !== "number" || until - now.value > WARN_FIRST_MS) return null;
  return approvalClock(until - now.value);
});
const orgLabel = computed<I18nText | null>(() => {
  const row = subject.value;
  if (!row?.otherOrg) return null;
  const orgs: { identifier: string; name?: string }[] = vuex.state.organizations ?? [];
  const name = orgs.find((org) => org.identifier === row.org)?.name ?? row.org;
  return t("assistant.notice.inOrg", { org: raw(name) });
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
  listedRows.value.forEach((row) => {
    hiddenRequests.value.add(requestOf(row));
    warning.value.delete(requestOf(row));
  });
  emit("hidden");
}

function review(): void {
  const row = subject.value;
  // Another org's chat never opens in place, so Review lists it (PO B51).
  if (row && !row.otherOrg) void runs.open(row, { focus: "card" });
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

// Invisible keeps the strip's box, so its width still tells when the header has room again.
function measureFit(el: HTMLElement): void {
  const style = getComputedStyle(el);
  const kept = [...el.querySelectorAll<HTMLElement>("[data-keep]")];
  const gaps = (parseFloat(style.columnGap) || 0) * kept.length;
  const padding =
    (parseFloat(style.paddingInlineStart) || 0) + (parseFloat(style.paddingInlineEnd) || 0);
  const need = kept.reduce((sum, node) => sum + node.offsetWidth, 0) + gaps + padding + MIN_TEXT_PX;
  fits.value = el.clientWidth >= need;
  fitTitle();
}

function fitTitle(): void {
  const el = chat.value;
  const measure = el ? textMeasure(el) : null;
  shownTitle.value = el && measure ? wordFit(chatTitle.value, el.clientWidth, measure) : null;
}

watch([chatTitle, chat], () => void nextTick(fitTitle));

watch(strip, (el) => {
  sizeObserver?.disconnect();
  sizeObserver = null;
  fits.value = true;
  if (!el || typeof ResizeObserver === "undefined") return;
  sizeObserver = new ResizeObserver(() => measureFit(el));
  sizeObserver.observe(el);
  measureFit(el);
});

onBeforeUnmount(() => {
  sizeObserver?.disconnect();
  if (timer) clearInterval(timer);
  if (gap) clearTimeout(gap);
});
</script>
