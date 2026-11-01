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
    class="@container flex h-full min-h-0 min-w-0 flex-col gap-2 p-2"
    :role="mode === 'panel' ? 'region' : undefined"
    :aria-label="mode === 'panel' ? t('assistant.history.view.title') : undefined"
    :data-mode="mode"
    :data-readonly="readonly ? '' : undefined"
    data-dd-privacy="mask"
    data-test="assistant-history"
  >
    <div v-if="toolsShown" class="flex min-w-0 shrink-0 items-center gap-1">
      <OSearchInput
        :model-value="history.filter.value.q"
        size="sm"
        :placeholder="t('assistant.history.search')"
        :debounce="SEARCH_DEBOUNCE_MS"
        clearable
        :aria-controls="drawn.length ? listId : undefined"
        class="min-w-0 flex-1"
        data-test="assistant-history-search"
        @update:model-value="(q) => history.setFilter({ q })"
        @keydown="onSearchKey"
      />
      <ODropdown v-if="filterShown" align="end">
        <template #trigger>
          <OButton
            variant="ghost"
            size="xs"
            :icon-left="assistantGlyph.filter"
            :aria-label="filterName"
            :class="[
              'shrink-0 max-md:min-h-11 pointer-coarse:min-h-11',
              activeFilters.length && 'text-assistant-link',
            ]"
            data-test="assistant-history-filter"
          >
            <span v-if="!narrow">{{ filterName }}</span>
          </OButton>
        </template>
        <ODropdownGroup
          v-for="section in filterSections"
          :key="section.id"
          :label="section.label"
          :data-test="`assistant-history-filter-${section.id}`"
        >
          <ODropdownItem
            v-for="choice in section.choices"
            :key="choice.id"
            role="menuitemradio"
            :aria-checked="choice.checked"
            :data-test="`assistant-history-filter-${choice.id}`"
            @select="choice.toggle"
          >
            {{ choice.label }}
            <template v-if="choice.checked" #icon-right>
              <OIcon :name="assistantGlyph.done" size="sm" class="text-assistant-link ms-auto" />
            </template>
          </ODropdownItem>
        </ODropdownGroup>
      </ODropdown>
      <ODropdown align="end">
        <template #trigger>
          <AssistantIconButton
            :label="t('assistant.history.listMenu')"
            :icon="assistantGlyph.more"
            data-test="assistant-history-list-menu"
          />
        </template>
        <ODropdownItem
          v-if="sharesOffered"
          :icon-left="assistantGlyph.share"
          data-test="assistant-history-shared-links"
          @select="emit('shared-links')"
        >
          {{ t("assistant.history.sharedLinks") }}
        </ODropdownItem>
        <ODropdownItem
          v-if="history.rows.value.length"
          :icon-left="assistantGlyph.download"
          data-test="assistant-history-download-all"
          @select="exporter.exportAll('json')"
        >
          {{ t("assistant.history.downloadAll") }}
        </ODropdownItem>
        <ODropdownSub
          v-if="narrow && $slots['menu-layout']"
          :text-value="t('assistant.shell.layout')"
        >
          <template #icon-left><OIcon :name="assistantGlyph.layout" size="sm" /></template>
          <template #trigger>{{ t("assistant.shell.layout") }}</template>
          <slot name="menu-layout" />
        </ODropdownSub>
        <template v-if="history.rows.value.length && !readonly">
          <ODropdownSeparator />
          <ODropdownItem
            variant="destructive"
            :icon-left="assistantGlyph.remove"
            data-test="assistant-history-clear-all"
            @select="clearAllOpen = true"
          >
            {{ t("assistant.history.clearAll.action") }}
          </ODropdownItem>
        </template>
      </ODropdown>
    </div>

    <div ref="scroller" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <h2 v-if="mode === 'rail'" class="sr-only">{{ t("assistant.history.title") }}</h2>
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
        v-if="activeFilters.length"
        class="flex min-w-0 shrink-0 flex-wrap items-center gap-1"
        data-test="assistant-history-chips"
      >
        <OButton
          v-for="chip in activeFilters"
          :key="chip.id"
          variant="secondary"
          size="xs"
          :icon-right="assistantGlyph.close"
          :aria-label="t('assistant.history.filter.remove', { filter: chip.label })"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          :data-test="`assistant-history-chip-${chip.id}`"
          @click="chip.clear"
        >
          {{ chip.label }}
        </OButton>
        <OText variant="meta" as="span" data-test="assistant-history-chips-count">
          {{ t("assistant.history.filter.count", { count: drawn.length }, drawn.length) }}
        </OText>
      </div>
      <OText
        v-if="searchLine"
        variant="meta"
        as="p"
        class="sr-only"
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
          :title="
            triedAt ? t('assistant.history.serverErrorAgain') : t('assistant.history.serverError')
          "
          :description="triedAt ? t('assistant.history.lastTried', { time: triedTime }) : undefined"
          :action-label="t('common.retry')"
          data-test="assistant-history-error"
          @action="retryList"
        >
          <template v-if="listState.error && !triedAt" #description>
            <AssistantErrorDetails
              :error="listState.error"
              :at="errorAt"
              :is-admin="capability.isAdmin"
            />
          </template>
        </OEmptyState>
        <OEmptyState
          v-else-if="!history.rows.value.length && !drawn.length"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.empty.title')"
          data-test="assistant-history-empty"
        />
        <OEmptyState
          v-else-if="!drawn.length && query"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.noMatch', { q: raw(query) })"
          :description="titlesOnly ? t('assistant.history.titlesOnly') : undefined"
          :action-label="
            titlesOnly ? t('assistant.history.loadOlder') : t('assistant.history.clearSearch')
          "
          data-test="assistant-history-no-match"
          @action="titlesOnly ? loadOlder() : clearSearch()"
        />
        <OEmptyState
          v-else-if="!drawn.length"
          size="inline"
          :backdrop="false"
          :title="t('assistant.history.filterEmpty')"
          :action-label="t('assistant.history.filter.clear')"
          data-test="assistant-history-filter-empty"
          @action="clearFilters"
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
                <h3 :class="GROUP_HEADING_CLASS">{{ groupLabel(item.id) }}</h3>
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
                @float="floatRow"
                @stop="stopRow"
                @share="shareRow"
                @delete="askDelete"
                @delete-draft="deleteDraft"
              />
            </template>
          </OVirtualScroll>
        </div>
        <ul
          v-else
          :id="listId"
          :aria-label="t('assistant.history.title')"
          :aria-describedby="modeLineId"
          class="flex flex-col gap-3"
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
                {{ groupLabel(group.id) }}
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
                  @float="floatRow"
                  @stop="stopRow"
                  @share="shareRow"
                  @delete="askDelete"
                  @delete-draft="deleteDraft"
                />
              </ul>
            </div>
          </li>
        </ul>
        <OButton
          v-if="history.hasMore.value && drawn.length && !endScope"
          variant="ghost"
          size="sm"
          class="mt-1 max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-history-load-older"
          @click="loadOlder"
        >
          {{ t("assistant.history.loadOlder") }}
        </OButton>
      </div>

      <AssistantLocalOnlyHeader
        v-if="history.mode.value === 'local'"
        :count="history.localCount.value"
        :cap="LOCAL_CAP"
        :is-admin="capability.isAdmin"
        :clear-on-sign-out="clearOnSignOut"
        :description-id="modeLineId"
        class="px-2"
        @update:clear-on-sign-out="setClearOnSignOut"
      />
      <p
        v-else-if="endScope"
        :id="modeLineId"
        class="text-text-secondary px-2 text-xs"
        data-test="assistant-history-end-scope"
      >
        {{ t("assistant.history.titlesOnly") }} ·
        <button
          type="button"
          class="text-assistant-link cursor-pointer"
          data-test="assistant-history-load-older"
          @click="loadOlder"
        >
          {{ t("assistant.history.loadOlder") }}
        </button>
      </p>
      <OText
        v-else-if="retentionLine"
        :id="modeLineId"
        variant="meta"
        as="p"
        class="px-2"
        data-test="assistant-history-retention"
      >
        {{ retentionLine }}
      </OText>
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
    <AssistantShareControl
      v-if="sharing"
      v-model:open="sharingOpen"
      :sid="sharing"
      variant="drawer"
      @manage="emit('shared-links')"
    />
  </div>
