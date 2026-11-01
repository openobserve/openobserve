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
      class="bg-surface-overlay rounded-surface fixed end-4 bottom-[calc(var(--o-assistant-inset-bottom,0rem)+1rem)] z-5000 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 border border-transparent p-3 shadow-lg"
      data-test="assistant-decision-notice"
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <p
          class="text-text-heading flex min-w-0 items-center gap-2 text-sm font-medium"
          data-test="assistant-decision-notice-line"
        >
          <AssistantStatusDot state="attention" />
          <span class="min-w-0 break-words">{{ line }}</span>
        </p>
        <OText
          v-if="subject"
          variant="body"
          as="p"
          class="break-words"
          data-test="assistant-decision-notice-chat"
        >
          {{ runTitle(subject, t) }}
        </OText>
        <OText
          v-if="subject && (ask || clock || orgLabel)"
          variant="meta"
          as="p"
          aria-live="off"
          class="break-words"
          data-test="assistant-decision-notice-request"
        >
          <template v-if="ask">{{ ask }}</template>
          <template v-if="clock">
            <template v-if="ask"> · </template>
            <span
              class="text-assistant-signal-attention tabular-nums"
              data-test="assistant-decision-notice-clock"
              >{{ clock }}</span
            >
          </template>
          <template v-if="orgLabel">
            <template v-if="ask || clock"> · </template>
            <span data-test="assistant-decision-notice-org">{{ orgLabel }}</span>
          </template>
        </OText>
      </div>
      <div class="flex items-center justify-end gap-2">
        <OButton
          variant="ghost"
          size="xs"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-decision-notice-hide"
          @click="hide"
        >
          {{ t("assistant.notice.hide") }}
        </OButton>
        <OButton
          variant="primary"
          size="xs"
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
import { useStore } from "vuex";

import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
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
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { runRequest, runTitle } from "./runsText";

const TICK_MS = 1_000;

/** Background sentences stay this far apart, and a warning is never dropped (`95` §2.1). */
const SPEAK_GAP_MS = 3_000;

const WARN_FIRST_MS = 60_000;

const WARN_LAST_MS = 20_000;

const SHARED_ROUTES: ReadonlySet<unknown> = new Set(["sharedChat", "publicSharedChat"]);

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

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (gap) clearTimeout(gap);
});
</script>
