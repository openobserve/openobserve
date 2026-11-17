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
    icon="notifications-active"
  >
    <template #title-trail>
      <BetaBadge class="shrink-0" />
    </template>
    <template #actions>
      <!-- Whether the reader is themselves on call, beside the buttons rather
           than in the body: it qualifies the whole screen, not one section. -->
      <OnCallShiftBanner
        v-if="myShift && !isMobile"
        :user-email="viewerEmail"
        :rotation="myShift.rotation"
        :team-name="myShift.teamName"
        :ends-at="myShift.endsAt"
        :other-teams="myShift.otherTeams"
      />
    </template>

    <!-- §G.8.1: the entry fetch is the capability probe. 404 (feature off) and
         403 "Not Supported" (OSS build) both mean on-call is not available on
         this deployment — a fact, not a failure. No error tone, no retry, and
         no hint of which of the two it was. -->
    <OEmptyState
      v-if="unavailable"
      size="hero"
      icon="cloud-off"
      :title="t('oncall.notAvailableTitle')"
      :description="t('oncall.notAvailableDescription')"
      data-test="oncall-responses-unavailable"
    />

    <!-- Setup is answered from live data, so it survives past "no teams": a
         team with nobody in its rotation pages nobody, and the calm empty
         state below would call that healthy.

         `compact` is the whole layout decision. With no pages the checklist is
         the screen and everything below it is hidden; with pages it is one bar
         naming the next undone step, over a list that stays fully usable. -->
    <!-- A phone header has no room for the banner, so it leads the body instead. -->
    <OnCallShiftBanner
      v-if="myShift && isMobile"
      class="mx-page-edge mt-2 shrink-0"
      :user-email="viewerEmail"
      :rotation="myShift.rotation"
      :team-name="myShift.teamName"
      :ends-at="myShift.endsAt"
      :other-teams="myShift.otherTeams"
    />

    <OnCallSetupChecklist
      v-if="showChecklist && !unavailable"
      :has-team="setup.hasTeam"
      :has-staffed-rotation="setup.hasStaffedRotation"
      :has-policy="setup.hasPolicy"
      :has-routing="setup.hasRouting"
      :compact="!setupOnly"
      :dismissible="hasPages"
      :can-configure="canConfigure"
      :first-team-id="teams[0]?.id ?? null"
      :first-team-name="teams[0]?.name ?? null"
      @create-team="createTeam"
    />

    <!-- `table-id` carries a version suffix because column widths and
         visibility are persisted per column id: the previous entry hid Team,
         hid a column that no longer exists, and sized a time column that has
         since been renamed — three settings no reader chose. v3 adds the
         "On call now" column. -->
    <OTable
      v-if="!unavailable && !setupOnly"
      ref="oTableRef"
      :frame="false"
      :data="visibleRows"
      :columns="columns"
      row-key="rowKey"
      :loading="loading || (!setupLoaded && !responses.length)"
      :streaming="backgroundLoading"
      :error="loadError"
      :forbidden="forbidden"
      pagination="client"
      :page-size="pageSize"
      :current-page="currentPage"
      :sort-by="sortBy"
      :sort-order="sortOrder"
      :column-visibility="{
        firings: false,
        channels: false,
      }"
      table-id="oncall-responses-list-v3"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-responses-table"
      :row-tone="rowTone"
      :row-rail-tone="rowRailTone"
      :row-section="rowSection"
      :section-order="SECTION_ORDER"
      selection="multiple"
      v-model:selected-ids="selectedIds"
      :is-row-selectable="canAcknowledge"
      expansion="single"
      v-model:expanded-ids="expandedIds"
      @row-click="openResponse"
      @update:current-page="currentPage = $event"
      @update:page-size="pageSize = $event"
      @update:sort-by="sortBy = $event"
      @update:sort-order="sortOrder = $event"
    >
      <!-- During an incident the list IS the work surface. Opening 200 pages
           one at a time to claim them is not triage. -->
      <template v-if="hasPages" #toolbar>
        <div class="flex w-full flex-wrap items-center gap-2 max-md:contents">
          <!-- First, and always on screen, so a list narrowed to the reader's own pages never looks empty for a hidden reason. -->
          <OToggleGroup
            v-if="viewerEmail"
            :model-value="mineOnly ? 'mine' : 'everyone'"
            mobile-dropdown
            data-test="oncall-responses-scope"
            @update:model-value="(v) => setMineOnly(v === 'mine')"
          >
            <OToggleGroupItem
              value="mine"
              size="sm"
              icon-left="person"
              data-test="oncall-responses-scope-mine"
            >
              {{ t("oncall.scopeMine") }}
            </OToggleGroupItem>
            <OToggleGroupItem
              value="everyone"
              size="sm"
              icon-left="group"
              data-test="oncall-responses-scope-everyone"
            >
              {{ t("oncall.scopeEveryone") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OSelect
            :model-value="activeFilter"
            :options="statusOptions"
            :searchable="false"
            icon-key="icon"
            :aria-label="t('oncall.statusFilterLabel')"
            width="sm"
            data-test="oncall-responses-filter-tabs"
            @update:model-value="(v) => selectFilterTab(v as FilterTab)"
          >
            <template #trigger>
              <span class="flex min-w-0 items-center gap-1.5">
                <OIcon :name="STATUS_ICON[activeFilter]" size="sm" class="text-text-secondary" />
                {{ t("oncall.statusTrigger", { status: statusLabel }) }}
              </span>
            </template>
          </OSelect>
          <!-- Server-side, so a team's older pages past the fetch cap are not hidden by a client filter. -->
          <OSelect
            v-if="!isMobile"
            v-model="teamFilter"
            :options="teamOptions"
            :disabled="!teamsAvailable"
            :placeholder="teamsAvailable ? undefined : t('oncall.teamFilterUnavailable')"
            :aria-label="t('oncall.teamFilterLabel')"
            width="sm"
            data-test="oncall-responses-team-filter"
            @update:model-value="() => fetchResponses()"
          />
          <OSelect
            v-if="!isMobile"
            v-model="priorityFilter"
            :options="priorityOptions"
            :aria-label="t('oncall.priorityFilterLabel')"
            width="sm"
            data-test="oncall-responses-priority-filter"
          />
          <OSearchInput
            v-model="search"
            class="min-w-40 flex-1 basis-40 max-md:min-w-24 max-md:basis-24"
            clearable
            :placeholder="t('oncall.searchResponses')"
            data-test="oncall-responses-search"
          />
          <OPopover align="end" content-class="w-72" :aria-label="t('oncall.filters')">
            <template #trigger>
              <OButton
                variant="outline"
                size="icon-sm"
                icon-left="filter-list"
                :active="narrowed"
                :aria-label="t('oncall.filters')"
                data-test="oncall-responses-filters-btn"
              />
            </template>
            <div class="flex flex-col gap-3 p-3" data-test="oncall-responses-filters-panel">
              <OSelect
                v-if="isMobile"
                v-model="teamFilter"
                :options="teamOptions"
                :disabled="!teamsAvailable"
                :placeholder="teamsAvailable ? undefined : t('oncall.teamFilterUnavailable')"
                :aria-label="t('oncall.teamFilterLabel')"
                data-test="oncall-responses-team-filter"
                @update:model-value="() => fetchResponses()"
              />
              <OSelect
                v-if="isMobile"
                v-model="priorityFilter"
                :options="priorityOptions"
                :aria-label="t('oncall.priorityFilterLabel')"
                data-test="oncall-responses-priority-filter"
              />
              <OSelect
                v-if="sectionVisibility.resolved"
                :model-value="causeFilter || ANY_CAUSE"
                :options="causeOptions"
                :searchable="false"
                :aria-label="t('oncall.causeFilterLabel')"
                data-test="oncall-responses-cause-filter"
                @update:model-value="onCauseFilter"
              />
              <OCheckbox
                v-model="grouped"
                :label="t('oncall.groupByAlert')"
                data-test="oncall-responses-group-toggle"
              />
            </div>
          </OPopover>
        </div>
      </template>

      <template #selection-actions>
        <OButton
          variant="outline"
          size="sm"
          :loading="bulkBusy"
          data-test="oncall-bulk-ack"
          @click="bulkAcknowledge"
        >
          <OIcon name="check-circle" size="sm" />{{ t("oncall.acknowledge") }}
        </OButton>
        <ODropdown>
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              icon-right="expand-more"
              :loading="bulkBusy"
              data-test="oncall-bulk-snooze"
            >
              <OIcon name="alarm" size="sm" />{{ t("oncall.snooze") }}
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
          size="sm"
          :loading="bulkBusy"
          data-test="oncall-bulk-resolve"
          @click="confirmBulkResolve = true"
        >
          <OIcon name="task-alt" size="sm" />{{ t("oncall.resolve") }}
        </OButton>
      </template>

      <!-- Both caps are stated: a capped list under-reports, and a blank ladder cell would read as "nothing has fired". -->
      <!-- The list endpoint has no count, so the loaded length is never presented as the total. -->
      <template v-if="truncated" #footer-note>
        <span data-test="oncall-responses-truncated">
          {{ t("oncall.listTruncatedNoTotal", { count: responses.length }) }}
        </span>
      </template>

      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="lastUpdatedAt"
          :loading="loading"
          shortcut-id="oncallRefresh"
          data-test="oncall-responses-refresh"
          @click="refreshAll"
        />
      </template>

      <!-- What each run of rows IS, in the words somebody would use out loud, so
           the state is read once per section instead of once per row. The count
           is taken from the filtered set rather than the page, because a heading
           that said "3" on page one of five would be describing the pagination.

           `sectionKey` rather than `key`: Vue reserves `key` on a slot outlet. -->
      <template #group-header="{ sectionKey }">
        <!-- The cell spans the scrolled table, so a phone pins this to the visible width or the sentence runs off screen. -->
        <div
          class="px-page-edge flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 max-md:sticky max-md:left-0 max-md:w-[100cqw]"
          :data-test="`oncall-section-header-${sectionKey}`"
        >
          <span class="text-2xs font-semibold" :class="sectionTone(sectionKey)">
            {{ t(`oncall.section_${sectionKey}`) }}
          </span>
          <OTag variant="default-soft" size="sm" :data-test="`oncall-section-count-${sectionKey}`">
            {{ raw(String(sectionCounts[sectionKey] ?? 0)) }}
          </OTag>
          <template v-if="sectionKey === 'ringing' && unroutedRinging + stoppedRinging > 0">
            <OText v-if="routedRinging > 0" variant="meta" data-test="oncall-section-hint-routed">
              {{ t("oncall.sectionHint_ringingRouted", { count: routedRinging }, routedRinging) }}
            </OText>
            <OText v-if="routedRinging > 0" variant="meta" aria-hidden="true">
              {{ raw("·") }}
            </OText>
            <OText
              v-if="unroutedRinging > 0"
              variant="meta"
              data-test="oncall-section-hint-unrouted"
            >
              {{
                t("oncall.sectionHint_ringingUnrouted", { count: unroutedRinging }, unroutedRinging)
              }}
            </OText>
            <OText
              v-if="unroutedRinging > 0 && stoppedRinging > 0"
              variant="meta"
              aria-hidden="true"
            >
              {{ raw("·") }}
            </OText>
            <OText v-if="stoppedRinging > 0" variant="meta" data-test="oncall-section-hint-stopped">
              {{
                t("oncall.sectionHint_ringingStopped", { count: stoppedRinging }, stoppedRinging)
              }}
            </OText>
          </template>
        </div>
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
        <OText variant="body" as="span" v-else>
          {{ raw(`#${row.latest.subject.firing}`) }}
        </OText>
      </template>

      <!-- No team means nothing claimed it, which is a routing bug rather than
           a blank cell. -->
      <template #cell-team="{ row }">
        <OTag v-if="!row.latest.team_id" variant="error-soft" size="sm">
          {{ t("oncall.statUnrouted") }}
        </OTag>
        <OTag
          v-else-if="teamIsDeleted(row.latest.team_id)"
          variant="default-soft"
          size="sm"
          data-test="oncall-row-team-deleted"
        >
          {{ t("oncall.deletedTeam") }}
        </OTag>
        <!-- The team is a destination, not a label: "who else is on this
             rotation" is the question after "who owns this page", and it lives
             one click away on the team. `.stop` because the row itself opens
             the page — a cell that navigates somewhere else must not do both.
             An anchor rather than a button: it goes somewhere, it doesn't act. -->
        <router-link
          v-else
          :to="{
            name: 'onCallTeamDetail',
            params: { teamId: row.latest.team_id },
            query: { org_identifier: orgId },
          }"
          class="text-text-body flex max-w-full min-w-0 hover:underline"
          :data-test="`oncall-row-team-${row.rowKey}`"
          @click.stop
        >
          <OTruncatedText class="block">{{
            raw(teamNameById[row.latest.team_id] ?? row.latest.team_id)
          }}</OTruncatedText>
        </router-link>
      </template>

      <!-- Same reasoning as the team cell above: a page that escalated into an
           incident used to say so only via a chip inside the subject cell, so
           there was nothing on screen to suggest it was a link at all. -->
      <template #cell-incident="{ row }">
        <router-link
          v-if="row.latest.incident_id"
          :to="{
            name: 'incidentDetail',
            params: { id: row.latest.incident_id },
            query: { org_identifier: orgId },
          }"
          class="text-text-body flex max-w-full min-w-0 hover:underline"
          :data-test="`oncall-row-incident-${row.rowKey}`"
          @click.stop
        >
          <OTruncatedText class="block">{{
            raw(row.latest.incident_title ?? row.latest.incident_id)
          }}</OTruncatedText>
        </router-link>
      </template>

      <!-- The name plus how often it has fired. A woken engineer reads this
           cell first. -->
      <template #cell-subject="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex items-center gap-1.5">
            <OTruncatedText class="text-text-body">
              {{ raw(row.latest.title || row.latest.subject.source_id) }}
            </OTruncatedText>
            <OTag v-if="row.firings.length > 1" variant="default-soft" size="sm">
              {{ raw(`×${row.firings.length}`) }}
            </OTag>
          </span>
          <!-- Only when there is something to say: with the team moved out to
               its own column most rows carry no chips at all, and an empty row
               of them still took vertical space in every one. -->
          <span v-if="isImpactedRow(row.latest)" class="flex flex-wrap items-center gap-1">
            <!-- This row is somebody else's outage reaching this team's
                 service, and the difference decides what the reader does with
                 it: a page you fix, or a blast radius you contain and confirm
                 recovery on. `origin_response_id` is already on every row, so
                 the two were indistinguishable in a list only because nothing
                 read it. -->
            <OTag variant="info-outline" size="sm" :data-test="`oncall-impacted-${row.latest.id}`">
              {{ t("oncall.liaisonTag") }}
            </OTag>
          </span>
        </span>
      </template>

      <!-- How far up the ladder this page has climbed, and what fires next.
           Loaded for the oldest open pages only — see ESCALATION_DETAIL_LIMIT. -->
      <!-- The one "what is happening" phrase per row; the section headers already say the state. -->
      <template #cell-escalation="{ row }">
        <OnCallEscalationCell
          :response-id="row.latest.id"
          :record="row.latest"
          :progress="progressById[row.latest.id] ?? null"
          :progress-loaded="progressAnswered.has(row.latest.id)"
          :total-rungs="totalRungsFor(row.latest)"
          :reached-step="reachedStepFor(row.latest)"
          :team-deleted="teamIsDeleted(row.latest.team_id)"
        />
      </template>

      <!-- Who owns it, or — while nobody does — that nobody does. Who the
           rotation would ring right now is a separate question (an escalated
           or reassigned page can be answered by someone no longer holding the
           pager), so it lives in its own "On call now" column instead of
           repeating here. -->
      <template #cell-responder="{ row }">
        <span
          v-if="row.latest.acked_by"
          class="text-text-body block min-w-0 truncate"
          :data-test="`oncall-responder-${row.rowKey}`"
        >
          {{ raw(displayName(row.latest.acked_by)) }}
          <OTooltip :content="personTooltip(row.latest.acked_by)" />
        </span>
        <!-- Same text color as the P2 priority tag, so an unanswered page
             reads as the same order of urgency the priority column already
             establishes. -->
        <OText
          v-else
          variant="body"
          as="span"
          class="text-badge-orange-soft-text"
          data-test="oncall-responder-nobody"
        >
          {{ t("oncall.nobodyYet") }}
        </OText>
      </template>

      <!-- Who the rotation would ring right now, for this row's team — the
           person to reach out to, whether or not the page itself has been
           claimed. Not in the map yet vs. fetched-and-empty are different
           facts — see positionsByTeam's loading contract in
           OnCallTeams.vue — so this says nothing while still loading rather
           than flash a name or a gap in and out. -->
      <template #cell-on_call_now="{ row }">
        <span
          v-if="positionsByTeam[row.latest.team_id ?? '']?.[0]"
          class="text-text-body block min-w-0 truncate"
          :data-test="`oncall-oncallnow-${row.rowKey}`"
        >
          {{ raw(displayName(positionsByTeam[row.latest.team_id ?? ""]![0].user_email)) }}
          <OTooltip
            :content="personTooltip(positionsByTeam[row.latest.team_id ?? '']![0].user_email)"
          />
        </span>
        <OText
          v-else-if="row.latest.team_id && positionsByTeam[row.latest.team_id] !== undefined"
          variant="meta"
          class="text-status-warning-text"
          data-test="oncall-oncallnow-gap"
        >
          {{ raw("—") }}
        </OText>
      </template>

      <!-- The same cell as the Incident list's "Last Alert", down to the hover
           tooltip and the em dash, so the two lists read alike.

           The second line survives the change because it is not a time format:
           a page opened an hour ago whose ladder waited thirty minutes has been
           ringing for half as long as its age suggests, and that gap is the
           difference between a slow responder and a slow policy. -->
      <template #cell-last_alert_at="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5">
          <OTimeCell
            :value="row.latest.opened_at"
            unit="us"
            mode="relative"
            :timezone="store.state.timezone"
            :empty-label="raw('—')"
          />
          <OText
            v-if="isRinging(row) && ladderStarted(row.latest)"
            variant="meta"
            :data-test="`oncall-ladder-started-${row.rowKey}`"
          >
            {{ ladderStarted(row.latest) }}
          </OText>
        </span>
      </template>

      <!-- What the policy WOULD page on — a channel with no provider behind it
           is marked rather than implied. Off by default: it describes the team's
           policy, which is the same for every row of that team. -->
      <template #cell-channels="{ row }">
        <span class="flex flex-nowrap items-center gap-1">
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
              :content="
                t('oncall.channelUndeliverable', { channel: t(`oncall.channel_${channel}`) })
              "
            />
          </OTag>
        </span>
      </template>

      <!-- What already happened, without leaving the triage list. The detail
           screen stays the place to act; this is the place to read. -->
      <template #expansion="{ row }">
        <div
          class="px-page-edge py-3 max-md:sticky max-md:left-0 max-md:w-[100cqw]"
          :data-test="`oncall-expansion-${row.rowKey}`"
        >
          <OInnerLoading v-if="expandedLoading" showing />
          <template v-else>
            <div class="mb-2 flex justify-end">
              <OButton
                variant="ghost"
                size="sm"
                :icon-left="expandedShowAllActivity ? 'visibility-off' : 'visibility'"
                data-test="oncall-expansion-activity-toggle-all"
                @click="expandedShowAllActivity = !expandedShowAllActivity"
              >
                {{
                  expandedShowAllActivity
                    ? t("oncall.activityHideSystem")
                    : t("oncall.activityShowSystemCount", { count: expandedSystemActivityCount })
                }}
              </OButton>
            </div>
            <OnCallActivityTimeline
              :events="expandedEvents"
              :show-scroll-buttons="false"
              v-model:comment-text="expandedNoteBody"
              v-model:show-all="expandedShowAllActivity"
              :submitting="addingExpandedNote"
              @submit="addExpandedNote(row.latest.id)"
            />
          </template>
        </div>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center justify-center">
          <template v-if="!row.latest.team_id">
            <ODropdown>
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  :loading="busyId === row.rowKey"
                  :aria-label="t('oncall.assignTeamShort')"
                  :data-test="`oncall-row-assign-${row.rowKey}`"
                  @click.stop
                >
                  <OIcon name="group-add" size="sm" />
                  <OTooltip side="bottom" :content="t('oncall.assignTeamShort')" />
                </OButton>
              </template>
              <ODropdownItem
                v-for="team in teams"
                :key="team.id"
                icon-left="group"
                :data-test="`oncall-row-assign-${row.rowKey}-${team.id}`"
                @select="assignTeamToRow(row, team.id, team.name)"
              >
                {{ raw(team.name) }}
              </ODropdownItem>
              <ODropdownItem v-if="!teams.length" disabled data-test="oncall-row-assign-no-teams">
                {{ t("oncall.noTeamsToAssign") }}
              </ODropdownItem>
            </ODropdown>
            <span class="size-8 shrink-0 max-md:hidden" aria-hidden="true" />
          </template>
          <template v-else>
            <OButton
              v-if="canAcknowledge(row)"
              variant="ghost-warning"
              size="icon-sm"
              class="max-md:hidden"
              :loading="busyId === row.rowKey"
              :aria-label="t('oncall.acknowledge')"
              :data-test="`oncall-row-ack-${row.rowKey}`"
              @click.stop="acknowledgeRow(row)"
            >
              <OIcon name="check-circle" size="sm" aria-hidden="true" />
              <OTooltip :content="ackTooltip(row)" />
            </OButton>
            <span
              v-else-if="hasUnresolved(row)"
              class="size-8 shrink-0 max-md:hidden"
              aria-hidden="true"
            />
            <OButton
              v-if="hasUnresolved(row)"
              variant="ghost-primary"
              size="icon-sm"
              class="max-md:hidden"
              :loading="busyId === row.rowKey"
              :aria-label="t('oncall.resolve')"
              :data-test="`oncall-row-resolve-${row.rowKey}`"
              @click.stop="resolveRow(row)"
            >
              <OIcon name="task-alt" size="sm" aria-hidden="true" />
              <OTooltip :content="t('oncall.resolve')" />
            </OButton>
            <span
              v-else-if="canAcknowledge(row)"
              class="size-8 shrink-0 max-md:hidden"
              aria-hidden="true"
            />
          </template>
          <!-- An open tooltip is the top dismissable layer, so it would take the menu's Escape. -->
          <ODropdown
            side="bottom"
            align="end"
            @update:open="(open: boolean) => (openMenuKey = open ? row.rowKey : '')"
          >
            <template #trigger>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="more-vert"
                :loading="busyId === row.rowKey"
                :aria-label="t('oncall.moreActions')"
                :data-test="`oncall-row-more-${row.rowKey}`"
                @click.stop
              >
                <OTooltip
                  v-if="openMenuKey !== row.rowKey"
                  side="bottom"
                  :content="t('oncall.moreActions')"
                />
              </OButton>
            </template>
            <ODropdownItem
              v-if="row.latest.team_id && canAcknowledge(row)"
              icon-left="check-circle"
              class="md:hidden"
              :data-test="`oncall-row-ack-${row.rowKey}-menu`"
              @select="acknowledgeRow(row)"
            >
              {{ t("oncall.acknowledge") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="row.latest.team_id && hasUnresolved(row)"
              icon-left="task-alt"
              class="md:hidden"
              :data-test="`oncall-row-resolve-${row.rowKey}-menu`"
              @select="resolveRow(row)"
            >
              {{ t("oncall.resolve") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="timeline"
              :data-test="`oncall-row-show-timeline-${row.rowKey}`"
              @select="toggleTimeline(row)"
            >
              {{
                expandedIds.includes(row.rowKey)
                  ? t("oncall.rowHideTimeline")
                  : t("oncall.rowShowTimeline")
              }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="link"
              :data-test="`oncall-row-copy-link-${row.rowKey}`"
              @select="copyRowLink(row)"
            >
              {{ t("oncall.rowCopyLink") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="row.latest.team_id && canAcknowledge(row) && snoozedFirings(row).length"
              icon-left="notifications-active"
              :data-test="`oncall-row-unsnooze-${row.rowKey}`"
              @select="unsnoozeRow(row)"
            >
              {{ t("oncall.unsnooze") }}
            </ODropdownItem>
            <ODropdownGroup
              v-if="
                row.latest.team_id &&
                canAcknowledge(row) &&
                snoozedFirings(row).length < row.escalating.length
              "
              :label="t('oncall.snoozeFor')"
            >
              <ODropdownItem
                v-for="option in snoozeOptions"
                :key="option.minutes"
                icon-left="alarm"
                :data-test="`oncall-row-snooze-${row.rowKey}-${option.minutes}`"
                @select="snoozeRow(row, option.minutes)"
              >
                {{ option.label }}
              </ODropdownItem>
            </ODropdownGroup>
          </ODropdown>
        </div>
      </template>

      <!-- A transient 500 is not "this org has no pages", and it must offer a
           way back rather than a dead end. -->
      <template #error>
        <OEmptyState
          size="hero"
          preset="load-error"
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
    </OTable>

    <ODialog
      :open="confirmBulkResolve"
      @update:open="(v: boolean) => (v ? (confirmBulkResolve = v) : closeBulkResolveDialog())"
      :title="t('oncall.bulkResolveTitle')"
      data-test="oncall-bulk-resolve-dialog"
    >
      <div class="flex flex-col gap-3">
        <p class="text-text-secondary text-sm">
          {{ t("oncall.bulkResolveConfirm", { count: selectedIds.length }) }}
        </p>

        <OnCallResolveCauseForm
          v-model:cause="bulkResolveCause"
          v-model:note="bulkResolveNote"
          data-test-prefix="oncall-bulk-resolve"
        />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="closeBulkResolveDialog">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="bulkBusy"
            data-test="oncall-bulk-resolve-confirm"
            @click="bulkResolve"
          >
            {{ t("oncall.resolve") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OnCallActivityTimeline from "@/components/oncall/OnCallActivityTimeline.vue";
import OnCallEscalationCell from "@/components/oncall/OnCallEscalationCell.vue";
import OnCallResolveCauseForm from "@/components/oncall/OnCallResolveCauseForm.vue";
import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import OnCallShiftBanner from "@/components/oncall/OnCallShiftBanner.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallPolicyReviewed } from "@/composables/useOnCallPolicyReviewed";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useListViewState } from "@/composables/useListViewState";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { copyToClipboard } from "@/utils/clipboard";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { pageAckWords } from "@/utils/alerts/ackState";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { readQuery } from "@/composables/query/readQuery";
import {
  acknowledgeResponseMutation,
  addResponseNoteMutation,
  coverageGapsQuery,
  handoffResponseMutation,
  oncallTeamsQuery,
  ownershipRulesQuery,
  pagedResponsesQuery,
  resolveResponseMutation,
  responseQuery,
  responsesProgressQuery,
  snoozeResponseMutation,
  unsnoozeResponseMutation,
  teamContextQuery,
  teamPolicyQuery,
  whoIsOnCallQuery,
} from "@/services/oncall.queries";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef, RowRailTone, RowTone } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import analytics from "@/services/product_analytics";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import type {
  Channel,
  CoverageGaps,
  EscalationProgress,
  EscalationProgressEntry,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallResponseGroup,
  OnCallSchedule,
  OnCallPosition,
  OnCallTeam,
  OnCallTeamContext,
  ResolutionCause,
} from "@/ts/interfaces/oncall";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import {
  DEFAULT_ACTIVITY_KINDS,
  groupBySubject,
  isDeliverableChannel,
  isEscalating,
  isOnCallUnavailable,
  isDeletedTeam,
  ladderStopped,
  isSnoozed,
  reachedStepOf,
  nextHandover,
  winningRule,
  apiErrorText,
} from "@/utils/oncall";
import { licenseDeniedFeatures, type ForbiddenState } from "@/utils/featureGate";

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { canConfigure } = useOnCallPermissions();

/// A table row. Grouped or not, every row carries the same shape so the
/// columns and the actions never have to branch on the mode.
type PageRow = OnCallResponseGroup & { rowKey: string };

/** The batch routes' cap on ids per request. */
const ESCALATION_DETAIL_LIMIT = 200;

/**
 * The states a reader triages by, in the order they matter.
 *
 * The first three are not the wire's `ResponseState`: "ringing" is an
 * escalating record that nobody has claimed and nothing is snoozing, which is
 * three fields rather than one, and it is the only distinction that changes
 * what somebody does next. A record stays ringing here even once its ladder
 * has exhausted with nobody reached — that is the one case a human most needs
 * to see, not one to bury under "handled" alongside pages an owner actually
 * has. "resolved" IS the wire state:
 * once a page is resolved there is nothing left to triage, only the record of
 * what happened — the reader has to ask for it (`includeResolved`) by picking
 * the "all" or "resolved" tab, rather than it always riding along with the
 * open ones.
 */
const SECTION_ORDER = ["ringing", "snoozed", "handled", "resolved"] as const;

type SectionKey = (typeof SECTION_ORDER)[number];

/// "open" is every section but resolved: what still needs somebody.
type FilterTab = "all" | "open" | SectionKey;

const OPEN_SECTIONS: readonly SectionKey[] = ["ringing", "snoozed", "handled"];

function tabShows(tab: FilterTab, section: SectionKey): boolean {
  if (tab === "all") return true;
  if (tab === "open") return OPEN_SECTIONS.includes(section);
  return tab === section;
}

const responses = ref<OnCallResponse[]>([]);
// Clearing a narrowing must not read the narrowed (possibly empty) rows still in hand as "this org has no pages".
const responsesNarrowed = ref(false);
const teams = ref<OnCallTeam[]>([]);
const policyByTeam = ref<Record<string, OnCallPolicy>>({});
const scheduleByTeam = ref<Record<string, OnCallSchedule>>({});
const positionsByTeam = ref<Record<string, OnCallPosition[]>>({});
const progressById = ref<Record<string, EscalationProgress>>({});
/// Ids whose progress was asked for and answered; a row past the cap or whose read failed is not in it, so it never reads "Not paged yet".
const progressAnswered = ref<Set<string>>(new Set());
const expandedIds = ref<string[]>([]);
const expandedEvents = ref<OnCallResponseEvent[]>([]);
const expandedLoading = ref(false);
const expandedNoteBody = ref("");
const addingExpandedNote = ref(false);
const expandedShowAllActivity = ref(true);
const expandedSystemActivityCount = computed(
  () => expandedEvents.value.filter((e) => !DEFAULT_ACTIVITY_KINDS.includes(e.kind)).length,
);
const teamsAvailable = ref(true);
// False until the list has answered, so no row reads as a deleted team while it loads.
const teamsLoaded = ref(false);
const truncated = ref(false);
const loading = ref(false);
const lastUpdatedAt = ref<number | null>(null);
/// Set only while a tab switch is quietly fetching resolved pages the reader
/// cannot see are missing. Drives `OTable`'s `streaming` bar rather than
/// `loading` so the rows already on screen never disappear behind a skeleton
/// for a fetch nothing visible was waiting on.
const backgroundLoading = ref(false);
const loadError = ref<string | null>(null);
const forbidden = ref<ForbiddenState>(false);
/// §G.8.1: 404 or 403 "Not Supported" from the entry fetch — on-call is not
/// available on this deployment. A fact about the build, never an error.
const unavailable = ref(false);
const savedView = useListViewState("oncall-responses", {
  search: "",
  teamFilter: "all",
  priorityFilter: "all",
  mineOnly: false,
  grouped: true,
  activeFilter: "all" as FilterTab,
  causeFilter: "" as ResolutionCause | "",
  currentPage: 1,
  pageSize: 20,
  sortBy: "last_alert_at",
  sortOrder: "desc" as "asc" | "desc",
});
const search = ref(savedView.search);
const teamFilter = ref(savedView.teamFilter);
const priorityFilter = ref(savedView.priorityFilter);
const mineOnly = ref(savedView.mineOnly);
const selectedIds = ref<string[]>([]);
const grouped = ref(savedView.grouped);
/// `"all"` is the default tab, and "all" means all — resolved included —
/// so the very first fetch already asks for resolved pages too.
const includeResolved = ref(
  savedView.activeFilter !== "ringing" &&
    savedView.activeFilter !== "snoozed" &&
    savedView.activeFilter !== "handled",
);
/// All four sections start visible, matching the default `"all"` tab.
const sectionVisibility = ref<Record<SectionKey, boolean>>({
  ringing: tabShows(savedView.activeFilter, "ringing"),
  snoozed: tabShows(savedView.activeFilter, "snoozed"),
  handled: tabShows(savedView.activeFilter, "handled"),
  resolved: tabShows(savedView.activeFilter, "resolved"),
});
/// The tab the toolbar shows as pressed. `"all"` is every section at once
/// (open and resolved alike) and has no `SectionKey` of its own; picking any
/// other tab narrows `sectionVisibility` to just that one section — and, for
/// every tab but `"all"` and `"resolved"`, drops resolved pages out of the
/// fetch entirely.
const activeFilter = ref<FilterTab>(savedView.activeFilter);
/// Empty means every cause. Cleared whenever resolved pages leave the list,
/// because a cause filter over open records matches nothing and would read as
/// "there is nothing here" rather than "this filter cannot apply".
const causeFilter = ref<ResolutionCause | "">(
  sectionVisibility.value.resolved ? savedView.causeFilter : "",
);
const currentPage = ref(savedView.currentPage);
const pageSize = ref(savedView.pageSize);
// A view saved before the Status column was removed can still sort by it.
const sortBy = ref(savedView.sortBy === "state" ? "last_alert_at" : savedView.sortBy);
const sortOrder = ref<"asc" | "desc">(savedView.sortOrder);
const oTableRef = ref<{ restorePage?: (page: number) => void } | null>(null);
const busyId = ref("");
const openMenuKey = ref("");
const bulkBusy = ref(false);
const confirmBulkResolve = ref(false);
const bulkResolveCause = ref<ResolutionCause | "">("");
const bulkResolveNote = ref("");

// Only after the first fetch, so the checklist never flashes while loading.
const loaded = ref(false);
const setup = ref<{
  hasTeam: boolean;
  hasStaffedRotation: boolean;
  /** `null` when neither the bulk nor the per-team read could answer. */
  hasPolicy: boolean | null;
  hasRouting: boolean;
}>({
  hasTeam: false,
  hasStaffedRotation: false,
  hasPolicy: false,
  hasRouting: false,
});
/// The list and the checklist are answered by two different fetches, and these
/// defaults are all-false. Drawing the checklist off them the moment the LIST
/// arrived told every configured org to create a team — and, with no pages yet,
/// handed setup the whole screen — for as long as the context call took. The
/// checklist waits for its own answer.
const setupLoaded = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
const { reviewed: policyReviewed } = useOnCallPolicyReviewed(() => teams.value[0]?.id);
/// Lowercased to compare with `acked_by`, which the server normalises on a
/// handoff but not necessarily on a self-acknowledgement.
const viewerEmail = computed(() => String(store.state.userInfo?.email ?? "").toLowerCase());

const teamNameById = computed<Record<string, string>>(() =>
  Object.fromEntries(teams.value.map((team) => [team.id, team.name])),
);

const teamIsDeleted = (teamId: string | null) =>
  isDeletedTeam(teamId, teamsLoaded.value ? teams.value.map((team) => team.id) : null);

const teamOptions = computed(() => [
  { label: t("oncall.allTeams"), value: "all" },
  ...teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
]);

const STATUS_ICON: Record<FilterTab, IconName> = {
  all: "list",
  open: "radio-button-unchecked",
  ringing: "notifications-active",
  handled: "check-circle",
  resolved: "task-alt",
  snoozed: "alarm",
};

/// Counted from what was fetched, so a tab's number is what picking it shows.
const statusOptions = computed(() => {
  const counts = sectionCounts.value;
  const total = (keys: SectionKey[]) => keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
  const tabs: { value: FilterTab; label: I18nText; count: number }[] = [
    { value: "open", label: t("oncall.filterOpen"), count: total([...OPEN_SECTIONS]) },
    { value: "ringing", label: t("oncall.section_ringing"), count: counts.ringing },
    { value: "handled", label: t("oncall.section_handled"), count: counts.handled },
    { value: "snoozed", label: t("oncall.section_snoozed"), count: counts.snoozed },
    { value: "resolved", label: t("oncall.section_resolved"), count: counts.resolved },
    { value: "all", label: t("oncall.all"), count: total([...SECTION_ORDER]) },
  ];
  // A count before the list has answered would read as "nothing here".
  const counted = loaded.value && !loading.value;
  // An open-only fetch never asked for resolved pages, so a tab showing them has no count yet, not zero.
  const known = (tab: FilterTab) => includeResolved.value || !tabShows(tab, "resolved");
  return tabs.map((tab) => ({
    value: tab.value,
    icon: STATUS_ICON[tab.value],
    label:
      counted && known(tab.value)
        ? t("oncall.statusOptionCount", { label: tab.label, count: tab.count })
        : tab.label,
  }));
});

const statusLabel = computed<I18nText>(
  () =>
    statusOptions.value.find((option) => option.value === activeFilter.value)?.label ??
    t("oncall.all"),
);

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
    mineScope.value ||
    !!causeFilter.value ||
    activeFilter.value !== "all",
);

/// Only what the filter button hides: it lights up so a narrowed list never looks like the whole one.
const narrowed = computed(
  () =>
    !!causeFilter.value ||
    (isMobile.value && (teamFilter.value !== "all" || priorityFilter.value !== "all")),
);

const showChecklist = computed(
  () =>
    loaded.value &&
    setupLoaded.value &&
    // Teams did not answer, so "this org has no team" is not a fact we hold —
    // it is the default we started from, and the first step would be a lie.
    teamsAvailable.value &&
    !loadError.value &&
    // The test-page step is left out: the server keeps no record of one, so it could never stay done.
    !(
      setup.value.hasTeam &&
      setup.value.hasStaffedRotation &&
      (policyReviewed.value || setup.value.hasPolicy !== false) &&
      setup.value.hasRouting
    ),
);

/// Team and cause narrow the fetch itself, so an empty answer says nothing about whether the org has pages.
const serverFiltered = computed(() => teamFilter.value !== "all" || !!causeFilter.value);

// Read from what was fetched, and true under a server-side narrowing, so a narrowing that finds nothing never hides the toolbar.
const hasPages = computed(
  () =>
    responses.value.length > 0 ||
    responsesNarrowed.value ||
    !includeResolved.value ||
    teamFilter.value !== "all" ||
    !!causeFilter.value,
);

/// Setup is the entire screen.
///
/// Nothing has ever paged and the wiring is incomplete, which are the same
/// fact: there is no list to hide behind the checklist, and an empty table
/// under it would only offer "no pages yet" as if that were healthy. Once a
/// single page exists the checklist has to give the screen back — it becomes
/// one bar over a live list.
const setupOnly = computed(() => showChecklist.value && !hasPages.value && !serverFiltered.value);

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
    header: t("oncall.subjectColumn"),
    // The producer sends the alert's name; the source id is a ksuid and tells
    // a woken engineer nothing. Fall back only when there is no title.
    accessorFn: (row: PageRow) => row.latest.title || row.latest.subject.source_id,
    sortable: true,
    size: 176,
    minSize: 160,
    // The widest thing in the row and the one a reader scans by, so it takes
    // the table's leftover width rather than leaving it to the trailing spacer.
    meta: { isName: true, flex: true },
  },
  {
    // Who owns this page. It used to be a chip inside the alert cell and a
    // column hidden by default — so the one fact that decides who answers was
    // unsortable, unfilterable by column, and said twice on the rows where it
    // was on at all.
    id: "team",
    header: t("oncall.team"),
    size: 136,
    accessorFn: (row: PageRow) => {
      const teamId = row.latest.team_id;
      return teamId ? (teamNameById.value[teamId] ?? teamId) : "";
    },
    sortable: true,
    hideable: true,
  },
  {
    // Was a chip inside the subject cell, reachable only if a reader noticed
    // it looked clickable. Its own column makes "this page has an incident"
    // scannable down the list instead of discovered by accident.
    id: "incident",
    header: t("oncall.incident"),
    size: 120,
    accessorFn: (row: PageRow) =>
      row.latest.incident_id ? (row.latest.incident_title ?? row.latest.incident_id) : "",
    sortable: true,
    hideable: true,
  },
  {
    // Sorts on rungs fired, so "furthest up the ladder" is one click away —
    // that is the ordering a responder wants, not alphabetical state.
    id: "escalation",
    header: t("oncall.escalation"),
    size: 144,
    accessorFn: (row: PageRow) =>
      progressById.value[row.latest.id]?.fired.length ?? reachedStepFor(row.latest) ?? 0,
    sortable: true,
  },
  {
    id: "responder",
    header: t("oncall.responder"),
    size: 136,
    accessorFn: (row: PageRow) => row.latest.acked_by ?? "",
    sortable: true,
  },
  {
    // Who the rotation would ring right now, independent of who (if anyone)
    // has answered THIS page — an escalated or reassigned page can be
    // answered by someone no longer holding the pager.
    id: "on_call_now",
    header: t("oncall.onCallNow"),
    size: 136,
    accessorFn: (row: PageRow) =>
      positionsByTeam.value[row.latest.team_id ?? ""]?.[0]?.user_email ?? "",
    sortable: true,
  },
  {
    // The Incident list's "Last Alert" cell, said the same way here: relative
    // time with the absolute instant on hover. Two sibling tables answering
    // "when did this last fire" in two different formats made a reader carry
    // the conversion between them.
    //
    // The bespoke duration this used to render is the same number: a page that
    // opened forty minutes ago and is still ringing has been ringing for forty
    // minutes, which is what the relative time already says.
    id: "last_alert_at",
    header: t("oncall.lastAlertAt"),
    size: 120,
    accessorFn: (row: PageRow) => row.latest.opened_at,
    sortable: true,
  },
  {
    // What the policy would page on. Split out of the age cell and off by
    // default: it is a property of the team's policy rather than of this page,
    // so it repeats down the list and earns its place only when asked for.
    id: "channels",
    header: t("oncall.channels"),
    size: 160,
    accessorFn: (row: PageRow) => channelsFor(row.latest).join(","),
    sortable: false,
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
    pinned: "right",
    sortable: false,
    size: 112,
    meta: { align: "center", actionCount: 3 },
  },
]);

/// Teams whose CURRENT rotation resolves to the viewer, from the same slots the
/// engine would page. Membership is not the question: a member who is not on
/// the rotation right now would not be rung, so their team's pages are not
/// theirs to answer.
const myTeamIds = computed(() => {
  const ids = new Set<string>();
  if (!viewerEmail.value) return ids;
  for (const [teamId, slots] of Object.entries(positionsByTeam.value)) {
    if (slots.some((slot) => slot.user_email.toLowerCase() === viewerEmail.value)) {
      ids.add(teamId);
    }
  }
  return ids;
});

function setMineOnly(on: boolean) {
  mineOnly.value = on;
}

/// Inert until we know who is signed in — otherwise a stale toggle would hide
/// every row with no visible control to turn it off.
const mineScope = computed(() => mineOnly.value && !!viewerEmail.value);

/// A page is the viewer's if their shift would have taken it, or if they already
/// did. The acknowledgement outlives the shift: whoever claimed it still owns it
/// after handover.
function isMine(record: OnCallResponse): boolean {
  return (
    (!!record.team_id && myTeamIds.value.has(record.team_id)) ||
    (!!record.acked_by && record.acked_by.toLowerCase() === viewerEmail.value)
  );
}

// Every filter the header offers, applied to the records before they are
// grouped into rows.
const scopedResponses = computed(() => {
  const q = search.value.trim().toLowerCase();
  return responses.value.filter((row) => {
    if (mineScope.value && !isMine(row)) return false;
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

/// The rows the table shows. There is no facet between these and the scoped
/// records: the tiles that used to sit above the table restated the section
/// headings and the header's own "mine" toggle, so the list narrows from the
/// header controls alone.
const rows = computed(() => toRows(scopedResponses.value));

/// The visible tab's rows, filtered before the table pages them, so the footer count and pages describe that tab.
const visibleRows = computed(() =>
  rows.value.filter((row) => sectionVisibility.value[rowSection(row)]),
);

// Reka's single select rejects an empty-string item value, so "every cause" needs a real one.
const ANY_CAUSE = "any";
const causeOptions = computed(() => [
  { label: t("oncall.causeFilterAny"), value: ANY_CAUSE },
  ...RESOLUTION_CAUSES.map((cause) => ({ label: t(`oncall.cause_${cause}`), value: cause })),
]);

function onCauseFilter(value: unknown) {
  causeFilter.value = value === ANY_CAUSE ? "" : (value as ResolutionCause) || "";
  void fetchResponses();
}

/// One tab, one section — except `"all"`, which is every section at once,
/// resolved included. Narrowing away from resolved is never a round trip:
/// `responses` already holds whatever was last fetched, so hiding a section
/// is exactly that, hiding it. The only real fetch is the first crossing INTO
/// a resolved-showing tab, because that is the only direction that can be
/// missing rows — and it goes quietly, behind whatever the reader is already
/// looking at, rather than blocking the rows already on screen.
function selectFilterTab(tab: FilterTab) {
  activeFilter.value = tab;
  const showsResolved = tabShows(tab, "resolved");
  sectionVisibility.value = {
    ringing: tabShows(tab, "ringing"),
    snoozed: tabShows(tab, "snoozed"),
    handled: tabShows(tab, "handled"),
    resolved: showsResolved,
  };
  if (!showsResolved) {
    // Left with the tab: over an open list a cause matches nothing, and
    // would read as "there is nothing here" rather than "this filter cannot
    // apply". `responses` itself is untouched — nothing to refetch.
    causeFilter.value = "";
    return;
  }
  if (includeResolved.value) return;
  includeResolved.value = true;
  void fetchResponses({ background: true });
}

const youLabel = computed(() => String(t("oncall.onCallYou")));
const { nameOf, tooltipOf } = useOrgUserNames();

/// A name when the org has one, else the email's local part: the domain is the same on every row.
function displayName(email: string): string {
  if (email.toLowerCase() === viewerEmail.value) return youLabel.value;
  return nameOf(email);
}

/// Names can repeat across an org, so the email is always one hover away.
function personTooltip(email: string): I18nText {
  return tooltipOf(email);
}

/// Is this row somebody else's outage reaching this team's service?
///
/// Either marker is enough. `responder_role` is what the record says it is;
/// `origin_response_id` is the owner record it hangs off, and it is present on
/// exactly the same rows. Reading both means a record that carries one and not
/// the other — the shape a partial write leaves behind — still reads as what
/// it is rather than as an ordinary page.
function isImpactedRow(record: OnCallResponse): boolean {
  return record.responder_role === "impacted" || !!record.origin_response_id;
}

/// The channels this record's priority pages on, per its team's policy.
function channelsFor(record: OnCallResponse): Channel[] {
  return (
    (record.team_id ? policyByTeam.value[record.team_id] : undefined)?.rungs.find(
      (rung) => rung.priority === record.priority,
    )?.channels ?? []
  );
}

/// Rungs the team's policy defines for THIS record's priority — the "of 3" in
/// "Level 2 of 3". Undefined when the policy could not be read, which the cell
/// renders as a level with no denominator rather than a guessed total.
function totalRungsFor(record: OnCallResponse): number | null {
  const rungs = (record.team_id ? policyByTeam.value[record.team_id] : undefined)?.rungs ?? [];
  return rungs.find((rung) => rung.priority === record.priority)?.steps.length ?? null;
}

/// The step the record says it reached, for a row whose progress was not fetched.
function reachedStepFor(record: OnCallResponse): number | null {
  const rungs = (record.team_id ? policyByTeam.value[record.team_id] : undefined)?.rungs ?? [];
  const steps = rungs.find((rung) => rung.priority === record.priority)?.steps;
  return reachedStepOf(steps, record.reached_rung_micros);
}

/// When each team's current shift hands over.
///
/// `OnCallPosition` carries no end instant, so this is resolved from the schedule
/// with the same rotation maths the engine uses (`winningRotation` +
/// `nextHandover`) rather than guessed from the shift length.
const handoverByTeam = computed<Record<string, number | null>>(() => {
  const nowMicros = Date.now() * 1000;
  const out: Record<string, number | null> = {};
  for (const team of teams.value) {
    const schedule = scheduleByTeam.value[team.id];
    if (!schedule) continue;
    // Each rotation hands over on its own cadence, so count down the one the viewer holds.
    const heldId = (positionsByTeam.value[team.id] ?? []).find(
      (position) => position.user_email.toLowerCase() === viewerEmail.value,
    )?.rotation_id;
    const rotation =
      schedule.rotations?.find((candidate) => candidate.id === heldId) ?? schedule.rotations?.[0];
    const rule = rotation ? winningRule(rotation, nowMicros, schedule.timezone) : null;
    out[team.id] = rule ? nextHandover(rule, nowMicros, schedule.timezone) : null;
  }
  return out;
});

/// The viewer's own shift, if they hold one. Taken from the server's positions
/// so the banner never names a different person from the one it would page.
const myShift = computed(() => {
  if (!viewerEmail.value) return null;
  const mine = teams.value
    .map((team) => ({
      team,
      position: (positionsByTeam.value[team.id] ?? []).find(
        (candidate) => candidate.user_email.toLowerCase() === viewerEmail.value,
      ),
    }))
    .filter((entry): entry is { team: OnCallTeam; position: OnCallPosition } => !!entry.position);

  if (!mine.length) return null;
  // Soonest handover first: the shift ending next is the one being counted down.
  const sorted = [...mine].sort(
    (a, b) =>
      (handoverByTeam.value[a.team.id] ?? Infinity) - (handoverByTeam.value[b.team.id] ?? Infinity),
  );
  const first = sorted[0];
  return {
    teamName: first.team.name,
    rotation: first.position.rotation_name,
    endsAt: handoverByTeam.value[first.team.id] ?? null,
    otherTeams: sorted.length - 1,
  };
});

// Only an escalating page can be claimed. A row with nothing left to claim
// offers no button rather than one that errors.
function canAcknowledge(row: PageRow): boolean {
  return row.escalating.length > 0;
}

/// Anything under the row still open. A group stands for every firing beneath
/// it, so one unresolved firing keeps the whole row closeable.
function hasUnresolved(row: PageRow): boolean {
  return row.firings.some((firing) => firing.state !== "resolved");
}

function ackTooltip(row: PageRow): I18nText {
  const teamId = row.latest.team_id;
  const team = teamId ? (teamNameById.value[teamId] ?? teamId) : "";
  return pageAckWords(team, row.latest.subject.subject_type, t).ackHint;
}

/// One list writes to many rows, so the id rides in the variables, not the setup.
const ackWrite = useMutation(() => acknowledgeResponseMutation(orgId.value));
const snoozeWrite = useMutation(() => snoozeResponseMutation(orgId.value));
const unsnoozeWrite = useMutation(() => unsnoozeResponseMutation(orgId.value));
const resolveWrite = useMutation(() => resolveResponseMutation(orgId.value));
const handoffWrite = useMutation(() => handoffResponseMutation(orgId.value));
const noteWrite = useMutation(() => addResponseNoteMutation(orgId.value));

/// Acts on every firing the row stands for. Acknowledging the latest of
/// ninety-five and leaving ninety-four escalating would be a worse lie than
/// showing all ninety-five rows.
async function acknowledgeRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    const results = await Promise.allSettled(row.escalating.map((r) => ackWrite.mutateAsync(r.id)));
    const acked = results.filter((r) => r.status === "fulfilled").length;
    if (acked > 0) analytics.track("oncall_page_acknowledged", { count: acked });
    // Once per batch, and unforced: the write already expired what it moved.
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
      row.escalating.map((r) => snoozeWrite.mutateAsync({ responseId: r.id, minutes })),
    );
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

function snoozedFirings(row: PageRow): OnCallResponse[] {
  return row.escalating.filter((r) => isSnoozed(r));
}

/// Ends the snooze on every quiet firing the row stands for, so they all continue now.
async function unsnoozeRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    const results = await Promise.allSettled(
      snoozedFirings(row).map((r) => unsnoozeWrite.mutateAsync(r.id)),
    );
    if (results.some((r) => r.status === "rejected")) {
      toast({ variant: "error", message: t("oncall.unsnoozeFailed") });
    } else {
      toast({ variant: "success", message: t("oncall.unsnoozed") });
    }
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

async function resolveRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    const results = await Promise.allSettled(
      row.firings
        .filter((r) => r.state !== "resolved")
        .map((r) => resolveWrite.mutateAsync({ responseId: r.id })),
    );
    const resolved = results.filter((r) => r.status === "fulfilled").length;
    if (resolved > 0) analytics.track("oncall_page_resolved", { cause: "none", count: resolved });
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

/// Handoff, not a dedicated "assign" endpoint: it sets team_id unconditionally
/// whether the row currently has none or another team, so it doubles as first
/// assignment. Applied to every unresolved firing in the group, same as resolve.
async function assignTeamToRow(row: PageRow, teamId: string, teamName: string) {
  busyId.value = row.rowKey;
  try {
    const results = await Promise.allSettled(
      row.firings
        .filter((r) => r.state !== "resolved")
        .map((r) => handoffWrite.mutateAsync({ responseId: r.id, toTeamId: teamId })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      toast({ variant: "error", message: t("oncall.assignTeamFailed") });
    } else {
      toast({ variant: "success", message: t("oncall.assignTeamDone", { team: raw(teamName) }) });
    }
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
  onSucceeded?: (count: number) => void,
) {
  bulkBusy.value = true;
  try {
    const results = await Promise.allSettled(ids.map(call));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (results.length - failed > 0) onSucceeded?.(results.length - failed);
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
    (id) => ackWrite.mutateAsync(id),
    "bulkAckDone",
    "bulkAckPartial",
    (count) => analytics.track("oncall_page_acknowledged", { count }),
  );
}

/// Snooze quiets an escalating record WITHOUT claiming it, so it only applies
/// to the ones still climbing the ladder.
async function bulkSnooze(minutes: number) {
  // The server refuses Snooze on a page with no team (one-ack AK-4), so those are left out and named.
  const teamless = selectedRecords((r) => r.escalating.filter((e) => !e.team_id)).length;
  if (teamless) {
    toast({
      variant: "warning",
      message: t("oncall.bulkSnoozeNoTeam", { count: teamless }, teamless),
    });
  }
  const ids = selectedRecords((r) => r.escalating.filter((e) => !!e.team_id));
  if (!ids.length) return;
  await runBulk(
    ids,
    (id) => snoozeWrite.mutateAsync({ responseId: id, minutes }),
    "bulkSnoozeDone",
    "bulkSnoozePartial",
  );
}

function closeBulkResolveDialog() {
  confirmBulkResolve.value = false;
  bulkResolveCause.value = "";
  bulkResolveNote.value = "";
}

async function bulkResolve() {
  const cause = bulkResolveCause.value || undefined;
  const cause_note = bulkResolveNote.value.trim() || undefined;
  closeBulkResolveDialog();
  await runBulk(
    selectedRecords((r) => r.firings.filter((f) => f.state !== "resolved")),
    (id) => resolveWrite.mutateAsync({ responseId: id, cause, causeNote: cause_note }),
    "bulkResolveDone",
    "bulkResolvePartial",
    (count) => analytics.track("oncall_page_resolved", { cause: cause ?? "none", count }),
  );
}

/// Which run a row belongs to. Asked of the row rather than the record so a
/// group standing for ninety-five firings lands where its live ones do: a group
/// with anything still ringing is ringing, whatever its latest firing says.
function rowSection(row: PageRow): SectionKey {
  if (row.latest.state === "resolved") return "resolved";
  if (row.escalating.some((r) => !r.acked_by && !isSnoozed(r))) return "ringing";
  if (row.firings.some((r) => isSnoozed(r))) return "snoozed";
  return "handled";
}

/// Counted over the filtered set, not the page: a heading reading "3" on page
/// one of five would be describing the pagination rather than the state.
const sectionCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = { ringing: 0, snoozed: 0, handled: 0, resolved: 0 };
  for (const row of rows.value) counts[rowSection(row)] += 1;
  return counts;
});

// No team means no policy to page, so these sit in Ringing without anyone being woken.
const unroutedRinging = computed(
  () =>
    rows.value.filter(
      (row) =>
        rowSection(row) === "ringing" &&
        !row.escalating.some((r) => r.team_id && !r.acked_by && !isSnoozed(r)),
    ).length,
);
const stoppedRinging = computed(
  () =>
    rows.value.filter((row) => {
      if (rowSection(row) !== "ringing") return false;
      const live = row.escalating.filter((r) => r.team_id && !r.acked_by && !isSnoozed(r));
      return (
        live.length > 0 &&
        live.every((r) => ladderStopped(progressById.value[r.id], teamIsDeleted(r.team_id)))
      );
    }).length,
);
const routedRinging = computed(
  () => (sectionCounts.value.ringing ?? 0) - unroutedRinging.value - stoppedRinging.value,
);

/// Only the run that needs somebody gets colour. Snoozed is deliberately
/// inert and handled and resolved are both finished, so all three stay in the
/// calm tone.
function sectionTone(key: string): string {
  if (key === "ringing") return "text-status-error-text";
  if (key === "snoozed") return "text-status-warning-text";
  return "text-text-secondary";
}

/// A ringing row is one nobody has claimed and nothing is snoozing — the only
/// state where an age is worth shouting.
function isRinging(row: PageRow): boolean {
  return rowSection(row) === "ringing";
}

/// When the ladder's first rung fired, as its delay from the page opening. A
/// policy that waits before ringing anybody is a common and invisible cause of
/// "nobody answered", and `after_micros` is the only place it is recorded.
function ladderStarted(record: OnCallResponse): I18nText | "" {
  const first = progressById.value[record.id]?.fired[0];
  if (!first || first.after_micros <= 0) return "";
  return t("oncall.ladderStartedAfter", {
    duration: formatMicrosDuration(first.after_micros),
  });
}

// Snoozed rows are deliberately inert, so they recede. This is the only wash
// on the list — the loud one is reserved for something you must act on now.
function rowTone(row: PageRow): RowTone | null {
  return isSnoozed(row.latest) ? "muted" : null;
}

function rowRailTone(row: PageRow): RowRailTone | null {
  return isRinging(row) ? "error" : null;
}

/// Team and cause go to the SERVER: narrowing client-side hid a team's older pages past the cap.
function responseFilters() {
  return {
    include_resolved: includeResolved.value,
    ...(teamFilter.value === "all" ? {} : { team_id: teamFilter.value }),
    ...(causeFilter.value ? { cause: causeFilter.value } : {}),
  };
}

/// Every fetch is now a deliberate one — first load, an explicit refresh, or a
/// row action — so every fetch shows the spinner. The silent variant existed
/// only for the background poll.
/// `background: true` is for a fetch that is filling in data the reader
/// cannot see is missing — picking up resolved pages behind a tab that was
/// already showing rows. `loading` would swap those rows for a skeleton over
/// something that, from the reader's side, was not loading at all; `streaming`
/// leaves them on screen with a quiet bottom bar instead.
// The newest read: a slower answer for a filter the reader has already left must not overwrite the rows.
let latestResponsesRead = 0;

async function fetchResponses(opts: { background?: boolean; force?: boolean } = {}) {
  const busy = opts.background ? backgroundLoading : loading;
  busy.value = true;
  const readId = ++latestResponsesRead;
  try {
    const filters = responseFilters();
    const options = pagedResponsesQuery(orgId.value, filters);
    const walk = await readQuery(options, !!opts.force);
    if (readId !== latestResponsesRead) return;
    responses.value = walk.rows;
    responsesNarrowed.value = "team_id" in filters || "cause" in filters;
    lastUpdatedAt.value = queryClient.getQueryState(options.queryKey)?.dataUpdatedAt ?? null;
    // From the payload, cache hit included: the cap describes these rows, not this request.
    truncated.value = walk.truncated;
    loadError.value = null;
    forbidden.value = false;
    // Only on SUCCESS. Setting this in `finally` would let a transient API
    // error render the first-run checklist, telling a configured org that
    // nothing is set up.
    loaded.value = true;
    // Fire-and-forget: the rows are already usable while their teams and ladders fill in.
    rowContextRead = fetchRowContext(!!opts.force);
  } catch (err) {
    if (readId !== latestResponsesRead) return;
    // §G.8.1: the probe said "not here". Leaving `loaded` false keeps the
    // setup checklist away too — a build that cannot page must not be told
    // to create teams.
    if (isOnCallUnavailable(err)) {
      unavailable.value = true;
      return;
    }
    // A license denial is not a failed read: the table shows the license copy, with no retry.
    const denied = licenseDeniedFeatures(err);
    if (denied) {
      forbidden.value = denied;
      return;
    }
    loadError.value = apiErrorText(err) || String(t("oncall.loadResponsesFailed"));
  } finally {
    if (readId === latestResponsesRead) busy.value = false;
  }
}

/// Teams, coverage and ownership answer the checklist, not the list. A failure
/// on any one of them degrades a single control rather than the page.
async function fetchContext(force = false) {
  const [teamRes, gapRes, ruleRes] = await Promise.allSettled([
    readQuery(oncallTeamsQuery(orgId.value), force),
    readQuery(coverageGapsQuery(orgId.value), force),
    readQuery(ownershipRulesQuery(orgId.value), force),
  ]);

  teamsAvailable.value = teamRes.status === "fulfilled";
  teamsLoaded.value = teamsAvailable.value;
  teams.value = teamRes.status === "fulfilled" ? teamRes.value : [];

  const rules = ruleRes.status === "fulfilled" ? ruleRes.value : [];

  setup.value = {
    hasTeam: teams.value.length > 0,
    hasStaffedRotation: await someTeamWouldPage(gapRes, force),
    hasPolicy: setup.value.hasPolicy,
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
  gapRes: PromiseSettledResult<CoverageGaps | null>,
  force: boolean,
): Promise<boolean> {
  if (!teams.value.length) return false;
  if (gapRes.status === "fulfilled") {
    return (gapRes.value?.total ?? 0) < teams.value.length;
  }
  const slots = await Promise.allSettled(
    teams.value.map((team) => readQuery(whoIsOnCallQuery(orgId.value, team.id), force)),
  );
  return slots.some((s) => s.status === "fulfilled" && s.value.length > 0);
}

// The newest row-context read: one started for rows a filter has since replaced must not overwrite the maps.
let latestRowContextRead = 0;
let rowContextRead: Promise<void> = Promise.resolve();
/// Every chunk of the last bulk read failed, so asking it again for the checklist would fail the same way.
let teamContextUnavailable = false;

/// Team context for the row teams and the viewer's, and the ladder of the oldest open pages: one request each, sent together.
async function fetchRowContext(force = false) {
  const readId = ++latestRowContextRead;
  const teamIds = [
    ...new Set(responses.value.map((r) => r.team_id).filter((id): id is string => !!id)),
  ];
  const open = responses.value
    .filter((r) => isEscalating(r.state))
    .sort((a, b) => a.opened_at - b.opened_at);
  const wanted = open.slice(0, ESCALATION_DETAIL_LIMIT).map((r) => r.id);
  const teamChunks = chunkIds(teamIds);
  if (!teamChunks.length) teamChunks.push([]);
  const [context, progress] = await Promise.allSettled([
    Promise.allSettled(
      teamChunks.map((ids, i) => readQuery(teamContextQuery(orgId.value, ids, i === 0), force)),
    ).then((reads) => {
      teamContextUnavailable = reads.every((r) => r.status === "rejected");
      return reads.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    }),
    wanted.length
      ? readQuery(responsesProgressQuery(orgId.value, wanted), force)
      : Promise.resolve([]),
  ]);
  if (readId !== latestRowContextRead) return;
  applyTeamContext(context.status === "fulfilled" ? context.value : []);
  applyProgress(progress.status === "fulfilled" ? progress.value : []);
}

/// The checklist asks whether ANY team pages; the row teams' policies usually answer it, so the rest are read only when they do not.
async function fetchPolicyPresence(force = false) {
  await rowContextRead;
  if (Object.keys(policyByTeam.value).length > 0) {
    setup.value.hasPolicy = true;
    return;
  }
  const chunks = chunkIds(teams.value.map((team) => team.id));
  if (teamContextUnavailable) {
    setup.value.hasPolicy = chunks.length ? await anyTeamPolicy(chunks.flat(), force) : false;
    return;
  }
  const reads = await Promise.allSettled(
    chunks.map((ids) => readQuery(teamContextQuery(orgId.value, ids, false), force)),
  );
  // The server creates the default ladder on first read, so a policy that answers is one that pages.
  if (reads.some((r) => r.status === "fulfilled" && r.value.some((team) => !!team.policy))) {
    setup.value.hasPolicy = true;
    return;
  }
  const unread = chunks.filter((_, i) => reads[i].status === "rejected").flat();
  setup.value.hasPolicy = unread.length ? await anyTeamPolicy(unread, force) : false;
}

/// The bulk read is newer than some servers, so a failed one falls back to each team's own policy read; `null` when a team stays unread.
async function anyTeamPolicy(teamIds: string[], force: boolean): Promise<boolean | null> {
  let unread = false;
  for (const teamId of teamIds) {
    try {
      if (await readQuery(teamPolicyQuery(orgId.value, teamId), force)) return true;
    } catch {
      unread = true;
    }
  }
  return unread ? null : false;
}

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ESCALATION_DETAIL_LIMIT) {
    chunks.push(ids.slice(i, i + ESCALATION_DETAIL_LIMIT));
  }
  return chunks;
}

/// Replaced wholesale, so a team no longer on screen drops out of the maps.
function applyTeamContext(context: OnCallTeamContext[]) {
  const policies: Record<string, OnCallPolicy> = {};
  const slots: Record<string, OnCallPosition[]> = {};
  const schedules: Record<string, OnCallSchedule> = {};
  for (const team of context) {
    if (team.policy) policies[team.team_id] = team.policy;
    // An unreadable rotation is left OUT, not empty: it is not the same fact as a coverage gap.
    if (team.on_call) slots[team.team_id] = team.on_call;
    if (team.schedule) schedules[team.team_id] = team.schedule;
  }
  policyByTeam.value = policies;
  positionsByTeam.value = slots;
  scheduleByTeam.value = schedules;
}

/// Replaced wholesale, so a record that resolved since the last read drops a countdown that will never fire.
function applyProgress(entries: EscalationProgressEntry[]) {
  const next: Record<string, EscalationProgress> = {};
  for (const { response_id, ...progress } of entries) next[response_id] = progress;
  progressById.value = next;
  // Only the ids the server answered, so an unread row never reads "Not paged yet".
  progressAnswered.value = new Set(Object.keys(next));
}

/// The expanded row's timeline.
async function fetchExpandedEvents(responseId: string, force = false) {
  expandedLoading.value = true;
  expandedEvents.value = [];
  try {
    const record = await readQuery(responseQuery(orgId.value, responseId), force);
    expandedEvents.value = record?.events ?? [];
  } catch {
    // A failed fetch leaves this row's timeline empty rather than erroring the whole list.
  } finally {
    expandedLoading.value = false;
  }
}

async function addExpandedNote(responseId: string) {
  const body = expandedNoteBody.value.trim();
  if (!body) return;
  addingExpandedNote.value = true;
  try {
    await noteWrite.mutateAsync({ responseId, body });
    expandedNoteBody.value = "";
    toast({ variant: "success", message: t("oncall.noteAdded") });
    // Unforced: the write expired this response's entry, so it reaches the server once.
    await fetchExpandedEvents(responseId);
  } catch (err) {
    toast({ variant: "error", message: raw(apiErrorText(err)) || t("oncall.addNoteFailed") });
  } finally {
    addingExpandedNote.value = false;
  }
}

/// The response behind the one expanded row, if any.
const expandedResponseId = () =>
  rows.value.find((candidate) => candidate.rowKey === expandedIds.value[0])?.latest.id;

async function loadAll(force = false) {
  await fetchResponses({ force });
  // The probe answered "not here" — every further call would 404/403 the
  // same way, so stop asking.
  if (unavailable.value) return;
  // Team and ladder reads were started by fetchResponses.
  await fetchContext(force);
  await fetchPolicyPresence(force);
  // Set even when a call failed: the screen has to stop waiting either way; `teamsAvailable` says whether to trust it.
  setupLoaded.value = true;
  // The open timeline is part of what the reader sees, so a refresh reaches it too.
  const open = expandedResponseId();
  if (open) await fetchExpandedEvents(open, force);
}

// Named, not bound straight to the template: a click would pass `force` a MouseEvent.
const refreshAll = () => loadAll(true);

// Expansion is single-mode, so there is at most one id to resolve. The table
// keys rows by `rowKey`, which is the group key when grouping is on.
watch(expandedIds, (ids) => {
  expandedNoteBody.value = "";
  expandedShowAllActivity.value = true;
  const row = rows.value.find((candidate) => candidate.rowKey === ids[0]);
  // Fresh on every expand: the reader opened the timeline to see what has happened since.
  if (row) void fetchExpandedEvents(row.latest.id, true);
  else expandedEvents.value = [];
});

/// The setup checklist's first step, which is only ever shown to an org with no
/// team at all. It lands on the teams screen with the form already open —
/// "create a team" that drops you on a list you then have to find a button in
/// is the same click asked twice.
function createTeam() {
  router.push({
    name: "onCallTeams",
    query: { org_identifier: orgId.value, action: "add" },
  });
}

function openResponse(row: PageRow) {
  router.push(responseRoute(row));
}

function responseRoute(row: PageRow) {
  return {
    name: "onCallResponseDetail",
    params: { responseId: row.latest.id },
    query: { org_identifier: orgId.value },
  };
}

/// The row's own expansion is its timeline; one open at a time, like a click on the row chevron.
function toggleTimeline(row: PageRow) {
  expandedIds.value = expandedIds.value.includes(row.rowKey) ? [] : [row.rowKey];
}

async function copyRowLink(row: PageRow) {
  const href = router.resolve(responseRoute(row)).href;
  await copyToClipboard(new URL(href, window.location.origin).toString(), t);
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    const refetch = serverFiltered.value;
    search.value = "";
    teamFilter.value = "all";
    priorityFilter.value = "all";
    causeFilter.value = "";
    setMineOnly(false);
    selectFilterTab("all");
    // The loaded rows are the filtered server answer, so clearing team or cause must ask again.
    if (refetch) void fetchResponses();
  }
}

watch([search, teamFilter, priorityFilter, mineOnly, grouped, activeFilter, causeFilter], () => {
  currentPage.value = 1;
});
watch(
  [
    search,
    teamFilter,
    priorityFilter,
    mineOnly,
    grouped,
    activeFilter,
    causeFilter,
    currentPage,
    pageSize,
    sortBy,
    sortOrder,
  ],
  () => {
    Object.assign(savedView, {
      search: search.value,
      teamFilter: teamFilter.value,
      priorityFilter: priorityFilter.value,
      mineOnly: mineOnly.value,
      grouped: grouped.value,
      activeFilter: activeFilter.value,
      causeFilter: causeFilter.value,
      currentPage: currentPage.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
    });
  },
);
// The first load lands after mount and TanStack resets to page 0 on its own deferred queue; setTimeout(0) runs after it so the restored page wins.
watch(
  loaded,
  (ready) => {
    if (!ready) return;
    setTimeout(() => oTableRef.value?.restorePage?.(currentPage.value), 0);
  },
  { once: true },
);

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

onMounted(() => {
  if (route.query.mine === "1") setMineOnly(true);
  return loadAll();
});
</script>