</template>

<script lang="ts">
import type { Container, HistoryFilter, HistoryRow, Sid } from "@/composables/assistant";

export interface AssistantHistoryListProps {
  /** `panel` replaces a container's chat (D5 §3.2); `rail` sits beside the full view's chat. */
  mode: "panel" | "rail";
  currentSid: Sid | null;
  /** The window this list sits in: a row opens there, never in the primary container. */
  windowSid?: Sid | null;
  /** Where a row opens: the rail routes to the full view, the others open in their container. */
  container: Container;
  /** A window's own verdict from its geometry; its 2 px of borders would read 24 rem as narrower. */
  narrow?: boolean;
}

/** Filter joins the tools from this many chats, or while one is active. */
export const FILTER_FROM = 8;

export const SEARCH_DEBOUNCE_MS = 300;

/** From this many rows the list mounts only what is on screen. */
export const VIRTUAL_FROM = 150;

const GROUP_ORDER = [
  "running",
  "pinned",
  "today",
  "yesterday",
  "week",
  "older",
  "browser",
] as const;

const ROW_ESTIMATE_PX = 32;

const NARROW_REM = 24;

const REM_PX = 16;

const COUNTDOWN_TICK_MS = 1_000;

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
import AssistantShareControl from "@/components/ai-assistant/share/AssistantShareControl.vue";
import {
  groupOf,
  LOCAL_CAP,
  MAX_FLOATING_CHATS,
  registerHistoryTarget,
  runAgentKey,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantName,
  useAssistantRuns,
  useAssistantStore,
  useChatExport,
  type RunRow,
} from "@/composables/assistant";
import { rosterOffersChoice } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OVirtualScroll from "@/lib/core/VirtualScroll/OVirtualScroll.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import { queryClient } from "@/composables/query/queryClient";
import { mySharesQuery } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime, orgDayDistance, orgTimeZone } from "@/utils/formatters";

