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
  <ODialog
    :open="open"
    size="md"
    :max-height="70"
    :title="placeholder"
    data-test="assistant-chat-search"
    @update:open="setOpen"
  >
    <template #header>
      <div ref="bar" class="flex min-w-0 items-center gap-2">
        <OSearchInput
          :model-value="text"
          size="md"
          :clearable="false"
          :placeholder="placeholder"
          :debounce="SEARCH_DEBOUNCE_MS"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="results.length > 0"
          :aria-controls="listId"
          :aria-activedescendant="activeId"
          class="min-w-0 flex-1 [&>div]:border-transparent! [&>div]:bg-transparent! [&>div]:shadow-none! [&>div]:ring-0!"
          data-test="assistant-chat-search-input"
          @update:model-value="setText"
          @keydown="onKey"
        />
        <OButton
          v-if="text"
          variant="ghost"
          size="xs"
          data-test="assistant-chat-search-clear"
          @click="clear"
        >
          {{ t("components.input.clear") }}
        </OButton>
      </div>
    </template>

    <p class="sr-only" aria-live="polite" data-test="assistant-chat-search-line">
      {{ countLine }}
    </p>
    <div v-if="loading" class="flex flex-col gap-2" data-test="assistant-chat-search-skeleton">
      <OSkeleton v-for="n in 4" :key="n" type="rect" class="h-10 w-full" />
    </div>
    <OEmptyState
      v-else-if="!results.length"
      size="inline"
      :backdrop="false"
      :title="
        query
          ? t('assistant.history.noMatch', { q: raw(query) })
          : t('assistant.history.empty.title')
      "
      :description="query && titlesOnly ? t('assistant.history.titlesOnly') : undefined"
      data-test="assistant-chat-search-empty"
    />
    <ul
      v-else
      :id="listId"
      role="listbox"
      :aria-label="t('assistant.history.title')"
      class="-mx-2 flex flex-col"
      data-test="assistant-chat-search-results"
    >
      <li
        v-for="(result, index) in results"
        :id="`${listId}-${index}`"
        :key="result.sid"
        role="option"
        :aria-selected="index === active"
        :class="[
          'rounded-default flex min-w-0 cursor-pointer items-center gap-3 px-2 py-2 max-md:min-h-11 pointer-coarse:min-h-11',
          index === active && 'bg-surface-subtle',
        ]"
        :data-sid="result.sid"
        :data-active="index === active ? '' : undefined"
        tabindex="-1"
        data-test="assistant-chat-search-result"
        @pointermove="active = index"
        @click="choose(index)"
        @keydown.enter="choose(index)"
      >
        <OIcon
          :name="assistantGlyph.thread"
          size="sm"
          class="text-text-secondary shrink-0"
          aria-hidden="true"
        />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="text-text-body truncate text-sm" data-test="assistant-chat-search-title">
            <template v-for="(part, n) in result.title" :key="n">
              <mark v-if="part.hit" :class="MARK_CLASS">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span
            v-if="result.snippet"
            class="text-text-secondary truncate text-xs"
            data-test="assistant-chat-search-snippet"
          >
            <template v-for="(part, n) in result.snippet" :key="n">
              <mark v-if="part.hit" :class="MARK_CLASS">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
        </span>
        <span
          class="text-text-secondary shrink-0 text-xs tabular-nums"
          data-test="assistant-chat-search-date"
          >{{ formatRelative(result.updatedAt, now) }}</span
        >
      </li>
    </ul>
    <div v-if="history.hasMore.value && !loading && !onServer" class="flex items-center gap-1 pt-2">
      <OText v-if="query && titlesOnly" variant="meta" as="span">
        {{ t("assistant.history.titlesOnly") }} ·
      </OText>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="assistant-chat-search-load-older"
        @click="history.loadOlder()"
      >
        {{ t("assistant.history.loadOlder") }}
      </OButton>
    </div>
  </ODialog>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantChatSearchProps {
  open: boolean;
  /** `rail` routes a chosen chat to the full view; `panel` opens it in the list's container. */
  mode?: "panel" | "rail";
  windowSid?: Sid | null;
  /** Only investigations, matched by title in this browser. */
  investigationsOnly?: boolean;
}

interface SearchResult {
  sid: Sid;
  updatedAt: number;
  title: TextPart[];
  snippet: TextPart[] | null;
}

export const SEARCH_DEBOUNCE_MS = 200;

/** Results drawn at once; Load older and a narrower query reach the rest. */
export const RESULT_CAP = 100;

