<template>
  <OPageLayout
    bleed
    data-test="oncall-response-detail-page"
    :title="title"
    title-min-width
    icon="notifications-active"
    tabs-below
    :back="{
      label: t('oncall.backToResponses'),
      to: { name: 'onCallResponses', query: { org_identifier: orgId } },
    }"
  >
    <!-- Team, which firing this is, and when it opened — the tagline reads as
         one short line rather than a metadata grid below the fold. Team is a
         real link because "whose rotation is this" is the next click a
         responder makes; the firing count carries its history as a tooltip
         instead of a trailing clause, which is enough for "not the first
         time" without spelling out how many. -->
    <template v-if="response" #subtitle>
      <span class="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
        <i18n-t
          keypath="oncall.responseSubtitle"
          tag="span"
          scope="global"
          class="flex min-w-0 items-center gap-1 truncate"
          data-test="oncall-response-subtitle"
        >
          <template #team>
            <span
              v-if="!response.team_id"
              class="text-status-error-text shrink-0"
              data-test="oncall-response-team-none"
              >{{ t("oncall.statUnrouted") }}</span
            >
            <OTag
              v-else-if="teamDeleted"
              variant="default-soft"
              size="sm"
              data-test="oncall-response-team-deleted"
            >
              {{ t("oncall.deletedTeam") }}
            </OTag>
            <OSkeleton
              v-else-if="!teamName"
              class="h-3.5 w-20"
              data-test="oncall-response-team-pending"
            />
            <router-link
              v-else
              class="text-accent min-w-0 hover:underline"
              :to="teamRoute"
              data-test="oncall-response-team-link"
            >
              <OTruncatedText class="block">{{ raw(teamName) }}</OTruncatedText>
            </router-link>
          </template>
          <template #opened>
            <span class="shrink-0" data-test="oncall-response-opened">{{ openedAtClock }}</span>
          </template>
        </i18n-t>
        <OTruncatedText
          v-if="response.state === 'acknowledged' && response.acked_by"
          class="shrink-[100]"
          :tooltip="t('oncall.escalationAckedBy', { who: tooltipOf(response.acked_by) })"
          data-test="oncall-response-acked-by"
        >
          {{ raw("·") }}
          <i18n-t keypath="oncall.escalationAckedBy" tag="span" scope="global">
            <template #who>
              <OnCallPersonName
                :email="response.acked_by"
                data-test="oncall-response-acked-by-name"
              />
            </template>
          </i18n-t>
        </OTruncatedText>
        <!-- A closed page's state tag already says it, and an acknowledged one names its holder just before. -->
        <span
          v-if="lgUp && isOpenState && response.state !== 'acknowledged'"
          class="flex min-w-0 shrink-[100] items-center gap-1"
          data-test="oncall-response-phrase"
        >
          <span v-if="headerPhraseKind !== 'unknown'" class="shrink-0">{{ raw("·") }}</span>
          <!-- Words, not the list's chip: the title row keeps only state and priority. -->
          <OTruncatedText
            v-if="headerPhraseKind === 'nobodyAnswered'"
            class="text-status-error-text min-w-0"
            :tooltip="t('oncall.ladderExhausted')"
            data-test="oncall-response-phrase-exhausted"
          >
            {{ t("oncall.state_exhausted") }}
          </OTruncatedText>
          <OnCallEscalationCell
            v-else
            class="min-w-0"
            :response-id="response.id"
            :record="response"
            :progress="escalation"
            :total-rungs="totalRungs"
            :progress-loaded="escalationLoaded"
            :reached-step="headerReachedStep"
            :team-deleted="teamDeleted"
          />
        </span>
        <!-- Why this team is looking at somebody else's outage, said with the page's other facts. -->
        <span
          v-if="lgUp && isImpacted"
          class="text-status-info-text inline-flex shrink-[100] items-center gap-1 truncate"
          data-test="oncall-response-liaison-tag"
        >
          {{ raw("·") }} {{ t("oncall.liaisonTag") }}
          <OTooltip side="bottom" :content="t('oncall.ladderLiaisonNote')" />
        </span>
      </span>
    </template>

    <template #title-trail>
      <template v-if="response && lgUp">
        <!-- The title ellipsises first; clipping here means the chips can never paint under the actions. -->
        <span
          class="flex min-w-0 shrink-[0.01] items-center gap-3.25 overflow-hidden"
          data-test="oncall-response-title-trail"
        >
          <span class="inline-flex shrink-0" data-test="oncall-response-state-tag">
            <OTag type="oncallResponseState" :value="response.state" size="sm" />
            <OTooltip v-if="closedAfter" :content="closedAfter" />
          </span>
          <OTag class="shrink-0" type="alertPriority" :value="`p${response.priority}`" size="sm" />
        </span>
      </template>
    </template>

    <template v-if="response" #header-tabs>
      <OTabs
        v-model="activeDetailTab"
        align="left"
        class="flex-1"
        mobile-arrows
        :breakpoint="0"
        data-test="oncall-response-tabs-strip"
      >
        <OTab
          name="activity"
          icon="forum"
          :label="t('oncall.tabActivity')"
          data-test="oncall-response-tab-activity"
        />
        <OTab
          name="deliveries"
          icon="send"
          :label="t('oncall.deliveriesTitle')"
          data-test="oncall-response-tab-deliveries"
        />
        <OTab
          name="causes"
          icon="history"
          :label="t('oncall.tabPriorCauses')"
          data-test="oncall-response-tab-causes"
        />
        <!-- Absent on a deployment with no agent, rather than a tab that opens on nothing. -->
        <OTab
          v-if="report"
          name="report"
          icon="psychology"
          :label="t('oncall.tabReport')"
          data-test="oncall-response-tab-report"
        />
      </OTabs>
    </template>

    <template #actions>
      <ORefreshButton
        v-if="response"
        layout="inline"
        size="header"
        variant="outline"
        :last-run-at="lastFetchedAt"
        :loading="refreshing"
        data-test="oncall-response-refresh"
        @click="refreshPage"
      />
      <template v-if="response && isOpenState">
        <!-- Exactly one primary, and it moves: claiming the page matters most
             until somebody has, and closing it matters most after. -->
        <OButton
          v-if="canAcknowledge"
          variant="primary"
          size="sm"
          :loading="acking"
          data-test="oncall-response-ack-btn"
          @click="acknowledgeRecord"
        >
          <OTooltip :content="ackWords.ackHint" />
          <OIcon name="check-circle" size="sm" />{{ t("oncall.acknowledge") }}
        </OButton>
        <template v-if="response.state === 'acknowledged'">
          <OButton
            v-if="response.acked_by !== me"
            variant="outline"
            size="sm"
            :loading="acking"
            data-test="oncall-response-take-over-btn"
            @click="takeOverRecord"
          >
            <OTooltip :content="t('oncall.takeOverHint')" />
            <OIcon name="how-to-reg" size="sm" />{{ t("oncall.takeOver") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            :loading="acking"
            :disabled="!!unackBlockedReason"
            :focusable-unavailable="!!unackBlockedReason"
            data-test="oncall-response-unack-btn"
            @click="unacknowledgeRecord"
          >
            <!-- First child, so it anchors to the whole button: a disabled one must say why on hover. -->
            <OTooltip :content="unackBlockedReason ?? ackWords.unackHint" />
            <OIcon name="undo" size="sm" />{{ t("oncall.unacknowledge") }}
            <template v-if="unackBlockedReason" #unavailable-reason>{{
              unackBlockedReason
            }}</template>
          </OButton>
        </template>

        <!-- A menu of durations, not a panel that pushes the page down. -->
        <OButton
          v-if="canUnsnooze && inlineVerbs"
          variant="outline"
          size="sm"
          :loading="snoozing"
          data-test="oncall-response-unsnooze-btn"
          @click="unsnoozeRecord"
        >
          <OTooltip :content="t('oncall.unsnoozeHint')" />
          <OIcon name="notifications-active" size="sm" />{{ t("oncall.unsnooze") }}
        </OButton>
        <ODropdown v-else-if="canSnooze && inlineVerbs">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              :loading="snoozing"
              icon-right="expand-more"
              data-test="oncall-response-snooze-btn"
            >
              <OIcon name="alarm" size="sm" />{{ t("oncall.snooze") }}
            </OButton>
          </template>
          <ODropdownItem
            v-for="opt in snoozeOptions"
            :key="opt.minutes"
            icon-left="alarm"
            :data-test="`oncall-response-snooze-${opt.minutes}`"
            @select="snoozeRecord(opt.minutes)"
          >
            {{ raw(opt.label) }}
          </ODropdownItem>
        </ODropdown>

        <!-- Not on an unrouted page: the server refuses it there, and Hand off is the next step. -->
        <span v-if="inlineVerbs && canEscalate" class="inline-flex">
          <OButton
            variant="outline"
            size="sm"
            :loading="escalatingNow"
            :disabled="escalation?.exhausted"
            :focusable-unavailable="escalation?.exhausted"
            data-test="oncall-response-escalate-btn"
            @click="escalateNow"
          >
            <OIcon name="trending-up" size="sm" />{{ t("oncall.escalate") }}
            <template v-if="escalation?.exhausted" #unavailable-reason>{{
              t("oncall.ladderExhausted")
            }}</template>
          </OButton>
          <OTooltip v-if="escalation?.exhausted" :content="t('oncall.ladderExhausted')" />
        </span>

        <OButton
          v-if="inlineVerbs"
          variant="outline"
          size="sm"
          data-test="oncall-response-handoff-btn"
          @click="showHandoff = true"
        >
          <OIcon name="swap-horiz" size="sm" />{{ t("oncall.handoff") }}
        </OButton>
      </template>

      <!-- Ten minutes into a page, "this is bigger than an alert" had no way of
           being said: `incident_id` could only ever be set by the path that
           opened the record. Offered on a closed record too — the server does
           not gate it by state, and the realisation that a firing belonged to
           something larger routinely arrives after it was closed. Hidden once
           an incident exists, because the rail links to it from then on. -->
      <OButton
        v-if="response && !response.incident_id && inlineVerbs"
        variant="outline"
        size="sm"
        data-test="oncall-response-promote-btn"
        @click="promoteOpen = true"
      >
        <OIcon name="local-fire-department" size="sm" />{{ t("oncall.promote") }}
      </OButton>

      <template v-if="response && isOpenState">
        <!-- An impacted record closes through ITS verb. A plain resolve would
             close this record but skip the sibling check that closes the
             owner's — the owner would wait forever on a confirmation that can
             no longer arrive. -->
        <OButton
          v-if="isImpacted"
          :variant="canAcknowledge ? 'outline' : 'primary'"
          size="sm"
          :loading="confirmingRecovery"
          data-test="oncall-response-confirm-recovery-btn"
          @click="confirmRecoveryOpen = true"
        >
          <OIcon name="task-alt" size="sm" />{{ t("oncall.confirmRecovery") }}
        </OButton>
        <OButton
          v-else
          :variant="canAcknowledge ? 'outline' : 'primary'"
          size="sm"
          :loading="resolving"
          data-test="oncall-response-resolve-btn"
          @click="confirmResolve = true"
        >
          <OIcon name="task-alt" size="sm" />{{ t("oncall.resolve") }}
        </OButton>
      </template>

      <ODropdown v-if="response && !inlineVerbs && hasMoreActions" side="bottom" align="end">
        <template #trigger>
          <OButton
            variant="outline"
            size="icon-md"
            icon-left="more-vert"
            :loading="snoozing || escalatingNow"
            :aria-label="t('oncall.moreActions')"
            data-test="oncall-response-more-btn"
          />
        </template>
        <ODropdownItem
          v-if="canUnsnooze"
          icon-left="notifications-active"
          data-test="oncall-response-unsnooze-btn-menu"
          @select="unsnoozeRecord"
        >
          {{ t("oncall.unsnooze") }}
        </ODropdownItem>
        <ODropdownGroup v-else-if="canSnooze" :label="t('oncall.snoozeFor')">
          <ODropdownItem
            v-for="opt in snoozeOptions"
            :key="opt.minutes"
            icon-left="alarm"
            :data-test="`oncall-response-snooze-${opt.minutes}-menu`"
            @select="snoozeRecord(opt.minutes)"
          >
            {{ raw(opt.label) }}
          </ODropdownItem>
        </ODropdownGroup>
        <ODropdownSeparator v-if="canSnooze" />
        <ODropdownItem
          v-if="isOpenState && canEscalate"
          icon-left="trending-up"
          :disabled="escalation?.exhausted"
          data-test="oncall-response-escalate-btn-menu"
          @select="escalateNow"
        >
          <!-- Touch has no tooltip, so a greyed-out verb says why in its own one line. -->
          {{ escalation?.exhausted ? t("oncall.escalateNobodyLeft") : t("oncall.escalate") }}
        </ODropdownItem>
        <ODropdownItem
          v-if="isOpenState"
          icon-left="swap-horiz"
          data-test="oncall-response-handoff-btn-menu"
          @select="showHandoff = true"
        >
          {{ t("oncall.handoff") }}
        </ODropdownItem>
        <ODropdownItem
          v-if="!response.incident_id"
          icon-left="local-fire-department"
          data-test="oncall-response-promote-btn-menu"
          @select="promoteOpen = true"
        >
          {{ t("oncall.promote") }}
        </ODropdownItem>
      </ODropdown>
    </template>

    <template v-if="response">
      <!-- This page is a document, so the body is the scroller; the note box sticks to its foot. -->
      <OContent y class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          v-if="!lgUp"
          class="mb-3 flex flex-wrap items-center gap-2"
          data-test="oncall-response-meta"
        >
          <span class="inline-flex" data-test="oncall-response-state-tag">
            <OTag type="oncallResponseState" :value="response.state" size="sm" />
            <OTooltip v-if="closedAfter" :content="closedAfter" />
          </span>
          <OTag type="alertPriority" :value="`p${response.priority}`" size="sm" />
          <span
            v-if="isOpenState"
            class="flex min-w-32 shrink-[1000] truncate"
            data-test="oncall-response-phrase"
          >
            <OnCallEscalationCell
              :response-id="response.id"
              :record="response"
              :progress="escalation"
              :total-rungs="totalRungs"
              :progress-loaded="escalationLoaded"
              :reached-step="headerReachedStep"
              :team-deleted="teamDeleted"
            />
          </span>
          <OTag
            v-if="isImpacted"
            variant="info-outline"
            size="sm"
            data-test="oncall-response-liaison-tag"
          >
            {{ t("oncall.liaisonTag") }}
          </OTag>
        </div>

        <!-- The one sentence this screen exists to say when it is true:
             nobody has seen this page, and here is why. -->
        <OnCallReachAlarm
          :state="response.state"
          :deliveries="deliveries"
          :deliveries-total="deliveriesTotal"
          :progress="escalation"
          :smtp-configured="smtpConfigured"
          :escalating="escalatingNow"
          :no-team="!response.team_id || teamDeleted"
          :escalatable="canEscalate"
          @escalate="escalateNow"
          @open-reachability="openReachability"
        />

        <OBanner
          v-if="exhaustedAtClock"
          variant="error"
          class="mb-3"
          data-test="oncall-response-exhausted-banner"
        >
          {{ t("oncall.exhaustedBanner", { time: exhaustedAtClock }) }}
        </OBanner>

        <!-- Snoozing does not assign the page, and the banner has to keep
             saying so — a quiet page that looks owned is how one gets dropped. -->
        <OBanner
          v-if="snoozedUntilLabel"
          variant="warning"
          class="mb-3"
          data-test="oncall-response-snoozed-banner"
        >
          {{ t("oncall.snoozedUntil", { time: snoozedUntilLabel }) }}
          <template v-if="canUnsnooze" #actions>
            <OButton
              variant="outline"
              size="sm"
              :loading="snoozing"
              data-test="oncall-response-snoozed-banner-unsnooze"
              @click="unsnoozeRecord"
            >
              <OIcon name="notifications-active" size="sm" />{{ t("oncall.unsnooze") }}
            </OButton>
          </template>
        </OBanner>

        <!-- D-21. This record exists because somebody else's failure reaches
             this team's service. Without saying so, a two-rung ladder that
             stops reads as a broken one, and the team reads its own page as
             an outage it is supposed to fix. -->
        <OBanner
          v-if="isImpacted"
          variant="info"
          class="mb-3"
          data-test="oncall-response-liaison-banner"
        >
          {{ t("oncall.liaisonBanner") }}
          <router-link
            v-if="response.origin_response_id"
            class="text-accent"
            :to="{
              name: 'onCallResponseDetail',
              params: { responseId: response.origin_response_id },
              query: { org_identifier: orgId },
            }"
            data-test="oncall-response-origin-link"
          >
            {{ t("oncall.liaisonOpenOrigin") }}
          </router-link>
        </OBanner>

        <!-- Acknowledge would take the page; Page now wakes rung 1 without waiting for triage. -->
        <OBanner
          v-if="holdSecondsLeft > 0"
          variant="info"
          class="mb-3"
          data-test="oncall-response-hold-banner"
        >
          {{ t("oncall.holdBanner", { n: holdSecondsLeft }) }}
          <template #actions>
            <OButton
              v-if="canEscalate"
              variant="outline"
              size="sm"
              :loading="escalatingNow"
              data-test="oncall-response-hold-page-now"
              @click="escalateNow"
            >
              {{ t("oncall.pageNow") }}
            </OButton>
          </template>
        </OBanner>

        <OStatStrip
          v-if="topStats.length"
          :items="topStats"
          class="mb-4"
          data-test="oncall-response-stats"
        />

        <div class="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4 lg:col-span-2">
            <!-- Renders nothing until a verdict event exists (§G.7) — the
                 default deployment has no agent and must not show an
                 analysis panel that sits empty forever. -->
            <OnCallVerdictCard :events="events" />

            <!-- Not clipped, or the note box could not stick to the scrolling body's foot. -->
            <OCard
              variant="glass"
              class="overflow-visible lg:flex-1"
              data-test="oncall-response-tabs"
            >
              <OCardSection role="body" dense class="lg:flex lg:flex-col">
                <!-- Unclipped, or it becomes the note box's sticky container instead of the page. -->
                <OTabPanels
                  v-model="activeDetailTab"
                  class="overflow-visible! lg:flex lg:flex-1 lg:flex-col"
                >
                  <OTabPanel name="activity" content-class="lg:flex lg:flex-1 lg:flex-col">
                    <div data-test="oncall-response-activity" class="lg:flex lg:flex-1 lg:flex-col">
                      <div v-if="systemActivityCount" class="flex justify-end pt-2">
                        <OButton
                          variant="ghost"
                          size="sm"
                          :icon-left="showAllActivity ? 'visibility-off' : 'visibility'"
                          data-test="oncall-response-activity-toggle-all"
                          @click="showAllActivity = !showAllActivity"
                        >
                          {{
                            showAllActivity
                              ? t("oncall.activityHideSystem")
                              : t("oncall.activityShowSystemCount", { count: systemActivityCount })
                          }}
                        </OButton>
                      </div>
                      <!-- Held until the policy answers, so "(step 1)" is on each line from the first paint. -->
                      <div
                        v-if="!timelineReady"
                        class="flex flex-col gap-4 py-3"
                        data-test="oncall-response-activity-pending"
                      >
                        <OSkeleton v-for="n in 4" :key="n" class="h-4 w-3/4" />
                      </div>
                      <OnCallActivityTimeline
                        v-else
                        :events="events"
                        v-model:comment-text="noteBody"
                        v-model:show-all="showAllActivity"
                        :submitting="addingNote"
                        :opened-at="response.opened_at"
                        :step-of="stepOfRung"
                        :team-name-of="teamNameOf"
                        pin-composer
                        @submit="addNote"
                      />
                    </div>
                  </OTabPanel>

                  <!-- The receipt behind the ladder's claims. -->
                  <OTabPanel name="deliveries">
                    <div data-test="oncall-response-deliveries">
                      <OnCallDeliveryLedger
                        :records="deliveries"
                        :total="deliveriesTotal"
                        :loading="deliveriesLoading"
                      />
                    </div>
                  </OTabPanel>

                  <!-- The history behind the rail's one-line summary. -->
                  <OTabPanel name="causes">
                    <div class="flex flex-col gap-4 py-3" data-test="oncall-response-causes">
                      <OnCallPriorCauses
                        :groups="priorCauses"
                        :loading="priorCausesLoading"
                        @open="openResponse"
                      />
                      <OSeparator />
                      <OnCallFiringHistory
                        :firings="firingHistory"
                        :loading="priorCausesLoading"
                        @open="openResponse"
                      />
                    </div>
                  </OTabPanel>

                  <!-- The working behind the verdict card's one sentence. -->
                  <OTabPanel name="report">
                    <div class="py-3" data-test="oncall-response-report">
                      <OnCallReportCard :report="report" :loading="reportLoading" />
                    </div>
                  </OTabPanel>
                </OTabPanels>
              </OCardSection>
            </OCard>
          </div>

          <div class="flex flex-col gap-4">
            <!-- An unrouted page has no rotation to read, so there is no one to list. -->
            <OnCallWhoIsOn
              v-if="response.team_id"
              :positions="onCallPositions"
              :deliveries="deliveries"
              :handover-at="handoverAt"
              :handover-to="handoverTo"
              :closed-at="response.closed_at"
              :acked-by="response.acked_by"
              :loading="onCallPositionsLoading"
              :team-deleted="teamDeleted"
            />

            <OnCallWhatFired
              v-if="response.subject.subject_type === 'alert' && subjectAlert"
              :alert="subjectAlert"
            />

            <OnCallAboutPage
              :org-id="orgId"
              :team-id="response.team_id"
              :team-name="teamName"
              :team-deleted="teamDeleted"
              :subject-type="response.subject.subject_type"
              :source-id="response.subject.source_id"
              :routing-reason="routingReason"
              :subject-stream="subjectStream"
              :incident-id="response.incident_id"
              :incident-title="incidentTitle"
              :incident-loading="incidentLoading"
              :cause="response.cause"
              :cause-note="response.cause_note"
            />
          </div>
        </div>
      </OContent>
    </template>

    <!-- Ahead of the skeleton: the reads run together, so a slow one must not hold the lock back. -->
    <LicenseDeniedState
      v-else-if="licenseDenied"
      :features="licenseDenied"
      data-test="oncall-response-detail-license-denied"
    />

    <OnCallResponseDetailSkeleton v-else-if="loading" />

    <OContent v-else-if="loadError !== null" y>
      <OEmptyState
        size="hero"
        variant="error"
        illustration="broken-panel"
        :title="t('oncall.loadResponseFailed')"
        :description="raw(loadError)"
        :action-label="t('oncall.retry')"
        data-test="oncall-response-detail-error"
        @action="refreshPage"
      />
    </OContent>

    <!-- Reads return 404 for a deleted page, and "nothing here yet" would suggest it is still coming. -->
    <OContent v-else y>
      <OEmptyState
        size="hero"
        :title="t('oncall.responseNotFoundTitle')"
        :action-label="t('oncall.openPagesList')"
        data-test="oncall-response-detail-not-found"
        @action="openPagesList"
      />
    </OContent>

    <!-- Handing a page to another team clears the ack and re-arms the ladder,
         so it gets room to say so rather than a menu. -->
    <ODrawer
      v-model:open="showHandoff"
      :title="t('oncall.handoffTitle')"
      data-test="oncall-handoff-drawer"
    >
      <div class="flex flex-col gap-4">
        <OToggleGroup v-model="handoffMode">
          <OToggleGroupItem value="person" size="sm" data-test="oncall-handoff-mode-person">
            {{ t("oncall.handoffToPerson") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="team" size="sm" data-test="oncall-handoff-mode-team">
            {{ t("oncall.handoffToTeam") }}
          </OToggleGroupItem>
        </OToggleGroup>

        <p class="text-text-secondary text-sm" data-test="oncall-handoff-hint">
          {{ handoffMode === "team" ? t("oncall.handoffTeamHint") : t("oncall.handoffPersonHint") }}
        </p>

        <OSelect
          v-if="handoffMode === 'person'"
          v-model="handoffPerson"
          :options="memberOptions"
          :label="t('oncall.handoffPerson')"
          clearable
          data-test="oncall-handoff-person-select"
        />
        <OSelect
          v-else
          v-model="handoffTeam"
          :options="teamOptions"
          :label="t('oncall.handoffTeam')"
          clearable
          data-test="oncall-handoff-team-select"
        />
        <OTextarea
          v-model="handoffNote"
          :label="t('oncall.handoffNote')"
          :rows="2"
          data-test="oncall-handoff-note"
        />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="showHandoff = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="handingOff"
            :disabled="!handoffTarget"
            data-test="oncall-handoff-submit"
            @click="handoffRecord"
          >
            {{ t("oncall.handoff") }}
          </OButton>
        </div>
      </template>
    </ODrawer>

    <ODialog
      :open="confirmRecoveryOpen"
      @update:open="(v: boolean) => (confirmRecoveryOpen = v)"
      :title="t('oncall.confirmRecoveryTitle')"
      data-test="oncall-confirm-recovery-dialog"
    >
      <div class="flex flex-col gap-3">
        <p class="text-text-secondary text-sm">{{ t("oncall.confirmRecoveryMessage") }}</p>
        <OInput
          v-model="recoveryNote"
          :label="t('oncall.confirmRecoveryNote')"
          :placeholder="t('oncall.confirmRecoveryNotePlaceholder')"
          data-test="oncall-confirm-recovery-note"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="confirmRecoveryOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="confirmingRecovery"
            data-test="oncall-confirm-recovery-confirm"
            @click="confirmRecovery"
          >
            {{ t("oncall.confirmRecovery") }}
          </OButton>
        </div>
      </template>
    </ODialog>

    <ODialog
      :open="promoteOpen"
      @update:open="(v: boolean) => (promoteOpen = v)"
      :title="t('oncall.promoteTitle')"
      data-test="oncall-promote-dialog"
    >
      <div class="flex flex-col gap-3">
        <p class="text-text-secondary text-sm">{{ t("oncall.promoteMessage") }}</p>

        <OInput
          v-model="promoteTitle"
          :label="t('oncall.promoteIncidentTitle')"
          :placeholder="t('oncall.promoteIncidentTitlePlaceholder')"
          data-test="oncall-promote-title"
        />

        <!-- Only P1 up to this record's own severity is offered. "A promotion
             may raise the severity but must never lower what already woke
             somebody" is an invariant the handler states and does not enforce
             — it takes whatever string it is sent — so the picker is where it
             holds. -->
        <div class="flex flex-col gap-1">
          <span class="text-text-secondary text-xs">{{ t("oncall.promoteSeverity") }}</span>
          <span class="text-text-secondary text-xs">{{ t("oncall.promoteSeverityHint") }}</span>
          <OSelect
            v-model="promoteSeverity"
            :options="severityOptions"
            data-test="oncall-promote-severity"
          />
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="promoteOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="promoting"
            data-test="oncall-promote-confirm"
            @click="promoteRecord"
          >
            {{ t("oncall.promote") }}
          </OButton>
        </div>
      </template>
    </ODialog>

    <ODialog
      :open="confirmResolve"
      @update:open="(v: boolean) => (confirmResolve = v)"
      :title="t('oncall.resolveTitle')"
      data-test="oncall-resolve-dialog"
    >
      <div class="flex flex-col gap-3">
        <!-- Asked here and nowhere else: a cause collected later is never collected. -->
        <OnCallResolveCauseForm
          v-model:cause="resolveCause"
          v-model:note="resolveNote"
          data-test-prefix="oncall-resolve"
        />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="confirmResolve = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="resolving"
            data-test="oncall-resolve-confirm"
            @click="resolveRecord"
          >
            {{ t("oncall.resolve") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import OnCallAboutPage from "@/components/oncall/OnCallAboutPage.vue";
import OnCallDeliveryLedger from "@/components/oncall/OnCallDeliveryLedger.vue";
import OnCallEscalationCell from "@/components/oncall/OnCallEscalationCell.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallReachAlarm from "@/components/oncall/OnCallReachAlarm.vue";
import OnCallWhatFired from "@/components/oncall/OnCallWhatFired.vue";
import OnCallWhoIsOn from "@/components/oncall/OnCallWhoIsOn.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { notAckedToast, pageAckWords, unchangedAckToast } from "@/utils/alerts/ackState";
import OnCallFiringHistory from "@/components/oncall/OnCallFiringHistory.vue";
import OnCallPriorCauses from "@/components/oncall/OnCallPriorCauses.vue";
import OnCallReportCard from "@/components/oncall/OnCallReportCard.vue";
import OnCallActivityTimeline from "@/components/oncall/OnCallActivityTimeline.vue";
import OnCallResolveCauseForm from "@/components/oncall/OnCallResolveCauseForm.vue";
import OnCallVerdictCard from "@/components/oncall/OnCallVerdictCard.vue";
import OnCallResponseDetailSkeleton from "./OnCallResponseDetailSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import analytics from "@/services/product_analytics";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import alertsService from "@/services/alerts";
import { alertKeys } from "@/services/alerts.querykeys";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { readQuery } from "@/composables/query/readQuery";
import {
  acknowledgeResponseMutation,
  takeOverResponseMutation,
  unacknowledgeResponseMutation,
  addResponseNoteMutation,
  confirmRecoveryMutation,
  escalateNowMutation,
  handoffResponseMutation,
  oncallTeamQuery,
  oncallTeamsQuery,
  promoteResponseMutation,
  resolveResponseMutation,
  resolvedScheduleQuery,
  responseDeliveriesQuery,
  responseHistoryQuery,
  responsePriorCausesQuery,
  responseProgressQuery,
  responseQuery,
  responseReportQuery,
  snoozeResponseMutation,
  unsnoozeResponseMutation,
  teamMembersQuery,
  teamPolicyQuery,
  teamReachabilityQuery,
  whoIsOnCallQuery,
} from "@/services/oncall.queries";
import { oncallKeys } from "@/services/oncall.querykeys";
import { incidentQuery } from "@/services/incidents.queries";

import type {
  DeliveryRecord,
  CauseGroup,
  EscalateResult,
  EscalationProgress,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallResponseReport,
  OnCallPosition,
  PromoteSeverity,
  ResolutionCause,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import {
  apiErrorMessage,
  apiErrorStatus,
  apiErrorText,
  DEFAULT_ACTIVITY_KINDS,
  formatOnCallInstant,
  isDeletedTeam,
  isEscalating,
  isSnoozed,
  isUnresolved,
  pagePhrase,
  pageState,
  promoteSeverityFloor,
  promoteSeverityOptions,
  reachedStepOf,
  routingReasonOf,
} from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";
import { formatTimestampInTimezone } from "@/utils/date";

const HOLD_RECHECK_MS = 10_000;
/// Re-reads of a lapsed rung before giving up: a minute at HOLD_RECHECK_MS.
const LAPSE_RECHECKS = 6;
// Every verb inline takes about 56rem, which below this leaves the title a few letters wide.
const INLINE_VERBS_QUERY = "(min-width: 96rem)";

const { t } = useI18nTyped();
const { tooltipOf } = useOrgUserNames();
const { lgUp } = useBreakpoint();
const inlineVerbsMql =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(INLINE_VERBS_QUERY)
    : null;
const wideHeader = ref(inlineVerbsMql?.matches ?? true);
const onWideHeader = (e: MediaQueryListEvent) => (wideHeader.value = e.matches);
inlineVerbsMql?.addEventListener?.("change", onWideHeader);
onBeforeUnmount(() => inlineVerbsMql?.removeEventListener?.("change", onWideHeader));
const inlineVerbs = computed(() => lgUp.value && wideHeader.value);
const nowMicros = useOnCallClock();
const store = useStore();
const route = useRoute();
const router = useRouter();

const response = ref<OnCallResponse | null>(null);
const events = ref<OnCallResponseEvent[]>([]);
const systemActivityCount = computed(
  () => events.value.filter((e) => !DEFAULT_ACTIVITY_KINDS.includes(e.kind)).length,
);
const teamName = ref("");
/// Ids of the teams that exist, `null` until the list has answered.
const knownTeamIds = ref<string[] | null>(null);
const teamDeleted = computed(() => isDeletedTeam(response.value?.team_id, knownTeamIds.value));
const loading = ref(false);
/// Set only when a load fails with nothing on screen; a 404 leaves it null and reads as not found.
const loadError = ref<string | null>(null);
const licenseDenied = ref<string[] | null>(null);
const resolving = ref(false);
const confirmRecoveryOpen = ref(false);
const confirmingRecovery = ref(false);
const recoveryNote = ref("");

/// An impacted record was opened alongside another team's page to contain the
/// blast radius on THIS team's service. The role is always on the wire and the
/// origin id says the same thing (§ "UI rule"); either one is enough, and an
/// older record written before the role column is still readable.
const isImpacted = computed(
  () => response.value?.responder_role === "impacted" || !!response.value?.origin_response_id,
);

/// The dependent's close. The owner's record closes on its own once the last
/// dependent has confirmed — which may be this call.
async function confirmRecovery() {
  confirmingRecovery.value = true;
  try {
    await recoveryWrite.mutateAsync({
      responseId: responseId.value,
      note: recoveryNote.value.trim() || undefined,
    });
    confirmRecoveryOpen.value = false;
    recoveryNote.value = "";
    toast({ variant: "success", message: t("oncall.recoveryConfirmed") });
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.confirmRecoveryFailed"),
    });
  } finally {
    confirmingRecovery.value = false;
  }
}
const promoteOpen = ref(false);
const promoting = ref(false);
const promoteTitle = ref("");
const promoteSeverity = ref<PromoteSeverity>("P4");

/// What a promotion may be set to on THIS record, most severe first, floored
/// at its own priority.
const severityOptions = computed(() =>
  promoteSeverityOptions(response.value?.priority ?? 5).map((severity) => ({
    label: raw(severity),
    value: severity,
  })),
);

/// The record's own severity is the default: the wire derives exactly this
/// when no severity is sent, so the picker opens on the answer rather than on
/// an empty box somebody has to fill in mid-incident.
watch(promoteOpen, (open) => {
  if (!open || !response.value) return;
  promoteTitle.value = response.value.title || "";
  promoteSeverity.value = promoteSeverityFloor(response.value.priority);
});

/// Makes an incident out of a page that turned out to be one. The refusal path
/// matters as much as the success one: a 409 means somebody else promoted this
/// record while this dialog was open, so the record is refetched and the rail's
/// incident link is what the responder sees next.
async function promoteRecord() {
  promoting.value = true;
  try {
    const res = await promoteWrite.mutateAsync({
      responseId: responseId.value,
      data: {
        ...(promoteTitle.value.trim() ? { title: promoteTitle.value.trim() } : {}),
        severity: promoteSeverity.value,
      },
    });
    promoteOpen.value = false;
    toast({
      variant: "success",
      message: t("oncall.promoted", { incident: res.data.incident_id }),
    });
    await fetchResponse();
  } catch (err: unknown) {
    promoteOpen.value = false;
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.promoteFailed"),
    });
    // A refused write expires nothing, so only a forced read shows whose incident won.
    if (apiErrorStatus(err) === 409) await fetchResponse(true);
  } finally {
    promoting.value = false;
  }
}

const acking = ref(false);
const snoozing = ref(false);
const addingNote = ref(false);
const handingOff = ref(false);
const confirmResolve = ref(false);
const showHandoff = ref(false);
const escalatingNow = ref(false);

const noteBody = ref("");
/// Engine bookkeeping stays folded until asked for; the default feed is what people and the ladder did.
const showAllActivity = ref(false);
/// Activity, deliveries and prior causes as tabs of one card rather than a
/// card plus two collapsibles — the toggle-all button in the header only
/// makes sense while activity is the one showing.
const activeDetailTab = ref("activity");
const resolveCause = ref<ResolutionCause | "">("");
const resolveNote = ref("");
const priorCauses = ref<CauseGroup[]>([]);
const firingHistory = ref<OnCallResponse[]>([]);
const priorCausesLoading = ref(false);
const report = ref<OnCallResponseReport | null>(null);
const reportLoading = ref(false);
/// Only the fields the page shows; the condition shapes stay opaque because only `alertConditionText` reads them.
const subjectAlert = ref<{
  name?: string;
  stream_name?: string;
  stream_type?: string;
  query_condition?: unknown;
  condition?: unknown;
  trigger_condition?: unknown;
} | null>(null);
/// True once the alert lookup answers 404: the page outlived its alert, and the server can no longer release it.
const subjectAlertMissing = ref(false);
/// Why the last Unacknowledge left the page held; cleared when another page loads.
const unackRefusedReason = ref<I18nText | null>(null);
const unackBlockedReason = computed<I18nText | null>(() =>
  subjectAlertMissing.value ? t("oncall.unackAlertDeleted") : unackRefusedReason.value,
);
const escalation = ref<EscalationProgress | null>(null);
/// False until the progress has answered, so the header makes no paging claim from a missing value.
const escalationLoaded = ref(false);
/// Who a page to this team reaches right now, and where the pager goes next.
const onCallPositions = ref<OnCallPosition[]>([]);
const onCallPositionsLoading = ref(false);
const handoverAt = ref<number | null>(null);
const handoverTo = ref<string | null>(null);
/// The team's own policy, for the one thing progress cannot say: what the
/// ladder does after its last rung.
const policy = ref<OnCallPolicy | null>(null);
/// `false` is the server's finding that no mail can leave this deployment —
/// the usual reason every row of the ledger failed. `null` is "not answered",
/// which is not the same thing and must never be rendered as a cause.
const smtpConfigured = ref<boolean | null>(null);
const handoffMode = ref<"person" | "team">("person");
const handoffPerson = ref("");
const handoffTeam = ref("");
const handoffNote = ref("");
const memberOptions = ref<{ label: I18nText; value: string }[]>([]);
const teamOptions = ref<{ label: I18nText; value: string }[]>([]);
const teamNamesById = ref<Record<string, string>>({});
/// The incident's own title for the rail link; the id until it answers, or when the read fails.
const incidentTitle = ref<string | null>(null);
/// True from the record's arrival until its incident's title answers, so the id never flashes first.
const incidentLoading = ref(true);
/// The timeline waits for the policy that numbers its steps, then never goes back to waiting.
const timelineReady = ref(false);

// Round numbers a half-awake person can pick without doing arithmetic.
const snoozeOptions = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 180, label: "3 h" },
];