import AssistantHistoryConfirm from "./AssistantHistoryConfirm.vue";
import AssistantHistoryRow from "./AssistantHistoryRow.vue";
import AssistantImportCard from "./AssistantImportCard.vue";
import AssistantLocalOnlyHeader from "./AssistantLocalOnlyHeader.vue";
import { chatStatusOf, isInProgress, type ChatStatus } from "./chatStatus";
import { useAssistantHistoryKeys } from "./useAssistantHistoryKeys";

const props = defineProps<AssistantHistoryListProps>();

const emit = defineEmits<{ opened: [sid: Sid]; close: []; "shared-links": [] }>();

defineSlots<{ "menu-layout"?: () => unknown }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const history = useAssistantHistory();
const capability = useAssistantCapability();
const store = useAssistantStore();
const runs = useAssistantRuns();
const { lgUp } = useBreakpoint();
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
const widthRem = ref(Number.POSITIVE_INFINITY);
const sharing = ref<Sid | null>(null);
const sharingOpen = ref(false);
const triedAt = ref<number | null>(null);

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

const narrow = computed(() => {
  if (props.mode !== "panel") return false;
  return props.container === "window" ? props.narrow : widthRem.value < NARROW_REM;
});
const query = computed(() => history.filter.value.q.trim());
const titlesOnly = computed(() => history.searchPartial.value);
// The end line carries Load older while a title search has more to read.
const endScope = computed(() => titlesOnly.value && drawn.value.length > 0);
const sharesOffered = computed(
  () => capability.value.persistence && capability.value.canShare !== "no",
);
const offersAgents = computed(() => rosterOffersChoice(capability.value.agents));
const triedTime = computed(() => (triedAt.value ? formatOrgTime(triedAt.value) : ""));

function filterChoice<K extends "kind" | "agent" | "started">(
  key: K,
  value: NonNullable<HistoryFilter[K]>,
  off: HistoryFilter[K],
  id: string,
  label: I18nText,
) {
  const checked = history.filter.value[key] === value;
  return {
    id,
    label,
    checked,
    toggle: () => history.setFilter({ [key]: checked ? off : value }),
    clear: () => history.setFilter({ [key]: off }),
  };
}