const MARK_CLASS = "text-text-heading bg-transparent font-semibold";
</script>

<script setup lang="ts">
import { useQueries, useQuery } from "@tanstack/vue-query";
import { computed, nextTick, ref, useId, watch } from "vue";
import { useStore } from "vuex";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  isHelperChat,
  runAgentKey,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantStore,
} from "@/composables/assistant";
import { queryClient } from "@/composables/query/queryClient";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { assistantChatQuery, assistantChatsQuery } from "@/services/assistant.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatRelative } from "@/utils/formatters";

import {
  highlightParts,
  messageSnippet,
  PEEK_LIMIT,
  snippetOf,
  titleWindow,
  turnTexts,
  type TextPart,
} from "./chatSearch";
import { useOpenChat } from "./useOpenChat";

const props = withDefaults(defineProps<AssistantChatSearchProps>(), {
  mode: "rail",
  windowSid: null,
  investigationsOnly: false,
});

const emit = defineEmits<{ "update:open": [open: boolean]; opened: [sid: Sid] }>();

const { t } = useI18nTyped();
const history = useAssistantHistory();
const store = useAssistantStore();
const capability = useAssistantCapability();
const vuex = useStore();
const openChat = useOpenChat();
const listId = `assistant-chat-search-${useId()}`;
const bar = ref<HTMLElement | null>(null);
const text = ref("");
const active = ref(0);
const enterPending = ref(false);
const now = ref(Date.now());

const query = computed(() => text.value.trim());
const placeholder = computed(() =>
  props.investigationsOnly
    ? t("assistant.history.searchInvestigations")
    : t("assistant.history.search"),
);
// The dialog keeps its own query, so the list behind it and the stored filter never move while it searches.
const onServer = computed(
  () =>
    !props.investigationsOnly &&
    !!query.value &&
    capability.value.persistence &&
    capability.value.historySearch === true,
);
const served = useQuery(
  computed(() => ({
    ...assistantChatsQuery(
      vuex.state.selectedOrganization?.identifier ?? "",
      undefined,
      query.value || undefined,
    ),
    enabled: props.open && onServer.value,
  })),
  queryClient,
);
const titlesOnly = computed(() => !onServer.value && history.hasMore.value);
const loading = computed(() => {
  if (onServer.value) return !served.data.value && !served.isError.value;
  const status = history.listState.value.status;
  return (status === "loading" || status === "idle") && !history.rows.value.length;
});

// A chat opened in this browser keeps its messages, so its snippet comes from them; others match by title.
const messagesBySid = computed(() => {
  const map = new Map<Sid, readonly ChatMessage[]>();
  for (const record of history.localRecords())
    if (record.sessionId) map.set(record.sessionId as Sid, record.messages);
  for (const [sid, session] of Object.entries(store.state.sessions))
    if (session?.messages.length) map.set(sid as Sid, session.messages);
  return map;
});

type Match = Pick<SearchResult, "sid" | "updatedAt"> & { title: string };

// Titles, then the messages this browser holds; the server's own search answers when it offers one.
const matched = computed<Match[]>(() => {
  const needle = query.value.toLowerCase();
  if (onServer.value)
    return (served.data.value?.chats ?? [])
      .filter((chat) => !isHelperChat({ title: chat.title, agentType: chat.agent_type }))
      .map((chat) => ({
        sid: chat.session_id as Sid,
        title: chat.title,
        updatedAt: Math.floor(chat.updated_at / 1_000),
      }));
  return history.rows.value
    .filter((row) => !props.investigationsOnly || runAgentKey(row.agentType) === "investigator")
    .filter(
      (row) =>
        !needle ||
        String(row.title).toLowerCase().includes(needle) ||
        (!props.investigationsOnly &&
          !!messagesBySid.value
            .get(row.sid)
            ?.some((message) => String(message.content).toLowerCase().includes(needle))),
    )
    .map((row) => ({ sid: row.sid, title: String(row.title), updatedAt: row.updatedAt }));
});