const orgId = computed(() => store.state.selectedOrganization.identifier);
const responseId = computed(() => String(route.params.responseId ?? ""));

// The id rides in the variables: the origin link swaps it under a reused instance.
const resolveWrite = useMutation(() => resolveResponseMutation(orgId.value));
const ackWrite = useMutation(() => acknowledgeResponseMutation(orgId.value));
const takeOverWrite = useMutation(() => takeOverResponseMutation(orgId.value));
const unackWrite = useMutation(() => unacknowledgeResponseMutation(orgId.value));
const me = computed(() => store.state.userInfo?.email);
const ackWords = computed(() =>
  pageAckWords(
    response.value?.team_id ? teamName.value : "",
    response.value?.subject.subject_type ?? "alert",
    t,
  ),
);
const snoozeWrite = useMutation(() => snoozeResponseMutation(orgId.value));
const unsnoozeWrite = useMutation(() => unsnoozeResponseMutation(orgId.value));
const noteWrite = useMutation(() => addResponseNoteMutation(orgId.value));
const handoffWrite = useMutation(() => handoffResponseMutation(orgId.value));
const recoveryWrite = useMutation(() => confirmRecoveryMutation(orgId.value));
const promoteWrite = useMutation(() => promoteResponseMutation(orgId.value));
const escalateWrite = useMutation(() => escalateNowMutation(orgId.value));