// Only the server keeps share links, so a browser-only list has nothing to show as shared.
const filterSections = computed(() => {
  const server = history.mode.value === "server";
  const f = "assistant.history.filter";
  const sections = [
    {
      id: "show",
      label: t(`${f}.show`),
      choices: [
        filterChoice("kind", "pinned", "all", "pinned", t(`${f}.pinned`)),
        ...(server ? [filterChoice("kind", "shared", "all", "shared", t(`${f}.shared`))] : []),
      ],
    },
    {
      id: "started",
      label: t(`${f}.started`),
      choices: [
        filterChoice("started", "alert", null, "alert", t(`${f}.alertOrIncident`)),
        filterChoice("started", "editor", null, "editor", t(`${f}.queryEditor`)),
      ],
    },
  ];
  if (offersAgents.value)
    sections.splice(1, 0, {
      id: "agent",
      label: t(`${f}.agent`),
      choices: (["general", "investigator", "queryBuilder"] as const).map((id) =>
        filterChoice("agent", id, null, id, t(`assistant.runs.agent.${id}`, { product })),
      ),
    });
  return sections;
});
const activeFilters = computed(() =>
  filterSections.value.flatMap((section) => section.choices.filter((choice) => choice.checked)),
);
const filterShown = computed(
  () => history.rows.value.length >= FILTER_FROM || activeFilters.value.length > 0,
);
const filterName = computed(() =>
  activeFilters.value.length
    ? t("assistant.history.filter.active", { n: activeFilters.value.length })
    : t("assistant.history.filter.button"),
);
// A failed read or an empty list has nothing to search; a first load keeps the box under the skeleton.
const toolsShown = computed(
  () =>
    listState.value.status === "loading" ||
    listState.value.status === "idle" ||
    history.rows.value.length > 0 ||
    history.drafts.value.length > 0 ||
    !!query.value,
);

const retentionLine = computed(() => {
  if (history.hasMore.value || !history.rows.value.length) return null;
  const days = history.retentionDays.value;
  return days ? t("assistant.history.kept", { days }) : null;
});

// The rail row always matches the transcript, so a live chat the pages have not reached still lists.
const runBySid = computed(() => new Map(runs.rows.value.map((row) => [row.sid, row])));
const liveRows = computed<HistoryRow[]>(() => {
  const listed = new Set(history.rows.value.map((row) => row.sid));
  return runs.rows.value.filter((row) => !listed.has(row.sid) && isCounted(row)).map(rowOfRun);
});
const shownRows = computed<HistoryRow[]>(() => {
  if (query.value || activeFilters.value.length) return history.visible.value;
  const seen = new Set(history.visible.value.map((row) => row.sid));
  const drafts = history.drafts.value.filter((row) => !seen.has(row.sid));
  return [...liveRows.value, ...history.visible.value, ...drafts];
});
const drawn = computed(() => shownRows.value);

const searchLine = computed(() => {
  if (!query.value || !drawn.value.length) return null;
  const count = drawn.value.length;
  return t("assistant.history.matchCount", { count }, count);
});

const groups = computed(() => {
  const server = history.mode.value === "server";
  const zone = timezone.value;
  const buckets = new Map<GroupId, HistoryRow[]>();
  for (const row of drawn.value) {
    // A chat that answers or waits leaves its date group until it settles (D5 decision 2).
    const id = isInProgress(statusOf(row))
      ? "running"
      : groupOf(row, now.value, (ts, at) => orgDayDistance(ts, at, zone), server);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }
  return GROUP_ORDER.filter((id) => buckets.has(id)).map((id) => ({ id, rows: buckets.get(id)! }));
});

const virtual = computed(() => drawn.value.length > VIRTUAL_FROM);
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
let countdown: ReturnType<typeof setInterval> | null = null;
let sizes: ResizeObserver | null = null;
let unregisterHistory: (() => void) | null = null;

// A countdown moves every second; a list with none stays still.
watch(
  () => drawn.value.some((row) => typeof runBySid.value.get(row.sid)?.expiresAt === "number"),
  (counting) => {
    if (countdown) clearInterval(countdown);
    countdown = counting ? setInterval(tick, COUNTDOWN_TICK_MS) : null;
  },
  { immediate: true },
);

onMounted(() => {
  if (props.mode === "rail")
    unregisterHistory = registerHistoryTarget({
      el: () => root.value,
      priority: 2,
      run: focusSearch,
    });
  if (props.mode === "panel") root.value?.addEventListener("keydown", onRootKey);
  history.ensureLoaded();
  trackAssistant("ai_history_open", { placement: props.mode });
  clock = setInterval(tick, 60_000);
  if (props.mode !== "rail") void nextTick(() => focusSearch());
  measure();
  if (typeof ResizeObserver === "undefined" || !root.value) return;
  sizes = new ResizeObserver(measure);
  sizes.observe(root.value);
});
onBeforeUnmount(() => {
  root.value?.removeEventListener("keydown", onRootKey);
  if (clock) clearInterval(clock);
  if (countdown) clearInterval(countdown);
  sizes?.disconnect();
  unregisterHistory?.();
});