const hasTitleHit = (title: string) => title.toLowerCase().includes(query.value.toLowerCase());
// A server match whose title hides the hit reads its chat, so the row can show where it matched.
const peekSids = computed(() =>
  onServer.value
    ? matched.value
        .filter((match) => !hasTitleHit(match.title) && !messagesBySid.value.has(match.sid))
        .slice(0, PEEK_LIMIT)
        .map((match) => match.sid)
    : [],
);
const peeks = useQueries(
  {
    queries: () =>
      peekSids.value.map((sid) => ({
        ...assistantChatQuery(vuex.state.selectedOrganization?.identifier ?? "", sid),
        enabled: props.open,
      })),
  },
  queryClient,
);
const peekedTexts = computed(() => {
  const map = new Map<Sid, string[]>();
  peekSids.value.forEach((sid, index) => {
    const turns = peeks.value[index]?.data?.turns;
    if (turns) map.set(sid, turnTexts(turns));
  });
  return map;
});

function snippetFor(sid: Sid): string | null {
  if (!query.value) return null;
  const messages = messagesBySid.value.get(sid);
  if (messages) return messageSnippet(messages, query.value);
  for (const text of peekedTexts.value.get(sid) ?? []) {
    const found = snippetOf(text, query.value);
    if (found) return found;
  }
  return null;
}

const results = computed<SearchResult[]>(() =>
  matched.value.slice(0, RESULT_CAP).map((match) => {
    const snippet = snippetFor(match.sid);
    return {
      sid: match.sid,
      updatedAt: match.updatedAt,
      title: highlightParts(titleWindow(match.title, query.value), query.value),
      snippet: snippet ? highlightParts(snippet, query.value) : null,
    };
  }),
);

const activeId = computed(() =>
  results.value.length
    ? `${listId}-${Math.min(active.value, results.value.length - 1)}`
    : undefined,
);
const countLine = computed(() => {
  if (!query.value || loading.value) return "";
  const count = results.value.length;
  return count
    ? t("assistant.history.matchCount", { count }, count)
    : t("assistant.history.noMatch", { q: raw(query.value) });
});

const resultSids = computed(() => results.value.map((result) => result.sid));
// Snippets and streamed messages recompute the rows; only a new query or row set moves the highlight.
watch([query, () => resultSids.value.join("\n")], ([q], [prevQ, prevSids]) => {
  const keep =
    q === prevQ ? resultSids.value.indexOf(prevSids.split("\n")[active.value] as Sid) : -1;
  active.value = Math.max(keep, 0);
});

// keepPreviousData shows the last query's server rows while the new one loads.
const settled = computed(
  () => !loading.value && !(onServer.value && served.isPlaceholderData.value),
);
watch(settled, (ready) => ready && enterPending.value && chooseActive());

watch(
  () => props.open,
  (open) => open && start(),
  { immediate: true },
);

// The dialog autofocuses fields in its body only; this one sits in the header.
function focusInput(): void {
  requestAnimationFrame(() => bar.value?.querySelector("input")?.focus());
}

function start(): void {
  focusInput();
  now.value = Date.now();
  text.value = "";
  active.value = 0;
  enterPending.value = false;
  history.ensureLoaded();
  trackAssistant("ai_history_open", { placement: props.mode });
}

function setOpen(open: boolean): void {
  emit("update:open", open);
}

function setText(value: string): void {
  if (value === text.value) return;
  text.value = value;
  enterPending.value = false;
  const q = value.trim();
  if (q)
    trackAssistant("ai_history_search", { length_bucket: lengthBucket(q), server: onServer.value });
}

function lengthBucket(q: string): "1_20" | "21_100" | "101_500" | "500_plus" {
  if (q.length <= 20) return "1_20";
  if (q.length <= 100) return "21_100";
  return q.length <= 500 ? "101_500" : "500_plus";
}

function clear(): void {
  setText("");
  bar.value?.querySelector("input")?.focus();
}

function onKey(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const count = results.value.length;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!count) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    active.value = (active.value + step + count) % count;
    scrollActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    void enter((event.target as HTMLInputElement | null)?.value);
  }
}

// Enter can land inside the input debounce; the typed text, not the last emitted one, picks the chat.
async function enter(typed: string | undefined): Promise<void> {
  if (typed !== undefined && typed !== text.value) {
    setText(typed);
    await nextTick();
  }
  chooseActive();
}

function chooseActive(): void {
  enterPending.value = !settled.value;
  const count = results.value.length;
  if (!enterPending.value && count) void choose(Math.min(active.value, count - 1));
}

function scrollActive(): void {
  requestAnimationFrame(() =>
    document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: "nearest" }),
  );
}

async function choose(index: number): Promise<void> {
  const sid = results.value[index]?.sid;
  if (!sid) return;
  setOpen(false);
  await openChat(sid, { mode: props.mode, windowSid: props.windowSid }, (opened) =>
    emit("opened", opened),
  );
}
</script>