const title = computed(() =>
  response.value
    ? raw(response.value.title || response.value.subject.source_id)
    : t("oncall.responseDetail"),
);

// Every action hangs off this. It asks "is this still somebody's problem",
// not "is the ladder running" — an acknowledged page still needs resolving.
const isOpenState = computed(() => !!response.value && isUnresolved(response.value.state));

/// How long a closed page stayed open, said on hover of its state tag.
const closedAfter = computed(() => {
  const r = response.value;
  if (!r?.closed_at || isOpenState.value) return null;
  return t("oncall.resolvedAfter", { duration: formatMicrosDuration(r.closed_at - r.opened_at) });
});

/// Only an escalating page can be claimed. Once it is owned, Acknowledge and
/// Snooze are gone and Resolve becomes the primary action.
const canAcknowledge = computed(() => !!response.value && isEscalating(response.value.state));

/// Whether the compact header's menu has anything in it: a closed page already tied to an incident has no verb left.
const hasMoreActions = computed(() => isOpenState.value || !response.value?.incident_id);

/// The server refuses Escalate and Snooze on a page with no team (AK-4); a deleted team's ladder reaches nobody, so Escalate goes there too.
const canEscalate = computed(() => !!response.value?.team_id && !teamDeleted.value);
const canSnooze = computed(() => canAcknowledge.value && !!response.value?.team_id);

