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
      <!-- A filter, not a destination. "What is mine" is this same list
           narrowed; leaving for another screen to ask it threw away every other
           filter the reader had set and answered from a different dataset.
           Hidden when we do not know who is signed in, rather than left as a
           toggle that can only ever empty the table. -->
      <OButton
        v-if="viewerEmail"
        variant="outline"
        size="sm"
        :active="mineOnly"
        :aria-pressed="mineOnly"
        data-test="oncall-responses-mine-btn"
        @click="mineOnly = !mineOnly"
      >
        {{ t("oncall.myOnCallNav") }}
      </OButton>
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
    <OnCallSetupChecklist
      v-if="showChecklist && !unavailable"
      :has-team="setup.hasTeam"
      :has-staffed-rotation="setup.hasStaffedRotation"
      :has-routing="setup.hasRouting"
      :compact="hasPages"
      :can-configure="canConfigure"
      :first-team-id="teams[0]?.id ?? null"
      @create-team="createTeam"
    />

    <!-- `table-id` carries a version suffix because column widths and
         visibility are persisted per column id: the previous entry hid Team,
         hid a column that no longer exists, and sized a time column that has
         since been renamed — three settings no reader chose. v3 adds the
         "On call now" column. -->
    <OTable
      v-if="!unavailable && !setupOnly"
      :frame="false"
      :data="rows"
      :columns="columns"
      row-key="rowKey"
      :loading="loading || !setupLoaded"
      :streaming="backgroundLoading"
      :error="loadError"
      pagination="client"
      :page-size="20"
      sort-by="last_alert_at"
      sort-order="desc"
      :column-visibility="{
        firings: false,
        state: false,
        channels: false,
      }"
      table-id="oncall-responses-list-v3"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-responses-table"
      :row-tone="rowTone"
      :row-section="visibleRowSection"
      :section-order="SECTION_ORDER"
      selection="multiple"
      v-model:selected-ids="selectedIds"
      :is-row-selectable="canAcknowledge"
      expansion="single"
      v-model:expanded-ids="expandedIds"
      @row-click="openResponse"
    >
      <!-- During an incident the list IS the work surface. Opening 200 pages
           one at a time to claim them is not triage. -->
      <template #toolbar>
        <div class="flex w-full flex-wrap items-center gap-2">
          <!-- One tab, one section — spread out rather than tucked behind a
               filter icon, the way Alerts' type tabs are: what the list is
               currently narrowed to should be visible at a glance, not a
               state hidden inside a dropdown. -->
          <OToggleGroup
            :model-value="activeFilter"
            data-test="oncall-responses-filter-tabs"
            @update:model-value="(v) => selectFilterTab(v as 'all' | SectionKey)"
          >
            <OToggleGroupItem value="all" size="sm" data-test="oncall-responses-tab-all">
              {{ t("oncall.all") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="ringing" size="sm" data-test="oncall-responses-tab-ringing">
              {{ t("oncall.section_ringing") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="handled" size="sm" data-test="oncall-responses-tab-handled">
              {{ t("oncall.section_handled") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="resolved" size="sm" data-test="oncall-responses-tab-resolved">
              {{ t("oncall.section_resolved") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="snoozed" size="sm" data-test="oncall-responses-tab-snoozed">
              {{ t("oncall.section_snoozed") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <!-- `width` is a PROP, not a class: OSelect merges an incoming class
               with its own width class, so a `w-56` here lost to the default
               `w-full` and stacked the whole toolbar into three rows. -->
          <!-- Refetches, because the server does this filter now: narrowing
               the rows this page happened to have walked hid a team's older
               pages entirely past the fetch cap. -->
          <OSelect
            v-model="teamFilter"
            :options="teamOptions"
            :disabled="!teamsAvailable"
            :placeholder="teamsAvailable ? undefined : t('oncall.teamFilterUnavailable')"
            width="sm"
            data-test="oncall-responses-team-filter"
            @update:model-value="() => fetchResponses()"
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
          <!-- On by default. A rule firing every minute is one problem, not
               ninety-five, and the ungrouped view is for reading history. -->
          <OCheckbox
            v-model="grouped"
            :label="t('oncall.groupByAlert')"
            data-test="oncall-responses-group-toggle"
          />
          <!-- Only on a tab showing resolved pages: a cause is written at
               resolve, so filtering an open list by one can only ever empty
               it. Server-side, like the team filter — the cause somebody wants
               is usually months back, past any page cap. Keyed off the tab
               rather than `includeResolved`, which stays true once fetched
               even after the reader narrows away from resolved rows. -->
          <OSelect
            v-if="sectionVisibility.resolved"
            :model-value="causeFilter"
            :options="causeOptions"
            :placeholder="t('oncall.causeFilterAny')"
            width="sm"
            data-test="oncall-responses-cause-filter"
            @update:model-value="onCauseFilter"
          />
        </div>
      </template>

      <template
        v-if="selectedIds.length || truncated || escalationCapped"
        #bottom
      >
        <div v-if="selectedIds.length" class="flex w-full flex-wrap items-center gap-2">
          <OText variant="body" as="span" data-test="oncall-bulk-count">
            {{ t("oncall.selectedCount", { count: selectedIds.length }) }}
          </OText>
          <OButton
            variant="primary"
            size="sm-toolbar"
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
                size="sm-toolbar"
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
            size="sm-toolbar"
            :loading="bulkBusy"
            data-test="oncall-bulk-resolve"
            @click="confirmBulkResolve = true"
          >
            {{ t("oncall.resolve") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-toolbar"
            data-test="oncall-bulk-cancel"
            @click="selectedIds = []"
          >
            {{ t("oncall.cancel") }}
          </OButton>
        </div>

        <!-- The server caps a page at 200 and the facets have to be honest about
             what they counted, so say so rather than quietly under-reporting.
             The escalation cap is stated for the same reason: a blank ladder cell
             would otherwise read as "nothing has fired". -->
        <span
          v-if="!selectedIds.length && (truncated || escalationCapped)"
          class="text-text-secondary flex flex-wrap gap-x-3 text-xs"
        >
          <!-- The loaded length is never presented as the total: §G.5 is
               explicit that the list endpoint has no count, and "the first
               2000 of 2000" is a lie exactly when the number matters. -->
          <span v-if="truncated" data-test="oncall-responses-truncated">
            {{ t("oncall.listTruncatedNoTotal", { count: responses.length }) }}
          </span>
          <span v-if="escalationCapped" data-test="oncall-escalation-capped">
            {{ t("oncall.escalationDetailCapped", { count: ESCALATION_DETAIL_LIMIT }) }}
          </span>
        </span>
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

      <!-- What each run of rows IS, in the words somebody would use out loud, so
           the state is read once per section instead of once per row. The count
           is taken from the filtered set rather than the page, because a heading
           that said "3" on page one of five would be describing the pagination.

           `sectionKey` rather than `key`: Vue reserves `key` on a slot outlet. -->
      <template #group-header="{ sectionKey }">
        <div
          class="px-page-edge flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5"
          :data-test="`oncall-section-header-${sectionKey}`"
        >
          <span class="text-2xs font-semibold tracking-wide uppercase" :class="sectionTone(sectionKey)">
            {{ t(`oncall.section_${sectionKey}`) }}
          </span>
          <OTag variant="default-soft" size="sm" :data-test="`oncall-section-count-${sectionKey}`">
            {{ raw(String(sectionCounts[sectionKey] ?? 0)) }}
          </OTag>
          <OText variant="meta">
            {{ t(`oncall.sectionHint_${sectionKey}`) }}
          </OText>
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
          class="text-text-body inline-block max-w-full truncate underline"
          :data-test="`oncall-row-team-${row.rowKey}`"
          @click.stop
        >
          {{ raw(teamNameById[row.latest.team_id] ?? row.latest.team_id) }}
          <OTooltip :content="raw(teamNameById[row.latest.team_id] ?? row.latest.team_id)" />
        </router-link>
      </template>

      <!-- The name plus what the page is about: how often it has fired, and the
           incident it produced. A woken engineer reads this cell first. -->
      <template #cell-subject="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex items-center gap-1.5">
            <span class="text-text-body truncate">
              {{ raw(row.latest.title || row.latest.subject.source_id) }}
              <OTooltip :content="raw(row.latest.title || row.latest.subject.source_id)" />
            </span>
            <OTag v-if="row.firings.length > 1" variant="default-soft" size="sm">
              {{ raw(`×${row.firings.length}`) }}
            </OTag>
          </span>
          <!-- Only when there is something to say: with the team moved out to
               its own column most rows carry no chips at all, and an empty row
               of them still took vertical space in every one. -->
          <span
            v-if="isImpactedRow(row.latest) || row.latest.incident_id"
            class="flex flex-wrap items-center gap-1"
          >
            <!-- This row is somebody else's outage reaching this team's
                 service, and the difference decides what the reader does with
                 it: a page you fix, or a blast radius you contain and confirm
                 recovery on. `origin_response_id` is already on every row, so
                 the two were indistinguishable in a list only because nothing
                 read it. -->
            <OTag
              v-if="isImpactedRow(row.latest)"
              variant="info-outline"
              size="sm"
              :data-test="`oncall-impacted-${row.latest.id}`"
            >
              {{ t("oncall.liaisonTag") }}
            </OTag>
            <router-link
              v-if="row.latest.incident_id"
              :to="{
                name: 'incidentDetail',
                params: { id: row.latest.incident_id },
                query: { org_identifier: orgId },
              }"
              :data-test="`oncall-row-incident-${row.rowKey}`"
              @click.stop
            >
              <ODimensionChip
                dim-key="incident"
                :key-label="String(t('oncall.incident'))"
                :value="incidentTitleById[row.latest.incident_id] ?? row.latest.incident_id"
              />
              <OTooltip
                :content="raw(incidentTitleById[row.latest.incident_id] ?? row.latest.incident_id)"
              />
            </router-link>
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

      <!-- Who owns it, or — while nobody does — that nobody does. Who the
           rotation would ring right now is a separate question (an escalated
           or reassigned page can be answered by someone no longer holding the
           pager), so it lives in its own "On call now" column instead of
           repeating here. -->
      <template #cell-responder="{ row }">
        <OUserCell
          v-if="row.latest.acked_by"
          :value="row.latest.acked_by"
          :name="row.latest.acked_by === viewerEmail ? youLabel : undefined"
          local-part
          copy
          :copy-label="t('oncall.copyEmail')"
        />
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
        <OUserCell
          v-if="positionsByTeam[row.latest.team_id ?? '']?.[0]"
          :value="positionsByTeam[row.latest.team_id ?? '']![0].user_email"
          :name="
            positionsByTeam[row.latest.team_id ?? '']![0].user_email === viewerEmail
              ? youLabel
              : undefined
          "
          local-part
          copy
          :copy-label="t('oncall.copyEmail')"
        />
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

           Exactly one action carries a label, and it is whatever this row's next
           step actually is — claim it, close it, or read it. Acknowledge or
           nothing meant a handled page that still had to be closed offered its
           one visible button to a menu. Everything else sits behind the
           more-menu, as it does on every other list in the app. -->
      <template #cell-actions="{ row }">
        <!-- The slot's wrapper is inline-flex and shrinks to content by design, so pin to the column's resolved width directly instead of `w-full`. -->
        <span class="flex w-[var(--header-actions-size)] items-center justify-between">
          <OButton
            v-if="!row.latest.team_id"
            variant="outline"
            size="xs"
            :data-test="`oncall-row-assign-${row.rowKey}`"
            @click.stop="goTo('onCallRouting')"
          >
            {{ t("oncall.assignTeamShort") }}
          </OButton>
          <template v-else>
            <!-- Primary is `primaryAction(row)`: claiming is loud because it is
                 the one somebody is woken for; closing and reading are ordinary
                 work, so they stay quiet. -->
            <OButton
              v-if="primaryAction(row) === 'acknowledge'"
              variant="primary"
              size="xs"
              class="w-28"
              :loading="busyId === row.rowKey"
              :data-test="`oncall-row-ack-${row.rowKey}`"
              @click.stop="acknowledgeRow(row)"
            >
              {{ t("oncall.acknowledge") }}
            </OButton>
            <OButton
              v-else-if="primaryAction(row) === 'resolve'"
              variant="outline"
              size="xs"
              class="w-28"
              :loading="busyId === row.rowKey"
              :data-test="`oncall-row-resolve-${row.rowKey}`"
              @click.stop="resolveRow(row)"
            >
              {{ t("oncall.resolve") }}
            </OButton>
            <OButton
              v-else
              variant="outline"
              size="xs"
              class="w-28"
              :data-test="`oncall-row-timeline-${row.rowKey}`"
              @click.stop="openResponse(row)"
            >
              {{ t("oncall.timeline") }}
            </OButton>

            <!-- Hidden when the row has nothing left to offer: a closed page's
                 only action is already the button beside it, and a menu whose
                 single item is the thing you just clicked is furniture. -->
            <ODropdown v-if="canAcknowledge(row) || menuActions(row).length">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="more-vert"
                  :loading="busyId === row.rowKey"
                  :data-test="`oncall-row-more-${row.rowKey}`"
                  @click.stop
                >
                  <OTooltip side="bottom" :content="t('oncall.moreActions')" />
                </OButton>
              </template>

              <!-- Grouped rather than four loose items: they are one decision
                   ("quiet it") asked at four lengths. -->
              <ODropdownGroup v-if="canAcknowledge(row)" :label="t('oncall.snoozeFor')">
                <ODropdownItem
                  v-for="option in snoozeOptions"
                  :key="option.minutes"
                  :data-test="`oncall-row-snooze-${row.rowKey}-${option.minutes}`"
                  @select="snoozeRow(row, option.minutes)"
                >
                  <template #icon-left>
                    <OIcon name="pause-circle-filled" size="sm" />
                  </template>
                  {{ option.label }}
                </ODropdownItem>
              </ODropdownGroup>

              <ODropdownSeparator v-if="canAcknowledge(row)" />

              <ODropdownItem
                v-if="menuActions(row).includes('resolve')"
                :data-test="`oncall-row-resolve-${row.rowKey}`"
                @select="resolveRow(row)"
              >
                <template #icon-left>
                  <OIcon name="task-alt" size="sm" />
                </template>
                {{ t("oncall.resolve") }}
              </ODropdownItem>

              <ODropdownItem
                v-if="menuActions(row).includes('timeline')"
                :data-test="`oncall-row-timeline-${row.rowKey}`"
                @select="openResponse(row)"
              >
                <template #icon-left>
                  <OIcon name="format-list-bulleted" size="sm" />
                </template>
                {{ t("oncall.timeline") }}
              </ODropdownItem>
            </ODropdown>
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
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallEscalationCell from "@/components/oncall/OnCallEscalationCell.vue";
import OnCallPageContext from "@/components/oncall/OnCallPageContext.vue";
import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import OnCallShiftBanner from "@/components/oncall/OnCallShiftBanner.vue";
import OnCallTimeline from "@/components/oncall/OnCallTimeline.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import type { OTableColumnDef, RowTone } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import incidentsService from "@/services/incidents";
import oncallService, { RESPONSE_PAGE_LIMIT } from "@/services/oncall";
import type {
  CauseGroup,
  Channel,
  CoverageGaps,
  EscalationProgress,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallResponseGroup,
  OnCallSchedule,
  OnCallPosition,
  OnCallTeam,
  ResolutionCause,
} from "@/ts/interfaces/oncall";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import {
  groupBySubject,
  isDeliverableChannel,
  isEscalating,
  isOnCallUnavailable,
  isSnoozed,
  nextHandover,
  winningRule,
} from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
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

const responses = ref<OnCallResponse[]>([]);
const teams = ref<OnCallTeam[]>([]);
const policyByTeam = ref<Record<string, OnCallPolicy>>({});
const scheduleByTeam = ref<Record<string, OnCallSchedule>>({});
const positionsByTeam = ref<Record<string, OnCallPosition[]>>({});
const progressById = ref<Record<string, EscalationProgress>>({});
const escalationCapped = ref(false);
const expandedIds = ref<string[]>([]);
const expandedEvents = ref<OnCallResponseEvent[]>([]);
const expandedHistory = ref<OnCallResponse[]>([]);
const expandedCauses = ref<CauseGroup[]>([]);
const expandedLoading = ref(false);
const teamsAvailable = ref(true);
const truncated = ref(false);
const loading = ref(false);
/// Set only while a tab switch is quietly fetching resolved pages the reader
/// cannot see are missing. Drives `OTable`'s `streaming` bar rather than
/// `loading` so the rows already on screen never disappear behind a skeleton
/// for a fetch nothing visible was waiting on.
const backgroundLoading = ref(false);
const loadError = ref<string | null>(null);
/// §G.8.1: 404 or 403 "Not Supported" from the entry fetch — on-call is not
/// available on this deployment. A fact about the build, never an error.
const unavailable = ref(false);
const search = ref("");
const teamFilter = ref("all");
const priorityFilter = ref("all");
/// `?mine=1` opens the list already narrowed. It is what the retired
/// `oncall/me` page now redirects to, so a bookmark from before still lands on
/// the answer instead of a stub that told everybody they were on no team.
const mineOnly = ref(false);
const selectedIds = ref<string[]>([]);
const grouped = ref(true);
/// `"all"` is the default tab, and "all" means all — resolved included —
/// so the very first fetch already asks for resolved pages too.
const includeResolved = ref(true);
/// All four sections start visible, matching the default `"all"` tab.
const sectionVisibility = ref<Record<SectionKey, boolean>>({
  ringing: true,
  snoozed: true,
  handled: true,
  resolved: true,
});
/// The tab the toolbar shows as pressed. `"all"` is every section at once
/// (open and resolved alike) and has no `SectionKey` of its own; picking any
/// other tab narrows `sectionVisibility` to just that one section — and, for
/// every tab but `"all"` and `"resolved"`, drops resolved pages out of the
/// fetch entirely.
const activeFilter = ref<"all" | SectionKey>("all");
/// Empty means every cause. Cleared whenever resolved pages leave the list,
/// because a cause filter over open records matches nothing and would read as
/// "there is nothing here" rather than "this filter cannot apply".
const causeFilter = ref<ResolutionCause | "">("");
const busyId = ref("");
const bulkBusy = ref(false);
const confirmBulkResolve = ref(false);

// Only after the first fetch, so the checklist never flashes while loading.
const loaded = ref(false);
const setup = ref({ hasTeam: false, hasStaffedRotation: false, hasRouting: false });
/// The list and the checklist are answered by two different fetches, and these
/// defaults are all-false. Drawing the checklist off them the moment the LIST
/// arrived told every configured org to create a team — and, with no pages yet,
/// handed setup the whole screen — for as long as the context call took. The
/// checklist waits for its own answer.
const setupLoaded = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
/// Lowercased to compare with `acked_by`, which the server normalises on a
/// handoff but not necessarily on a self-acknowledgement.
const viewerEmail = computed(() => String(store.state.userInfo?.email ?? "").toLowerCase());

const teamNameById = computed<Record<string, string>>(() =>
  Object.fromEntries(teams.value.map((team) => [team.id, team.name])),
);

// A ksuid asks the reader to look it up somewhere else, same as team_id
// (`fetchTeamContext` below). There is no bulk "get these incidents" endpoint,
// so this fills in one id at a time and the chip falls back to the raw id
// until its title lands.
const incidentTitleById = ref<Record<string, string>>({});

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
    mineScope.value ||
    activeFilter.value !== "all",
);

const showChecklist = computed(
  () =>
    loaded.value &&
    setupLoaded.value &&
    // Teams did not answer, so "this org has no team" is not a fact we hold —
    // it is the default we started from, and the first step would be a lie.
    teamsAvailable.value &&
    !loadError.value &&
    !(setup.value.hasTeam && setup.value.hasStaffedRotation && setup.value.hasRouting),
);

/// Whether this org has ever paged anybody — read from what was FETCHED, not
/// from the filtered rows, so narrowing the table to nothing does not swap the
/// page's whole shape underneath the reader.
const hasPages = computed(() => responses.value.length > 0);

/// Setup is the entire screen.
///
/// Nothing has ever paged and the wiring is incomplete, which are the same
/// fact: there is no list to hide behind the checklist, and an empty table
/// under it would only offer "no pages yet" as if that were healthy. Once a
/// single page exists the checklist has to give the screen back — it becomes
/// one bar over a live list.
const setupOnly = computed(() => showChecklist.value && !hasPages.value);

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
    size: 280,
    minSize: 200,
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
    size: 160,
    accessorFn: (row: PageRow) =>
      teamNameById.value[row.latest.team_id] ?? row.latest.team_id ?? "",
    sortable: true,
    hideable: true,
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
    // Who the rotation would ring right now, independent of who (if anyone)
    // has answered THIS page — an escalated or reassigned page can be
    // answered by someone no longer holding the pager.
    id: "on_call_now",
    header: t("oncall.onCallNow"),
    size: 184,
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
    size: COL.dateAbsolute,
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
    // One labelled button plus the more-menu. `actionCount` is what OTable
    // sizes the hover rail from, so it counts the controls, not the width.
    size: 128,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
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

/// Inert until we know who is signed in — otherwise a stale toggle would hide
/// every row with no visible control to turn it off.
const mineScope = computed(() => mineOnly.value && !!viewerEmail.value);

/// A page is the viewer's if their shift would have taken it, or if they already
/// did. The acknowledgement outlives the shift: whoever claimed it still owns it
/// after handover.
function isMine(record: OnCallResponse): boolean {
  return (
    myTeamIds.value.has(record.team_id) ||
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

const causeOptions = computed(() => [
  { label: t("oncall.causeFilterAny"), value: "" },
  ...RESOLUTION_CAUSES.map((cause) => ({ label: t(`oncall.cause_${cause}`), value: cause })),
]);

function onCauseFilter(value: unknown) {
  causeFilter.value = (value as ResolutionCause) || "";
  void fetchResponses();
}

/// One tab, one section — except `"all"`, which is every section at once,
/// resolved included. Narrowing away from resolved is never a round trip:
/// `responses` already holds whatever was last fetched, so hiding a section
/// is exactly that, hiding it. The only real fetch is the first crossing INTO
/// a resolved-showing tab, because that is the only direction that can be
/// missing rows — and it goes quietly, behind whatever the reader is already
/// looking at, rather than blocking the rows already on screen.
function selectFilterTab(tab: "all" | SectionKey) {
  activeFilter.value = tab;
  const showsResolved = tab === "all" || tab === "resolved";
  sectionVisibility.value = {
    ringing: tab === "all" || tab === "ringing",
    snoozed: tab === "all" || tab === "snoozed",
    handled: tab === "all" || tab === "handled",
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

/// How fast the page was answered, for a row that already has been.
function ackedInMicros(record: OnCallResponse): number | null {
  return record.acked_at ? record.acked_at - record.opened_at : null;
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
    // The FIRST rotation's handover. Each rotation hands over on its own
    // cadence now, so there is no single team-wide one — and the countdown
    // beside "you are on call" is about the shift the viewer is holding, which
    // is the position they were resolved into.
    const rotation = schedule.rotations?.[0];
    const rule = rotation ? winningRule(rotation, nowMicros, schedule.timezone) : null;
    out[team.id] = rule ? nextHandover(rule, nowMicros) : null;
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
      (handoverByTeam.value[a.team.id] ?? Infinity) -
      (handoverByTeam.value[b.team.id] ?? Infinity),
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

/** The three things a row can be asked to do, in the order they take priority. */
type RowAction = "acknowledge" | "resolve" | "timeline";

/**
 * The one action that earns a label on the row.
 *
 * Precedence, not a mode: a ringing page is claimed first, an owned one still
 * has to be closed, and a closed one is only there to be read. The point is that
 * every row has a visible next step — "Acknowledge or nothing" left a handled
 * page's actual next step buried in a menu.
 */
function primaryAction(row: PageRow): RowAction {
  if (canAcknowledge(row)) return "acknowledge";
  if (hasUnresolved(row)) return "resolve";
  return "timeline";
}

/// What the more-menu carries: every action the row has EXCEPT the one already
/// labelled beside it, so nothing is offered twice.
function menuActions(row: PageRow): RowAction[] {
  const primary = primaryAction(row);
  const actions: RowAction[] = [];
  if (hasUnresolved(row) && primary !== "resolve") actions.push("resolve");
  if (primary !== "timeline") actions.push("timeline");
  return actions;
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

/// Which run a row belongs to. Asked of the row rather than the record so a
/// group standing for ninety-five firings lands where its live ones do: a group
/// with anything still ringing is ringing, whatever its latest firing says.
function rowSection(row: PageRow): SectionKey {
  if (row.latest.state === "resolved") return "resolved";
  if (row.escalating.some((r) => !r.acked_by && !isSnoozed(r))) return "ringing";
  if (row.firings.some((r) => isSnoozed(r))) return "snoozed";
  return "handled";
}

/// What `OTable` groups by. Unlike `rowSection`, a section the filters
/// dropdown unchecked returns null here — `OTable` drops a row entirely when
/// its section is null, which is how "hide Handled" hides Handled rows
/// without touching `rows`, `sectionCounts`, or anything counted off it.
function visibleRowSection(row: PageRow): SectionKey | null {
  const section = rowSection(row);
  return sectionVisibility.value[section] ? section : null;
}

/// Counted over the filtered set, not the page: a heading reading "3" on page
/// one of five would be describing the pagination rather than the state.
const sectionCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = { ringing: 0, snoozed: 0, handled: 0, resolved: 0 };
  for (const row of rows.value) counts[rowSection(row)] += 1;
  return counts;
});

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
      // Filtered by the SERVER once a team is chosen. Filtering client-side
      // narrowed the rows this fetch happened to have walked — capped at
      // MAX_PAGES × RESPONSE_PAGE_LIMIT — so on a busy org the team's older
      // pages were simply not in the list, and the screen said so by showing
      // nothing rather than by saying it was truncated.
      ...(teamFilter.value === "all" ? {} : { team_id: teamFilter.value }),
      ...(causeFilter.value ? { cause: causeFilter.value } : {}),
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
/// `background: true` is for a fetch that is filling in data the reader
/// cannot see is missing — picking up resolved pages behind a tab that was
/// already showing rows. `loading` would swap those rows for a skeleton over
/// something that, from the reader's side, was not loading at all; `streaming`
/// leaves them on screen with a quiet bottom bar instead.
async function fetchResponses(opts: { background?: boolean } = {}) {
  const busy = opts.background ? backgroundLoading : loading;
  busy.value = true;
  try {
    responses.value = await fetchAllPages();
    loadError.value = null;
    // Only on SUCCESS. Setting this in `finally` would let a transient API
    // error render the first-run checklist, telling a configured org that
    // nothing is set up.
    loaded.value = true;
    // Fire-and-forget: the list is already usable with ids as the fallback,
    // so titles fill in behind it rather than holding up the table.
    void fetchIncidentTitles();
  } catch (err) {
    // §G.8.1: the probe said "not here". Leaving `loaded` false keeps the
    // setup checklist away too — a build that cannot page must not be told
    // to create teams.
    if (isOnCallUnavailable(err)) {
      unavailable.value = true;
      return;
    }
    loadError.value = errorMessage(err) || String(t("oncall.loadResponsesFailed"));
  } finally {
    busy.value = false;
  }
}

/// One request per incident id — there is no bulk "get these incidents"
/// endpoint (see `fetchTeamContext` for the same constraint on team data).
/// Already-resolved ids are skipped so a background refresh doesn't re-fetch
/// titles the list already has.
async function fetchIncidentTitles() {
  const ids = [
    ...new Set(
      responses.value
        .map((response) => response.incident_id)
        .filter((id): id is string => !!id && !(id in incidentTitleById.value)),
    ),
  ];
  if (!ids.length) return;
  const results = await Promise.allSettled(
    ids.map((id) => incidentsService.get(orgId.value, id)),
  );
  const next = { ...incidentTitleById.value };
  ids.forEach((id, index) => {
    const result = results[index];
    if (result.status === "fulfilled" && result.value.data?.title) {
      next[id] = result.value.data.title;
    }
  });
  incidentTitleById.value = next;
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
  // Set even when a call failed: the screen has to stop waiting either way.
  // Whether the answer is trustworthy is `teamsAvailable`, checked separately.
  setupLoaded.value = true;
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
  const nextSlots: Record<string, OnCallPosition[]> = {};
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
  positionsByTeam.value = nextSlots;
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

async function refreshAll() {
  await fetchResponses();
  // The probe answered "not here" — every further call would 404/403 the
  // same way, so stop asking.
  if (unavailable.value) return;
  await fetchContext();
  await fetchTeamContext();
  await fetchEscalationProgress();
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
    mineOnly.value = false;
    selectFilterTab("all");
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

onMounted(() => {
  mineOnly.value = route.query.mine === "1";
  return refreshAll();
});
</script>
