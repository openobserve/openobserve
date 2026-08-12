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
  <OPageLayout
    bleed
    data-test="oncall-responses-page"
    :title="t('oncall.responsesTitle')"
    :subtitle="t('oncall.responsesSubtitle')"
    icon="notifications-active"
  >
    <template #actions>
      <!-- Whether the reader is themselves on call, beside the buttons rather
           than in the body: it qualifies the whole screen, not one section. -->
      <OnCallShiftBanner
        v-if="myShift"
        :user-email="viewerEmail"
        :rotation="myShift.rotation"
        :team-name="myShift.teamName"
        :ends-at="myShift.endsAt"
        :other-teams="myShift.otherTeams"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="person"
        data-test="oncall-responses-mine-btn"
        @click="goTo('onCallMine')"
      >
        {{ t("oncall.myOnCallNav") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        icon-left="group-work"
        data-test="oncall-responses-teams-btn"
        @click="goTo('onCallTeams')"
      >
        {{ t("oncall.teams") }}
      </OButton>
    </template>

    <!-- Setup is answered from live data, so it survives past "no teams": a
         team with nobody in its rotation pages nobody, and the calm empty
         state below would call that healthy. -->
    <OnCallSetupChecklist
      v-if="showChecklist"
      :has-team="setup.hasTeam"
      :has-staffed-rotation="setup.hasStaffedRotation"
      :has-routing="setup.hasRouting"
      :can-configure="canConfigure"
      :first-team-id="teams[0]?.id ?? null"
      @create-team="goTo('onCallTeams')"
    />

    <!-- The two standing questions, above the list that answers them per row:
         is anything waiting on a person, and would a page reach anyone. Hidden
         while the checklist is up, because neither means anything on an org
         that cannot page at all. -->
    <OContent v-if="!showChecklist" class="grid grid-cols-1 gap-2 pt-2 pb-1 xl:grid-cols-3">
      <OnCallAttentionCard
        :unacked="attention.unacked"
        :escalating="attention.escalating"
        :next-escalation-at="attention.nextEscalationAt"
        :assigned-to-me="attention.assignedToMe"
        :oldest-opened-at="attention.oldestOpenedAt"
      />
      <OnCallCoverageCard
        :teams="teams"
        :slots-by-team="slotsByTeam"
        :handover-by-team="handoverByTeam"
        :viewer-email="viewerEmail"
      />
      <OnCallCausesCard :analytics="causeAnalytics" />
    </OContent>

    <OTable
      :frame="false"
      :data="rows"
      :columns="columns"
      row-key="rowKey"
      :loading="loading"
      :error="loadError"
      pagination="client"
      :page-size="20"
      sort-by="opened_at"
      sort-order="desc"
      :column-visibility="{ firings: false, state: false, team: false, opened_at: false }"
      table-id="oncall-responses-list"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-responses-table"
      :row-rail-tone="rowRailTone"
      :row-tone="rowTone"
      selection="multiple"
      v-model:selected-ids="selectedIds"
      :is-row-selectable="canAcknowledge"
      expansion="single"
      v-model:expanded-ids="expandedIds"
      @row-click="openResponse"
    >
      <!-- Counts describe the filtered list below, which is honest here only
           because everything the filters see is already loaded. -->
      <template #subheader>
        <div
          class="px-page-edge border-table-row-divider border-b py-1.5"
          data-test="oncall-responses-summary"
        >
          <OStatStrip
            :items="summaryStats"
            :loading="loading"
            selectable
            :selected-key="stateFilter"
            @select="onStatSelect"
          />
        </div>
      </template>

      <!-- During an incident the list IS the work surface. Opening 200 pages
           one at a time to claim them is not triage. -->
      <template #toolbar>
        <div v-if="selectedIds.length" class="flex w-full flex-wrap items-center gap-2">
          <span class="text-text-body text-sm" data-test="oncall-bulk-count">
            {{ t("oncall.selectedCount", { count: selectedIds.length }) }}
          </span>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="bulkBusy"
            data-test="oncall-bulk-ack"
            @click="bulkAcknowledge"
          >
            {{ t("oncall.acknowledge") }}
          </OButton>
          <ODropdown>
            <template #trigger>
              <OButton
                variant="outline"
                size="sm-action"
                icon-right="expand-more"
                :loading="bulkBusy"
                data-test="oncall-bulk-snooze"
              >
                {{ t("oncall.snooze") }}
              </OButton>
            </template>
            <ODropdownItem
              v-for="option in snoozeOptions"
              :key="option.minutes"
              :data-test="`oncall-bulk-snooze-${option.minutes}`"
              @select="bulkSnooze(option.minutes)"
            >
              {{ option.label }}
            </ODropdownItem>
          </ODropdown>
          <OButton
            variant="outline"
            size="sm-action"
            :loading="bulkBusy"
            data-test="oncall-bulk-resolve"
            @click="confirmBulkResolve = true"
          >
            {{ t("oncall.resolve") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="oncall-bulk-cancel"
            @click="selectedIds = []"
          >
            {{ t("oncall.cancel") }}
          </OButton>
        </div>
        <div v-else class="flex w-full flex-wrap items-center gap-2">
          <!-- `width` is a PROP, not a class: OSelect merges an incoming class
               with its own width class, so a `w-56` here lost to the default
               `w-full` and stacked the whole toolbar into three rows. -->
          <OSelect
            v-model="teamFilter"
            :options="teamOptions"
            :disabled="!teamsAvailable"
            :placeholder="teamsAvailable ? undefined : t('oncall.teamFilterUnavailable')"
            width="sm"
            data-test="oncall-responses-team-filter"
          />
          <OSelect
            v-model="priorityFilter"
            :options="priorityOptions"
            width="xs"
            data-test="oncall-responses-priority-filter"
          />
          <!-- `basis-40` so the search keeps a usable width once the row
               wraps, instead of collapsing to its padding. -->
          <OSearchInput
            v-model="search"
            class="min-w-40 flex-1 basis-40"
            clearable
            :placeholder="t('oncall.searchResponses')"
            data-test="oncall-responses-search"
          />
          <!-- A resolved page is the only record of what happened, and it was
               reachable from nowhere. Off by default so the live list stays
               about what still needs somebody. -->
          <OCheckbox
            v-model="includeResolved"
            :label="t('oncall.showResolved')"
            data-test="oncall-responses-resolved-toggle"
            @update:model-value="() => fetchResponses()"
          />
          <!-- On by default. A rule firing every minute is one problem, not
               ninety-five, and the ungrouped view is for reading history. -->
          <OCheckbox
            v-model="grouped"
            :label="t('oncall.groupByAlert')"
            data-test="oncall-responses-group-toggle"
          />
        </div>
      </template>

      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="oncall-responses-refresh"
          @click="refreshAll"
        >
          <OTooltip side="bottom" :content="t('oncall.refresh')" shortcut-id="oncallRefresh" />
        </OButton>
      </template>

      <template #cell-priority="{ row }">
        <OTag type="alertPriority" :value="`p${row.latest.priority}`" size="sm" />
      </template>

      <!-- "95 firings" is the number that matters; a single firing's number
           only means something on its own record. -->
      <template #cell-firings="{ row }">
        <OTag v-if="row.firings.length > 1" variant="default-soft" size="sm">
          {{ t("oncall.firingCount", { count: row.firings.length }) }}
        </OTag>
        <span v-else class="text-text-muted text-sm">
          {{ raw(`#${row.latest.subject.firing}`) }}
        </span>
      </template>

      <!-- A snoozed page is still open, so it would otherwise look exactly
           like one escalating right now. -->
      <template #cell-state="{ row }">
        <span class="flex flex-wrap items-center gap-1">
          <OTag type="oncallResponseState" :value="row.latest.state" size="sm" />
          <OTag v-if="isSnoozed(row.latest)" variant="warning-soft" size="sm">
            {{ t("oncall.snoozed") }}
          </OTag>
        </span>
      </template>

      <!-- No team means nothing claimed it, which is a routing bug rather than
           a blank cell. -->
      <template #cell-team="{ row }">
        <OTag v-if="!row.latest.team_id" variant="error-soft" size="sm">
          {{ t("oncall.statUnrouted") }}
        </OTag>
        <span v-else class="text-text-body truncate text-sm">
          {{ raw(teamNameById[row.latest.team_id] ?? row.latest.team_id) }}
        </span>
      </template>

      <!-- The name plus what the page is about: how often it has fired, and the
           incident it produced. A woken engineer reads this cell first. -->
      <template #cell-subject="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex items-center gap-1.5">
            <span class="text-text-heading truncate text-sm font-medium">
              {{ raw(row.latest.title || row.latest.subject.source_id) }}
            </span>
            <OTag v-if="row.firings.length > 1" variant="default-soft" size="sm">
              {{ raw(`×${row.firings.length}`) }}
            </OTag>
          </span>
          <span class="flex flex-wrap items-center gap-1">
            <OTag v-if="row.latest.team_id" variant="default-soft" size="sm">
              {{ raw(teamNameById[row.latest.team_id] ?? row.latest.team_id) }}
            </OTag>
            <OTag v-else variant="error-soft" size="sm">{{ t("oncall.statUnrouted") }}</OTag>
            <OTag v-if="row.latest.incident_id" variant="amber-soft" size="sm">
              {{ raw(row.latest.incident_id) }}
            </OTag>
          </span>
        </span>
      </template>

      <!-- How far up the ladder this page has climbed, and what fires next.
           Loaded for the oldest open pages only — see ESCALATION_DETAIL_LIMIT. -->
      <template #cell-escalation="{ row }">
        <OnCallEscalationCell
          :response-id="row.latest.id"
          :state="row.latest.state"
          :progress="progressById[row.latest.id] ?? null"
          :total-rungs="totalRungsFor(row.latest)"
          :acked-in-micros="ackedInMicros(row.latest)"
        />
      </template>

      <!-- Who owns it, or — while nobody does — how many people the ladder has
           already rung, which is the difference between "unanswered" and
           "nobody has even been called yet". -->
      <template #cell-responder="{ row }">
        <span class="flex min-w-0 flex-col">
          <OUserCell
            v-if="row.latest.acked_by"
            :value="row.latest.acked_by"
            :name="row.latest.acked_by === viewerEmail ? youLabel : undefined"
          />
          <span v-else class="text-status-error-text text-sm" data-test="oncall-responder-nobody">
            {{ t("oncall.nobodyYet") }}
          </span>
          <span
            v-if="peopleRung(row.latest)"
            class="text-text-secondary truncate text-xs"
            :data-test="`oncall-responder-rung-${row.rowKey}`"
          >
            {{ peopleRung(row.latest) }}
          </span>
        </span>
      </template>

      <!-- Which channels this page went out on, and how long it has been open.
           Channels come from the team's policy — they are what WOULD be used —
           so one with no provider behind it is marked rather than implied. -->
      <template #cell-notified="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex flex-wrap items-center gap-1">
            <OTag
              v-for="channel in channelsFor(row.latest)"
              :key="channel"
              :variant="isDeliverableChannel(channel) ? 'success-soft' : 'default-soft'"
              size="sm"
              :data-test="`oncall-channel-${row.rowKey}-${channel}`"
            >
              {{ t(`oncall.channel_${channel}`) }}
              <OTooltip
                v-if="!isDeliverableChannel(channel)"
                side="top"
                :content="t('oncall.channelUndeliverable', { channel: t(`oncall.channel_${channel}`) })"
              />
            </OTag>
          </span>
          <OTimeCell :value="row.latest.opened_at" unit="us" />
        </span>
      </template>

      <template #cell-opened_at="{ row }">
        <OTimeCell :value="row.latest.opened_at" unit="us" />
      </template>

      <!-- What already happened, without leaving the triage list. The detail
           screen stays the place to act; this is the place to read. -->
      <template #expansion="{ row }">
        <div class="px-page-edge py-3" :data-test="`oncall-expansion-${row.rowKey}`">
          <OInnerLoading v-if="expandedLoading" showing />
          <!-- What happened beside what it usually means: the timeline answers
               "what has this page done", the panel answers "should I be worried
               about it", and neither is much use without the other. -->
          <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <OnCallTimeline
              v-if="expandedEvents.length"
              :events="expandedEvents"
              :opened-at="row.latest.opened_at"
            />
            <p v-else class="text-text-muted text-sm" data-test="oncall-expansion-empty">
              {{ t("oncall.ladderNothingSent") }}
            </p>
            <OnCallPageContext :firings="expandedHistory" :causes="expandedCauses" />
          </div>
        </div>
      </template>

      <!-- What the row can actually be done to, rather than the same two
           buttons everywhere: claiming is only offered while something is still
           escalating, and a page nobody owns is a routing fix, not a triage.

           Dense, following the alerts list: the secondary actions are icon
           buttons with tooltips, and only the one decision the row exists for
           keeps its label — an icon-only "Acknowledge" is not something to
           hunt for at 3am. -->
      <template #cell-actions="{ row }">
        <span class="flex items-center justify-center gap-0.5">
          <OButton
            v-if="!row.latest.team_id"
            variant="outline"
            size="xs"
            data-row-action="assign"
            :data-test="`oncall-row-assign-${row.rowKey}`"
            @click.stop="goTo('onCallRouting')"
          >
            {{ t("oncall.assignTeamShort") }}
          </OButton>
          <template v-else>
            <OButton
              v-if="canAcknowledge(row)"
              variant="primary"
              size="xs"
              :loading="busyId === row.rowKey"
              data-row-action="acknowledge"
              :data-test="`oncall-row-ack-${row.rowKey}`"
              @click.stop="acknowledgeRow(row)"
            >
              {{ t("oncall.acknowledge") }}
            </OButton>
            <ODropdown v-if="canAcknowledge(row)">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="pause-circle-filled"
                  :loading="busyId === row.rowKey"
                  data-row-action="snooze"
                  :data-test="`oncall-row-snooze-${row.rowKey}`"
                >
                  <OTooltip side="bottom" :content="t('oncall.snooze')" />
                </OButton>
              </template>
              <ODropdownItem
                v-for="option in snoozeOptions"
                :key="option.minutes"
                :data-test="`oncall-row-snooze-${row.rowKey}-${option.minutes}`"
                @select="snoozeRow(row, option.minutes)"
              >
                {{ option.label }}
              </ODropdownItem>
            </ODropdown>
            <OButton
              v-if="row.firings.some((f) => f.state !== 'resolved')"
              variant="ghost-success"
              size="icon-sm"
              icon-left="task-alt"
              :loading="busyId === row.rowKey"
              data-row-action="resolve"
              :data-test="`oncall-row-resolve-${row.rowKey}`"
              @click.stop="resolveRow(row)"
            >
              <OTooltip side="bottom" :content="t('oncall.resolve')" />
            </OButton>
            <OButton
              v-else
              variant="ghost"
              size="icon-sm"
              icon-left="format-list-bulleted"
              data-row-action="timeline"
              :data-test="`oncall-row-timeline-${row.rowKey}`"
              @click.stop="openResponse(row)"
            >
              <OTooltip side="bottom" :content="t('oncall.timeline')" />
            </OButton>
          </template>
        </span>
      </template>

      <!-- A transient 500 is not "this org has no pages", and it must offer a
           way back rather than a dead end. -->
      <template #error>
        <OEmptyState
          size="hero"
          variant="error"
          illustration="broken-panel"
          :title="t('oncall.loadResponsesFailed')"
          :description="loadError ? raw(loadError) : undefined"
          :action-label="t('oncall.retry')"
          data-test="oncall-responses-error"
          @action="refreshAll"
        />
      </template>

      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          preset="no-oncall-responses"
          :filtered="isFiltered"
          data-test="oncall-responses-empty"
          @action="onEmptyAction"
        />
      </template>

      <!-- The server caps a page at 200 and the facets have to be honest about
           what they counted, so say so rather than quietly under-reporting.
           The escalation cap is stated for the same reason: a blank ladder cell
           would otherwise read as "nothing has fired". -->
      <template v-if="truncated || escalationCapped" #bottom>
        <span class="text-text-secondary flex flex-wrap gap-x-3 text-xs">
          <span v-if="truncated" data-test="oncall-responses-truncated">
            {{ t("oncall.listTruncated", { count: responses.length, total: totalCount }) }}
          </span>
          <span v-if="escalationCapped" data-test="oncall-escalation-capped">
            {{ t("oncall.escalationDetailCapped", { count: ESCALATION_DETAIL_LIMIT }) }}
          </span>
        </span>
      </template>
    </OTable>

    <ConfirmDialog
      v-model="confirmBulkResolve"
      :title="t('oncall.bulkResolveTitle')"
      :message="t('oncall.bulkResolveConfirm', { count: selectedIds.length })"
      @update:ok="bulkResolve"
      @update:cancel="confirmBulkResolve = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallAttentionCard from "@/components/oncall/OnCallAttentionCard.vue";
import OnCallCausesCard from "@/components/oncall/OnCallCausesCard.vue";
import OnCallCoverageCard from "@/components/oncall/OnCallCoverageCard.vue";
import OnCallEscalationCell from "@/components/oncall/OnCallEscalationCell.vue";
import OnCallPageContext from "@/components/oncall/OnCallPageContext.vue";
import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import OnCallShiftBanner from "@/components/oncall/OnCallShiftBanner.vue";
import OnCallTimeline from "@/components/oncall/OnCallTimeline.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { OTableColumnDef, RowRailTone, RowTone } from "@/lib/core/Table/OTable.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import oncallService, { RESPONSE_PAGE_LIMIT } from "@/services/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type {
  CauseGroup,
  Channel,
  CoverageGaps,
  EscalationProgress,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallResponseGroup,
  CauseAnalytics,
  OnCallSchedule,
  OnCallSlot,
  OnCallTeam,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import {
  groupBySubject,
  isDeliverableChannel,
  isEscalating,
  isSnoozed,
  nextHandover,
  priorityTone,
  winningRotation,
} from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { canConfigure } = useOnCallPermissions();

/// A table row. Grouped or not, every row carries the same shape so the
/// columns and the actions never have to branch on the mode.
type PageRow = OnCallResponseGroup & { rowKey: string };

/// A busy org has more open records than one request may return, and the
/// facets have to count what the table can show. Three pages of the server's
/// cap is where "honest counts" stops being worth another round trip.
const MAX_PAGES = 3;

/**
 * How many open pages get their escalation ladder loaded.
 *
 * There is no bulk escalation endpoint, so this costs one request per page, on
 * every poll. Twenty-five covers the top of a triage list without turning a
 * 200-row incident into 200 requests every twenty seconds; the rows past it
 * still show their state, and the list says so rather than leaving a blank cell
 * that would read as "nothing has fired".
 */
const ESCALATION_DETAIL_LIMIT = 25;

const responses = ref<OnCallResponse[]>([]);
const teams = ref<OnCallTeam[]>([]);
const policyByTeam = ref<Record<string, OnCallPolicy>>({});
const scheduleByTeam = ref<Record<string, OnCallSchedule>>({});
const slotsByTeam = ref<Record<string, OnCallSlot[]>>({});
const progressById = ref<Record<string, EscalationProgress>>({});
const escalationCapped = ref(false);
const expandedIds = ref<string[]>([]);
const expandedEvents = ref<OnCallResponseEvent[]>([]);
const expandedHistory = ref<OnCallResponse[]>([]);
const expandedCauses = ref<CauseGroup[]>([]);
const expandedLoading = ref(false);
const causeAnalytics = ref<CauseAnalytics | null>(null);
const teamsAvailable = ref(true);
const totalCount = ref(0);
const truncated = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);
const search = ref("");
const teamFilter = ref("all");
const priorityFilter = ref("all");
const stateFilter = ref<string | null>(null);
const selectedIds = ref<string[]>([]);
const grouped = ref(true);
const includeResolved = ref(false);
const busyId = ref("");
const bulkBusy = ref(false);
const confirmBulkResolve = ref(false);

// Only after the first fetch, so the checklist never flashes while loading.
const loaded = ref(false);
const setup = ref({ hasTeam: false, hasStaffedRotation: false, hasRouting: false });

const orgId = computed(() => store.state.selectedOrganization.identifier);
/// Lowercased to compare with `acked_by`, which the server normalises on a
/// handoff but not necessarily on a self-acknowledgement.
const viewerEmail = computed(() => String(store.state.userInfo?.email ?? "").toLowerCase());

const teamNameById = computed<Record<string, string>>(() =>
  Object.fromEntries(teams.value.map((team) => [team.id, team.name])),
);

const teamOptions = computed(() => [
  { label: t("oncall.allTeams"), value: "all" },
  ...teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
]);

const priorityOptions = computed(() => [
  { label: t("oncall.allPriorities"), value: "all" },
  // "P1" is the same identifier on every surface — the alertPriority badge
  // group renders it with `raw` too.
  ...[1, 2, 3, 4, 5].map((p) => ({ label: raw(`P${p}`), value: String(p) })),
]);

const snoozeOptions = computed(() => [
  { minutes: 15, label: t("oncall.snooze15m") },
  { minutes: 30, label: t("oncall.snooze30m") },
  { minutes: 60, label: t("oncall.snooze1h") },
  { minutes: 180, label: t("oncall.snooze3h") },
]);

const isFiltered = computed(
  () =>
    !!search.value ||
    teamFilter.value !== "all" ||
    priorityFilter.value !== "all" ||
    stateFilter.value !== null,
);

const showChecklist = computed(
  () =>
    loaded.value &&
    !loadError.value &&
    !(setup.value.hasTeam && setup.value.hasStaffedRotation && setup.value.hasRouting),
);

const columns = computed<OTableColumnDef<PageRow>[]>(() => [
  {
    id: "priority",
    header: t("oncall.priority"),
    size: 88,
    accessorFn: (row: PageRow) => row.latest.priority,
    sortable: true,
  },
  {
    id: "subject",
    header: t("oncall.subject"),
    // The producer sends the alert's name; the source id is a ksuid and tells
    // a woken engineer nothing. Fall back only when there is no title.
    accessorFn: (row: PageRow) => row.latest.title || row.latest.subject.source_id,
    sortable: true,
    meta: { isName: true },
  },
  {
    // Sorts on rungs fired, so "furthest up the ladder" is one click away —
    // that is the ordering a responder wants, not alphabetical state.
    id: "escalation",
    header: t("oncall.escalation"),
    size: 240,
    accessorFn: (row: PageRow) => progressById.value[row.latest.id]?.fired.length ?? 0,
    sortable: true,
  },
  {
    id: "responder",
    header: t("oncall.responder"),
    size: 184,
    accessorFn: (row: PageRow) => row.latest.acked_by ?? "",
    sortable: true,
  },
  {
    // Age, not the absolute instant: "6m 40s" is what a responder is deciding
    // against. The channels beside it are what the policy WOULD use.
    id: "notified",
    header: t("oncall.notifiedAge"),
    size: 200,
    accessorFn: (row: PageRow) => row.latest.opened_at,
    sortable: true,
  },
  {
    // State now reads off the escalation cell, so this is the redundant copy —
    // kept for sorting and filtering, off by default.
    id: "state",
    header: t("oncall.state"),
    size: 128,
    accessorFn: (row: PageRow) => row.latest.state,
    sortable: true,
    hideable: true,
  },
  {
    id: "team",
    header: t("oncall.team"),
    size: 160,
    accessorFn: (row: PageRow) =>
      teamNameById.value[row.latest.team_id] ?? row.latest.team_id ?? "",
    sortable: true,
    hideable: true,
  },
  {
    id: "opened_at",
    header: t("oncall.openedAt"),
    size: 128,
    accessorFn: (row: PageRow) => row.latest.opened_at,
    sortable: true,
    hideable: true,
  },
  {
    // "95 firings" is the number that matters; the individual firing number
    // only means something on a single record. Secondary, so off by default.
    id: "firings",
    header: t("oncall.firings"),
    size: 112,
    accessorFn: (row: PageRow) => row.firings.length,
    sortable: true,
    hideable: true,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    // One labelled button plus two icon buttons. `actionCount` is what OTable
    // sizes the hover rail from, so it counts the controls, not the width.
    size: 148,
    meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
  },
]);

// Everything except the state facet, so the strip counts what the rest of the
// filters allow — a tile that changed its own number as you clicked it would
// be unreadable.
const scopedResponses = computed(() => {
  const q = search.value.trim().toLowerCase();
  return responses.value.filter((row) => {
    if (teamFilter.value !== "all" && row.team_id !== teamFilter.value) return false;
    if (priorityFilter.value !== "all" && String(row.priority) !== priorityFilter.value) {
      return false;
    }
    if (!q) return true;
    return (
      (row.title ?? "").toLowerCase().includes(q) ||
      row.subject.source_id.toLowerCase().includes(q) ||
      (row.acked_by ?? "").toLowerCase().includes(q)
    );
  });
});

/// Asked of a ROW, not a record, so the strip counts the same things the
/// table shows. A group is unacknowledged if any firing in it still is.
function matchesStateFacet(row: PageRow, facet: string | null): boolean {
  switch (facet) {
    case "unacked":
      return row.escalating.some((r) => !r.acked_by && !isSnoozed(r));
    case "p1":
      return row.latest.priority === 1 && row.escalating.length > 0;
    case "acked":
      return row.firings.some((r) => r.state === "acknowledged");
    case "snoozed":
      return row.firings.some((r) => isSnoozed(r));
    // Whoever acknowledged it owns it: a handoff to a person acknowledges as
    // the new owner, so this is the same field either way.
    case "mine":
      return row.firings.some(
        (r) => !!r.acked_by && r.acked_by.toLowerCase() === viewerEmail.value,
      );
    // A record with no team paged nobody. The one facet that is a
    // configuration bug rather than a state somebody is working through.
    case "unrouted":
      return !row.latest.team_id;
    default:
      return true;
  }
}

/// Grouped or not, downstream code sees one shape.
function toRows(records: OnCallResponse[]): PageRow[] {
  const groups = grouped.value
    ? groupBySubject(records)
    : records.map((r) => ({
        latest: r,
        firings: [r],
        escalating: isEscalating(r.state) ? [r] : [],
      }));
  // Keyed by the record when ungrouped so two firings never collapse into one
  // table row by accident.
  return groups.map((g) => ({
    ...g,
    rowKey: grouped.value
      ? `${g.latest.subject.subject_type}:${g.latest.subject.source_id}`
      : g.latest.id,
  }));
}

const scopedRows = computed(() => toRows(scopedResponses.value));

const rows = computed(() =>
  scopedRows.value.filter((row) => matchesStateFacet(row, stateFilter.value)),
);

// Attention-first, with the total last: whoever opens this page needs the
// pages nobody has taken before anything else.
const summaryStats = computed<StatItem[]>(() => {
  const all = scopedRows.value;
  const count = (facet: string) => all.filter((r) => matchesStateFacet(r, facet)).length;
  const items: StatItem[] = [
    {
      key: "unacked",
      label: t("oncall.statUnacked"),
      value: count("unacked"),
      icon: "notifications-active",
      tone: "error",
      dataTest: "oncall-stat-unacked",
    },
    {
      key: "p1",
      label: t("oncall.statP1"),
      value: count("p1"),
      icon: "warning-amber",
      tone: "orange",
      dataTest: "oncall-stat-p1",
    },
    {
      key: "mine",
      label: t("oncall.statMine"),
      value: count("mine"),
      icon: "person",
      tone: "info",
      dataTest: "oncall-stat-mine",
    },
    {
      // Now reachable: an acknowledged page stays in the list, so it needs a
      // way to be found.
      key: "acked",
      label: t("oncall.statAcked"),
      value: count("acked"),
      icon: "check-circle",
      tone: "info",
      dataTest: "oncall-stat-acked",
    },
    {
      key: "snoozed",
      label: t("oncall.statSnoozed"),
      value: count("snoozed"),
      icon: "pause-circle-filled",
      tone: "warning",
      dataTest: "oncall-stat-snoozed",
    },
    {
      key: "unrouted",
      label: t("oncall.statUnrouted"),
      value: count("unrouted"),
      icon: "help-outline",
      tone: "error",
      dataTest: "oncall-stat-unrouted",
    },
    {
      key: "all",
      label: t("oncall.statAll"),
      value: all.length,
      icon: "format-list-bulleted",
      tone: "neutral",
      dataTest: "oncall-stat-all",
    },
  ];
  // Dropped entirely when we do not know who is signed in, rather than left as
  // a tile that can only ever read zero.
  return viewerEmail.value ? items : items.filter((item) => item.key !== "mine");
});

const youLabel = computed(() => String(t("oncall.onCallYou")));

/// How fast the page was answered, for a row that already has been.
function ackedInMicros(record: OnCallResponse): number | null {
  return record.acked_at ? record.acked_at - record.opened_at : null;
}

/// Distinct people the ladder has already rung, from the rungs that fired.
///
/// Deduplicated across rungs: a two-rung ladder that reached the same person
/// twice has rung one person, and saying "2 people rung" would suggest a second
/// pair of hands that does not exist.
function peopleRung(record: OnCallResponse): I18nText | "" {
  if (record.acked_by) return "";
  const fired = progressById.value[record.id]?.fired ?? [];
  const people = new Set(fired.flatMap((rung) => rung.targets));
  return people.size
    ? t("oncall.escalationPeopleRung", { count: people.size }, people.size)
    : "";
}

/// The channels this record's priority pages on, per its team's policy.
function channelsFor(record: OnCallResponse): Channel[] {
  return (
    policyByTeam.value[record.team_id]?.rungs.find((rung) => rung.priority === record.priority)
      ?.channels ?? []
  );
}

/// Rungs the team's policy defines for THIS record's priority — the "of 3" in
/// "Level 2 of 3". Undefined when the policy could not be read, which the cell
/// renders as a level with no denominator rather than a guessed total.
function totalRungsFor(record: OnCallResponse): number | null {
  const rungs = policyByTeam.value[record.team_id]?.rungs ?? [];
  return rungs.find((rung) => rung.priority === record.priority)?.steps.length ?? null;
}

/// Everything the attention card states, derived from what is already loaded.
/// Records rather than rows: "2 unacknowledged" counts pages, and a grouped row
/// standing for ninety-five firings is still ninety-five pages nobody took.
const attention = computed(() => {
  const nowMicros = Date.now() * 1000;
  const open = scopedResponses.value.filter(
    (r) => isEscalating(r.state) && !r.acked_by && !isSnoozed(r, nowMicros),
  );

  // "Assigned to you" is the team's rotation resolving to the viewer — there is
  // no assignee on a record, and an unacknowledged page has no owner yet.
  const mine = viewerEmail.value
    ? open.filter((r) =>
        (slotsByTeam.value[r.team_id] ?? []).some(
          (slot) => slot.user_email.toLowerCase() === viewerEmail.value,
        ),
      ).length
    : 0;

  const pending = open
    .map((r) => progressById.value[r.id]?.next_at ?? null)
    .filter((at): at is number => !!at && at > nowMicros);

  return {
    unacked: open.length,
    escalating: pending.length,
    nextEscalationAt: pending.length ? Math.min(...pending) : null,
    assignedToMe: mine,
    oldestOpenedAt: open.length ? Math.min(...open.map((r) => r.opened_at)) : null,
  };
});

/// When each team's current shift hands over.
///
/// `OnCallSlot` carries no end instant, so this is resolved from the schedule
/// with the same rotation maths the engine uses (`winningRotation` +
/// `nextHandover`) rather than guessed from the shift length.
const handoverByTeam = computed<Record<string, number | null>>(() => {
  const nowMicros = Date.now() * 1000;
  const out: Record<string, number | null> = {};
  for (const team of teams.value) {
    const schedule = scheduleByTeam.value[team.id];
    if (!schedule) continue;
    const rotation = winningRotation(schedule.rotations, nowMicros, schedule.timezone);
    out[team.id] = rotation ? nextHandover(rotation, nowMicros) : null;
  }
  return out;
});

/// The viewer's own shift, if they hold one. Taken from the server's slots so
/// the banner never names a different person from the one it would page.
const myShift = computed(() => {
  if (!viewerEmail.value) return null;
  const mine = teams.value
    .map((team) => ({
      team,
      slot: (slotsByTeam.value[team.id] ?? []).find(
        (candidate) => candidate.user_email.toLowerCase() === viewerEmail.value,
      ),
    }))
    .filter((entry): entry is { team: OnCallTeam; slot: OnCallSlot } => !!entry.slot);

  if (!mine.length) return null;
  // Soonest handover first: the shift ending next is the one being counted down.
  const sorted = [...mine].sort(
    (a, b) =>
      (handoverByTeam.value[a.team.id] ?? Infinity) -
      (handoverByTeam.value[b.team.id] ?? Infinity),
  );
  const first = sorted[0];
  return {
    teamName: first.team.name,
    rotation: first.slot.rotation,
    endsAt: handoverByTeam.value[first.team.id] ?? null,
    otherTeams: sorted.length - 1,
  };
});

// Only an escalating page can be claimed. A row with nothing left to claim
// offers no button rather than one that errors.
function canAcknowledge(row: PageRow): boolean {
  return row.escalating.length > 0;
}

/// Acts on every firing the row stands for. Acknowledging the latest of
/// ninety-five and leaving ninety-four escalating would be a worse lie than
/// showing all ninety-five rows.
async function acknowledgeRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    await Promise.allSettled(
      row.escalating.map((r) =>
        oncallService.acknowledgeResponse({
          org_identifier: orgId.value,
          response_id: r.id,
        }),
      ),
    );
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

/// Quiets every firing still climbing, without claiming any of them.
async function snoozeRow(row: PageRow, minutes: number) {
  busyId.value = row.rowKey;
  try {
    await Promise.allSettled(
      row.escalating.map((r) =>
        oncallService.snoozeResponse({
          org_identifier: orgId.value,
          response_id: r.id,
          minutes,
        }),
      ),
    );
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

async function resolveRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    await Promise.allSettled(
      row.firings
        .filter((r) => r.state !== "resolved")
        .map((r) =>
          oncallService.resolveResponse({
            org_identifier: orgId.value,
            response_id: r.id,
          }),
        ),
    );
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

/// The records the selection stands for. `pick` narrows to the ones the action
/// can legally touch, so a bulk action never fires a request that must fail.
function selectedRecords(pick: (row: PageRow) => OnCallResponse[]): string[] {
  return rows.value
    .filter((r) => selectedIds.value.includes(r.rowKey))
    .flatMap((r) => pick(r).map((e) => e.id));
}

type BulkDoneKey = "bulkAckDone" | "bulkSnoozeDone" | "bulkResolveDone";
type BulkPartialKey = "bulkAckPartial" | "bulkSnoozePartial" | "bulkResolvePartial";

// Settled, not all-or-nothing: one page failing must not silently abandon the
// other ninety-nine. All three bulk actions share this shape.
async function runBulk(
  ids: string[],
  call: (id: string) => Promise<unknown>,
  doneKey: BulkDoneKey,
  partialKey: BulkPartialKey,
) {
  bulkBusy.value = true;
  try {
    const results = await Promise.allSettled(ids.map(call));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      toast({ variant: "error", message: t(`oncall.${partialKey}`, { count: failed }) });
    } else {
      toast({ variant: "success", message: t(`oncall.${doneKey}`, { count: ids.length }) });
    }
    selectedIds.value = [];
    await fetchResponses();
  } finally {
    bulkBusy.value = false;
  }
}

async function bulkAcknowledge() {
  await runBulk(
    selectedRecords((r) => r.escalating),
    (id) => oncallService.acknowledgeResponse({ org_identifier: orgId.value, response_id: id }),
    "bulkAckDone",
    "bulkAckPartial",
  );
}

/// Snooze quiets an escalating record WITHOUT claiming it, so it only applies
/// to the ones still climbing the ladder.
async function bulkSnooze(minutes: number) {
  await runBulk(
    selectedRecords((r) => r.escalating),
    (id) => oncallService.snoozeResponse({ org_identifier: orgId.value, response_id: id, minutes }),
    "bulkSnoozeDone",
    "bulkSnoozePartial",
  );
}

async function bulkResolve() {
  confirmBulkResolve.value = false;
  await runBulk(
    selectedRecords((r) => r.firings.filter((f) => f.state !== "resolved")),
    (id) => oncallService.resolveResponse({ org_identifier: orgId.value, response_id: id }),
    "bulkResolveDone",
    "bulkResolvePartial",
  );
}

// Re-clicking the live tile clears it; "All" only ever clears.
function onStatSelect(key: string) {
  stateFilter.value = key === "all" || stateFilter.value === key ? null : key;
}

// The rail carries severity on every row. A closed record has no severity left
// to signal, so it gets none rather than a stale colour.
function rowRailTone(row: PageRow): RowRailTone | null {
  return isEscalating(row.latest.state) ? priorityTone(row.latest.priority) : null;
}

// Snoozed rows are deliberately inert, so they recede. This is the only wash
// on the list — the loud one is reserved for something you must act on now.
function rowTone(row: PageRow): RowTone | null {
  return isSnoozed(row.latest) ? "muted" : null;
}

function errorMessage(err: unknown): string {
  const body = (err as { response?: { data?: { message?: string } } } | null)?.response?.data;
  return body?.message ?? (err instanceof Error ? err.message : "");
}

/// Walks the server's pages until a short one arrives or the cap is hit. The
/// alternative — one page plus client-side facets over it — would put a number
/// on the stat strip that silently described a fraction of the org.
async function fetchAllPages(): Promise<OnCallResponse[]> {
  const out: OnCallResponse[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await oncallService.listResponses({
      org_identifier: orgId.value,
      include_resolved: includeResolved.value,
      limit: RESPONSE_PAGE_LIMIT,
      offset: page * RESPONSE_PAGE_LIMIT,
    });
    const batch = res.data ?? [];
    out.push(...batch);
    if (batch.length < RESPONSE_PAGE_LIMIT) {
      truncated.value = false;
      return out;
    }
  }
  truncated.value = true;
  return out;
}

/// Every fetch is now a deliberate one — first load, an explicit refresh, or a
/// row action — so every fetch shows the spinner. The silent variant existed
/// only for the background poll.
async function fetchResponses() {
  loading.value = true;
  try {
    responses.value = await fetchAllPages();
    loadError.value = null;
    // Only on SUCCESS. Setting this in `finally` would let a transient API
    // error render the first-run checklist, telling a configured org that
    // nothing is set up.
    loaded.value = true;
    await refreshTotal();
  } catch (err) {
    loadError.value = errorMessage(err) || String(t("oncall.loadResponsesFailed"));
  } finally {
    loading.value = false;
  }
}

/// Best-effort: the real total only matters when the list is truncated, and a
/// server without the counter must not break the screen.
async function refreshTotal() {
  try {
    const res = await oncallService.countResponses({
      org_identifier: orgId.value,
      include_resolved: includeResolved.value,
    });
    totalCount.value = res.data?.count ?? responses.value.length;
  } catch {
    totalCount.value = responses.value.length;
  }
}

/// Teams, coverage and ownership answer the checklist, not the list. A failure
/// on any one of them degrades a single control rather than the page.
async function fetchContext() {
  const [teamRes, gapRes, ruleRes] = await Promise.allSettled([
    oncallService.listTeams({ org_identifier: orgId.value }),
    oncallService.coverageGaps({ org_identifier: orgId.value }),
    oncallService.listOwnershipRules({ org_identifier: orgId.value }),
  ]);

  teamsAvailable.value = teamRes.status === "fulfilled";
  teams.value = teamRes.status === "fulfilled" ? (teamRes.value.data ?? []) : [];

  const rules = ruleRes.status === "fulfilled" ? (ruleRes.value.data ?? []) : [];

  setup.value = {
    hasTeam: teams.value.length > 0,
    hasStaffedRotation: await someTeamWouldPage(gapRes),
    // An alert bound straight to a team counts: it is routing without a rule.
    hasRouting: rules.length > 0 || responses.value.some((r) => !!r.team_id),
  };
}

/// "Would any team page a person right now?" The coverage-gap endpoint answers
/// it in one request; when it is unavailable we ask each team instead, because
/// a missing gap count is not the same fact as a gap count of zero — reading it
/// as zero marked the rotation staffed on an org that had no rotation at all,
/// and that tick also hides the checklist that would have said so.
async function someTeamWouldPage(
  gapRes: PromiseSettledResult<{ data?: CoverageGaps | null }>,
): Promise<boolean> {
  if (!teams.value.length) return false;
  if (gapRes.status === "fulfilled") {
    return (gapRes.value.data?.total ?? 0) < teams.value.length;
  }
  const slots = await Promise.allSettled(
    teams.value.map((team) =>
      oncallService.whoIsOnCall({ org_identifier: orgId.value, team_id: team.id }),
    ),
  );
  return slots.some((s) => s.status === "fulfilled" && (s.value.data ?? []).length > 0);
}

/// Policy and rotation per team. Both are one request per team — there is no
/// bulk endpoint for either — but team counts are small and the answers change
/// far more slowly than the pages do.
async function fetchTeamContext() {
  const ids = teams.value.map((team) => team.id);
  const [policies, slots, schedules] = await Promise.all([
    Promise.allSettled(
      ids.map((id) => oncallService.getPolicy({ org_identifier: orgId.value, team_id: id })),
    ),
    Promise.allSettled(
      ids.map((id) => oncallService.whoIsOnCall({ org_identifier: orgId.value, team_id: id })),
    ),
    Promise.allSettled(
      ids.map((id) => oncallService.getSchedule({ org_identifier: orgId.value, team_id: id })),
    ),
  ]);

  const nextPolicies: Record<string, OnCallPolicy> = {};
  const nextSlots: Record<string, OnCallSlot[]> = {};
  const nextSchedules: Record<string, OnCallSchedule> = {};
  ids.forEach((id, index) => {
    const policy = policies[index];
    if (policy.status === "fulfilled" && policy.value.data) nextPolicies[id] = policy.value.data;
    const slot = slots[index];
    // A team whose rotation could not be read is left OUT rather than recorded
    // as empty: an unreadable schedule is not the same fact as a coverage gap,
    // and the card would otherwise accuse a staffed team of having none.
    if (slot.status === "fulfilled") nextSlots[id] = slot.value.data ?? [];
    const schedule = schedules[index];
    if (schedule.status === "fulfilled" && schedule.value.data) {
      nextSchedules[id] = schedule.value.data;
    }
  });
  policyByTeam.value = nextPolicies;
  slotsByTeam.value = nextSlots;
  scheduleByTeam.value = nextSchedules;
}

/// Ladder position for the oldest open pages. Bounded by
/// ESCALATION_DETAIL_LIMIT because each one is its own request.
async function fetchEscalationProgress() {
  const open = responses.value
    .filter((r) => isEscalating(r.state))
    .sort((a, b) => a.opened_at - b.opened_at);

  escalationCapped.value = open.length > ESCALATION_DETAIL_LIMIT;
  const wanted = open.slice(0, ESCALATION_DETAIL_LIMIT);

  const results = await Promise.allSettled(
    wanted.map((r) =>
      oncallService.escalationProgress({ org_identifier: orgId.value, response_id: r.id }),
    ),
  );

  const next: Record<string, EscalationProgress> = {};
  wanted.forEach((record, index) => {
    const result = results[index];
    if (result.status === "fulfilled" && result.value.data) next[record.id] = result.value.data;
  });
  // Replaced wholesale so a record that resolved since the last poll drops its
  // stale ladder instead of keeping a countdown that will never fire.
  progressById.value = next;
}

/// The expanded row's timeline plus what previous firings turned out to be.
async function fetchExpandedEvents(responseId: string) {
  expandedLoading.value = true;
  expandedEvents.value = [];
  expandedHistory.value = [];
  expandedCauses.value = [];
  try {
    // Settled: the context panel is worth having, but a missing prior-cause
    // must not cost the timeline that sits beside it.
    const [events, history, causes] = await Promise.allSettled([
      oncallService.getResponse({ org_identifier: orgId.value, response_id: responseId }),
      oncallService.responseHistory({ org_identifier: orgId.value, response_id: responseId }),
      oncallService.priorCauses({ org_identifier: orgId.value, response_id: responseId }),
    ]);
    if (events.status === "fulfilled") expandedEvents.value = events.value.data?.events ?? [];
    if (history.status === "fulfilled") expandedHistory.value = history.value.data ?? [];
    if (causes.status === "fulfilled") expandedCauses.value = causes.value.data ?? [];
  } finally {
    expandedLoading.value = false;
  }
}

/// What keeps breaking the org, counted in the database over a window. Costs
/// one request and, unlike anything derived from the fetched page, describes
/// the whole org.
async function fetchCauseAnalytics() {
  try {
    const res = await oncallService.analyticsCauses({ org_identifier: orgId.value });
    causeAnalytics.value = res.data ?? null;
  } catch {
    // Older servers have no analytics route; the card says "no cause recorded"
    // rather than taking the screen down.
    causeAnalytics.value = null;
  }
}

async function refreshAll() {
  await fetchResponses();
  await fetchContext();
  await fetchTeamContext();
  await Promise.allSettled([fetchEscalationProgress(), fetchCauseAnalytics()]);
}

// Expansion is single-mode, so there is at most one id to resolve. The table
// keys rows by `rowKey`, which is the group key when grouping is on.
watch(expandedIds, (ids) => {
  const row = rows.value.find((candidate) => candidate.rowKey === ids[0]);
  if (row) void fetchExpandedEvents(row.latest.id);
  else expandedEvents.value = [];
});

function goTo(name: string) {
  router.push({ name, query: { org_identifier: orgId.value } });
}

function openResponse(row: PageRow) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: row.latest.id },
    query: { org_identifier: orgId.value },
  });
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    teamFilter.value = "all";
    priorityFilter.value = "all";
    stateFilter.value = null;
  }
}

useShortcuts([
  {
    id: "oncallRefresh",
    handler: () => {
      if (isInputFocused()) return;
      void refreshAll();
    },
  },
  { id: "oncallSearch", handler: () => focusSearchInput("oncall-responses-search") },
]);

onMounted(refreshAll);
</script>