/// Where the team-name link in the subtitle goes — same target and tab
/// OnCallAboutPage's own team row links to, so the two agree on what
/// clicking the team means.
const teamRoute = computed(() => ({
  name: "onCallTeamDetail",
  params: { teamId: response.value?.team_id ?? "", tab: "overview" },
  query: { org_identifier: orgId.value },
}));

/// Clock time, not "N ago" — the elapsed duration is already said once, beside
/// the title tags, and repeating it here as "opened 2 hours ago" would just be
/// the same fact twice in two words.
const openedAtClock = computed(() => {
  const r = response.value;
  if (!r) return "";
  return formatTimestampInTimezone(r.opened_at, "HH:mm", store.state.timezone);
});

/// Rungs the team's policy defines for this priority, `null` when the policy could not be read.
const totalRungs = computed(
  () =>
    policy.value?.rungs.find((rung) => rung.priority === response.value?.priority)?.steps.length ??
    null,
);

/// The record's own step, so the header says something true before the ladder's progress has answered.
const headerReachedStep = computed(() =>
  reachedStepOf(
    policy.value?.rungs.find((rung) => rung.priority === response.value?.priority)?.steps,
    response.value?.reached_rung_micros,
  ),
);

/// The subtitle's separator waits for a phrase, so an unanswered ladder leaves no dangling dot.
const headerPhraseKind = computed(() =>
  response.value
    ? pagePhrase({
        record: response.value,
        progress: escalation.value,
        progressLoaded: escalationLoaded.value,
        totalRungs: totalRungs.value,
        reachedStep: headerReachedStep.value,
        nowMicros: nowMicros.value,
      }).kind
    : "unknown",
);

