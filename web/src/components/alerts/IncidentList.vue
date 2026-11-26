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
  <div data-test="incident-list" class="incident-list h-full">
    <OPageLayout
      bleed
      :title="t('alerts.incidents.title')"
      icon="notifications-active"
      :subtitle="t('alerts.incidents.subtitle')"
    >
      <OTable
        ref="qTableRef"
        :data="visibleIncidents"
        :columns="columns"
        :frame="false"
        :loading="loading"
        :forbidden="forbidden"
        row-key="id"
        pagination="none"
        sorting="server"
        :sort-by="sortBy"
        :sort-order="sortOrder"
        @update:sort-by="sortBy = $event"
        @update:sort-order="sortOrder = $event"
        filter-mode="server"
        :default-columns="false"
        show-index
        virtual-scroll
        :overscan="20"
        :show-global-filter="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="alerts-incident-list"
        data-test="incident-list-table"
        :get-row-style="incidentRowStyle"
        @row-click="viewIncident($event)"
      >
        <!-- Toolbar: status toggle (All / Active / Resolved) + search — same
             shape as the Alerts page tabs. -->
        <template #toolbar>
          <div class="contents">
            <OToggleGroup
              mobile-dropdown
              :model-value="statusFilter"
              @update:model-value="(v) => filterByStatus(v as string)"
              data-test="incident-status-filter-group"
            >
              <OToggleGroupItem value="active" size="sm" data-test="incident-status-filter-active">
                <template #icon-left><OIcon name="radio-button-unchecked" size="sm" /></template>
                {{ t("alerts.incidents.filterActive") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="open" size="sm" data-test="incident-status-filter-open">
                <template #icon-left><OIcon name="error-outline" size="sm" /></template>
                {{ t("alerts.incidents.statusOpen") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="resolved"
                size="sm"
                data-test="incident-status-filter-resolved"
              >
                <template #icon-left><OIcon name="task-alt" size="sm" /></template>
                {{ t("alerts.incidents.statusResolved") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="all" size="sm" data-test="incident-status-filter-all">
                <template #icon-left><OIcon name="format-list-bulleted" size="sm" /></template>
                {{ t("alerts.incidents.filterAll") }}
              </OToggleGroupItem>
            </OToggleGroup>
            <OSearchInput
              v-model="searchQuery"
              class="min-w-0 flex-1 max-md:min-w-40 md:min-w-48"
              :placeholder="t('alerts.incidents.search')"
              data-test="incident-search-input"
              clearable
            />
            <OStatStrip
              :items="severityStats"
              :loading="loading"
              selectable
              :row="false"
              multiple
              :selected-keys="severityFilters"
              default-key="total"
              class="max-md:order-last"
              data-test="incident-list-summary"
              @update:selected-keys="severityFilters = $event as SeverityKey[]"
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastUpdatedAt"
            :loading="fetching"
            shortcut-id="alertIncidentsRefresh"
            data-test="incident-list-refresh-btn"
            @click="refreshIncidents"
          />
        </template>
        <template #cell-status="{ row }">
          <OTag
            type="incidentStatus"
            :value="row.status"
            :label="raw(getStatusLabel(row.status))"
            size="sm"
            data-test="incident-status-badge"
          />
        </template>
        <template #cell-ai_analysis="{ row }">
          <IncidentAiAnalysisCell
            :incident="row"
            :rca-enabled="rcaEnabled"
            :now="now"
            @open="viewIncident(row, 'incidentAnalysis')"
            @started="loadIncidents(true)"
            @failed="loadIncidents(true)"
          />
        </template>
        <template #cell-severity="{ row }">
          <OTag
            type="severity"
            :value="row.severity"
            size="sm"
            data-test="incident-severity-badge"
          />
        </template>
        <template #cell-title="{ row }">
          <div class="flex min-w-0 items-center gap-1">
            <OTruncatedText class="min-w-0">
              {{ row.title || formatDimensions(row.group_values) }}
            </OTruncatedText>
            <IncidentMutedTag
              v-if="row.muted_by_downtime_id"
              :label="mutedLabel(row.muted_by_downtime_id)"
              :tooltip="mutedTooltip(row.muted_by_downtime_id)"
              :to="mutedRoute(row.muted_by_downtime_id)"
            />
          </div>
        </template>
        <template #cell-dimensions="{ row }">
          <div
            v-if="getSortedDimensions(row.group_values).length"
            class="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
          >
            <template v-for="dim in displayDimensions(row.group_values).slice(0, 2)" :key="dim.key">
              <span
                v-if="dim.key === 'service'"
                class="min-w-0"
                data-test="incident-list-service-chip"
                ><ServiceNameLabel
                  layout="chip"
                  :service-key="row.group_values?.[dim.key] ?? ''"
                  :display-name="row.group_values_display?.service"
              /></span>
              <ODimensionChip
                v-else
                :dim-key="dim.key"
                :key-label="dim.label"
                :value="dim.value"
                :tooltip="!dim.label"
                class="min-w-0"
              />
            </template>
            <OTag
              v-if="getSortedDimensions(row.group_values).length > 2"
              type="countChip"
              value="neutral"
              class="shrink-0"
              data-test="incident-dimensions-more"
            >
              {{
                t("alerts.incidents.moreDimensions", {
                  count: getSortedDimensions(row.group_values).length - 2,
                })
              }}
              <OTooltip :max-width="'28rem'">
                <template #content>
                  <div class="space-y-1">
                    <div v-for="dim in displayDimensions(row.group_values).slice(2)" :key="dim.key">
                      <span>{{ dim.label ?? dim.key }}</span
                      >=<span>{{ dim.value }}</span>
                    </div>
                  </div>
                </template>
              </OTooltip>
            </OTag>
          </div>
          <span v-else class="text-text-muted text-xs italic">
            {{ t("alerts.incidents.noDimensionsAvailable") }}
          </span>
        </template>
        <template #cell-alert_count="{ row }">
          <div
            v-if="row.alert_groups?.length"
            class="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
          >
            <OTag
              v-for="group in row.alert_groups.slice(0, 2)"
              :key="group.alert_id"
              type="countChip"
              value="neutral"
              class="min-w-0"
              data-test="incident-alert-group-chip"
            >
              <!-- One element, so the tooltip anchors on the whole label, truncated name included. -->
              <span class="flex min-w-0">
                <span class="truncate">{{ group.alert_name }}</span>
                <span class="shrink-0">&nbsp;×{{ group.count }}</span>
              </span>
              <OTooltip
                :content="
                  t(
                    'alerts.incidents.alertGroupTooltip',
                    { name: group.alert_name, count: group.count },
                    group.count,
                  )
                "
              />
            </OTag>
            <OTag
              v-if="row.alert_groups.length > 2"
              type="countChip"
              value="neutral"
              class="shrink-0"
              data-test="incident-alert-group-more"
            >
              {{ t("alerts.incidents.moreAlertGroups", { count: row.alert_groups.length - 2 }) }}
              <OTooltip :max-width="'28rem'">
                <template #content>
                  <div
                    class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1"
                    data-test="incident-alert-group-list"
                  >
                    <template v-for="group in row.alert_groups.slice(2)" :key="group.alert_id">
                      <span class="truncate">{{ group.alert_name }}</span>
                      <span class="text-right tabular-nums">×{{ group.count }}</span>
                    </template>
                  </div>
                </template>
              </OTooltip>
            </OTag>
          </div>
          <OTag v-else type="countChip" value="neutral">{{ row.alert_count }}</OTag>
        </template>
        <template #cell-last_alert_at="{ row }">
          <OTimeCell
            :value="row.last_alert_at"
            unit="us"
            mode="relative"
            :timezone="store.state.timezone"
            :empty-label="raw('—')"
          />
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end">
            <OButton
              v-if="row.status === 'open'"
              variant="ghost-warning"
              size="icon-xs-sq"
              :aria-label="t('alerts.incidents.acknowledgeAriaLabel')"
              class="max-md:hidden"
              @click.stop="acknowledgeIncident(row)"
              data-test="incident-ack-btn"
              ><OIcon name="check-circle" size="sm" aria-hidden="true" /><OTooltip
                :content="t('alerts.incidents.acknowledge')"
            /></OButton>
            <OButton
              v-if="row.status !== 'resolved'"
              variant="ghost-primary"
              size="icon-xs-sq"
              class="max-md:hidden"
              @click.stop="resolveIncident(row)"
              data-test="incident-resolve-btn"
              ><OIcon name="task-alt" size="sm" /><OTooltip
                :content="t('alerts.incidents.resolve')"
            /></OButton>
            <OButton
              v-if="row.status === 'resolved'"
              variant="ghost-warning"
              size="icon-xs-sq"
              class="max-md:hidden"
              @click.stop="reopenIncident(row)"
              data-test="incident-reopen-btn"
              ><OIcon name="restart-alt" size="sm" /><OTooltip
                :content="t('alerts.incidents.reopen')"
            /></OButton>
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  icon-left="more-vert"
                  :title="t('dashboard.moreActions')"
                  variant="ghost"
                  size="icon-xs-sq"
                  class="md:hidden"
                  data-test="incident-row-more-actions"
                  @click.stop
                />
              </template>
              <ODropdownItem
                v-if="row.status === 'open'"
                icon-left="visibility"
                class="md:hidden"
                data-test="incident-ack-btn-menu"
                @select="acknowledgeIncident(row)"
              >
                <span>{{ t("alerts.incidents.acknowledge") }}</span>
              </ODropdownItem>
              <ODropdownItem
                v-if="row.status !== 'resolved'"
                icon-left="task-alt"
                class="md:hidden"
                data-test="incident-resolve-btn-menu"
                @select="resolveIncident(row)"
              >
                <span>{{ t("alerts.incidents.resolve") }}</span>
              </ODropdownItem>
              <ODropdownItem
                v-if="row.status === 'resolved'"
                icon-left="restart-alt"
                class="md:hidden"
                data-test="incident-reopen-btn-menu"
                @select="reopenIncident(row)"
              >
                <span>{{ t("alerts.incidents.reopen") }}</span>
              </ODropdownItem>
            </ODropdown>
          </div>
        </template>

        <template #pagination-bar>
          <div
            class="border-border-default flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-t px-3 py-1"
            data-test="incident-list-pager"
          >
            <span
              class="text-text-secondary text-xs whitespace-nowrap tabular-nums"
              data-test="incident-list-pager-total"
            >
              {{ t("alerts.incidents.pagerTotal", { count: total.toLocaleString() }, total) }}
            </span>
            <div class="flex items-center gap-1.5 text-xs">
              <span class="whitespace-nowrap max-md:hidden">{{ t("search.recordsPerPage") }}</span>
              <OSelect
                v-model="pageSize"
                :options="pageSizeOptions"
                :searchable="false"
                size="xs"
                :aria-label="t('search.recordsPerPage')"
                data-test="incident-list-page-size"
              />
            </div>
            <nav
              class="flex items-center gap-1"
              :aria-label="t('components.pagination.pagination')"
            >
              <OButton
                variant="outline"
                size="icon-xs-sq"
                :disabled="!hasPreviousPage || fetching"
                :aria-label="t('components.pagination.previousPage')"
                data-test="incident-list-prev-page"
                @click="previousPage"
              >
                <OIcon name="chevron-left" size="sm" />
              </OButton>
              <OButton
                variant="outline"
                size="icon-xs-sq"
                :disabled="!nextCursor || fetching"
                :aria-label="t('components.pagination.nextPage')"
                data-test="incident-list-next-page"
                @click="nextPage"
              >
                <OIcon name="chevron-right" size="sm" />
              </OButton>
            </nav>
          </div>
        </template>

        <!-- Empty state -->
        <template #empty>
          <div v-if="!loading" class="flex h-full w-full items-center justify-center">
            <OEmptyState
              size="hero"
              preset="no-incidents"
              :filtered="hasFilters"
              :hide-action="!hasFilters"
              @action="(id) => (id === 'clear-filters' ? clearFilters() : null)"
            />
          </div>
        </template>
      </OTable>
    </OPageLayout>
  </div>
</template>

<script lang="ts">
import { useDowntimeLookup } from "@/composables/downtimes/useDowntimeLookup";
import { useOrgId } from "@/composables/query/useOrgId";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/vue-query";
import { watchDebounced } from "@vueuse/core";
import { incidentListQuery, updateIncidentStatusMutation } from "@/services/incidents.queries";
import { incidentRefusalToast, incidentStatusToast } from "@/utils/alerts/ackState";
import type { AckAlertResponse, UnackAlertResponse } from "@/ts/interfaces/alert";
import {
  defineComponent,
  ref,
  shallowRef,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
} from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { formatToReadable } from "@/utils/date";
import {
  cursorSort,
  type Incident,
  type IncidentListParams,
  type ListIncidentsResponse,
} from "@/services/incidents";
import IncidentAiAnalysisCell from "@/components/alerts/IncidentAiAnalysisCell.vue";
import { isLiveRca } from "@/utils/incidents/rcaCell";
import { useListViewState } from "@/composables/useListViewState";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { forbiddenState } from "@/utils/featureGate";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import IncidentMutedTag from "@/components/alerts/downtimes/IncidentMutedTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import { chipDimensionKeys, dimensionDisplay } from "@/utils/incidents/findingDimensions";
import ServiceNameLabel from "@/components/shared/ServiceNameLabel.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import { readFilterKeys } from "@/utils/filterKeys";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

/** Re-fetch period while a live RCA run is on the current page. */
const RCA_LIVE_POLL_MS = 30_000;
const SEVERITY_KEYS = ["P1", "P2", "P3", "P4"] as const;
type SeverityKey = (typeof SEVERITY_KEYS)[number];
const isSeverityKey = (key: string): key is SeverityKey =>
  (SEVERITY_KEYS as readonly string[]).includes(key);
const PAGE_SIZES = [20, 50, 100, 200];
/** The server's order when the request names no sort. */
const DEFAULT_SORT = "last_alert_at:desc";
/** URL keys the list owns (design spec 2.6); any other key on the route is left alone. */
const URL_KEYS = ["sev", "q", "sort", "cursor", "assignee", "service", "from", "to"] as const;

export default defineComponent({
  name: "IncidentList",
  components: {
    IncidentMutedTag,
    OPageLayout,
    OEmptyState,
    OButton,
    ORefreshButton,
    OSearchInput,
    OSelect,
    OTooltip,
    OTruncatedText,
    OIcon,
    OTable,
    OTag,
    ODimensionChip,
    ServiceNameLabel,
    OTimeCell,
    OStatStrip,
    OToggleGroup,
    OToggleGroupItem,
    ODropdown,
    ODropdownItem,
    IncidentAiAnalysisCell,
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const { confirm } = useConfirmDialog();

    const qTableRef: any = ref(null);
    const orgIdForList = useOrgId();
    const queryText = (key: string): string | undefined => {
      const value = route.query[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    };
    const queryMicros = (key: string): number | undefined => {
      const value = Number(queryText(key));
      return Number.isFinite(value) && queryText(key) ? value : undefined;
    };
    const linkedFilters = shallowRef<
      Pick<IncidentListParams, "assignedTo" | "service" | "startTime" | "endTime">
    >({
      assignedTo: queryText("assignee") === "me" ? "me" : undefined,
      service: queryText("service"),
      startTime: queryMicros("from"),
      endTime: queryMicros("to"),
    });
    const urlSort = queryText("sort")?.split(":");
    const urlSeverities = (queryText("sev") ?? "").split(",").filter(isSeverityKey);

    const searchQuery = ref(queryText("q") ?? "");
    // Typing waits for a pause before it becomes a request.
    const debouncedSearch = ref(searchQuery.value);
    watchDebounced(
      searchQuery,
      (value) => {
        debouncedSearch.value = value;
      },
      { debounce: 300 },
    );
    // Active covers open and acknowledged; Open is open only, matching the Overview count.
    const validStatuses = ["all", "active", "open", "resolved"];
    // Default to "active"; a valid ?status= query wins over the saved state.
    const urlStatus = validStatuses.includes(route.query.status as string)
      ? (route.query.status as string)
      : null;
    const statusFilter = ref(urlStatus ?? "active");
    const isRestoringState = ref(false);
    const viewState = useListViewState("incidents", {
      severityFilter: [] as SeverityKey[],
      pageSize: 20,
      sortBy: "",
      sortOrder: "asc" as "asc" | "desc",
      cursor: "",
      cursorContext: "",
    });
    // A size saved before the cursor pager may be 250 or 500, past the server's 200.
    const pageSize = ref(PAGE_SIZES.find((size) => size >= viewState.pageSize) ?? 200);
    const pageSizeOptions = PAGE_SIZES.map((size) => ({ label: raw(String(size)), value: size }));
    const sortBy = ref(urlSort?.[0] ?? viewState.sortBy);
    const sortOrder = ref<"asc" | "desc">(
      urlSort ? (urlSort[1] === "asc" ? "asc" : "desc") : viewState.sortOrder,
    );
    // A status link ignores the saved facet so it cannot silently narrow the linked view.
    const severityFilters = ref<SeverityKey[]>(
      urlSeverities.length
        ? urlSeverities
        : urlStatus
          ? []
          : readFilterKeys(viewState.severityFilter, isSeverityKey),
    );
    const hasFilters = computed(
      () =>
        !!searchQuery.value ||
        statusFilter.value !== "all" ||
        severityFilters.value.length > 0 ||
        Object.values(linkedFilters.value).some((value) => value !== undefined),
    );
    watch([severityFilters, pageSize, sortBy, sortOrder], () => {
      Object.assign(viewState, {
        severityFilter: severityFilters.value,
        pageSize: pageSize.value,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
      });
    });

    // A cursor has no page number: Previous pops the cursors this visit walked, and a
    // cursor that came in on a link has none behind it, so Previous goes to the first page.
    // A cursor is a position under one status, filter set and sort; a URL cursor is kept
    // only while the view state says it was written under the ones restored now.
    const urlCursor = queryText("cursor");
    const currentCursor = ref<string | undefined>(
      urlCursor && urlCursor === viewState.cursor ? urlCursor : undefined,
    );
    if (route.query.status !== undefined || (urlCursor && !currentCursor.value)) {
      const { status: _status, cursor, ...rest } = route.query;
      router.replace({ query: currentCursor.value ? { ...rest, cursor } : rest });
    }
    const cursorStack = ref<(string | undefined)[]>([]);
    const hasPreviousPage = computed(() => !!currentCursor.value);
    const resetPage = () => {
      currentCursor.value = undefined;
      cursorStack.value = [];
    };
    watch([debouncedSearch, statusFilter, severityFilters, pageSize, sortBy, sortOrder], () => {
      if (!isRestoringState.value) resetPage();
    });

    const listParams = computed<IncidentListParams>(() => ({
      ...linkedFilters.value,
      status: statusFilter.value === "all" ? undefined : statusFilter.value,
      severity: severityFilters.value.length ? [...severityFilters.value] : undefined,
      q: debouncedSearch.value.trim() || undefined,
      sort: sortBy.value ? `${sortBy.value}:${sortOrder.value}` : undefined,
      cursor: currentCursor.value,
      limit: pageSize.value,
    }));
    const listContext = (params: IncidentListParams) =>
      JSON.stringify({ ...params, cursor: undefined, limit: undefined });
    const cursorFits = (cursor: string) =>
      cursor === viewState.cursor &&
      viewState.cursorContext === listContext(listParams.value) &&
      cursorSort(cursor) === (listParams.value.sort ?? DEFAULT_SORT);
    watch(listParams, (params) => {
      if (params.cursor) {
        Object.assign(viewState, { cursor: params.cursor, cursorContext: listContext(params) });
      }
      const kept = Object.fromEntries(
        Object.entries(route.query).filter(
          ([key]) => key !== "status" && !(URL_KEYS as readonly string[]).includes(key),
        ),
      );
      const owned: Record<(typeof URL_KEYS)[number], string | undefined> = {
        sev: params.severity?.join(","),
        q: params.q,
        sort: params.sort,
        cursor: params.cursor,
        assignee: params.assignedTo,
        service: params.service,
        from: params.startTime?.toString(),
        to: params.endTime?.toString(),
      };
      const set = Object.fromEntries(Object.entries(owned).filter(([, value]) => !!value));
      router.replace({ query: { ...kept, ...set } });
    });

    // Set from `liveRowOnPage` below; the query getter reads it, so a change
    // re-applies the options and TanStack restarts or stops its interval timer.
    const pollLiveRows = ref(false);
    const incidentsList = useQuery(() =>
      Object.assign(incidentListQuery(orgIdForList.value, listParams.value), {
        enabled: !!orgIdForList.value,
        placeholderData: keepPreviousData,
        refetchInterval: pollLiveRows.value ? RCA_LIVE_POLL_MS : (false as const),
      }),
    );

    // `isPending` is the cold read only; `keepPreviousData` keeps the last page on screen while the next one loads.
    const loading = incidentsList.isPending;
    // Request in flight with rows still on screen — the refresh button's
    // spinner. `loading` is the skeleton, for a cold read only.
    const fetching = incidentsList.isFetching;
    // Epoch ms of the last successful read — drives the button's "1m ago" label.
    const lastUpdatedAt = incidentsList.dataUpdatedAt;
    // A 403 lands in the query's error rather than a loader's catch, so derive the no-access state from it.
    const forbidden = computed(() => {
      const e: any = incidentsList.error.value;
      return forbiddenState(e) || e?.status === 403;
    });
    // A 400 under a cursor is a position the server no longer accepts, so start over.
    watch(incidentsList.error, (e: any) => {
      if (currentCursor.value && (e?.response?.status ?? e?.status) === 400) resetPage();
    });
    const listData = computed(() => incidentsList.data.value as ListIncidentsResponse | undefined);
    const total = computed(() => listData.value?.total ?? 0);
    const nextCursor = computed(() => listData.value?.next_cursor ?? undefined);
    const nextPage = () => {
      if (!nextCursor.value) return;
      cursorStack.value.push(currentCursor.value);
      currentCursor.value = nextCursor.value;
    };
    const previousPage = () => {
      currentCursor.value = cursorStack.value.pop();
    };
    // The incident dataset is read-only display data replaced wholesale on every
    // reload, so hold it in a shallowRef (and freeze each row on load — see
    // loadIncidents). Vue then never deep-proxies the hundreds of objects, which
    // keeps the filter computeds and the table's row-model rebuild off the
    // reactivity hot path — the difference is very visible at a few hundred rows.
    const allIncidents = shallowRef<Incident[]>([]);
    // The downtimes list is read only to name a muted row's downtime.
    const {
      nameOf,
      notLoaded,
      detailRoute: mutedRoute,
    } = useDowntimeLookup(() =>
      allIncidents.value.some((incident) => !!incident.muted_by_downtime_id),
    );
    // A downtime past the lookup's one page says so, with its id kept for the tooltip.
    const mutedLabel = (id: string) =>
      t("alerts.downtimes.incident.mutedBy", {
        name: notLoaded(id) ? t("alerts.downtimes.incident.notLoaded") : nameOf(id),
      });
    const mutedTooltip = (id: string) =>
      notLoaded(id)
        ? t("alerts.downtimes.incident.notLoadedTooltip", { id })
        : t("alerts.downtimes.incident.mutedBy", { name: nameOf(id) });

    const columns: OTableColumnDef[] = [
      {
        id: "title",
        header: t("alerts.incidents.title_field"),
        accessorKey: "title",
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "severity",
        header: t("alerts.incidents.severity"),
        accessorKey: "severity",
        resizable: true,
        hideable: true,
        size: 100,
        meta: { align: "left" },
      },
      {
        id: "status",
        header: t("alerts.incidents.status"),
        accessorKey: "status",
        resizable: true,
        hideable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "ai_analysis",
        header: t("alerts.incidents.aiAnalysis.column"),
        resizable: true,
        hideable: true,
        // The cell holds state, detail and the follow door on one line.
        size: 320,
        meta: { align: "left" },
      },
      {
        id: "dimensions",
        header: t("alerts.incidents.stableDimensions"),
        accessorKey: "group_values",
        resizable: true,
        hideable: true,
        size: 340,
        meta: { align: "left" },
      },
      {
        id: "alert_count",
        header: t("alerts.incidents.alertCount"),
        accessorKey: "alert_count",
        resizable: true,
        hideable: true,
        size: 260,
        meta: { align: "left" },
      },
      {
        id: "last_alert_at",
        header: t("alerts.incidents.lastAlertAt"),
        accessorKey: "last_alert_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.dateAbsolute,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alerts.incidents.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center", actionCount: 2 },
      },
    ];

    const visibleIncidents = computed(() => allIncidents.value);
    const liveRowOnPage = computed(() =>
      allIncidents.value.some((incident) => isLiveRca(incident.rca)),
    );
    watch(
      liveRowOnPage,
      (live) => {
        pollLiveRows.value = live;
      },
      { immediate: true },
    );

    // Deployment-wide switch; undefined (older server) reads as disabled.
    const rcaEnabled = computed(() => store.state.zoConfig?.incidents_rca_enabled === true);
    // Elapsed and "ago" labels in the AI analysis cell are relative to this clock.
    const now = ref(Date.now());
    const nowTimer = setInterval(() => {
      now.value = Date.now();
    }, RCA_LIVE_POLL_MS);
    onUnmounted(() => clearInterval(nowTimer));

    // The server counts every filter but severity, so picking a severity card keeps the others' counts.
    const severityCounts = computed(() => {
      const counts = listData.value?.counts_by_severity;
      const p1 = counts?.P1 ?? 0;
      const p2 = counts?.P2 ?? 0;
      const p3 = counts?.P3 ?? 0;
      const p4 = counts?.P4 ?? 0;
      return { p1, p2, p3, p4, total: p1 + p2 + p3 + p4 };
    });
    // Severity summary strip — mirrors the Alerts state strip: Total + the four
    // severities as filter tiles, keyed by severity ("P1" .. "P4").
    const severityStats = computed<StatItem[]>(() => {
      const c = severityCounts.value;
      const hasData = c.total > 0;
      const v = (n: number): string | number => (hasData ? n : "—");
      const share = hasData ? c.total : undefined;
      return [
        {
          key: "P1",
          label: t("alerts.incidents.severityCritical"),
          value: v(c.p1),
          icon: "error",
          tone: "error",
          max: share,
          dataTest: "incident-severity-p1",
        },
        {
          key: "P2",
          label: t("alerts.incidents.severityHigh"),
          value: v(c.p2),
          icon: "warning",
          tone: "orange",
          max: share,
          dataTest: "incident-severity-p2",
        },
        {
          key: "P3",
          label: t("alerts.incidents.severityMedium"),
          value: v(c.p3),
          icon: "flag",
          tone: "warning",
          max: share,
          dataTest: "incident-severity-p3",
        },
        {
          key: "P4",
          label: t("alerts.incidents.severityLow"),
          value: v(c.p4),
          icon: "info",
          tone: "info",
          max: share,
          dataTest: "incident-severity-p4",
        },
        {
          key: "total",
          label: t("common.all"),
          value: v(c.total),
          icon: "format-list-bulleted",
          tone: "primary",
          dataTest: "incident-severity-total",
        },
      ];
    });

    // Extreme-left rail coloured by severity (P1 red … P4 blue); resolved rows
    // stand out. The rail answers "does this need action, and how urgently?":
    //   resolved → green (done, no action needed) ·
    //   else the severity heat scale (P1 red → P2 orange → P3 amber → P4 blue).
    // Severity is still fully filterable from the top strip.
    const incidentRowStyle = (row: any): Record<string, string> => {
      const s = String(row?.severity || "").toUpperCase();
      const color =
        row?.status === "resolved"
          ? "var(--color-success-500)"
          : s === "P1"
            ? "var(--color-error-500)"
            : s === "P2"
              ? "var(--color-orange-500)"
              : s === "P3"
                ? "var(--color-amber-500)"
                : s === "P4"
                  ? "var(--color-blue-500)"
                  : "var(--color-grey-400)";
      return { boxShadow: `var(--shadow-rail-geom) ${color}` };
    };

    // Freezing and the Vuex dispatch are both idempotent, so this is safe to
    // run twice — the cached rows paint, then the server's.
    const applyIncidents = (data: any) => {
      const items: Incident[] = data?.incidents || [];
      // Frozen objects are never made reactive, so Vue leaves the hundreds of
      // rows raw both here and in the Vuex cache below.
      for (const it of items) Object.freeze(it);
      allIncidents.value = items;
      now.value = Date.now();
      store.dispatch("incidents/setCachedData", items);
    };

    // The list is the query now: anything that invalidates the incidents scope
    // repaints these rows without this component asking.
    watch(
      incidentsList.data,
      (data: any) => {
        if (data) applyIncidents(data);
      },
      { immediate: true },
    );
    watch(incidentsList.error, (error: any) => {
      if (!error || forbidden.value) return;
      toast({ variant: "error", message: t("alerts.incidents.errorLoading") });
      console.error("Failed to load incidents:", error);
    });

    // Only an explicit call reads: refresh, post-write reload, search. Mount and
    // invalidation-driven repaints come from the query itself.
    const loadIncidents = async (force = false) => {
      if (force) await incidentsList.refetch();
    };

    // `tab` selects the incident page's tab (e.g. "incidentAnalysis" from the AI analysis cell).
    const viewIncident = (incident: Incident, tab?: string) => {
      store.dispatch("incidents/setIncidents", {
        searchQuery: searchQuery.value,
        statusFilter: statusFilter.value,
        organizationIdentifier: store.state.selectedOrganization.identifier,
      });

      // Spread the existing query so anything already on this route (e.g. page) survives the round trip to the detail view and back.
      router.push({
        name: "incidentDetail",
        params: { id: incident.id },
        query: {
          ...route.query,
          org_identifier: store.state.selectedOrganization.identifier,
          ...(tab ? { tab } : {}),
        },
      });
    };

    const savePageState = () => {
      if (isRestoringState.value) return;
      store.dispatch("incidents/setIncidents", {
        searchQuery: searchQuery.value,
        statusFilter: statusFilter.value,
        organizationIdentifier: store.state.selectedOrganization.identifier,
      });
    };

    const filterByStatus = (value: string) => {
      statusFilter.value = value;
      // Switching the primary status resets the severity facet back to "all".
      severityFilters.value = [];
      store.dispatch("incidents/setStatusFilter", value);
      savePageState();
    };

    const clearFilters = () => {
      linkedFilters.value = {};
      searchQuery.value = "";
      debouncedSearch.value = "";
      filterByStatus("active");
    };

    // The mutation drops the alert, incident and on-call reads the one ack wrote.
    const statusWrite = useMutation(() =>
      updateIncidentStatusMutation(store.state.selectedOrganization.identifier),
    );
    const updateStatus = async (
      incident: Incident,
      newStatus: "open" | "acknowledged" | "resolved",
    ) => {
      try {
        const res = await statusWrite.mutateAsync({
          id: incident.id,
          status: newStatus,
          from: incident.status,
        });
        // Only the one ack's routes answer with what they did.
        const { ack } = res as { ack?: AckAlertResponse | UnackAlertResponse };
        toast(
          incidentStatusToast(
            newStatus,
            ack,
            incident.title || incident.id,
            store.state.userInfo?.email,
            t,
          ) ?? { variant: "success", message: t("alerts.incidents.statusUpdated") },
        );
        // Post-write reload: must reach the server.
        loadIncidents(true);
        store.dispatch("incidents/setShouldRefresh", true);
      } catch (error: any) {
        toast(
          incidentRefusalToast(error, newStatus, t) ?? {
            variant: "error",
            message: t("alerts.incidents.statusUpdateFailed"),
          },
        );
        console.error("Failed to update incident status:", error);
      }
    };

    const acknowledgeIncident = async (incident: Incident) => {
      const ok = await confirm({
        title: t("alerts.incidents.acknowledgeConfirmTitle"),
        message: t("alerts.incidents.acknowledgeConfirmMessage"),
        confirmLabel: t("alerts.incidents.acknowledgeConfirmLabel"),
        cancelLabel: t("alerts.incidents.acknowledgeConfirmCancelLabel"),
        persistent: false,
      });
      if (!ok) return;
      updateStatus(incident, "acknowledged");
    };

    const resolveIncident = async (incident: Incident) => {
      const ok = await confirm({
        title: t("alerts.incidents.resolveConfirmTitle"),
        message: t("alerts.incidents.resolveConfirmMessage"),
        confirmLabel: t("alerts.incidents.resolve"),
        cancelLabel: t("common.cancel"),
        persistent: false,
      });
      if (!ok) return;
      updateStatus(incident, "resolved");
    };

    const reopenIncident = async (incident: Incident) => {
      const ok = await confirm({
        title: t("alerts.incidents.reopenConfirmTitle"),
        message: t("alerts.incidents.reopenConfirmMessage"),
        confirmLabel: t("alerts.incidents.reopen"),
        cancelLabel: t("common.cancel"),
        persistent: false,
      });
      if (!ok) return;
      updateStatus(incident, "open");
    };

    const getStatusColorClass = (status: string) => {
      switch (status) {
        case "open":
          return "status-open";
        case "acknowledged":
          return "status-acknowledged";
        case "resolved":
          return "status-resolved";
        default:
          return "status-default";
      }
    };

    const getStatusLabel = (status: string) => {
      switch (status) {
        case "open":
          return t("alerts.incidents.statusOpen");
        case "acknowledged":
          return t("alerts.incidents.statusAcknowledged");
        case "resolved":
          return t("alerts.incidents.statusResolved");
        default:
          return status;
      }
    };

    const formatTimestamp = (timestamp: number) => {
      return formatToReadable(timestamp);
    };

    const formatDimensions = (dimensions: Record<string, string> | undefined) => {
      if (!dimensions || Object.keys(dimensions).length === 0) {
        return t("common.unknown");
      }
      return Object.entries(dimensions)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
    };

    // The dimensions cell reads a row's sorted dimensions several times per render
    // (the shown chips, the "+N more" count, and its tooltip). Sorting is pure and
    // group_values is a stable object per incident, so memoise by object identity
    // to sort each row's dimensions once instead of on every re-render.
    const sortedDimCache = new WeakMap<object, [string, string][]>();
    const getSortedDimensions = (dimensions: Record<string, string> | undefined) => {
      if (!dimensions || typeof dimensions !== "object") return [];
      const cached = sortedDimCache.get(dimensions);
      if (cached) return cached;
      const sorted = chipDimensionKeys(dimensions).map(
        (key) => [key, dimensions[key]] as [string, string],
      );
      sortedDimCache.set(dimensions, sorted);
      return sorted;
    };

    const displayDimensions = (dimensions: Record<string, string> | undefined) =>
      getSortedDimensions(dimensions).map(([key, value]) => {
        const shown = dimensionDisplay(t, dimensions, key, value);
        return { key, label: shown.label ?? undefined, value: shown.value };
      });

    const getDimensionColorClass = (key: string) => {
      const colorMap: Record<string, string> = {
        "k8s-deployment": "badge-blue",
        "k8s-namespace": "badge-orange",
        deployment: "badge-blue",
        namespace: "badge-orange",
        env: "badge-green",
        environment: "badge-green",
        host: "badge-purple",
        hostname: "badge-purple",
        service: "badge-cyan",
        service_name: "badge-cyan",
        region: "badge-pink",
        zone: "badge-pink",
        cluster: "badge-indigo",
        pod: "badge-teal",
        container: "badge-red",
        app: "badge-yellow",
        application: "badge-yellow",
      };
      if (colorMap[key]) return colorMap[key];
      const lowerKey = key.toLowerCase();
      for (const [pattern, className] of Object.entries(colorMap)) {
        if (lowerKey.includes(pattern)) return className;
      }
      const classes = ["badge-gray", "badge-amber", "badge-violet", "badge-rose"];
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash = hash & hash;
      }
      return classes[Math.abs(hash) % classes.length];
    };

    const restoreStateFromStore = (): boolean => {
      const savedState = store.state.incidents.incidents;
      const cachedData = store.state.incidents.cachedData;
      const isInitialized = store.state.incidents.isInitialized;
      const currentOrg = store.state.selectedOrganization.identifier;

      if (
        isInitialized &&
        savedState &&
        savedState.organizationIdentifier &&
        savedState.organizationIdentifier !== currentOrg
      ) {
        store.dispatch("incidents/resetIncidents");
        searchQuery.value = "";
        allIncidents.value = [];
        return false;
      } else if (isInitialized && savedState && savedState.organizationIdentifier === currentOrg) {
        isRestoringState.value = true;
        if (cachedData && cachedData.length > 0) {
          allIncidents.value = cachedData;
        }
        // The URL's search wins; the debounced copy is set too, or its late update would reset the page.
        if (savedState.searchQuery !== undefined && !urlStatus && !queryText("q")) {
          searchQuery.value = savedState.searchQuery;
          debouncedSearch.value = savedState.searchQuery;
        }
        if (savedState.statusFilter !== undefined && !urlStatus) {
          statusFilter.value = savedState.statusFilter;
        }
        return true;
      }
      return false;
    };

    onMounted(async () => {
      const hasRestoredState = restoreStateFromStore();
      if (currentCursor.value && !cursorFits(currentCursor.value)) resetPage();
      const shouldRefresh = store.state.incidents?.shouldRefresh || false;

      if (allIncidents.value.length === 0 || shouldRefresh) {
        // Not forced: the drawer's writes drop the cached list, so the observer refetches on its own and forcing here would repeat it.
        await loadIncidents();
        if (shouldRefresh) {
          store.dispatch("incidents/setShouldRefresh", false);
        }
      }

      if (!store.state.incidents.isInitialized) {
        store.dispatch("incidents/setIsInitialized", true);
      }

      if (hasRestoredState) {
        store.dispatch("incidents/setIncidents", {
          searchQuery: searchQuery.value,
          statusFilter: statusFilter.value,
          organizationIdentifier: store.state.selectedOrganization.identifier,
        });
      }

      await nextTick();
      isRestoringState.value = false;
    });

    const refreshIncidents = async () => {
      if ((await incidentsList.refetch()).isError) return;
      toast({
        variant: "success",
        message: t("toastMessages.alerts.incidentsRefreshed"),
        timeout: 1500,
      });
    };

    useShortcuts([
      {
        id: "alertIncidentsRefresh",
        handler: () => {
          if (!isInputFocused()) refreshIncidents();
        },
      },
    ]);

    return {
      mutedLabel,
      mutedRoute,
      mutedTooltip,
      raw,
      t,
      loading,
      fetching,
      lastUpdatedAt,
      forbidden,
      allIncidents,
      visibleIncidents,
      rcaEnabled,
      now,
      severityStats,
      severityFilters,
      incidentRowStyle,
      searchQuery,
      statusFilter,
      hasFilters,
      filterByStatus,
      clearFilters,
      columns,
      pageSize,
      pageSizeOptions,
      sortBy,
      sortOrder,
      total,
      nextCursor,
      hasPreviousPage,
      nextPage,
      previousPage,
      loadIncidents,
      refreshIncidents,
      viewIncident,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
      getStatusColorClass,
      getStatusLabel,
      formatTimestamp,
      formatDimensions,
      getSortedDimensions,
      displayDimensions,
      getDimensionColorClass,
      qTableRef,
      store,
    };
  },
});
</script>
