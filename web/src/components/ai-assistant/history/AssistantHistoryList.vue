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
  <div
    ref="root"
    :class="[
      '@container flex min-h-0 min-w-0 flex-col gap-2',
      mode === 'popover' ? 'max-h-[70vh] p-2' : 'h-full p-2',
    ]"
    :data-mode="mode"
    :data-readonly="readonly ? '' : undefined"
    data-dd-privacy="mask"
    data-test="assistant-history"
  >
    <div class="flex min-w-0 shrink-0 items-center gap-1">
      <OSearchInput
        :model-value="history.filter.value.q"
        size="sm"
        :placeholder="t('assistant.history.search')"
        :debounce="SEARCH_DEBOUNCE_MS"
        clearable
        :aria-controls="history.visible.value.length ? listId : undefined"
        class="min-w-0 flex-1"
        data-test="assistant-history-search"
        @update:model-value="(q) => history.setFilter({ q })"
        @keydown="onSearchKey"
      />
      <template v-if="!readonly">
        <OButton
          v-if="mode === 'rail'"
          variant="outline"
          size="sm"
          :icon-left="assistantGlyph.newChat"
          class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-history-new"
          @click="emit('new')"
        >
          {{ t("assistant.history.new") }}
        </OButton>
        <AssistantIconButton
          v-else
          variant="outline"
          :label="t('assistant.history.new')"
          :icon="assistantGlyph.newChat"
          data-test="assistant-history-new"
          @click="emit('new')"
        />
      </template>
    </div>

    <div ref="scroller" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <h2 v-if="mode === 'rail'" class="sr-only">{{ t("assistant.history.title") }}</h2>
      <AssistantLocalOnlyHeader
        v-if="history.mode.value === 'local'"
        :count="history.localCount.value"
        :cap="LOCAL_CAP"
        :is-admin="capability.isAdmin"
        :clear-on-sign-out="clearOnSignOut"
        :description-id="modeLineId"
        @update:clear-on-sign-out="setClearOnSignOut"
      />
      <OText v-else :id="modeLineId" variant="meta" as="p" data-test="assistant-history-account">
        {{ accountLine }}
      </OText>
      <OText v-if="keptNotice" variant="meta" as="p" data-test="assistant-history-kept">
        {{ t("assistant.history.localOnly.keptOnSignOut") }}
      </OText>

      <AssistantImportCard
        v-if="history.importView.value && !readonly"
        :view="history.importView.value"
        :org="org"
        :downloading="exporter.busy.value.has('all')"
        @move="history.runImport()"
        @retry="history.runImport()"
        @dismiss="(kind) => history.dismissImport(kind)"
        @download="(sid) => exporter.exportChat(sid, 'json')"
        @download-all="exporter.exportAll('json', { scope: 'browser' })"
      />
      <OBanner
        v-if="history.storageBlocked.value"
        variant="warning"
        dense
        role="presentation"
        :content="t('assistant.history.storageBlocked')"
        data-test="assistant-history-storage-banner"
      />
      <OBanner
        v-if="errorWithRows"
        variant="warning"
        dense
        role="presentation"
        :content="
          listState.offline
            ? t('assistant.history.offline')
            : t('assistant.history.serverErrorCached')
        "
        data-test="assistant-history-error-banner"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-history-retry"
            @click="history.retry()"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>

      <div
        class="max-w-full min-w-0 shrink-0 overflow-x-auto"
        data-test="assistant-history-filter-strip"
      >
        <OToggleGroup
          type="single"
          mobile-dropdown
          :label="t('assistant.history.filter.label')"
          :model-value="history.filter.value.kind"
          data-test="assistant-history-filter"
          @update:model-value="
            (kind) => kind && history.setFilter({ kind: kind as HistoryFilter['kind'] })
          "
        >
          <OToggleGroupItem v-for="kind in filterKinds" :key="kind" :value="kind" size="sm">
            {{ t(`assistant.history.filter.${kind}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
      <OText
        v-if="searchLine"
        variant="meta"
        as="p"
        class="shrink-0"
        data-test="assistant-history-search-line"
      >
        {{ searchLine }}
      </OText>

      <div class="shrink-0">
        <div
          v-if="
            (listState.status === 'loading' || listState.status === 'idle') &&
            !history.rows.value.length
          "
          class="flex flex-col gap-2"
          data-test="assistant-history-skeleton"
        >
          <OSkeleton v-for="n in 5" :key="n" type="rect" class="h-8 w-full" />
        </div>
        <OEmptyState
          v-else-if="listState.status === 'error' && !history.rows.value.length"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.serverError')"
          :action-label="t('common.retry')"
          data-test="assistant-history-error"
          @action="history.retry()"
        >
          <template v-if="listState.error" #description>
            <AssistantErrorDetails
              :error="listState.error"
              :at="errorAt"
              :is-admin="capability.isAdmin"
            />
          </template>
        </OEmptyState>
        <OEmptyState
          v-else-if="!history.rows.value.length"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.empty.title')"
          :description="t('assistant.history.empty.body')"
          data-test="assistant-history-empty"
        />
        <OEmptyState
          v-else-if="!history.visible.value.length && history.filter.value.q.trim()"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.noMatch', { q: raw(history.filter.value.q.trim()) })"
          :action-label="t('assistant.history.clearSearch')"
          data-test="assistant-history-no-match"
          @action="clearSearch"
        />
        <OEmptyState
          v-else-if="!history.visible.value.length"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.filterEmpty')"
          :action-label="t('assistant.history.showAll')"
          data-test="assistant-history-filter-empty"
          @action="showAll"
        />
        <div
          v-else-if="virtual"
          :id="listId"
          role="list"
          :aria-label="t('assistant.history.title')"
          :aria-describedby="modeLineId"
          data-virtual=""
          data-test="assistant-history-list"
        >
          <OVirtualScroll
            ref="virtualList"
            :items="flat"
            :estimate-size="ROW_ESTIMATE_PX"
            :scroll-target="scroller"
            dynamic-row-height
          >
            <template #default="{ item }">
              <div
                v-if="item.kind === 'group'"
                role="listitem"
                :data-group="item.id"
                data-test="assistant-history-group"
              >
                <h3 :class="GROUP_HEADING_CLASS">{{ t(`assistant.history.group.${item.id}`) }}</h3>
              </div>
              <AssistantHistoryRow
                v-else
                :ref="(el) => setRow(item.row.sid, el)"
                tag="div"
                v-bind="rowProps(item.row)"
                @open="openRow"
                @navigate="(event) => keys.onKeydown(event, item.row.sid)"
                @rename="(sid, title) => history.rename(sid, title)"
                @pin="(sid, pinned) => history.pin(sid, pinned)"
                @download="(sid, format) => exporter.exportChat(sid, format)"
                @delete="askDelete"
              />
            </template>
          </OVirtualScroll>
        </div>
        <ul
          v-else
          :id="listId"
          :aria-label="t('assistant.history.title')"
          :aria-describedby="modeLineId"
          class="flex flex-col gap-2"
          data-test="assistant-history-list"
        >
          <li v-for="group in groups" :key="group.id" class="min-w-0">
            <div
              role="group"
              :aria-labelledby="`${listId}-${group.id}`"
              :data-group="group.id"
              data-test="assistant-history-group"
            >
              <h3 :id="`${listId}-${group.id}`" :class="GROUP_HEADING_CLASS">
                {{ t(`assistant.history.group.${group.id}`) }}
              </h3>
              <ul class="flex flex-col">
                <AssistantHistoryRow
                  v-for="row in group.rows"
                  :key="row.sid"
                  :ref="(el) => setRow(row.sid, el)"
                  v-bind="rowProps(row)"
                  @open="openRow"
                  @navigate="(event) => keys.onKeydown(event, row.sid)"
                  @rename="(sid, title) => history.rename(sid, title)"
                  @pin="(sid, pinned) => history.pin(sid, pinned)"
                  @download="(sid, format) => exporter.exportChat(sid, format)"
                  @delete="askDelete"
                />
              </ul>
            </div>
          </li>
        </ul>
        <OButton
          v-if="history.hasMore.value && history.visible.value.length"
          variant="ghost"
          size="sm"
          class="mt-1 max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-history-load-older"
          @click="loadOlder"
        >
          {{ t("assistant.history.loadOlder") }}
        </OButton>
      </div>

      <AssistantHistoryFooter
        :mode="history.mode.value"
        :has-rows="history.rows.value.length > 0"
        :has-more="history.hasMore.value"
        :retention-days="history.retentionDays.value"
        :readonly="readonly"
        :downloading="exporter.busy.value.has('all')"
        @download-all="exporter.exportAll('json')"
        @clear-all="clearAllOpen = true"
      >
        <template v-if="$slots.shares" #shares><slot name="shares" /></template>
      </AssistantHistoryFooter>
    </div>

    <AssistantHistoryConfirm
      kind="delete"
      :open="!!deleting"
      :mode="history.mode.value"
      :org="org"
      :org-name="orgName"
      :sid="deleting?.sid ?? null"
      :chat-title="deleting ? String(deleting.title) : ''"
      :running="!!deleting?.activeTurn"
      @update:open="(open) => !open && (deleting = null)"
      @confirm="confirmDelete"
    />
    <AssistantHistoryConfirm
      kind="clear_all"
      :open="clearAllOpen"
      :mode="history.mode.value"
      :org="org"
      :org-name="orgName"
      :count="history.total.value"
      :busy="clearing"
      @update:open="(open) => (clearAllOpen = open)"
      @confirm="confirmClearAll"
    />
  </div>
</template>

<script lang="ts">
import type { Container, HistoryFilter, HistoryRow, Sid } from "@/composables/assistant";

export interface AssistantHistoryListProps {
  mode: "popover" | "rail" | "drawer";
  currentSid: Sid | null;
  /** Where a row opens: the rail routes to the full view, the others open in their container. */
  container: Container;
}

export const SEARCH_DEBOUNCE_MS = 300;

/** From this many rows the list mounts only what is on screen. */
export const VIRTUAL_FROM = 150;

const GROUP_ORDER = ["pinned", "today", "yesterday", "week", "older", "browser"] as const;

const ROW_ESTIMATE_PX = 40;

const GROUP_HEADING_CLASS = "text-text-secondary px-2 pb-1 text-xs font-medium";

type GroupId = (typeof GROUP_ORDER)[number];

type FlatEntry = { kind: "group"; id: GroupId } | { kind: "row"; id: string; row: HistoryRow };
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import AssistantErrorDetails from "@/components/ai-assistant/common/AssistantErrorDetails.vue";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  groupOf,
  LOCAL_CAP,
  registerHistoryTarget,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantStore,
  useChatExport,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OVirtualScroll from "@/lib/core/VirtualScroll/OVirtualScroll.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { queryClient } from "@/composables/query/queryClient";
import { mySharesQuery } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { orgDayDistance, orgTimeZone } from "@/utils/formatters";

import AssistantHistoryConfirm from "./AssistantHistoryConfirm.vue";
import AssistantHistoryFooter from "./AssistantHistoryFooter.vue";
import AssistantHistoryRow from "./AssistantHistoryRow.vue";
import AssistantImportCard from "./AssistantImportCard.vue";
import AssistantLocalOnlyHeader from "./AssistantLocalOnlyHeader.vue";
import { useAssistantHistoryKeys } from "./useAssistantHistoryKeys";

const props = defineProps<AssistantHistoryListProps>();

const emit = defineEmits<{ opened: [sid: Sid]; new: [] }>();

defineSlots<{ shares?: () => unknown }>();

const { t } = useI18nTyped();
const history = useAssistantHistory();
const capability = useAssistantCapability();
const store = useAssistantStore();
const exporter = useChatExport();
const router = useRouter();
const vuex = useStore();
const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const virtualList = ref<{ scrollToIndex(index: number): void } | null>(null);
const listId = `assistant-history-${useId()}`;
const modeLineId = `${listId}-mode`;
const rowRefs = new Map<Sid, InstanceType<typeof AssistantHistoryRow>>();
const deleting = ref<HistoryRow | null>(null);
const clearAllOpen = ref(false);
const clearing = ref(false);
const clearOnSignOut = ref(history.clearOnSignOut());
const keptNotice = ref(history.mode.value === "local" && history.takeKeptNotice());
const now = ref(Date.now());

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const orgName = computed<string>(() => vuex.state.selectedOrganization?.label ?? org.value);
const timezone = computed(() => orgTimeZone());
const readonly = computed(() => capability.value.canChat === "no");
const listState = computed(() => history.listState.value);
const errorWithRows = computed(
  () => listState.value.status === "error" && history.rows.value.length > 0,
);
// Read only while the Shared filter is on, so opening the list costs no extra request.
const shares = useQuery(
  computed(() => ({
    ...mySharesQuery(org.value),
    enabled:
      history.mode.value === "server" && history.filter.value.kind === "shared" && !!org.value,
  })),
  queryClient,
);
watch(
  () => shares.data.value,
  // The server lists live links only, but a cached list can outlive a link's expiry (micros).
  (list) =>
    history.noteShared(
      (list ?? [])
        .filter((share) => share.expires_at == null || share.expires_at > Date.now() * 1_000)
        .map((share) => share.session_id as Sid),
    ),
  { immediate: true },
);

// Only the server keeps share links, so a browser-only list has nothing to show as shared.
const filterKinds = computed<HistoryFilter["kind"][]>(() => [
  "all",
  "pinned",
  "editor",
  "alert",
  "incident",
  ...(history.mode.value === "server" ? (["shared"] as const) : []),
]);

const accountLine = computed(() => {
  const days = history.retentionDays.value;
  return days
    ? t("assistant.history.account", {
        retention: t("assistant.history.retentionDays", { count: days }, days),
      })
    : t("assistant.history.accountNoRetention");
});

const searchLine = computed(() => {
  const q = history.filter.value.q.trim();
  if (!q || !history.visible.value.length) return null;
  if (history.searchPartial.value) return t("assistant.history.searchPartial");
  const count = history.visible.value.length;
  return t("assistant.history.matchCount", { count }, count);
});

const groups = computed(() => {
  const server = history.mode.value === "server";
  const zone = timezone.value;
  const buckets = new Map<GroupId, HistoryRow[]>();
  for (const row of history.visible.value) {
    const id = groupOf(row, now.value, (ts, at) => orgDayDistance(ts, at, zone), server);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }
  return GROUP_ORDER.filter((id) => buckets.has(id)).map((id) => ({ id, rows: buckets.get(id)! }));
});

const virtual = computed(() => history.visible.value.length > VIRTUAL_FROM);
const flat = computed<FlatEntry[]>(() =>
  groups.value.flatMap((group) => [
    { kind: "group" as const, id: group.id },
    ...group.rows.map((row) => ({ kind: "row" as const, id: row.sid, row })),
  ]),
);
const errorAt = computed(() => (listState.value.error ? Date.now() : 0));

const ordered = computed(() =>
  groups.value.flatMap((group) =>
    group.rows.map((row) => ({ sid: row.sid, title: String(row.title) })),
  ),
);
const preferred = computed(() => props.currentSid);
const keys = useAssistantHistoryKeys(ordered, preferred, focusRow);

// Day groups move at midnight in the org zone without a reload.
let clock: ReturnType<typeof setInterval> | null = null;
let unregisterHistory: (() => void) | null = null;
onMounted(() => {
  if (props.mode === "rail")
    unregisterHistory = registerHistoryTarget({
      el: () => root.value,
      priority: 2,
      run: focusSearch,
    });
  history.ensureLoaded();
  trackAssistant("ai_history_open", { placement: props.mode });
  clock = setInterval(() => (now.value = Date.now()), 60_000);
  if (props.mode !== "rail") void nextTick(() => focusSearch());
});
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
  unregisterHistory?.();
});

function rowProps(row: HistoryRow) {
  return {
    row,
    current: row.sid === props.currentSid,
    mode: props.mode,
    pending: history.pending[row.sid] ?? null,
    tabbable: keys.active.value === row.sid,
    readonly: readonly.value,
    serverMode: history.mode.value === "server",
    serverPins: history.serverPins.value,
    timezone: timezone.value,
  };
}

// A virtual row may be off screen: bring it in first, then focus it.
async function focusRow(sid: Sid): Promise<void> {
  const mounted = rowRefs.get(sid);
  if (mounted) return mounted.focus();
  const index = flat.value.findIndex((entry) => entry.kind === "row" && entry.id === sid);
  if (index < 0) return;
  virtualList.value?.scrollToIndex(index);
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  rowRefs.get(sid)?.focus();
}

function setRow(sid: Sid, el: unknown): void {
  if (el) rowRefs.set(sid, el as InstanceType<typeof AssistantHistoryRow>);
  else rowRefs.delete(sid);
}

function focusSearch(): void {
  root.value
    ?.querySelector<HTMLInputElement>(
      '[data-test="assistant-history-search"] input, input[type="search"]',
    )
    ?.focus();
}

// Escape clears the search first; a second Escape reaches the popover.
function onSearchKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    keys.focusFirst();
  } else if (event.key === "Escape" && history.filter.value.q) {
    event.stopPropagation();
    event.preventDefault();
    history.setFilter({ q: "" });
  }
}

function clearSearch(): void {
  history.setFilter({ q: "" });
  focusSearch();
}

function showAll(): void {
  history.setFilter({ kind: "all" });
  focusSearch();
}

async function openRow(sid: Sid): Promise<void> {
  keys.setActive(sid);
  if (props.mode === "rail") {
    await router.push({
      name: "assistant",
      params: { chatId: sid },
      query: { org_identifier: org.value },
    });
    emit("opened", sid);
    return;
  }
  emit("opened", sid);
  await store.openSession({ sid }, { focus: true }).catch(() => undefined);
}

function askDelete(sid: Sid): void {
  deleting.value = history.rows.value.find((row) => row.sid === sid) ?? null;
}

async function confirmDelete(): Promise<void> {
  const row = deleting.value;
  deleting.value = null;
  if (!row) return;
  const result = await history.remove(row.sid);
  if (result.ok) await nextTick(() => keys.focusFirst());
}

// The footer's button goes with the rows, so focus lands on the search instead of the page.
async function confirmClearAll(): Promise<void> {
  clearing.value = true;
  const result = await history.clearAll();
  clearing.value = false;
  clearAllOpen.value = false;
  if (result.ok) setTimeout(focusSearch, 0);
}

function setClearOnSignOut(on: boolean): void {
  clearOnSignOut.value = on;
  history.setClearOnSignOut(on);
}

async function loadOlder(): Promise<void> {
  await history.loadOlder();
}

defineExpose({ focusSearch });
</script>