// The same progress decides the header tag; the time is the last step's, which the record's flag lags.
const exhaustedAtClock = computed(() => {
  const r = response.value;
  if (!r || pageState(r, escalation.value) !== "exhausted") return "";
  const lastStepAt = escalation.value?.fired.at(-1)?.at ?? r.exhausted_at;
  if (!lastStepAt) return "";
  return formatOnCallInstant(lastStepAt, nowMicros.value, store.state.timezone);
});

/// Whole seconds until the triage hold releases the first page; 0 once it has, or when there is none.
const holdSecondsLeft = computed(() => {
  const until = escalation.value?.held_until_micros;
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - nowMicros.value) / 1_000_000));
});

/// The policy's steps for this page's priority, `null` when the policy could not be read.
const prioritySteps = computed(
  () =>
    policy.value?.rungs.find((rung) => rung.priority === response.value?.priority)?.steps ?? null,
);

/// The 1-based step a rung delay belongs to, so the timeline says "step 2" rather than a delay.
function stepOfRung(rungMicros: number): number | null {
  return reachedStepOf(prioritySteps.value, rungMicros);
}

function teamNameOf(teamId: string): string | null {
  return teamNamesById.value[teamId] ?? null;
}

/// Only facts the header does not already say: the duration of a closed page rides the title, so it is not repeated here.
const topStats = computed<StatItem[]>(() => {
  const r = response.value;
  if (!r) return [];
  const stats: StatItem[] = [];
  if (r.acked_at) {
    stats.push({
      key: "ack",
      label: t("oncall.statAckedIn"),
      value: formatMicrosDuration(r.acked_at - r.opened_at),
      icon: "check-circle",
      tone: "success",
      dataTest: "oncall-response-stat-ack",
    });
  } else if (!r.closed_at) {
    stats.push({
      key: "ack",
      label: t("oncall.statUnackedFor"),
      value: formatMicrosDuration(nowMicros.value - r.opened_at),
      icon: "schedule",
      tone: "warning",
      dataTest: "oncall-response-stat-ack",
    });
  }
  if (firingHistory.value.length) {
    stats.push({
      key: "firing",
      label: t("oncall.statFiredBefore"),
      value: t(
        "oncall.statTimes",
        { count: firingHistory.value.length },
        firingHistory.value.length,
      ),
      icon: "replay",
      tone: "neutral",
      dataTest: "oncall-response-stat-firing",
    });
  }
  return stats;
});