function tick(): void {
  now.value = Date.now();
}

function measure(): void {
  const width = root.value?.getBoundingClientRect().width ?? 0;
  if (width > 0) widthRem.value = width / REM_PX;
}

function rowProps(row: HistoryRow) {
  const run = runBySid.value.get(row.sid);
  return {
    row,
    status: statusOf(row),
    expiresAt: run?.expiresAt ?? null,
    now: now.value,
    org: run?.otherOrg ? orgLabel(run.org) : null,
    agentIcon: agentIcon(row),
    floatBlocked: floatBlocked.value,
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

const floatBlocked = computed(() =>
  store.state.shell.windows.length >= MAX_FLOATING_CHATS
    ? t("assistant.shell.placeWindowLimit")
    : !lgUp.value
      ? t("assistant.history.floatNeedsRoom")
      : undefined,
);

function agentIcon(row: HistoryRow): IconName | null {
  if (!offersAgents.value) return null;
  const key = runAgentKey(row.agentType);
  if (key === "investigator") return assistantGlyph.agentInvestigator;
  return key === "queryBuilder" ? assistantGlyph.agentQueryBuilder : assistantGlyph.agentGeneral;
}

function orgLabel(id: string): string {
  const orgs: { identifier: string; name?: string }[] = vuex.state.organizations ?? [];
  return orgs.find((candidate) => candidate.identifier === id)?.name ?? id;
}

function isCounted(row: RunRow): boolean {
  return (row.group === "answering" || row.group === "needs_you") && !row.consent;
}

function rowOfRun(run: RunRow): HistoryRow {
  return {
    sid: run.sid,
    chatId: null,
    title: run.title ?? t("assistant.thread.newChatTitle"),
    titleSource: "generated",
    createdAt: run.at,
    updatedAt: run.at,
    origin: "none",
    originContainer: "sidebar",
    pinned: false,
    activeTurn: run.group === "answering",
    pendingApproval: run.group === "needs_you",
    share: null,
    local: false,
    ephemeral: false,
    agentType: run.agent,
  };
}

function statusOf(row: HistoryRow): ChatStatus | null {
  if (history.drafts.value.some((draft) => draft.sid === row.sid)) return "draft";
  const run = runBySid.value.get(row.sid);
  if (run && isCounted(run)) return run.group === "needs_you" ? "needs_you" : "answering";
  if (run?.group === "failed") return "failed";
  return chatStatusOf(row, store.state.sessions[row.sid]?.turn);
}

function groupLabel(id: GroupId): string {
  if (id !== "running") return t(`assistant.history.group.${id}`);
  const count = groups.value.find((group) => group.id === "running")?.rows.length ?? 0;
  return t("assistant.history.group.running", { count, cap: runs.cap.value });
}

// Escape that nothing inside used (search clearing, a menu) returns the panel to its chat.
function onRootKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
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
  } else if (event.key === "Escape" && props.mode === "rail") {
    event.preventDefault();
    emit("close");
  }
}

function clearSearch(): void {
  history.setFilter({ q: "" });
  focusSearch();
}

function clearFilters(): void {
  history.setFilter({ kind: "all", agent: null, started: null });
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
  const windowSid = props.windowSid;
  const opening = windowSid
    ? store.openInWindow(windowSid, { sid })
    : store.openSession({ sid }, { focus: true });
  await opening.catch(() => undefined);
}

async function floatRow(sid: Sid): Promise<void> {
  if (!store.state.sessions[sid])
    await store.openSession({ sid }, { focus: false }).catch(() => undefined);
  store.floatChat(sid);
}

async function stopRow(sid: Sid): Promise<void> {
  const run = runBySid.value.get(sid);
  if (run) await runs.stop(run);
}

function shareRow(sid: Sid): void {
  sharing.value = sid;
  sharingOpen.value = true;
}

async function retryList(): Promise<void> {
  await history.retry();
  if (listState.value.status === "error") triedAt.value = Date.now();
}

function deleteDraft(sid: Sid): void {
  store.dropSession(sid, "deleted");
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

// The tools go with the rows, so focus returns to the chat instead of the page.
async function confirmClearAll(): Promise<void> {
  clearing.value = true;
  const result = await history.clearAll();
  clearing.value = false;
  clearAllOpen.value = false;
  if (result.ok) setTimeout(() => emit("close"), 0);
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