const routingReason = computed(() => routingReasonOf(events.value));

/// Which stream the rule watches — context the record does not carry and the
/// page had nowhere else to get.
const subjectStream = computed(() => {
  const alert = subjectAlert.value;
  if (!alert?.stream_name) return null;
  return alert.stream_type ? `${alert.stream_name} (${alert.stream_type})` : alert.stream_name;
});

const handoffTarget = computed(() =>
  handoffMode.value === "person" ? handoffPerson.value : handoffTeam.value,
);

// Only while it is actually in the future — a lapsed snooze is not a state,
// and leaving the banner up would say the page is quiet when it is escalating.
const snoozedUntilLabel = computed(() => {
  const r = response.value;
  if (!r || !isSnoozed(r)) return "";
  return formatOnCallInstant(r.snoozed_until as number, nowMicros.value, store.state.timezone);
});
const canUnsnooze = computed(() => canSnooze.value && !!snoozedUntilLabel.value);

// Any on-call read can carry the denial, because the others may be answered from cache; the callers still see the error.
const read: typeof readQuery = (options, force) =>
  readQuery(options, force).catch((err: unknown) => {
    const denied = licenseDeniedFeatures(err);
    if (denied) {
      licenseDenied.value = denied;
      // Clearing these takes off the record's actions and the progress rechecks; the server would refuse each one.
      response.value = null;
      escalation.value = null;
      // A lock drawn behind an open form would be out of sight, and saving there can only be refused.
      showHandoff.value = false;
      confirmRecoveryOpen.value = false;
      promoteOpen.value = false;
      confirmResolve.value = false;
    }
    throw err;
  });

// The newest read: a slower record for an id the route has already left must not overwrite the current one.
let latestResponseRead = 0;

type ReadGuard = () => boolean;

/// True while no newer record read has started and no read was denied; every page read checks it before it writes.
function readGuard(readId = latestResponseRead): ReadGuard {
  return () => readId === latestResponseRead && !licenseDenied.value;
}

// `force` reaches the record alone — it is the only thing a promote conflict moved.
async function fetchResponse(force = false) {
  loading.value = true;
  loadError.value = null;
  licenseDenied.value = null;
  const readId = ++latestResponseRead;
  const isCurrent = readGuard(readId);
  try {
    const data = await read(responseQuery(orgId.value, responseId.value), force);
    if (!isCurrent()) return;
    response.value = data?.response ?? null;
    events.value = data?.events ?? [];
    lastFetchedAt.value =
      queryClient.getQueryState(responseQuery(orgId.value, responseId.value).queryKey)
        ?.dataUpdatedAt ?? null;
    // Flip before the awaits below so the card skeletons instead of reading an empty roster as "nobody on call".
    onCallPositionsLoading.value = true;
    // The team list first: it says whether the team still exists, and a deleted one has nothing else to read.
    await fetchTeams(isCurrent);
    if (!isCurrent()) return;
    await Promise.all([
      fetchTeamName(isCurrent),
      fetchSubjectAlert(isCurrent),
      fetchHandoffTargets(isCurrent),
      fetchPriorCauses(isCurrent),
      fetchReport(isCurrent),
      fetchEscalation(false, isCurrent),
      fetchDeliveries(isCurrent),
      fetchTeamContext(isCurrent),
      fetchIncidentTitle(isCurrent),
    ]);
  } catch (err: unknown) {
    if (!isCurrent()) return;
    if (!response.value) {
      if (apiErrorStatus(err) !== 404) loadError.value = apiErrorText(err);
      return;
    }
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.loadResponseFailed"),
    });
  } finally {
    if (readId === latestResponseRead) loading.value = false;
  }
}

const refreshing = ref(false);
const lastFetchedAt = ref<number | null>(null);

/// Expires every read first, because `fetchResponse`'s own force reaches the record alone.
async function refreshPage() {
  refreshing.value = true;
  try {
    await queryClient.invalidateQueries({
      queryKey: oncallKeys.all(orgId.value),
      refetchType: "none",
    });
    await fetchResponse();
  } finally {
    refreshing.value = false;
  }
}

/// The org's teams: whether this page's team still exists, its name, and where it can be handed.
async function fetchTeams(isCurrent: ReadGuard) {
  try {
    const teams = await read(oncallTeamsQuery(orgId.value), false);
    if (!isCurrent()) return;
    knownTeamIds.value = teams.map((tm) => tm.id);
    teamNamesById.value = Object.fromEntries(teams.map((tm) => [tm.id, tm.name]));
  } catch {
    if (isCurrent()) knownTeamIds.value = null;
  }
}

// Never the raw id: the name from the list, else the team's own read, else a dash.
async function fetchTeamName(isCurrent: ReadGuard) {
  const teamId = response.value?.team_id;
  if (!teamId || teamDeleted.value) return;
  const listed = teamNamesById.value[teamId];
  if (listed) {
    teamName.value = listed;
    return;
  }
  try {
    const team = await read(oncallTeamQuery(orgId.value, teamId), false);
    if (isCurrent()) teamName.value = team?.name || "—";
  } catch {
    if (isCurrent()) teamName.value = "—";
  }
}

async function resolveRecord() {
  confirmResolve.value = false;
  resolving.value = true;
  try {
    await resolveWrite.mutateAsync({
      responseId: responseId.value,
      cause: resolveCause.value || undefined,
      causeNote: resolveNote.value.trim() || undefined,
    });
    analytics.track("oncall_page_resolved", { cause: resolveCause.value || "none", count: 1 });
    toast({ variant: "success", message: t("oncall.resolved") });
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.resolveFailed"),
    });
  } finally {
    resolving.value = false;
  }
}

/// A press that changed nothing on a closed page says so; nobody acknowledged it then (ack, take over).
function resolvedToast(page: OnCallResponse, unheld: boolean) {
  const closed = !!page.closed_at || !isUnresolved(page.state);
  return closed && (!unheld || !page.acked_by)
    ? { variant: "info" as const, message: t("oncall.alreadyResolved") }
    : null;
}

async function acknowledgeRecord() {
  acking.value = true;
  try {
    const res = await ackWrite.mutateAsync(responseId.value);
    analytics.track("oncall_page_acknowledged", { count: 1 });
    toast(
      res.data.ack?.changed === false
        ? (resolvedToast(res.data, true) ?? unchangedAckToast(res.data.acked_by, me.value, t))
        : { variant: "success", message: ackWords.value.acked },
    );
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.acknowledgeFailed"),
    });
  } finally {
    acking.value = false;
  }
}

async function takeOverRecord() {
  const from = response.value?.acked_by ?? "";
  acking.value = true;
  try {
    const res = await takeOverWrite.mutateAsync(responseId.value);
    toast(
      res.data.ack?.changed === false
        ? (resolvedToast(res.data, true) ?? unchangedAckToast(res.data.acked_by, me.value, t))
        : { variant: "success", message: t("oncall.tookOver", { who: raw(from) }) },
    );
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.acknowledgeFailed"),
    });
  } finally {
    acking.value = false;
  }
}

async function unacknowledgeRecord() {
  acking.value = true;
  try {
    const res = await unackWrite.mutateAsync(responseId.value);
    // The server answers 200 unchanged when it cannot find the alert to release, so the page stays held.
    const stillHeld = res.data.ack?.changed === false && res.data.state === "acknowledged";
    const refused = subjectAlertMissing.value
      ? t("oncall.unackAlertDeleted")
      : t("oncall.unackRefused");
    if (stillHeld) unackRefusedReason.value = refused;
    toast(
      stillHeld
        ? { variant: "warning", message: refused }
        : res.data.ack?.changed === false
          ? (resolvedToast(res.data, false) ??
            notAckedToast(res.data.title || res.data.subject.source_id, t))
          : { variant: "success", message: ackWords.value.unacked },
    );
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.unacknowledgeFailed"),
    });
  } finally {
    acking.value = false;
  }
}

async function snoozeRecord(minutes: number) {
  snoozing.value = true;
  try {
    await snoozeWrite.mutateAsync({ responseId: responseId.value, minutes });
    toast({ variant: "success", message: t("oncall.snoozed") });
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.snoozeFailed"),
    });
  } finally {
    snoozing.value = false;
  }
}

async function unsnoozeRecord() {
  snoozing.value = true;
  try {
    await unsnoozeWrite.mutateAsync(responseId.value);
    toast({ variant: "success", message: t("oncall.unsnoozed") });
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.unsnoozeFailed"),
    });
  } finally {
    snoozing.value = false;
  }
}

async function addNote() {
  const body = noteBody.value.trim();
  if (!body) return;
  addingNote.value = true;
  try {
    await noteWrite.mutateAsync({ responseId: responseId.value, body });
    noteBody.value = "";
    toast({ variant: "success", message: t("oncall.noteAdded") });
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.addNoteFailed"),
    });
  } finally {
    addingNote.value = false;
  }
}

async function handoffRecord() {
  if (!handoffTarget.value) {
    toast({ variant: "error", message: t("oncall.handoffPickOne") });
    return;
  }
  handingOff.value = true;
  try {
    await handoffWrite.mutateAsync({
      responseId: responseId.value,
      to: handoffMode.value === "person" ? handoffPerson.value : undefined,
      toTeamId: handoffMode.value === "team" ? handoffTeam.value : undefined,
      note: handoffNote.value.trim() || undefined,
    });
    showHandoff.value = false;
    handoffPerson.value = "";
    handoffTeam.value = "";
    handoffNote.value = "";
    toast({ variant: "success", message: t("oncall.handoffDone") });
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.handoffFailed"),
    });
  } finally {
    handingOff.value = false;
  }
}

// Handoff targets. Failing to load them leaves the selects empty rather than
// breaking the page — every other action still works.
async function fetchHandoffTargets(isCurrent: ReadGuard) {
  const r = response.value;
  if (!r) return;
  // An unrouted page or a deleted team has no members to hand to, but the team list still offers a team.
  const teamId = teamDeleted.value ? null : r.team_id;
  try {
    const members = teamId ? await read(teamMembersQuery(orgId.value, teamId), false) : [];
    if (!isCurrent()) return;
    // Names can repeat, so the email rides along in the option itself.
    memberOptions.value = members.map((m) => ({
      label: tooltipOf(m.user_email),
      value: m.user_email,
    }));
  } catch {
    if (!isCurrent()) return;
    memberOptions.value = [];
  }
  teamOptions.value = Object.entries(teamNamesById.value)
    .filter(([id]) => id !== r.team_id)
    .map(([id, name]) => ({ label: raw(name), value: id }));
}

/// Only alerts have a rule to fetch, and a page whose alert has since been
/// deleted must still render — the record is the authority on what happened,
/// the alert only decorates it.
// Uncached: the page links to the alert editor, which seeds its form from the cached alert entry.
async function fetchSubjectAlert(isCurrent: ReadGuard) {
  subjectAlert.value = null;
  subjectAlertMissing.value = false;
  if (response.value?.subject.subject_type !== "alert") return;
  const alertId = response.value.subject.source_id;
  if (cachedAlertMissing(alertId, response.value.opened_at)) {
    subjectAlertMissing.value = true;
    return;
  }
  try {
    const res = await alertsService.get_by_alert_id(orgId.value, alertId);
    if (isCurrent()) subjectAlert.value = res.data ?? null;
  } catch (err: unknown) {
    if (!isCurrent()) return;
    subjectAlert.value = null;
    subjectAlertMissing.value = apiErrorStatus(err) === 404;
  }
}

/// Only an org-wide list already cached since the page opened can say the alert is gone; anything else asks the alert itself.
function cachedAlertMissing(alertId: string, openedAt: number): boolean {
  const key = alertKeys.dependencies(orgId.value);
  const list = queryClient.getQueryData<{ alert_id?: string }[]>(key);
  const fetchedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
  if (!Array.isArray(list) || fetchedAt * 1000 < openedAt) return false;
  return !list.some((alert) => alert.alert_id === alertId);
}

async function fetchIncidentTitle(isCurrent: ReadGuard) {
  const incidentId = response.value?.incident_id;
  if (!incidentId) {
    incidentTitle.value = null;
    incidentLoading.value = false;
    return;
  }
  try {
    const incident = await readQuery(incidentQuery(orgId.value, incidentId), false);
    if (isCurrent()) incidentTitle.value = incident?.title ?? null;
  } catch {
    // The rail falls back to the id; Incidents has its own license feature, so a denial here does not lock this page.
  } finally {
    if (isCurrent()) incidentLoading.value = false;
  }
}

// History is context, not the page itself: failing to load it must not stop a
// responder acting on what is in front of them. The two calls are independent,
// so one server without the history route still leaves the causes readable.
async function fetchPriorCauses(isCurrent: ReadGuard) {
  priorCausesLoading.value = true;
  try {
    const [causeRes, historyRes] = await Promise.allSettled([
      read(responsePriorCausesQuery(orgId.value, responseId.value), false),
      read(responseHistoryQuery(orgId.value, responseId.value), false),
    ]);
    if (!isCurrent()) return;
    priorCauses.value = causeRes.status === "fulfilled" ? causeRes.value : [];
    firingHistory.value = historyRes.status === "fulfilled" ? historyRes.value : [];
  } finally {
    if (isCurrent()) priorCausesLoading.value = false;
  }
}

// 404 is the ordinary answer — no agent ran, or it never answered — so a
// failure here leaves the tab hidden rather than surfacing an error.
async function fetchReport(isCurrent: ReadGuard) {
  reportLoading.value = true;
  try {
    const next = await read(responseReportQuery(orgId.value, responseId.value), false);
    if (isCurrent()) report.value = next;
  } catch {
    if (isCurrent()) report.value = null;
  } finally {
    if (isCurrent()) reportLoading.value = false;
  }
}

// Context, like the history: a failure here must not stop somebody acting on
// the page in front of them.
const deliveries = ref<DeliveryRecord[]>([]);
const deliveriesTotal = ref(0);
const deliveriesLoading = ref(false);

/// The receipt beside the claim: the timeline says "paged ana", the ledger
/// says whether the transport took it. A failure leaves the panel empty with
/// its own empty state — the rest of the page still answers its questions.
async function fetchDeliveries(isCurrent: ReadGuard) {
  deliveriesLoading.value = true;
  try {
    const ledger = await read(responseDeliveriesQuery(orgId.value, responseId.value), false);
    if (!isCurrent()) return;
    deliveries.value = ledger?.deliveries ?? [];
    deliveriesTotal.value = ledger?.total ?? 0;
  } catch {
    if (!isCurrent()) return;
    deliveries.value = [];
    deliveriesTotal.value = 0;
  } finally {
    if (isCurrent()) deliveriesLoading.value = false;
  }
}

/**
 * The rail's four answers — who is on, when the pager changes hands, what the
 * ladder does at the end, and whether mail can leave this deployment.
 *
 * Every one is context. A page a responder can act on must render when all
 * four fail, so nothing here is allowed to throw and none of it gates the
 * record.
 */
async function fetchTeamContext(isCurrent: ReadGuard) {
  try {
    await readTeamContext(isCurrent);
  } finally {
    if (isCurrent()) timelineReady.value = true;
  }
}

async function readTeamContext(isCurrent: ReadGuard) {
  const r = response.value;
  if (!r) return;
  const teamId = r.team_id;
  // A deleted team has no rotation to read; asking only retries a 404 while the card waits.
  if (!teamId || teamDeleted.value) {
    onCallPositions.value = [];
    policy.value = null;
    smtpConfigured.value = null;
    onCallPositionsLoading.value = false;
    return;
  }
  onCallPositionsLoading.value = true;
  try {
    const [slots, policyRes, reach] = await Promise.allSettled([
      // A closed record asks about its own last moment — the live rotation is not its history.
      read(whoIsOnCallQuery(orgId.value, teamId, r.closed_at ?? undefined), false),
      read(teamPolicyQuery(orgId.value, teamId), false),
      read(teamReachabilityQuery(orgId.value, teamId), false),
    ]);
    if (!isCurrent()) return;
    onCallPositions.value = slots.status === "fulfilled" ? slots.value : [];
    policy.value = policyRes.status === "fulfilled" ? policyRes.value : null;
    smtpConfigured.value =
      reach.status === "fulfilled" ? (reach.value?.smtp_configured ?? null) : null;
    await fetchHandover(isCurrent);
  } finally {
    if (isCurrent()) onCallPositionsLoading.value = false;
  }
}

/// When the default slot's current span ends, and who inherits it. The
/// on-call payload names the next person but not the hour, and a page still
/// open at handover is one somebody inherits without being told.
async function fetchHandover(isCurrent: ReadGuard) {
  handoverAt.value = null;
  handoverTo.value = null;
  const r = response.value;
  if (!r?.team_id) return;
  // Who inherits the pager next is advice for a page somebody still has to
  // carry. On a closed one it is a fact about next week's rota that nobody
  // opened this record to read.
  if (r.closed_at) return;
  const from = nowMicros.value;
  const to = from + 7 * 24 * 60 * 60 * 1_000_000;
  try {
    const resolved = await read(resolvedScheduleQuery(orgId.value, r.team_id, from, to), false);
    if (!isCurrent()) return;
    const segments = [...resolved].sort((a, b) => a.from - b.from);
    const currentIndex = segments.findIndex((seg) => seg.from <= from && seg.to > from);
    if (currentIndex < 0) return;
    handoverAt.value = segments[currentIndex].to;
    // A gap after the current shift is a real answer — the pager goes to
    // nobody — so the name is left unset rather than skipped forward.
    handoverTo.value = segments[currentIndex + 1]?.user_email ?? null;
  } catch {
    // A team with no resolved schedule simply has no handover row.
  }
}

/// What the escalation actually did, from the response the verb already sends.
///
/// "Escalated" alone is a claim; the person who pressed it wants to know which
/// phone is ringing. The 200 body carries `recipients`, `chased` (reached again
/// although a page had already landed on them) and `deduplicated` (skipped for
/// the same reason), and all four fields were being thrown away for a fixed
/// sentence.
///
/// `ladder_exhausted` arrives as a 200, deliberately — "there is nobody above
/// you" is an answer, not a failure — so it is said plainly rather than as an
/// error, which would read as though the press failed and invite a second one.
/// It is not a success either: nothing advanced, so the toast reports it as
/// `info` rather than reusing the green checkmark a real escalation gets.
function escalateOutcome(result: EscalateResult | undefined): {
  variant: "success" | "info";
  message: I18nText;
} {
  if (result?.escalated_to === "ladder_exhausted") {
    return { variant: "info", message: t("oncall.escalateExhausted", { team: teamName.value }) };
  }
  const reached = result?.escalated_to === "rung" ? result.recipients : [];
  if (!reached.length) {
    // A rung that resolved to nobody is a real outcome and the one worth
    // saying loudest: the ladder moved and no phone rang.
    return { variant: "success", message: t("oncall.escalatedNobody", { team: teamName.value }) };
  }
  return {
    variant: "success",
    message: t("oncall.escalatedTo", {
      team: teamName.value,
      who: raw(reached.join(", ")),
    }),
  };
}

/// Wakes the next rung now instead of when the timer says so. Ownership does
/// not move — this is asking for more hands, which is what separates it from
/// a handoff.
async function escalateNow() {
  escalatingNow.value = true;
  try {
    const res = await escalateWrite.mutateAsync({ responseId: responseId.value });
    toast(escalateOutcome(res.data));
    await fetchResponse();
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.escalateFailed"),
    });
  } finally {
    escalatingNow.value = false;
  }
}

/// The two rail links out. Both land on the tab that answers the question the
/// reader had when they clicked, rather than on the team's front page.
function openReachability() {
  if (!response.value?.team_id) return;
  router.push({
    name: "onCallTeamDetail",
    params: { teamId: response.value.team_id, tab: "members" },
    query: { org_identifier: orgId.value },
  });
}

async function fetchEscalation(force = false, isCurrent: ReadGuard = readGuard()) {
  try {
    const progress = await read(responseProgressQuery(orgId.value, responseId.value), force);
    if (!isCurrent()) return;
    escalation.value = progress;
    // An empty body is no answer, so the header makes no paging claim from it.
    escalationLoaded.value = progress !== null;
  } catch {
    if (!isCurrent()) return;
    escalation.value = null;
    escalationLoaded.value = false;
  }
}

/// Re-reads the record and its events, so the rung card and activity agree with a newer progress.
async function refreshRecord() {
  const id = responseId.value;
  try {
    const data = await read(responseQuery(orgId.value, id), true);
    if (!data?.response || id !== responseId.value || licenseDenied.value) return;
    response.value = data.response;
    events.value = data.events ?? [];
  } catch (err: unknown) {
    if (id !== responseId.value || licenseDenied.value) return;
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.loadResponseFailed"),
    });
  }
}

/// A failed re-read keeps the last good progress, so the hold banner and its polling survive until the next tick.
async function recheckProgress() {
  const isCurrent = readGuard();
  try {
    const progress = await read(responseProgressQuery(orgId.value, responseId.value), true);
    if (isCurrent()) escalation.value = progress;
  } catch {
    // The next tick retries.
  }
}

function openPagesList() {
  router.push({ name: "onCallResponses", query: { org_identifier: orgId.value } });
}

function openResponse(id: string) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: id },
    query: { org_identifier: orgId.value },
  });
}

// A lapsed rung is sent a little later, so a few forced re-reads follow until next_at moves.
let lapseRecheck: ReturnType<typeof setInterval> | null = null;
function stopLapseRecheck() {
  if (lapseRecheck !== null) clearInterval(lapseRecheck);
  lapseRecheck = null;
}
watch(
  () => {
    const at = escalation.value?.next_at;
    return !!at && nowMicros.value >= at;
  },
  (lapsed) => {
    stopLapseRecheck();
    if (!lapsed) return;
    fetchEscalation(true);
    let triesLeft = LAPSE_RECHECKS;
    lapseRecheck = setInterval(() => {
      if (triesLeft-- <= 0) return stopLapseRecheck();
      recheckProgress();
    }, HOLD_RECHECK_MS);
  },
);
onBeforeUnmount(stopLapseRecheck);

// The newest rung sent in any ladder run; a run restart resets the count but never moves this back.
const lastSentAt = computed(() =>
  escalation.value ? Math.max(0, ...escalation.value.fired.map((rung) => rung.at)) : undefined,
);
// A rung the progress saw sent is on the record and its activity too, which this view read earlier.
watch(lastSentAt, (sent, before) => {
  if (sent !== undefined && before !== undefined && sent > before) refreshRecord();
});

// Triage may release the first page before the deadline, so the progress is re-read while held.
let holdRecheck: ReturnType<typeof setInterval> | null = null;
function stopHoldRecheck() {
  if (holdRecheck !== null) clearInterval(holdRecheck);
  holdRecheck = null;
}
watch(
  () => holdSecondsLeft.value > 0,
  (held) => {
    stopHoldRecheck();
    if (held) holdRecheck = setInterval(recheckProgress, HOLD_RECHECK_MS);
  },
);
onBeforeUnmount(stopHoldRecheck);

// The hold ends at its deadline, so the progress is re-read for the first page it released.
watch(
  () => !!escalation.value?.held_until_micros && holdSecondsLeft.value === 0,
  (released) => {
    if (released) fetchEscalation(true);
  },
);

// The origin-response link stays on this same route with a new responseId
// param, so Vue Router reuses this instance instead of remounting it — the
// fetch has to key off responseId directly rather than firing once on mount.
// Wrapped: a watcher hands the callback the new id, which `force` would read as a yes.
// A linked page reuses this view, so the one left must not stay on screen if the new id fails.
watch(
  responseId,
  () => {
    response.value = null;
    events.value = [];
    escalation.value = null;
    escalationLoaded.value = false;
    policy.value = null;
    onCallPositions.value = [];
    deliveries.value = [];
    teamName.value = "";
    incidentTitle.value = null;
    incidentLoading.value = true;
    timelineReady.value = false;
    subjectAlert.value = null;
    subjectAlertMissing.value = false;
    unackRefusedReason.value = null;
    priorCauses.value = [];
    firingHistory.value = [];
    report.value = null;
    promoteOpen.value = false;
    fetchResponse();
  },
  { immediate: true },
);
</script>
